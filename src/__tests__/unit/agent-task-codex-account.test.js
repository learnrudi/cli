import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { validateTaskProfile } from '../../agent-host/task-profile.js';
import { buildCodexPlan } from '../../agent-host/providers/codex.js';

function fixture(t) {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'task-codex-account-')));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  for (const name of ['project', 'out', 'runtime', 'codex']) fs.mkdirSync(path.join(root, name), { mode: 0o700 });
  const binding = { working_directory: path.join(root, 'project'), outputs: {
    runtime: path.join(root, 'runtime'), deliverables: [path.join(root, 'out')] } };
  const account = { id: 'codex-work', email: 'operator@example.test', config_directory: path.join(root, 'codex') };
  return { binding, account, input: { schema_version: 1, provider: 'codex', model: 'gpt-5.6-sol',
    workspace_mode: 'registered-shared', working_directory: binding.working_directory,
    read_roots: [binding.working_directory], write_roots: binding.outputs.deliverables,
    network: 'disabled', timeout_ms: 1000, account } };
}

test('selected Codex account uses its own native home and file credential store', t => {
  const { input, binding, account } = fixture(t);
  const profile = validateTaskProfile(input, binding);
  const plan = buildCodexPlan({ binaryPath: '/native/codex', cwd: profile.working_directory,
    workspaceMode: profile.workspace_mode, taskProfile: profile, model: profile.model,
    prompt: 'fixture', runtimeDirectory: binding.outputs.runtime });
  assert.equal(plan.environment.CODEX_HOME, account.config_directory);
  assert.equal(plan.environment.OPENAI_API_KEY, undefined);
  assert.equal(plan.environment.CODEX_API_KEY, undefined);
  assert.ok(plan.args.includes('cli_auth_credentials_store="file"'));
  assert.ok(Object.isFrozen(profile.account));
});

test('Codex account directories reject task overlap, aliases, exposed permissions and local config', t => {
  const { input, binding, account } = fixture(t);
  assert.throws(() => validateTaskProfile({ ...input, read_roots: [path.dirname(account.config_directory), ...input.read_roots] }, binding), /overlaps/);
  assert.throws(() => validateTaskProfile({ ...input, account: { ...account, token: 'never-store' } }, binding), /fields/);
  fs.chmodSync(account.config_directory, 0o755);
  assert.throws(() => validateTaskProfile(input, binding), /private/);
  fs.chmodSync(account.config_directory, 0o700);
  const alias = path.join(path.dirname(account.config_directory), 'alias');
  fs.symlinkSync(account.config_directory, alias);
  assert.throws(() => validateTaskProfile({ ...input, account: { ...account, config_directory: alias } }, binding), /canonical/);
  fs.writeFileSync(path.join(account.config_directory, 'config.toml'), 'model_provider="other"');
  assert.throws(() => validateTaskProfile(input, binding), /configuration/);
});

test('native Codex identity probe binds the selected login and never asks for tokens or a session', async t => {
  const { EventEmitter } = await import('node:events');
  const { PassThrough } = await import('node:stream');
  const { inspectCodexTaskSeat } = await import('../../agent-host/task-codex-account.js');
  const { taskEnvironment } = await import('../../agent-host/task-codex.js');
  const { input, binding, account } = fixture(t);
  const profile = validateTaskProfile(input, binding);
  const requests = [];
  function spawnImpl(_binary, args, options) {
    assert.equal(options.env.CODEX_HOME, account.config_directory);
    assert.ok(args.includes('cli_auth_credentials_store="file"'));
    const child = new EventEmitter();
    child.stdin = new PassThrough(); child.stdout = new PassThrough(); child.stderr = new PassThrough();
    child.kill = signal => { assert.equal(signal, 'SIGKILL'); queueMicrotask(() => child.emit('close', null, signal)); };
    child.stdin.on('data', data => {
      const request = JSON.parse(data.toString()); requests.push(request);
      if (request.method === 'initialize') queueMicrotask(() => child.stdout.write('{"id":1,"result":{}}\n'));
      if (request.method === 'account/read') queueMicrotask(() => child.stdout.write(JSON.stringify({ id: 2,
        result: { account: { type: 'chatgpt', email: account.email, planType: 'team' } } }) + '\n'));
    });
    return child;
  }
  const observed = await inspectCodexTaskSeat('/native/codex', profile, taskEnvironment('/native/codex', profile), { spawnImpl });
  assert.equal(observed.email, account.email);
  assert.deepEqual(requests.map(item => item.method), ['initialize', 'initialized', 'account/read']);
  assert.equal(requests[2].params.refreshToken, false);
  await assert.rejects(() => inspectCodexTaskSeat('/native/codex', { ...profile, account: { ...account, email: 'other@example.test' } },
    taskEnvironment('/native/codex', profile), { spawnImpl }), /does not match/);
});

test('native account protocol rejects duplicate identity keys without exposing diagnostics', async t => {
  const { inspectCodexTaskSeat } = await import('../../agent-host/task-codex-account.js');
  const { taskEnvironment } = await import('../../agent-host/task-codex.js');
  const { input, binding, account } = fixture(t);
  const profile = validateTaskProfile(input, binding);
  const native = path.join(path.dirname(account.config_directory), 'protocol.cjs');
  const response = '{"id":2,"result":{"account":{"type":"apiKey"},"account":{"type":"chatgpt","email":"operator@example.test"}}}';
  fs.writeFileSync(native, `#!${process.execPath}\nconst rl=require('node:readline').createInterface({input:process.stdin});
rl.on('line',line=>{const r=JSON.parse(line);if(r.id===1)console.log('{"id":1,"result":{}}');
if(r.id===2){process.stderr.write('diagnostic-secret-canary');console.log(${JSON.stringify(response)});}});`, { mode: 0o700 });
  await assert.rejects(() => inspectCodexTaskSeat(native, profile, taskEnvironment(native, profile)), error => {
    assert.match(error.message, /inspection failed/);
    assert.ok(!error.message.includes('diagnostic-secret-canary'));
    return true;
  });
});

