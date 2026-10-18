import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { launchAgent } from '../../agent-host/launch.js';
import { createLaunchStore } from '../../agent-host/launch-store.js';
import { validateTaskProfile } from '../../agent-host/task-profile.js';

function fixture(t, timeout_ms = 1000) {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'task-launch-')));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  for (const d of ['project', 'project/out', 'runtime']) fs.mkdirSync(path.join(root, d));
  const binding = { working_directory: path.join(root, 'project'), outputs: { deliverables: [path.join(root, 'project/out')], runtime: path.join(root, 'runtime') } };
  const profile = validateTaskProfile({ schema_version: 1, provider: 'codex', model: 'gpt-5.6-sol',
    workspace_mode: 'registered-shared', working_directory: binding.working_directory,
    read_roots: [binding.working_directory], write_roots: binding.outputs.deliverables, network: 'disabled', timeout_ms }, binding);
  const store = createLaunchStore({ databasePath: path.join(root, 'state.db') });
  t.after(() => store.close());
  return { root, profile, store };
}

function spawnFixture(events, calls) {
  return (command, args, options) => {
    calls.push(options);
    const child = new EventEmitter();
    child.stdout = new PassThrough(); child.stderr = new PassThrough(); child.stdin = new PassThrough();
    child.kill = () => true;
    queueMicrotask(() => {
      child.emit('spawn');
      for (const event of events) child.stdout.write(`${JSON.stringify(event)}\n`);
      child.emit('close', 0, null);
    });
    return child;
  };
}

test('task close never signals a process group without verified identity', async t => {
  const {root,profile,store}=fixture(t);const signals=[];
  const originalKill=process.kill.bind(process);
  t.mock.method(process,'kill',(pid,signal)=>{
    if(pid===-987654) {if(signal!==0)signals.push(signal);return true;}
    return originalKill(pid,signal);
  });
  await launchAgent({provider:'codex',model:profile.model,prompt:'fixture',taskProfile:profile,
    workspace:profile.working_directory,workspaceMode:'registered-shared'}, {
    artifactsRoot:path.join(root,'runtime'),store,idFactory:()=> 'launch_unowned',
    preflightImpl:async()=>{},taskPreflightImpl:async()=>{},resolveBinaryImpl:()=>'/fake/codex',
    spawnImpl:(...args)=>{const child=spawnFixture([],[])(...args);child.pid=987654;return child;},
    stdout:{write(){}},stderr:{write(){}},signalEmitter:new EventEmitter(),
  });
  assert.deepEqual(signals,[]);
});

test('task launch requires native terminal success, preserves final output and uses isolated environment', async t => {
  const { root, profile, store } = fixture(t);
  const calls = [];
  const events = [ { type: 'thread.started', thread_id: 'thread_fixture' },
    { type: 'item.completed', item: { type: 'agent_message', text: '{"outcome":"no_work","outputs":[]}' } },
    { type: 'turn.completed', usage: {} } ];
  let n = 0;
  const run = eventList => launchAgent({ provider: 'codex', model: profile.model, prompt: 'fixture', taskProfile: profile,
    workspace: profile.working_directory, workspaceMode: 'registered-shared' }, {
    artifactsRoot: path.join(root, 'runtime'), store, idFactory: () => `launch_fixture_${++n}`,
    preflightImpl: async () => {}, taskPreflightImpl: async () => {}, resolveBinaryImpl: () => '/fake/codex',
    spawnImpl: spawnFixture(eventList, calls), stdout: { write() {} }, stderr: { write() {} }, signalEmitter: new EventEmitter(),
  });
  const result = await run(events);
  assert.equal(result.status, 'completed');
  assert.equal(result.taskFinalOutput.outcome, 'no_work');
  assert.equal(calls[0].detached, true);
  assert.equal(calls[0].env.OPENAI_API_KEY, undefined);
  const incomplete = await run(events.slice(0, 2));
  assert.equal(incomplete.status, 'failed');
  assert.match(incomplete.lastError, /terminal/);
  const failed = await run([...events, { type: 'turn.failed', error: { message: 'failed' } }]);
  assert.equal(failed.status, 'failed');
});

