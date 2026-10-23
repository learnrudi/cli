import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {waitForCapsuleResult} from '../../agent-host/task-capsule.js';

test('capsule survives a transient status-probe timeout and completes', async t => {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'capsule-probe-')));
  t.after(() => fs.rmSync(root, {recursive:true,force:true}));
  let polls = 0;
  const result = await waitForCapsuleResult(root, 30, () => {
    if (++polls === 2) throw Object.assign(new Error('spawnSync /bin/launchctl ETIMEDOUT'), {code:'ETIMEDOUT'});
    if (polls === 3) fs.writeFileSync(path.join(root, 'result.json'), '{"value":"complete"}');
    return true;
  });
  assert.deepEqual(result, {value:'complete'});
  assert.equal(polls, 3);
});

test('completion published during the final timed-out probe is still returned', async t => {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'capsule-timeout-result-')));
  t.after(() => fs.rmSync(root, {recursive:true,force:true}));
  let polls = 0;
  assert.deepEqual(await waitForCapsuleResult(root, 0, () => {
    if (++polls === 3) fs.writeFileSync(path.join(root, 'result.json'), '{"value":"complete"}');
    throw Object.assign(new Error('probe timed out'), {code:'ETIMEDOUT'});
  }), {value:'complete'});
  assert.equal(polls, 3);
});

test('repeated status-probe timeouts fail within three probes even for unlimited tasks', async () => {
  let polls = 0;
  const timeout = Object.assign(new Error('probe timed out'), {code:'ETIMEDOUT'});
  await assert.rejects(waitForCapsuleResult('/unused', 0, () => {
    polls++;
    throw timeout;
  }), error => /three consecutive times/.test(error.message) && error.cause === timeout);
  assert.equal(polls, 3);
});

test('healthy status probes reset the consecutive timeout allowance', async t => {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'capsule-probe-reset-')));
  t.after(() => fs.rmSync(root, {recursive:true,force:true}));
  let polls = 0;
  assert.deepEqual(await waitForCapsuleResult(root, 30, () => {
    polls++;
    if ([1, 2, 4, 5].includes(polls)) throw Object.assign(new Error('probe timed out'), {code:'ETIMEDOUT'});
    if (polls === 6) fs.writeFileSync(path.join(root, 'result.json'), '{"value":"complete"}');
    return true;
  }), {value:'complete'});
  assert.equal(polls, 6);
});

test('an observed worker exit after a timeout still fails immediately', async () => {
  let polls = 0;
  await assert.rejects(waitForCapsuleResult('/unused', 0, () => {
    polls++;
    if (polls === 2) throw Object.assign(new Error('probe timed out'), {code:'ETIMEDOUT'});
    return polls === 1;
  }), /worker exited/);
  assert.equal(polls, 3);
});

test('probe timeout retries cannot extend a finite task deadline', async t => {
  let now = 0;
  let polls = 0;
  t.mock.method(Date, 'now', () => now);
  assert.equal(await waitForCapsuleResult('/unused', 1, () => {
    polls++;
    now = 17000;
    throw Object.assign(new Error('probe timed out'), {code:'ETIMEDOUT'});
  }), null);
  assert.equal(polls, 1);
});

test('unlimited capsule waits for completion across elapsed hours', async t => {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'unlimited-capsule-')));
  t.after(() => fs.rmSync(root, {recursive:true,force:true}));
  let ticks = 0;
  t.mock.method(Date, 'now', () => ticks++ < 2 ? 0 : 7200000);
  const timer = setTimeout(() => fs.writeFileSync(path.join(root, 'result.json'), '{"value":"done"}'), 20);
  t.after(() => clearTimeout(timer));
  assert.deepEqual(await waitForCapsuleResult(root, 0), {value:'done'});
});

test('finite capsule still reaches its deadline', async t => {
  let ticks = 0;
  t.mock.method(Date, 'now', () => ticks++ < 2 ? 0 : 7200000);
  assert.equal(await waitForCapsuleResult('/unused', 30), null);
});

test('unlimited capsule fails when its observed worker disappears without a result', async () => {
  const {spawnSync} = await import('node:child_process');
  const module = new URL('../../agent-host/task-capsule.js', import.meta.url).href;
  const script = `import {waitForCapsuleResult} from ${JSON.stringify(module)};
let polls=0;
try { await waitForCapsuleResult('/unused',0,()=>++polls===1); process.exit(2); }
catch(error) { if(!/worker exited/.test(error.message))throw error; }`;
  const result = spawnSync(process.execPath, ['--input-type=module','-e',script], {timeout:2000});
  assert.equal(result.error, undefined, 'dead capsule must not hold an unlimited job forever');
  assert.equal(result.status,0,result.stderr.toString());
});


test('capsule startup and probe failure are bounded independently of runtime', async t => {
  let ticks = 0;
  t.mock.method(Date, 'now', () => ticks++ < 2 ? 0 : 7200000);
  await assert.rejects(waitForCapsuleResult('/unused',0,()=>false), /failed to start/);
  await assert.rejects(waitForCapsuleResult('/unused',0,()=>{throw new Error('probe failure');}), /probe failure/);
});

test('completion published during the worker-exit probe wins over liveness failure', async t => {
  const root=fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(),'capsule-exit-race-')));
  t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
  let polls=0;
  assert.deepEqual(await waitForCapsuleResult(root,0,()=>{
    if(++polls===1)return true;
    fs.writeFileSync(path.join(root,'result.json'),'{"value":"complete"}');
    return false;
  }),{value:'complete'});
});
