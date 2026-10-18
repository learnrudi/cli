import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { sha256, validateTaskProfile } from '../../agent-host/task-profile.js';
import { buildClaudePlan } from '../../agent-host/providers/claude.js';
import { launchAgent } from '../../agent-host/launch.js';
import { createLaunchStore } from '../../agent-host/launch-store.js';
import { cmdAgent } from '../../commands/agent-host.js';
import { readAgentTask, runAgentTask, runAgentTaskInSession } from '../../agent-host/task-run.js';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import * as claudeTask from '../../agent-host/task-claude.js';
import { executeForegroundLaunch } from '../../agent-host/events/stream.js';

function taskRequest(root, profile, binding) {
  const reference = (name, value) => {
    const filename = path.join(root, name);
    fs.writeFileSync(filename, value);
    return { path: filename, sha256: sha256(value) };
  };
  return reference('request.json', JSON.stringify({ schema_version: 1,
    task: { id: 'claude-fixture', revision: 1, definition_sha256: 'a'.repeat(64) },
    instructions: reference('instructions.md', 'fixture'),
    execution_profile: reference('profile.json', JSON.stringify(profile)),
    ...binding, timeout_seconds: 30 }));
}

function fixture(t) {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'claude-task-')));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  for (const name of ['project', 'out', 'runtime', 'claude', 'anthropic']) fs.mkdirSync(path.join(root, name), {mode:0o700});
  const binding = { working_directory: path.join(root, 'project'),
    outputs: { deliverables: [path.join(root, 'out')], runtime: path.join(root, 'runtime') } };
  const input = { schema_version: 1, provider: 'claude', model: 'claude-haiku-4-5-20251001',
    workspace_mode: 'registered-shared', working_directory: binding.working_directory,
    read_roots: [binding.working_directory], write_roots: binding.outputs.deliverables,
    network: 'disabled', timeout_ms: 1000, account: {id:'claude-fixture',email:'fixture@example.test',organization_id:'fixture-org',config_directory:path.join(root,'claude'),anthropic_directory:path.join(root,'anthropic')} };
  return { root, binding, input, profile: validateTaskProfile(input, binding) };
}

test('Claude task candidate keeps stdin, exact roots and a closed file-tool surface', t => {
  const { profile, binding, input } = fixture(t);
  const options = { binaryPath: '/native/claude', cwd: profile.working_directory,
    workspaceMode: profile.workspace_mode, taskProfile: profile, model: profile.model,
    prompt: 'fixture', runtimeDirectory: binding.outputs.runtime };
  const plan = buildClaudePlan(options);
  assert.equal(plan.stdin, 'fixture');
  assert.equal(plan.permissionMode, 'registered-shared');
  assert.equal(plan.args[plan.args.indexOf('--tools') + 1], 'Read,Write,Edit');
  assert.equal(plan.args[plan.args.indexOf('--permission-mode') + 1], 'dontAsk');
  assert.ok(plan.args.includes('--restricted'));
  assert.ok(plan.args.includes('--safe-mode'));
  assert.ok(!plan.args.includes('--bare'));
  assert.equal(plan.environment.ANTHROPIC_API_KEY, undefined);
  assert.equal(plan.environment.CLAUDE_CODE_OAUTH_TOKEN, undefined);
  const settings = JSON.parse(plan.args[plan.args.indexOf('--settings') + 1]);
  assert.deepEqual(settings.permissions.allow, profile.write_roots.flatMap(root =>
    [`Write(/${root}/**)`, `Edit(/${root}/**)`]));
  assert.equal(settings.permissions.blockReadsOutsideWorkingDirectories, true);
  for (const override of [{ extraArgs: ['--dangerously-skip-permissions'] }, { permissionMode: 'acceptEdits' },
    { approvalMode: 'never' }, { images: ['image.png'] }, { nativeSessionId: 'old' }]) {
    assert.throws(() => buildClaudePlan({ ...options, ...override }), /forbids|resume/);
  }
  assert.throws(() => validateTaskProfile({ ...input, model: 'haiku' }, binding), /exact/);
  assert.throws(() => validateTaskProfile({ ...input, write_roots: [input.working_directory] }, binding), /write roots/);
});

