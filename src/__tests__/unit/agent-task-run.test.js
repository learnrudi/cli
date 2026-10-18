import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { sha256 } from '../../agent-host/task-profile.js';
import { readAgentTask, runAgentTaskInSession, runAgentTask as dispatchAgentTask } from '../../agent-host/task-run.js';
const runAgentTask=(reference,dependencies={})=>runAgentTaskInSession(reference,{...dependencies,
  custodyFactory:async()=>({track:async()=>{},stop:async()=>{},close:async()=>{}})});

test('public capsule dispatch rejects provider injection before resolving any task',async()=>{
  await assert.rejects(dispatchAgentTask(null,{launchDependencies:{resolveBinaryImpl:()=>{throw new Error('must not resolve');}}}),/unsupported capsule dependency/);
});

test('bridge receipt binds task/job/launch and hashes only allowed regular outputs', async t => {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'task-run-')));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  for (const d of ['project', 'out', 'runtime']) fs.mkdirSync(path.join(root, d));
  const ref = (name, value) => { const p = path.join(root, name); fs.writeFileSync(p, value); return { path: p, sha256: sha256(value) }; };
  const profile = { schema_version: 1, provider: 'codex', model: 'gpt-5.6-sol', workspace_mode: 'registered-shared',
    working_directory: path.join(root, 'project'), read_roots: [path.join(root, 'project')], write_roots: [path.join(root, 'out')], network: 'disabled', timeout_ms: 0 };
  const request = { schema_version: 1, task: { id: 'fixture', revision: 1, definition_sha256: 'a'.repeat(64) },
    instructions: ref('instructions.md', 'test'), execution_profile: ref('profile.json', JSON.stringify(profile)),
    working_directory: profile.working_directory, outputs: { deliverables: profile.write_roots, runtime: path.join(root, 'runtime') }, timeout_seconds: 0 };
  const requestRef = ref('request.json', JSON.stringify(request));
  assert.throws(() => readAgentTask(ref('mismatched.json', JSON.stringify({ ...request, timeout_seconds: 30 }))), /timeout|budget/);
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

test('both providers record explicit effort and selected native account in bound receipts', async t => {
  for (const provider of ['codex', 'claude']) {
    const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'task-profile-receipt-')));
    t.after(() => fs.rmSync(root, { recursive: true, force: true }));
    for (const name of ['project', 'out', 'runtime', 'account', 'anthropic']) fs.mkdirSync(path.join(root, name), { mode: 0o700 });
    const account = { id: `${provider}-work`, email: 'work@example.test', config_directory: path.join(root, 'account'),
      ...(provider === 'claude' ? { organization_id: 'org-fixture', anthropic_directory: path.join(root, 'anthropic') } : {}) };
    const profile = { schema_version: 1, provider, model: provider === 'codex' ? 'gpt-5.6-sol' : 'claude-sonnet-5',
      reasoning_effort: 'high', account, workspace_mode: 'registered-shared', working_directory: path.join(root, 'project'),
      read_roots: [path.join(root, 'project')], write_roots: [path.join(root, 'out')], network: 'disabled', timeout_ms: 1000 };
    const ref = (name, value) => { const filename = path.join(root, name); fs.writeFileSync(filename, value); return { path: filename, sha256: sha256(value) }; };
    const request = { schema_version: 1, task: { id: 'fixture', revision: 1, definition_sha256: 'a'.repeat(64) },
      instructions: ref('instructions.md', 'fixture'), execution_profile: ref('profile.json', JSON.stringify(profile)),
      working_directory: profile.working_directory, outputs: { deliverables: profile.write_roots, runtime: path.join(root, 'runtime') }, timeout_seconds: 30 };
    const result = await runAgentTask(ref('request.json', JSON.stringify(request)), {
      environment: { RUDI_COMPUTE_JOB_ID: 'job_profile_receipt', RUDI_COMPUTE_ATTEMPT: '1', RUDI_COMPUTE_SPEC_HASH: 'b'.repeat(64) },
      launchImpl: async options => {
        assert.equal(options.taskProfile.reasoning_effort, 'high');
        return { launchId: 'launch_profile', nativeSessionId: 'native_profile', status: 'completed', taskAccount: account,
          taskFinalOutput: { outcome: 'no_work', outputs: [] } };
      },
    });
    assert.equal(result.status, 'completed');
    const completion = JSON.parse(fs.readFileSync(result.receipt.path, 'utf8'));
    const launch = JSON.parse(fs.readFileSync(completion.launch_receipt.path, 'utf8'));
    for (const receipt of [launch, completion]) {
      assert.equal(receipt.reasoning_effort, 'high');
      assert.deepEqual(receipt.account, account);
      assert.deepEqual(receipt.observed_account, account);
      assert.deepEqual(receipt.execution_profile, request.execution_profile);
    }
  }
});

test('manual admission rejects a Codex login that differs from the selected account', async t => {
  const { checkAgentTask } = await import('../../agent-host/task-run.js');
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'task-admission-account-')));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  for (const name of ['project', 'out', 'runtime', 'account']) fs.mkdirSync(path.join(root, name), { mode: 0o700 });
  const ref = (name, text) => { const filename = path.join(root, name); fs.writeFileSync(filename, text); return { path: filename, sha256: sha256(text) }; };
  const account = { id: 'codex-work', email: 'wanted@example.test', config_directory: path.join(root, 'account') };
  const profile = { schema_version: 1, provider: 'codex', model: 'gpt-5.6-sol', account, reasoning_effort: 'high',
    workspace_mode: 'registered-shared', working_directory: path.join(root, 'project'), read_roots: [path.join(root, 'project')],
    write_roots: [path.join(root, 'out')], network: 'disabled', timeout_ms: 1000 };
  const request = { schema_version: 1, task: { id: 'fixture', revision: 1, definition_sha256: 'a'.repeat(64) },
    instructions: ref('instructions.md', 'fixture'), execution_profile: ref('profile.json', JSON.stringify(profile)),
    working_directory: profile.working_directory, outputs: { deliverables: profile.write_roots, runtime: path.join(root, 'runtime') }, timeout_seconds: 30 };
  const native = ref('native.cjs', `#!${process.execPath}\nconst readline=require('node:readline');
readline.createInterface({input:process.stdin}).on('line',line=>{const r=JSON.parse(line);
if(r.method==='initialize')console.log(JSON.stringify({id:r.id,result:{}}));
if(r.method==='account/read')console.log(JSON.stringify({id:r.id,result:{account:{type:'chatgpt',email:'wrong@example.test'}}}));});\n`);
  fs.chmodSync(native.path, 0o700);
  const requestRef = ref('request.json', JSON.stringify(request));
  await assert.rejects(async () => checkAgentTask(requestRef, {
    RUDI_AGENT_TASK_CODEX_PATH: native.path, RUDI_AGENT_TASK_CODEX_SHA256: native.sha256,
  }), /account does not match/);
  assert.deepEqual(fs.readdirSync(path.join(root, 'runtime')), []);
});
