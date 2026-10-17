import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { fileURLToPath } from 'node:url';
import { openTaskCustody, recoverTaskCustody } from '../../agent-host/task-custody.js';

test('normal close never retires a quarantined runtime', async t => {
  const root=fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(),'custody-quarantine-')));
  t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
  const runtime=path.join(root,'runtime');const runDirectory=path.join(root,'attempt');
  fs.mkdirSync(runtime);fs.mkdirSync(runDirectory);
  const custody=await openTaskCustody({runtime,runDirectory,jobId:'job_quarantine'});
  fs.writeFileSync(path.join(runtime,'custody.lock','quarantine.json'),JSON.stringify({reason:'guardian lost'}));
  await assert.rejects(custody.close(),/quarantined/);
  assert.equal(fs.existsSync(path.join(runtime,'custody.lock')),true);
});

test('supervisor SIGKILL cleans its group but quarantines further task execution', async t => {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'task-custody-')));
  const runtime = path.join(root, 'runtime'); const run = path.join(root, 'run');
  fs.mkdirSync(runtime); fs.mkdirSync(run);
  const module = new URL('../../agent-host/task-custody.js', import.meta.url).href;
  const workerPath=fileURLToPath(new URL('../../agent-host/task-custody-worker.js',import.meta.url));
  const program = `import {openTaskCustody} from ${JSON.stringify(module)};
    import {spawn} from 'node:child_process'; import fs from 'node:fs';
    const custody = await openTaskCustody(${JSON.stringify({runtime, runDirectory:run, jobId:'job_crashfixture',workerPath})});
    const child = spawn(process.execPath,['-e','setInterval(()=>{},1000)'],{detached:true,stdio:'ignore'});
    fs.writeFileSync(${JSON.stringify(path.join(root,'fixture-pid'))},String(child.pid));
    await custody.track(child.pid); console.log(child.pid); setInterval(()=>{},1000);`;
  const owner = spawn(process.execPath, ['--input-type=module', '-e', program], { stdio:['ignore','pipe','pipe'] });
  let diagnostics='';owner.stderr.on('data', d=>diagnostics+=d);
  t.after(() => {
    owner.kill('SIGKILL');
    try {process.kill(-Number(fs.readFileSync(path.join(root,'fixture-pid'),'utf8')),'SIGKILL');}catch{}
    fs.rmSync(root, {recursive:true,force:true});
  });
  const line = await Promise.race([once(owner.stdout,'data'), once(owner,'exit').then(()=>{throw new Error(diagnostics);})]);
  const pid = Number(String(line[0]).trim()); assert.ok(pid > 1);
  t.after(()=>{try{process.kill(-pid,'SIGKILL');}catch{}});
  await assert.rejects(openTaskCustody({runtime,runDirectory:run,jobId:'job_conflict'}), /active|custody/);
  owner.kill('SIGKILL'); await once(owner,'exit');
  const end=Date.now()+12000;
  while(Date.now()<end && !fs.existsSync(path.join(runtime,'custody.lock','orphan-cleanup.json'))) await new Promise(r=>setTimeout(r,50));
  assert.equal(JSON.parse(fs.readFileSync(path.join(runtime,'custody.lock','orphan-cleanup.json'))).native_group_gone,true);
  assert.throws(()=>process.kill(-pid,0), {code:'ESRCH'});
  const recovered=await recoverTaskCustody(runtime);
  assert.equal(recovered.status,'quarantined');
  assert.ok(fs.existsSync(path.join(recovered.evidence,'owner.json')));
  const nextRun=path.join(root,'next');fs.mkdirSync(nextRun);
  await assert.rejects(openTaskCustody({runtime,runDirectory:nextRun,jobId:'job_next'}),/quarantined/);
  assert.ok(fs.existsSync(path.join(recovered.evidence,'quarantine.json')));
});