test('Claude tasks request the same native completion schema in both access modes', t => {
  const { root, profile } = fixture(t);
  t.mock.method(os, 'homedir', () => root);
  const router = path.join(root, '.rudi/bins/rudi-router');
  fs.mkdirSync(path.dirname(router), { recursive: true });
  fs.writeFileSync(router, '#!/bin/sh\nexit 0\n', { mode: 0o700 });
  for (const access_mode of ['restricted', 'trusted']) {
    const args = claudeTask.taskClaudeArgs({ model: profile.model, taskProfile: { ...profile, access_mode } });
    assert.equal(args.filter(value => value === '--json-schema').length, 1);
    const schema = JSON.parse(args[args.indexOf('--json-schema') + 1]);
    assert.equal(schema.type, 'object');
    assert.equal(schema.additionalProperties, false);
    assert.deepEqual(schema.required, ['outcome', 'outputs']);
    assert.deepEqual(schema.properties.outcome.enum, ['complete', 'no_work', 'partial', 'needs_evidence', 'failed']);
    assert.equal(schema.properties.outputs.type, 'array');
    assert.equal(schema.properties.outputs.items.type, 'string');
    assert.equal(schema.properties.outputs.maxItems, 64);
  }
});

test('native fixture retains a failure receipt for malformed provider output', t => {
  const { root } = fixture(t);
  const bin = path.join(root, '.local', 'bin');
  fs.mkdirSync(bin, { recursive: true });
  fs.writeFileSync(path.join(bin, 'claude'), `#!${process.execPath}
if(process.argv.includes('--version')) console.log('2.1.294 (Claude Code)');
else if(process.argv.includes('auth')) console.log(JSON.stringify({loggedIn:true,authMethod:'claude.ai',apiProvider:'firstParty'}));
else console.log('{malformed');`, { mode: 0o700 });
  const script = fileURLToPath(new URL('../../../scripts/verify-task-claude.mjs', import.meta.url));
  const result = spawnSync(process.execPath, [script], { encoding: 'utf8', timeout: 10000,
    env: { HOME: root, TMPDIR: root, PATH: '/usr/bin:/bin' } });
  assert.equal(result.status, 1);
  assert.ok(result.stdout.trim().startsWith('{'), 'fixture must emit its failure receipt');
  const receipt = JSON.parse(result.stdout);
  assert.match(receipt.protocolError, /malformed/);
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(receipt.root, 'receipt.json'))), receipt);
});

test('Claude request binds only a Claude native executable pin', t => {
  const { root, profile, binding } = fixture(t);
  const reference = taskRequest(root, profile, binding);
  const binary = path.join(root, 'native');
  fs.writeFileSync(binary, 'synthetic binary', { mode: 0o700 });
  const digest = sha256(fs.readFileSync(binary));
  assert.throws(() => readAgentTask(reference, {
    RUDI_AGENT_TASK_CODEX_PATH: binary, RUDI_AGENT_TASK_CODEX_SHA256: digest,
  }), /provider.*pin/);
  assert.equal(readAgentTask(reference, {
    RUDI_AGENT_TASK_CLAUDE_PATH: binary, RUDI_AGENT_TASK_CLAUDE_SHA256: digest,
  }).nativeBinary, binary);
  assert.throws(() => readAgentTask(reference, { RUDI_AGENT_TASK_CLAUDE_PATH: binary }), /pin/);
});

for (const mode of ['timeout', 'cancel']) {
  test(`Claude protocol fixture ${mode} terminates a resistant provider without success`, async t => {
    const { root, profile } = fixture(t);
    const store = createLaunchStore({ databasePath: path.join(root, 'stop.db') });
    t.after(() => store.close());
    const launchId = `launch_${mode}`;
    store.create({ launchId, provider: 'claude', model: profile.model, originDirectory: root,
      projectRoot: root, executionWorkspace: root, outputDestination: path.join(root, 'runtime'),
      workspaceMode: profile.workspace_mode });
    const emitter = new EventEmitter();
    const result = await executeForegroundLaunch({ launchId, store,
      plan: { taskProfile: profile, provider: 'claude', model: profile.model, stdin: 'fixture',
        args: ['-e', "process.on('SIGTERM',()=>{});setInterval(()=>{},1000)"],
        spawn: { command: process.execPath, cwd: root }, environment: {}, maxRawOutputBytes: 1024,
        timeouts: { runtimeMs: 1000, shutdownGraceMs: 50 } },
      timeoutMs: mode === 'timeout' ? 200 : 1000,
      onSpawn: () => { if (mode === 'cancel') setTimeout(() => emitter.emit('SIGTERM'), 100); },
      stdout: { write() {} }, stderr: { write() {} }, signalEmitter: emitter });
    assert.notEqual(result.status, 'completed');
    assert.equal(result.taskFinalOutput, null);
    assert.throws(() => process.kill(result.pid, 0), /ESRCH/);
  });
}