test('native account metadata survives a UTF-8 character split between output chunks', async t => {
  const { inspectCodexTaskSeat } = await import('../../agent-host/task-codex-account.js');
  const { taskEnvironment } = await import('../../agent-host/task-codex.js');
  const { input, binding, account } = fixture(t);
  const profile = validateTaskProfile({ ...input, account: { ...account, email: 'opérator@example.test' } }, binding);
  const native = path.join(path.dirname(account.config_directory), 'unicode.cjs');
  fs.writeFileSync(native, `#!${process.execPath}\nconst rl=require('node:readline').createInterface({input:process.stdin});
rl.on('line',line=>{const r=JSON.parse(line);if(r.id===1)console.log('{"id":1,"result":{}}');
if(r.id===2){const bytes=Buffer.from(JSON.stringify({id:2,result:{account:{type:'chatgpt',email:'opérator@example.test'}}})+'\\n');
const split=bytes.indexOf(Buffer.from('é'))+1;process.stdout.write(bytes.subarray(0,split));setTimeout(()=>process.stdout.write(bytes.subarray(split)),50);}});`, { mode: 0o700 });
  const observed = await inspectCodexTaskSeat(native, profile, taskEnvironment(native, profile));
  assert.equal(observed.email, profile.account.email);
});

test('native account inspection cleans up descendants retaining its output pipes', async t => {
  const { inspectCodexTaskSeat } = await import('../../agent-host/task-codex-account.js');
  const { taskEnvironment } = await import('../../agent-host/task-codex.js');
  const { input, binding, account } = fixture(t);
  const profile = validateTaskProfile(input, binding);
  const native = path.join(path.dirname(account.config_directory), 'inherited-pipes.cjs');
  fs.writeFileSync(native, `#!${process.execPath}\nconst rl=require('node:readline').createInterface({input:process.stdin});
rl.on('line',line=>{const r=JSON.parse(line);if(r.id===1)console.log('{"id":1,"result":{}}');
if(r.id===2){require('node:child_process').spawn(process.execPath,['-e','setTimeout(()=>{},12000)'],{stdio:['ignore',1,2]});
console.log(JSON.stringify({id:2,result:{account:{type:'chatgpt',email:'operator@example.test'}}}));}});`, { mode: 0o700 });
  const started = performance.now();
  const observed = await inspectCodexTaskSeat(native, profile, taskEnvironment(native, profile));
  assert.equal(observed.email, account.email);
  assert.ok(performance.now() - started < 2000, 'account probe must close its private process group without waiting on inherited pipes');
});

test('native account inspection deadline rejects even when a stopped process never closes', async t => {
  const { EventEmitter } = await import('node:events');
  const { PassThrough } = await import('node:stream');
  const { inspectCodexTaskSeat } = await import('../../agent-host/task-codex-account.js');
  const { input, binding } = fixture(t);
  const profile = validateTaskProfile(input, binding);
  t.mock.timers.enable({ apis: ['setTimeout'] });
  let killed = false, completed = false;
  const child = new EventEmitter();
  child.stdin = new PassThrough(); child.stdout = new PassThrough(); child.stderr = new PassThrough();
  child.kill = () => { killed = true; };
  child.stdin.on('data', data => {
    const request = JSON.parse(data.toString());
    if (request.id === 1) child.stdout.write('{"id":1,"result":{}}\n');
    if (request.id === 2) child.stdout.write(JSON.stringify({ id: 2,
      result: { account: { type: 'chatgpt', email: profile.account.email } } }) + '\n');
  });
  const pending = inspectCodexTaskSeat('/native/codex', profile, {}, { spawnImpl: () => child });
  const checked = assert.rejects(pending, /timed out/).then(() => { completed = true; });
  assert.equal(killed, true);
  t.mock.timers.tick(10000);
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(completed, true, 'deadline must settle without an exit or close event');
  await checked;
  assert.equal(child.stdout.destroyed, true);
  assert.equal(child.stderr.destroyed, true);
});

test('native account inspection cleans up a helper after an unexpected native exit', async t => {
  const { inspectCodexTaskSeat } = await import('../../agent-host/task-codex-account.js');
  const { taskEnvironment } = await import('../../agent-host/task-codex.js');
  const { input, binding, account } = fixture(t);
  const profile = validateTaskProfile(input, binding);
  const native = path.join(path.dirname(account.config_directory), 'early-exit.cjs');
  const pidFile = path.join(path.dirname(account.config_directory), 'helper.pid');
  fs.writeFileSync(native, `#!${process.execPath}\nconst child=require('node:child_process').spawn(process.execPath,['-e','setTimeout(()=>{},2000)'],{stdio:['ignore',1,2]});
require('node:fs').writeFileSync(${JSON.stringify(pidFile)},String(child.pid));process.exit(1);`, { mode: 0o700 });
  await assert.rejects(() => inspectCodexTaskSeat(native, profile, taskEnvironment(native, profile)), /inspection/);
  const pid = Number(fs.readFileSync(pidFile, 'utf8'));
  let alive = true;
  for (let attempt = 0; attempt < 20 && alive; attempt++) {
    try { process.kill(pid, 0); } catch (error) { if (error.code === 'ESRCH') alive = false; else throw error; }
    if (alive) await new Promise(resolve => setTimeout(resolve, 25));
  }
  assert.equal(alive, false, 'unexpected native exit must not leave its helper running');
});
