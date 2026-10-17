import fs from 'node:fs';
import path from 'node:path';
import { runTaskCapsule } from './task-capsule.js';
import { launchAgent } from './launch.js';
import { openTaskCustody, recoverTaskCustody } from './task-custody.js';
import { createLaunchStore } from './launch-store.js';
import { canonicalDirectory, exactFields, inside, parseTaskJson, readTaskReference, readTaskRegularFile, sha256, taskText, validateTaskProfile } from './task-profile.js';

function pinnedNative(environment) {
  const binary = environment.RUDI_AGENT_TASK_CODEX_PATH;
  const digest = environment.RUDI_AGENT_TASK_CODEX_SHA256;
  if (binary === undefined && digest === undefined) return null;
  if (typeof binary !== 'string' || !path.isAbsolute(binary) || !/^[a-f0-9]{64}$/u.test(digest || '')
      || fs.realpathSync(binary) !== binary
      || sha256(readTaskRegularFile(binary, 512 * 1024 * 1024, true)) !== digest) {
    throw new Error('task native executable pin mismatch');
  }
  fs.accessSync(binary, fs.constants.X_OK);
  return binary;
}

export function readAgentTask(reference, environment = process.env) {
  const nativeBinary = pinnedNative(environment);
  const request = parseTaskJson(readTaskReference(reference, 'task request'));
  exactFields(request, ['schema_version', 'task', 'instructions', 'execution_profile', 'working_directory', 'outputs', 'timeout_seconds'], 'task request');
  exactFields(request.task, ['id', 'revision', 'definition_sha256'], 'task binding');
  exactFields(request.outputs, ['deliverables', 'runtime'], 'task outputs');
  if (request.schema_version !== 1 || !/^[a-z][a-z0-9-]{0,63}$/u.test(request.task.id)
      || !Number.isSafeInteger(request.task.revision) || request.task.revision < 1
      || !/^[a-f0-9]{64}$/u.test(request.task.definition_sha256)
      || !Number.isSafeInteger(request.timeout_seconds) || request.timeout_seconds < 21 || request.timeout_seconds > 3620) {
    throw new Error('invalid task request identity/version/budget');
  }
  canonicalDirectory(request.working_directory, 'task working directory');
  const instructions = readTaskReference(request.instructions, 'task instructions');
  if (!instructions.trim()) throw new Error('empty instructions');
  const profile = validateTaskProfile(parseTaskJson(readTaskReference(request.execution_profile, 'execution profile')), request);
  if (profile.timeout_ms > (request.timeout_seconds - 20) * 1000) throw new Error('native timeout must leave 20 seconds for bridge shutdown');
  if (inside(request.outputs.runtime, request.working_directory) || inside(request.working_directory, request.outputs.runtime)) throw new Error('task runtime and workspace overlap');
  for (const control of [reference.path, request.instructions.path, request.execution_profile.path]) {
    if (profile.write_roots.some(root => inside(control, root))) throw new Error('task control references cannot be writable outputs');
  }
  return { request, profile, instructions, nativeBinary };
}