test('Claude fixture auth accepts only native first-party seat status and never returns raw account data', () => {
  const probe = value => claudeTask.inspectClaudeTaskSeat('/native/claude', {
    spawnSyncImpl: (_binary, args, options) => {
      assert.deepEqual(args, ['auth', 'status']);
      assert.equal(options.env.ANTHROPIC_API_KEY, undefined);
      return { status: 0, stdout: JSON.stringify(value) };
    },
  });
  assert.deepEqual(probe({ loggedIn: true, authMethod: 'claude.ai', apiProvider: 'firstParty', email: 'private' }),
    { authenticated: true, authMethod: 'claude.ai', apiProvider: 'firstParty' });
  for (const authMethod of ['api_key', 'api_key_helper', 'oauth_token', 'third_party', 'none']) {
    assert.throws(() => probe({ loggedIn: true, authMethod, apiProvider: 'firstParty' }), /native Claude.*seat/);
  }
  assert.throws(() => probe({ loggedIn: false, authMethod: 'claude.ai', apiProvider: 'firstParty' }), /native Claude.*seat/);
});

test('public task check refuses an unqualified host or unauthenticated selected seat before runtime mutation', async t => {
  const { root, profile, binding } = fixture(t);
  const reference = taskRequest(root, profile, binding);
  await assert.rejects(cmdAgent(['task-check', reference.path, reference.sha256], { json: true }), /qualified|seat|account|unavailable/);
  await assert.rejects(runAgentTask(reference), /qualified|seat|account|unavailable/);
  assert.deepEqual(fs.readdirSync(binding.outputs.runtime), []);
});

test('Claude protocol fixture writes a deliverable and binds it to task, job, launch and native session receipts', async t => {
  const { root, profile, binding } = fixture(t);
  const reference = taskRequest(root, profile, binding);
  const output = path.join(root, 'out', 'report.txt');
  const provider = path.join(root, 'provider.cjs');
  fs.writeFileSync(provider, `const fs=require('node:fs');
process.stdin.resume(); process.stdin.on('end',()=>{
fs.writeFileSync(${JSON.stringify(output)},'fixture proof');
console.log(JSON.stringify({type:'system',subtype:'init',session_id:'native-fixture'}));
console.log(JSON.stringify({type:'result',subtype:'success',session_id:'native-fixture',is_error:false,
permission_denials:[],result:'Static review complete.',structured_output:{outcome:'complete',outputs:[${JSON.stringify(output)}]}}));
});`);
  const environment = { RUDI_COMPUTE_JOB_ID: 'job_claude_fixture', RUDI_COMPUTE_ATTEMPT: '1', RUDI_COMPUTE_SPEC_HASH: 'b'.repeat(64) };
  const result = await runAgentTaskInSession(reference, { environment,
    custodyFactory: async () => ({ track: async () => {}, stop: async () => {}, close: async () => {} }),
    launchDependencies: { preflightImpl: async () => {}, taskPreflightImpl: async () => ({account:profile.account}),
      resolveBinaryImpl: () => process.execPath,
      spawnImpl: (_binary, _args, options) => spawn(process.execPath, [provider], options),
      stderr: { write() {} }, signalEmitter: new EventEmitter() } });
  assert.equal(result.status, 'completed');
  const receipt = JSON.parse(fs.readFileSync(result.receipt.path));
  assert.equal(sha256(fs.readFileSync(result.receipt.path)), result.receipt.sha256);
  assert.equal(receipt.outputs[0].sha256, sha256('fixture proof'));
  assert.equal(receipt.launch.native_session_id, 'native-fixture');
  assert.deepEqual(receipt.account, profile.account);
  assert.deepEqual(receipt.observed_account, profile.account);
  assert.equal(receipt.compute.job_id, environment.RUDI_COMPUTE_JOB_ID);
  assert.deepEqual(receipt.request, reference);
  const launch = JSON.parse(fs.readFileSync(receipt.launch_receipt.path));
  assert.equal(sha256(fs.readFileSync(receipt.launch_receipt.path)), receipt.launch_receipt.sha256);
  assert.equal(launch.provider, 'claude');
  assert.equal(launch.launch_id, receipt.launch.id);
  await assert.rejects(runAgentTaskInSession(reference, { environment }), /exists/);
});

