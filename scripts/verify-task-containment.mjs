import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawn, spawnSync } from 'node:child_process';
import { once } from 'node:events';
import { fileURLToPath } from 'node:url';
import { openTaskCustody, processIdentity, recoverTaskCustody } from '../src/agent-host/task-custody.js';
import {verifyCensus} from './task-census-fixture.mjs';
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
const script = fileURLToPath(import.meta.url);
if (process.argv[2] === 'owner') {
  const [root, label, creatorPid, mode='normal'] = process.argv.slice(3);
  if(mode==='census-race'){await verifyCensus(root);process.exit(0);}
  const runtime = path.join(root, 'runtime');
  const runDirectory = path.join(root, 'attempt');
  const custody = await openTaskCustody({ runtime, runDirectory, jobId: 'job_detachedfixture',
    capsule: { label, creatorPid: Number(creatorPid) },
    workerPath: fileURLToPath(new URL('../src/agent-host/task-custody-worker.js', import.meta.url)) });
  if(mode==='guardian-before-spawn') {
    const guardian=JSON.parse(fs.readFileSync(path.join(runtime,'custody.lock','guardian.json'),'utf8'));
    assert.deepEqual(processIdentity(guardian.pid),guardian);
    process.kill(guardian.pid,'SIGKILL');
    await delay(700);
  }
  const doubleFork=`import os,sys,time
if os.fork(): os._exit(0)
os.setsid()
if os.fork(): os._exit(0)
print(os.getpid(),flush=True)
while True: time.sleep(1)`;
  const native = spawn(process.execPath, ['--input-type=module', '-e', `
    import {spawn} from 'node:child_process';
    const child=${mode==='double-fork' ? `spawn('/usr/local/bin/python3.12',['-c',${JSON.stringify(doubleFork)}],{stdio:['ignore','pipe','inherit']}); child.stdout.once('data',bytes=>console.log(bytes.toString().trim()))` : "spawn(process.execPath,['-e','setInterval(()=>{},1000)'],{detached:true,stdio:'ignore'}); console.log(child.pid)"};
    setInterval(()=>{},1000);`], { detached: true, stdio: ['ignore','pipe','pipe'] });
  const data = await Promise.race([once(native.stdout, 'data'),once(native,'exit').then(()=>null)]);
  if(!data)assert.equal(mode,'guardian-before-spawn','native fixture exited before detached child proof');
  const descendant = data ? processIdentity(Number(data[0].toString().trim())) : null;
  fs.writeFileSync(path.join(root,'identities.json'), JSON.stringify([processIdentity(native.pid), descendant].filter(Boolean)));
  if(mode==='untracked-crash')process.kill(process.pid,'SIGKILL');
  if(mode==='guardian-before-spawn') await assert.rejects(custody.track(native.pid),/watchdog/);
  else await custody.track(native.pid);
  if(mode==='prequarantined-crash')fs.writeFileSync(path.join(runtime,'custody.lock','quarantine.json'),JSON.stringify({reason:'fixture creator loss'}));
  if(mode==='owner-crash'||mode==='prequarantined-crash')process.kill(process.pid,'SIGKILL');
  if(mode==='guardian-crash') {
    const guardian=JSON.parse(fs.readFileSync(path.join(runtime,'custody.lock','guardian.json'),'utf8'));
    assert.deepEqual(processIdentity(guardian.pid),guardian);
    process.kill(guardian.pid,'SIGKILL');
    await delay(700);
    await assert.rejects(custody.close(),/watchdog/);
  } else if(mode==='guardian-before-spawn')await assert.rejects(custody.close(),/watchdog/);
  else await custody.close();
  const result = { closed: fs.existsSync(path.join(runDirectory,'custody','closed.json')),
    nativeGone: processIdentity(native.pid) === null, descendantGone: descendant===null || processIdentity(descendant.pid) === null };
  fs.writeFileSync(path.join(root,'result.json'), JSON.stringify(result));
} else {
  assert.equal(process.platform, 'darwin');
  const mode=process.argv[2] || 'normal';
  assert.ok(['normal','double-fork','census-race','owner-crash','prequarantined-crash','untracked-crash','guardian-crash','guardian-before-spawn'].includes(mode));
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(),'rudi-containment-')));
  for (const name of ['runtime','attempt']) fs.mkdirSync(path.join(root,name));
  const label = `com.learnrudi.fixture.containment.${crypto.randomUUID()}`;
  const target = `gui/${process.getuid()}/${label}`;
  const canary = spawn(process.execPath,['-e','setInterval(()=>{},1000)'],{stdio:'ignore'});
  await once(canary,'spawn');
  const canaryIdentity = processIdentity(canary.pid);
  let result;
  try {
    const plist = { Label: label, ProgramArguments: [process.execPath,script,'owner',root,label,String(process.pid),mode],
      RunAtLoad:true, KeepAlive:false, SessionCreate:true, AbandonProcessGroup:false, ExitTimeOut:2,
      StandardOutPath:path.join(root,'stdout'), StandardErrorPath:path.join(root,'stderr') };
    fs.writeFileSync(path.join(root,'job.json'),JSON.stringify(plist));
    const convert = spawnSync('/usr/bin/plutil',['-convert','xml1','-o',path.join(root,'job.plist'),path.join(root,'job.json')]);
    assert.equal(convert.status,0);
    const start = spawnSync('/bin/launchctl',['bootstrap',`gui/${process.getuid()}`,path.join(root,'job.plist')]);
    assert.equal(start.status,0,start.stderr.toString());
    const end=Date.now()+20000;
    const crash=mode==='owner-crash'||mode==='prequarantined-crash'||mode==='untracked-crash';
    const marker=crash?path.join(root,'runtime','custody.lock','orphan-cleanup.json'):path.join(root,'result.json');
    while(!fs.existsSync(marker) && Date.now()<end) await delay(100);
    if(crash && fs.existsSync(marker)) {
      const identities=JSON.parse(fs.readFileSync(path.join(root,'identities.json'),'utf8'));
      const recovered=await recoverTaskCustody(path.join(root,'runtime'));
      assert.equal(recovered.status,'quarantined');
      const cleanup=JSON.parse(fs.readFileSync(marker,'utf8'));
      assert.equal(cleanup.audit_session_drained,true);
      fs.writeFileSync(path.join(root,'result.json'),JSON.stringify({closed:false,nativeGone:processIdentity(identities[0].pid)===null,descendantGone:processIdentity(identities[1].pid)===null,quarantined:true}));
    }
    assert.ok(fs.existsSync(path.join(root,'result.json')),fs.readFileSync(path.join(root,'stderr'),'utf8'));
    result=JSON.parse(fs.readFileSync(path.join(root,'result.json'),'utf8'));
    result.canaryUnchanged=JSON.stringify(processIdentity(canary.pid))===JSON.stringify(canaryIdentity);
    console.log(JSON.stringify({fixture:root,mode,...result}));
    assert.equal(result.closed,['normal','double-fork','census-race'].includes(mode)); assert.equal(result.nativeGone,true);
    assert.equal(result.descendantGone,true,'detached descendant survived successful custody close');
    assert.equal(result.canaryUnchanged,true);
  } finally {
    spawnSync('/bin/launchctl',['bootout',target]);
    if(fs.existsSync(path.join(root,'identities.json'))) for(const identity of JSON.parse(fs.readFileSync(path.join(root,'identities.json'),'utf8'))) {
      if(JSON.stringify(processIdentity(identity.pid))===JSON.stringify(identity)) process.kill(identity.pid,'SIGKILL');
    }
    if(JSON.stringify(processIdentity(canary.pid))===JSON.stringify(canaryIdentity)) canary.kill('SIGKILL');
    // Preserve this small fixture's receipts and diagnostics for review.
  }
}