function writeReceipt(filename, value) {
  const bytes = `${JSON.stringify(value, null, 2)}\n`;
  const fd = fs.openSync(filename, 'wx', 0o600);
  try { fs.writeFileSync(fd, bytes); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
  return { path: filename, sha256: sha256(bytes) };
}

function computeBinding(environment) {
  const job = environment.RUDI_COMPUTE_JOB_ID;
  const attempt = environment.RUDI_COMPUTE_ATTEMPT;
  const hash = environment.RUDI_COMPUTE_SPEC_HASH;
  if (!/^job_[A-Za-z0-9_-]{4,123}$/u.test(job || '') || attempt !== '1' || !/^[a-f0-9]{64}$/u.test(hash || '')) {
    throw new Error('task runner requires a valid Compute job/spec binding and first attempt');
  }
  return { job_id: job, attempt: 1, spec_sha256: hash };
}

function verifyOutputs(manifest, profile) {
  exactFields(manifest, ['outcome', 'outputs'], 'task final manifest');
  if (!['complete', 'no_work', 'partial', 'needs_evidence'].includes(manifest.outcome)
      || !Array.isArray(manifest.outputs) || manifest.outputs.length > 64
      || (manifest.outcome === 'complete' && manifest.outputs.length === 0)
      || (manifest.outcome === 'no_work' && manifest.outputs.length !== 0)
      || new Set(manifest.outputs).size !== manifest.outputs.length) throw new Error('invalid task output manifest');
  return manifest.outputs.map(filename => {
    taskText(filename, 'output path');
    if (!path.isAbsolute(filename) || fs.realpathSync(filename) !== filename
        || !profile.write_roots.some(root => inside(filename, root))) throw new Error('output path outside declared roots or aliased');
    const bytes = readTaskRegularFile(filename, 32 * 1024 * 1024, true);
    return { path: filename, sha256: sha256(bytes), bytes: bytes.length };
  });
}

export async function runAgentTask(reference, dependencies = {}) {
  if(Object.keys(dependencies).some(key=>key!=='environment'))throw new Error('unsupported capsule dependency; use the explicit in-session fixture interface');
  const environment=dependencies.environment || process.env;
  const {request}=readAgentTask(reference,environment);
  computeBinding(environment);
  return runTaskCapsule(reference,request,environment);
}

export async function runAgentTaskInSession(reference, dependencies = {}) {
  const { request, profile, instructions, nativeBinary } = readAgentTask(reference, dependencies.environment || process.env);
  const compute = computeBinding(dependencies.environment || process.env);
  const runDirectory = path.join(request.outputs.runtime, `${compute.job_id}-attempt-1`);
  fs.mkdirSync(runDirectory, { mode: 0o700 }); // Exclusive: an interrupted run is evidence, never replayed in place.
  const base = { schema_version: 1, task: request.task, request: reference, compute,
    instructions: request.instructions, execution_profile: request.execution_profile };
  const store = createLaunchStore({ databasePath: path.join(request.outputs.runtime, 'agent-hosts.db') });
  let custody;
  try { custody = await (dependencies.custodyFactory || openTaskCustody)({capsule:dependencies.capsule,runtime:request.outputs.runtime,runDirectory,jobId:compute.job_id,
    workerPath:dependencies.custodyWorkerPath}); }
  catch (error) {store.close();throw error;}
  let launchReference = null;
  let launch = null;
  let outputs = [];
  let error = null;
  const recordLaunch = value => {
    if (!launchReference) launchReference = writeReceipt(path.join(runDirectory, 'launch.json'), {
      ...base, launch_id: value.launchId, provider: profile.provider, model: profile.model,
      working_directory: request.working_directory, workspace_mode: profile.workspace_mode,
    });
  };
  try {
    const launchImpl = dependencies.launchImpl || launchAgent;
    launch = await launchImpl({ provider: profile.provider, model: profile.model, taskProfile: profile,
      workspaceMode: profile.workspace_mode, workspace: request.working_directory, originDirectory: request.working_directory,
      outputDirectory: path.join(runDirectory, 'host'),
      prompt: `${instructions}\n\nReturn a final JSON object with exactly outcome and outputs. outcome is complete, no_work, partial, needs_evidence, or failed. outputs is an array of absolute paths to files produced in the declared write roots. complete requires at least one file; no_work requires none. Do not include Markdown fences.\nDeclared write roots: ${JSON.stringify(profile.write_roots)}`,
    }, { ...dependencies.launchDependencies,
      ...(nativeBinary ? {resolveBinaryImpl:()=>nativeBinary} : {}), taskStop:()=>custody.stop(), store, onSpawn: async value => {
      await custody.track(value.pid);
      recordLaunch(value);
    }, stdout: { write() {} } });
    recordLaunch(launch);
    if (launch.status !== 'completed' || !launch.nativeSessionId) throw new Error(launch.lastError || 'native launch did not complete');

  } catch (caught) { error = String(caught.message || 'task execution failed').slice(0, 2048); }
  finally {
    store.close();
    dependencies.beforeCustodyClose?.();
    try { await custody.close(); } catch (caught) { error = `Task custody unresolved: ${caught.message}`.slice(0,2048); }
  }
  if(!error) {
    try {outputs=verifyOutputs(launch.taskFinalOutput,profile);}catch(caught){error=String(caught.message).slice(0,2048);}
  }
  const receipt = writeReceipt(path.join(runDirectory, 'completion.json'), {
    ...base, status: error ? 'failed' : 'completed', outcome: error ? 'failed' : launch.taskFinalOutput.outcome,
    launch_receipt: launchReference,
    launch: launch ? { id: launch.launchId, native_session_id: launch.nativeSessionId || null } : null,
    outputs, error, finished_at: new Date().toISOString(),
  });
  return { status: error ? 'failed' : 'completed', receipt };
}

export async function recoverAgentTask(reference) {
  const {request} = readAgentTask(reference);
  return {schema_version:1,kind:'agent-task-recovery',request:reference,
    ...await recoverTaskCustody(request.outputs.runtime)};
}
