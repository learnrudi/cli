import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawn,spawnSync} from 'node:child_process';
import {auditIdentity,auditHelperPath,drainAuditScope} from '../src/agent-host/task-audit.js';
import {processIdentity} from '../src/agent-host/task-custody.js';
const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));

export async function verifyCensus(root) {
  const owner=auditIdentity(process.pid);
  const source=fs.readFileSync(fileURLToPath(new URL('../native/task-audit.c',import.meta.url)),'utf8');
  const needle='int count=proc_listallpids(pids,MAX_PIDS*sizeof(pid_t));';
  assert.equal(source.split(needle).length,2);
  // Fault injection exists only in this fixture-built executable, never the package.
  const hook=`
    const char *mode=getenv("CENSUS_FIXTURE");
    if(mode && !strcmp(mode,"truncate"))for(int i=0;i<count;i++)if(pids[i]==0)pids[i]=1;
    if(mode && !strcmp(mode,"unknown"))pids[count++]=INT32_MAX;
    if(mode && !strcmp(mode,"race")) {
      FILE *marker=fopen(${JSON.stringify(path.join(root,'census'))},"w"); if(!marker)fail("fixture marker"); fclose(marker);
      int ready=0;for(int i=0;i<3000;i++){if(!access(${JSON.stringify(path.join(root,'forked'))},F_OK)){ready=1;break;}usleep(1000);}
      if(!ready)fail("fixture fork deadline"); usleep(50000);
    }`;
  fs.writeFileSync(path.join(root,'census-fixture.c'),source.replace(needle,needle+hook));
  const binary=path.join(root,'census-fixture');
  const build=spawnSync('/usr/bin/clang',['-std=c11','-Wall','-Wextra','-Werror','-lbsm',path.join(root,'census-fixture.c'),'-o',binary],{encoding:'utf8'});
  assert.equal(build.status,0,build.stderr);
  const args=['sweep',owner.asid,owner.unique,owner.pid,owner.version,0,0,9].map(String);
  const invoke=(mode,arguments_=args)=>spawnSync(binary,arguments_,{env:{PATH:'/usr/bin:/bin',CENSUS_FIXTURE:mode},encoding:'utf8',timeout:5000});
  const truncated=invoke('truncate');assert.notEqual(truncated.status,0);assert.match(truncated.stderr,/truncated/);
  const unknown=invoke('unknown');assert.equal(unknown.status,0,unknown.stderr);assert.ok(JSON.parse(unknown.stdout).uncertain>0);
  const stale=[...args];stale[4]=String(owner.version+1);
  const mismatch=invoke('',stale);assert.notEqual(mismatch.status,0);assert.match(mismatch.stderr,/anchors unavailable/);
  const python=`import os,time,pathlib
r=pathlib.Path(${JSON.stringify(root)})
(r/'ready').write_text(str(os.getpid()))
while not (r/'census').exists(): time.sleep(.001)
if os.fork(): os._exit(0)
os.setsid()
(r/'forked').write_text(str(os.getpid()))
while True: time.sleep(1)
`;
  const ancestor=spawn('/usr/local/bin/python3.12',['-c',python],{detached:true,stdio:'ignore'});
  const end=Date.now()+5000;
  while(!fs.existsSync(path.join(root,'ready'))&&Date.now()<end)await delay(10);
  assert.ok(fs.existsSync(path.join(root,'ready')));
  const first=invoke('race');assert.equal(first.status,0,first.stderr);
  const raced=JSON.parse(first.stdout);
  assert.equal(raced.members,0);assert.ok(raced.uncertain>0,'fork-and-exit must invalidate an empty census');
  const descendant=processIdentity(Number(fs.readFileSync(path.join(root,'forked'),'utf8')));
  assert.ok(descendant,'new child must still exist after the raced census');
  fs.writeFileSync(path.join(root,'identities.json'),JSON.stringify([descendant]));
  const second=spawnSync(auditHelperPath(),args,{encoding:'utf8'});
  assert.equal(second.status,0,second.stderr);assert.ok(JSON.parse(second.stdout).members>=1);
  await drainAuditScope({schema_version:1,owner});
  assert.equal(processIdentity(ancestor.pid),null);
  assert.equal(processIdentity(descendant.pid),null);
  fs.writeFileSync(path.join(root,'census-proof.json'),JSON.stringify({raced,next:JSON.parse(second.stdout),truncationRejected:true,unknownUncertain:true,staleAnchorRejected:true}));
  fs.writeFileSync(path.join(root,'result.json'),JSON.stringify({closed:true,nativeGone:true,descendantGone:true}));
}