test('Claude task completion requires one successful result bound to its initialized session', async t => {
  const { root, profile } = fixture(t);
  const store = createLaunchStore({ databasePath: path.join(root, 'store.db') });
  t.after(() => store.close());
  const init = { type: 'system', subtype: 'init', session_id: 'session-fixture' };
  const result = { type: 'result', subtype: 'success', session_id: init.session_id,
    is_error: false, result: '{"outcome":"no_work","outputs":[]}', permission_denials: [] };
  let count = 0;
  const run = events => launchAgent({ provider: 'claude', model: profile.model, prompt: 'fixture',
    taskProfile: profile, workspace: profile.working_directory, workspaceMode: profile.workspace_mode }, {
    store, artifactsRoot: path.join(root, 'runtime'), idFactory: () => `launch_fixture_${++count}`,
    preflightImpl: async () => {}, taskPreflightImpl: async () => {}, resolveBinaryImpl: () => '/fake/claude',
    spawnImpl: () => {
      const child = new EventEmitter();
      child.stdout = new PassThrough(); child.stderr = new PassThrough(); child.stdin = new PassThrough();
      child.kill = () => true;
      queueMicrotask(() => {
        child.emit('spawn');
        for (const event of events) child.stdout.write(`${typeof event === 'string' ? event : JSON.stringify(event)}\n`);
        child.emit('close', 0, null);
      });
      return child;
    }, stdout: { write() {} }, stderr: { write() {} }, signalEmitter: new EventEmitter(),
  });
  const success = await run([init, result]);
  assert.equal(success.status, 'completed');
  assert.deepEqual(success.taskFinalOutput, { outcome: 'no_work', outputs: [] });
  const structured = await run([init, { ...result, result: 'Static review complete.',
    structured_output: { outcome: 'no_work', outputs: [] } }]);
  assert.equal(structured.status, 'completed');
  assert.deepEqual(structured.taskFinalOutput, { outcome: 'no_work', outputs: [] });
  assert.equal((await run([init, { ...result, result: undefined,
    structured_output: { outcome: 'no_work', outputs: [] } }])).status, 'completed');
  // A present invalid native record cannot fall back to valid JSON in result.
  for (const structured_output of [null, [], 'not an object', {},
    { outcome: 'unknown', outputs: [] }, { outcome: 'failed', outputs: [] },
    { outcome: 'no_work', outputs: 'report.txt' },
    { outcome: 'no_work', outputs: [], extra: true },
    { outcome: 'complete', outputs: ['x'.repeat(65536)] }]) {
    assert.equal((await run([init, { ...result, structured_output }])).status, 'failed');
  }
  const prelude = { type: 'system', subtype: 'ui_invalidate', session_id: init.session_id };
  assert.equal((await run([prelude, init, result])).status, 'completed');
  for (const events of [[init], [result], [init, { ...result, session_id: 'wrong' }],
    [init, '{"type":"result","subtype":"success","session_id":"session-fixture","is_error":true,"is_error":false,"permission_denials":[],"result":"{\\"outcome\\":\\"no_work\\",\\"outputs\\":[]}"}'],
    [init, { ...result, is_error: true }], [init, { ...result, subtype: 'error_max_turns' }],
    [init, result, result], [init, { ...result, permission_denials: [{ tool_name: 'Write' }] }],
    [init, { ...result, result: '{"outcome":"no_work","outcome":"complete","outputs":[]}' }],
    [init, { ...result, result: 'Static review complete.' }],
    [init, { type: 'turn.completed' }]]) {
    const failed = await run(events);
    assert.equal(failed.status, 'failed', JSON.stringify(events));
  }
});
