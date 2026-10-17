import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { auditIdentity } from './task-audit.js';
import { capsuleRecord } from './task-capsule.js';
import { runAgentTaskInSession } from './task-run.js';
import { quarantineTaskCustody } from './task-custody.js';
import { canonicalDirectory, parseTaskJson, readTaskRegularFile } from './task-profile.js';
async function main() {
const directory=canonicalDirectory(process.argv[2],'capsule directory');
const input=parseTaskJson(readTaskRegularFile(path.join(directory,'input.json'),32768,true).toString('utf8'));
let creatorLost=false;
function creatorAlive() {
  try{return JSON.stringify(auditIdentity(input.creator.pid))===JSON.stringify(input.creator);}catch{return false;}
}
if(!creatorAlive())throw new Error('capsule creator identity lost before execution');
const monitor=setInterval(()=>{
  if(creatorAlive() || creatorLost)return;
  creatorLost=true;
  const lock=path.join(path.dirname(directory),'custody.lock');
  if(fs.existsSync(lock))quarantineTaskCustody(lock,'capsule creator lost');
  process.kill(process.pid,'SIGTERM');
},500);
try {
  const value=await runAgentTaskInSession(input.reference,{environment:input.environment,
    capsule:{label:input.label,creatorPid:input.creator.pid},beforeCustodyClose:()=>clearInterval(monitor)});
  capsuleRecord(path.join(directory,'result.json'),{value});
} catch(error) {
  capsuleRecord(path.join(directory,'result.json'),{error:String(error.message).slice(0,2048)});
} finally {
  clearInterval(monitor);
  if(creatorLost)spawnSync('/bin/launchctl',['bootout',`gui/${process.getuid()}/${input.label}`],{timeout:10000,stdio:'ignore'});
}
}
main().catch(error=>{process.stderr.write(`${error.message}\n`);process.exitCode=1;});