test('legacy launch store migration preserves parent/native pointers and rejects shared resume/discard', async t => {
  const Database = (await import('better-sqlite3')).default;
  const { resumeAgent } = await import('../../agent-host/resume.js');
  const { discardAgentLaunch } = await import('../../agent-host/workspace-lifecycle.js');
  const { root, profile, store } = fixture(t);
  const projection = { provider: 'codex', model: profile.model, originDirectory: profile.working_directory,
    projectRoot: profile.working_directory, executionWorkspace: profile.working_directory,
    outputDestination: path.join(root, 'runtime', 'legacy'), workspaceMode: 'read-only' };
  store.create({ ...projection, launchId: 'launch_parent', nativeSessionId: 'native_parent' });
  store.create({ ...projection, launchId: 'launch_child', parentLaunchId: 'launch_parent' });
  const legacyPath = path.join(root, 'legacy.db');
  const source = new Database(path.join(root, 'state.db'));
  const sql = source.prepare("SELECT sql FROM sqlite_master WHERE name='agent_launches'").get().sql.replace(", 'registered-shared'", '');
  const rows = source.prepare('SELECT * FROM agent_launches').all(); source.close();
  const legacy = new Database(legacyPath); legacy.exec(sql);
  for (const row of rows) legacy.prepare(`INSERT INTO agent_launches (${Object.keys(row).join(',')}) VALUES (${Object.keys(row).map(k => `@${k}`).join(',')})`).run(row);
  legacy.close();
  const migrated = createLaunchStore({ databasePath: legacyPath });
  t.after(() => migrated.close());
  assert.equal(migrated.get('launch_child').parentLaunchId, 'launch_parent');
  assert.equal(migrated.get('launch_parent').nativeSessionId, 'native_parent');
  migrated.create({ ...projection, launchId: 'launch_shared', workspaceMode: 'registered-shared' });
  await assert.rejects(() => resumeAgent({ launchId: 'launch_shared' }, { store: migrated }), /fresh sessions/);
  assert.throws(() => discardAgentLaunch('launch_shared', { store: migrated }), /externally owned/);
  assert.ok(fs.existsSync(profile.working_directory));
});

test('task timeout kills a real TERM-resistant descendant process', async t => {
  const { root, profile, store } = fixture(t);
  const childFile = path.join(root, 'child.cjs');
  fs.writeFileSync(childFile, "process.on('SIGTERM',()=>{}); setInterval(()=>{},1000);");
  const providerFile = path.join(root, 'provider.cjs');
  const pidFile = path.join(root, 'pid');
  fs.writeFileSync(providerFile, `const {spawn}=require('node:child_process'); const fs=require('node:fs');\nconst child=spawn(process.execPath,[${JSON.stringify(childFile)}],{stdio:'ignore'});\nfs.writeFileSync(${JSON.stringify(pidFile)},String(child.pid));\nprocess.on('SIGTERM',()=>{}); setInterval(()=>{},1000);`);
  const { executeForegroundLaunch } = await import('../../agent-host/events/stream.js');
  store.create({ launchId: 'launch_tree', provider: 'codex', model: profile.model,
    originDirectory: root, projectRoot: root, executionWorkspace: root,
    outputDestination: path.join(root, 'runtime'), workspaceMode: 'registered-shared' });
  const result = await executeForegroundLaunch({ launchId: 'launch_tree', store,
    plan: { taskProfile: profile, provider: 'codex', model: profile.model, stdin: 'test',
      args: [providerFile], spawn: { command: process.execPath, cwd: root }, environment: {},
      maxRawOutputBytes: 1024, timeouts: { runtimeMs: 250, shutdownGraceMs: 100 } },
    timeoutMs: 250, stdout: { write() {} }, stderr: { write() {} }, signalEmitter: new EventEmitter() });
  assert.equal(result.status, 'failed');
  assert.match(result.lastError, /timed out/);
  const pid = Number(fs.readFileSync(pidFile));
  let alive = true;
  for (let i = 0; i < 50 && alive; i++) {
    try { process.kill(pid, 0); await new Promise(resolve => setTimeout(resolve, 20)); }
    catch { alive = false; }
  }
  assert.equal(alive, false, `descendant ${pid} survived timeout`);
});

test('launch receipt persistence failure terminates the provider and records failure', async t => {
  const { root, profile, store } = fixture(t);
  const providerFile = path.join(root, 'receipt-provider.cjs');
  fs.writeFileSync(providerFile, "process.on('SIGTERM',()=>{}); setInterval(()=>{},1000);");
  const { executeForegroundLaunch } = await import('../../agent-host/events/stream.js');
  store.create({ launchId: 'launch_receipt_error', provider: 'codex', model: profile.model,
    originDirectory: root, projectRoot: root, executionWorkspace: root,
    outputDestination: path.join(root, 'runtime'), workspaceMode: 'registered-shared' });
  const result = await executeForegroundLaunch({ launchId: 'launch_receipt_error', store,
    plan: { taskProfile: profile, provider: 'codex', model: profile.model, stdin: 'test',
      args: [providerFile], spawn: { command: process.execPath, cwd: root }, environment: {},
      maxRawOutputBytes: 1024, timeouts: { runtimeMs: 500, shutdownGraceMs: 100 } },
    onSpawn: () => { throw new Error('fixture receipt EIO'); }, timeoutMs: 500,
    stdout: { write() {} }, stderr: { write() {} }, signalEmitter: new EventEmitter() });
  assert.equal(result.status, 'failed');
  assert.match(result.lastError, /receipt EIO/);
  assert.throws(() => process.kill(result.pid, 0), /ESRCH/);
});

