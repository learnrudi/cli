import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { execFileSync, spawnSync } from 'node:child_process';
import { auditIdentity, auditHelperPath } from './task-audit.js';
import { readTaskRegularFile, parseTaskJson } from './task-profile.js';
const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));
export function capsuleWorkerPath() {
  const entry=process.argv[1] || '';
  return entry.endsWith('.cjs') ? path.join(path.dirname(entry),'task-capsule-worker.cjs')
    : fileURLToPath(new URL('./task-capsule-worker.js',import.meta.url));
}
export function capsuleRecord(filename,value) {
  const fd=fs.openSync(filename,'wx',0o600);
  try {fs.writeFileSync(fd,JSON.stringify(value)+'\n');fs.fsyncSync(fd);}finally{fs.closeSync(fd);}
}
export async function waitForCapsuleResult(directory, timeoutSeconds, workerAlive = () => true) {
  const startupEnd = Date.now() + 5000;
  let observedRunning = false;
  let consecutiveProbeTimeouts = 0;
  const end = timeoutSeconds === 0 ? Infinity : Date.now() + (timeoutSeconds + 15) * 1000;
  while (Date.now() < end) {
    const filename = path.join(directory, 'result.json');
    if (fs.existsSync(filename)) {
      return parseTaskJson(readTaskRegularFile(filename, 32768, true).toString('utf8'));
    }
    let alive;
    try {
      alive = workerAlive();
      consecutiveProbeTimeouts = 0;
    } catch (error) {
      if (fs.existsSync(filename)) {
        return parseTaskJson(readTaskRegularFile(filename, 32768, true).toString('utf8'));
      }
      if (error.code !== 'ETIMEDOUT') throw error;
      if (++consecutiveProbeTimeouts >= 3) {
        throw new Error(`task capsule status probe timed out three consecutive times; retain custody evidence at ${directory}`, {cause:error});
      }
      await delay(100);
      continue;
    }
    if (alive) observedRunning = true;
    else if (observedRunning || Date.now() >= startupEnd) {
      // Completion can be published between the first read and the exit probe.
      if (fs.existsSync(filename)) {
        return parseTaskJson(readTaskRegularFile(filename, 32768, true).toString('utf8'));
      }
      throw new Error(`task capsule worker exited or failed to start; retain custody evidence at ${directory}`);
    }
    await delay(100);
  }
  return null;
}
export async function runTaskCapsule(reference,request,environment) {
  auditHelperPath();
  const creator=auditIdentity(process.pid);
  const id=crypto.randomUUID();
  const label=`com.learnrudi.containment.${id}`;
  const directory=path.join(request.outputs.runtime,`capsule-${id}`);
  fs.mkdirSync(directory,{mode:0o700});
  const env={PATH:'/usr/bin:/bin'};
  for(const key of ['HOME','USER','LOGNAME','LANG','LC_ALL','RUDI_COMPUTE_JOB_ID','RUDI_COMPUTE_ATTEMPT',
    'RUDI_COMPUTE_SPEC_HASH','RUDI_AGENT_TASK_CODEX_PATH','RUDI_AGENT_TASK_CODEX_SHA256','RUDI_AGENT_TASK_CLAUDE_PATH','RUDI_AGENT_TASK_CLAUDE_SHA256']) {
    if(typeof environment[key]==='string')env[key]=environment[key];
  }
  capsuleRecord(path.join(directory,'input.json'),{reference,creator,label,environment:env});
  const target=`gui/${process.getuid()}/${label}`;
  capsuleRecord(path.join(directory,'job.json'),{Label:label,SessionCreate:true,RunAtLoad:true,KeepAlive:false,
    AbandonProcessGroup:false,ExitTimeOut:10,ProgramArguments:[process.execPath,capsuleWorkerPath(),directory],
    EnvironmentVariables:env,StandardOutPath:path.join(directory,'stdout'),StandardErrorPath:path.join(directory,'stderr')});
  execFileSync('/usr/bin/plutil',['-convert','xml1','-o',path.join(directory,'job.plist'),path.join(directory,'job.json')],{stdio:'pipe'});
  let complete=false;
  try {
    execFileSync('/bin/launchctl',['bootstrap',`gui/${process.getuid()}`,path.join(directory,'job.plist')],{stdio:'pipe',timeout:5000});
    const result = await waitForCapsuleResult(directory, request.timeout_seconds, () => {
      // A finite probe detects a dead supervisor; it never limits healthy runtime.
      const state = execFileSync('/bin/launchctl', ['print', target], {encoding:'utf8',timeout:2000,maxBuffer:262144});
      return /^\s*pid = [1-9][0-9]*$/m.test(state) && /^\s*state = running$/m.test(state);
    });
    if (result) {
      complete = true;
      if (result.error) throw new Error(result.error);
      return result.value;
    }
    spawnSync('/bin/launchctl',['kill','SIGTERM',target],{timeout:5000,stdio:'pipe'});
    throw new Error(`task capsule timed out; retain custody evidence at ${directory}`);
  } finally {
    // An unresolved capsule is not force-removed: its independent watchdog
    // and session anchor remain available for fail-closed reconciliation.
    if(complete)spawnSync('/bin/launchctl',['bootout',target],{timeout:15000,stdio:'pipe'});
  }
}
