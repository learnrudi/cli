import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { sha256 } from '../../agent-host/task-profile.js';
import { runAgentTask } from '../../agent-host/task-run.js';

test('bridge receipt binds task/job/launch and hashes only allowed regular outputs', async t => {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'task-run-')));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  for (const d of ['project', 'out', 'runtime']) fs.mkdirSync(path.join(root, d));
  const ref = (name, value) => { const p = path.join(root, name); fs.writeFileSync(p, value); return { path: p, sha256: sha256(value) }; };
  const profile = { schema_version: 1, provider: 'codex', model: 'gpt-5.6-sol', workspace_mode: 'registered-shared',
    working_directory: path.join(root, 'project'), read_roots: [path.join(root, 'project')], write_roots: [path.join(root, 'out')], network: 'disabled', timeout_ms: 1000 };
  const request = { schema_version: 1, task: { id: 'fixture', revision: 1, definition_sha256: 'a'.repeat(64) },
    instructions: ref('instructions.md', 'test'), execution_profile: ref('profile.json', JSON.stringify(profile)),
    working_directory: profile.working_directory, outputs: { deliverables: profile.write_roots, runtime: path.join(root, 'runtime') }, timeout_seconds: 30 };
  const requestRef = ref('request.json', JSON.stringify(request));
  const output = path.join(root, 'out', 'report.txt'); fs.writeFileSync(output, 'proof');
  const environment = { RUDI_COMPUTE_JOB_ID: 'job_fixture', RUDI_COMPUTE_ATTEMPT: '1', RUDI_COMPUTE_SPEC_HASH: 'b'.repeat(64) };
  const launchImpl = async options => ({ launchId: 'launch_fixture', nativeSessionId: 'native_fixture', status: 'completed',
    provider: 'codex', model: profile.model, executionWorkspace: options.workspace,
    taskFinalOutput: { outcome: 'complete', outputs: [output] } });
  const result = await runAgentTask(requestRef, { environment, launchImpl });
  const receipt = JSON.parse(fs.readFileSync(result.receipt.path, 'utf8'));
  assert.equal(sha256(fs.readFileSync(result.receipt.path)), result.receipt.sha256);
  assert.equal(receipt.task.revision, 1); assert.equal(receipt.compute.job_id, 'job_fixture');
  assert.equal(receipt.outputs[0].sha256, sha256('proof'));
  assert.equal(receipt.launch.native_session_id, 'native_fixture');
  await assert.rejects(() => runAgentTask(requestRef, { environment, launchImpl }), /exists/);
  const outside = async () => ({ launchId: 'launch_other', nativeSessionId: 'native_fixture', status: 'completed',
    taskFinalOutput: { outcome: 'complete', outputs: [requestRef.path] } });
  const rejected = await runAgentTask(requestRef, { environment: { ...environment, RUDI_COMPUTE_JOB_ID: 'job_other' }, launchImpl: outside });
  assert.equal(rejected.status, 'failed');
  assert.match(JSON.parse(fs.readFileSync(rejected.receipt.path)).error, /output/);
  const pinned = ref('native-a', 'approved native bytes');
  const other = ref('native-b', 'different native bytes');
  fs.chmodSync(pinned.path, 0o700);
  fs.chmodSync(other.path, 0o700);
  const pinnedEnvironment = {...environment, RUDI_COMPUTE_JOB_ID:'job_pinned',
    RUDI_AGENT_TASK_CODEX_PATH:pinned.path, RUDI_AGENT_TASK_CODEX_SHA256:pinned.sha256};
  const pinnedResult = await runAgentTask(requestRef, {environment:pinnedEnvironment,
    launchDependencies:{resolveBinaryImpl:()=>other.path}, launchImpl:async (options, dependencies)=>{
      assert.equal(dependencies.resolveBinaryImpl('codex'), pinned.path);
      return launchImpl(options);
    }});
  assert.equal(pinnedResult.status, 'completed', 'guarded native A must override ambient native B');
  fs.writeFileSync(pinned.path, 'changed native');
  await assert.rejects(runAgentTask(requestRef,{environment:{...pinnedEnvironment,RUDI_COMPUTE_JOB_ID:'job_drift'}}),/native.*pin/);
  assert.equal(fs.existsSync(path.join(root,'runtime','job_drift-attempt-1')),false);
  fs.writeFileSync(path.join(root,'runtime','agent-hosts.db'),'corrupt fixture database');
  await assert.rejects(runAgentTask(requestRef,{environment:{...environment,RUDI_COMPUTE_JOB_ID:'job_badstore'},launchImpl}),/database/);
  assert.equal(fs.existsSync(path.join(root,'runtime','custody.lock')),false,'database open failure must not strand custody');
});