test('selected task account does not depend on the ambient Codex login', async t => {
  const { root, profile, store } = fixture(t);
  const accountDirectory = path.join(root, 'codex-account');
  fs.mkdirSync(accountDirectory, { mode: 0o700 });
  const selected = validateTaskProfile({ ...profile, account: { id: 'codex-work',
    email: 'work@example.test', config_directory: accountDirectory } }, {
    working_directory: profile.working_directory,
    outputs: { runtime: path.join(root, 'runtime'), deliverables: profile.write_roots },
  });
  const events = [{ type: 'thread.started', thread_id: 'selected_session' },
    { type: 'item.completed', item: { type: 'agent_message', text: '{"outcome":"no_work","outputs":[]}' } },
    { type: 'turn.completed', usage: {} }];
  const result = await launchAgent({ provider: 'codex', model: selected.model, prompt: 'fixture',
    taskProfile: selected, workspace: selected.working_directory, workspaceMode: selected.workspace_mode }, {
    artifactsRoot: path.join(root, 'runtime'), store, idFactory: () => 'launch_selected_account',
    preflightImpl: async () => { throw new Error('ambient login must not be inspected'); },
    taskPreflightImpl: async ({ profile: observed }) => { assert.equal(observed.account.id, 'codex-work'); return { account: observed.account }; },
    resolveBinaryImpl: () => '/fake/codex', spawnImpl: spawnFixture(events, []),
    stdout: { write() {} }, stderr: { write() {} }, signalEmitter: new EventEmitter(),
  });
  assert.equal(result.status, 'completed');
});


test('unlimited task launch does not install a native runtime timer', async t => {
  const {root,profile,store} = fixture(t, 0);
  const timers = [];
  const original = globalThis.setTimeout;
  t.mock.method(globalThis, 'setTimeout', (fn, ms, ...args) => {
    timers.push(ms); return original(fn, ms, ...args);
  });
  const result = await launchAgent({provider:'codex', model:profile.model, prompt:'fixture',
    taskProfile:profile, workspace:profile.working_directory, workspaceMode:'registered-shared'}, {
    artifactsRoot:path.join(root,'runtime'), store, idFactory:()=> 'launch_unlimited',
    preflightImpl:async()=>{}, taskPreflightImpl:async()=>{}, resolveBinaryImpl:()=>'/fake/codex',
    spawnImpl:spawnFixture([{type:'thread.started',thread_id:'native_unlimited'},
      {type:'item.completed',item:{type:'agent_message',text:'{"outcome":"no_work","outputs":[]}'}},
      {type:'turn.completed',usage:{}}],[]),
    stdout:{write(){}},stderr:{write(){}},signalEmitter:new EventEmitter(),
  });
  assert.equal(result.status,'completed');
  assert.deepEqual(timers, [], 'zero must not fall back to the provider runtime limit');
});

test('unlimited task still responds to cancellation and drains its provider', async t => {
  const {root,profile,store} = fixture(t, 0);
  const providerFile = path.join(root, 'cancel-provider.cjs');
  fs.writeFileSync(providerFile, 'setInterval(()=>{},1000);');
  const {executeForegroundLaunch} = await import('../../agent-host/events/stream.js');
  const signals = new EventEmitter();
  store.create({launchId:'launch_cancel_unlimited',provider:'codex',model:profile.model,
    originDirectory:root,projectRoot:root,executionWorkspace:root,
    outputDestination:path.join(root,'runtime'),workspaceMode:'registered-shared'});
  const result = await executeForegroundLaunch({launchId:'launch_cancel_unlimited',store,
    plan:{taskProfile:profile,provider:'codex',model:profile.model,stdin:'fixture',
      args:[providerFile],spawn:{command:process.execPath,cwd:root},environment:{},
      maxRawOutputBytes:1024,timeouts:{runtimeMs:1000,shutdownGraceMs:100}},
    timeoutMs:0,onSpawn:()=>setTimeout(()=>signals.emit('SIGTERM'),50),
    stdout:{write(){}},stderr:{write(){}},signalEmitter:signals});
  assert.equal(result.status,'stopped');
  assert.throws(()=>process.kill(result.pid,0), /ESRCH/);
});
