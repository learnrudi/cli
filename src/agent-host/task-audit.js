import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

export function isQualifiedTaskAuditHost() {
  return process.platform === 'darwin' && os.release().startsWith('24.') && process.arch === 'x64';
}
export function auditHelperPath() {
  if(!isQualifiedTaskAuditHost())throw new Error('task audit containment requires the qualified Darwin 24 x64 host');
  const entry=process.argv[1] || '';
  const helper=entry.endsWith('.cjs') ? path.join(path.dirname(entry),'task-audit-darwin')
    : fileURLToPath(new URL('../../dist/task-audit-darwin',import.meta.url));
  const stat=fs.lstatSync(helper);
  if(!stat.isFile() || stat.nlink!==1 || fs.realpathSync(helper)!==helper)throw new Error('invalid task audit helper');
  fs.accessSync(helper,fs.constants.X_OK);
  return helper;
}
function invoke(args) {
  return JSON.parse(execFileSync(auditHelperPath(),args,{encoding:'utf8',timeout:5000,maxBuffer:16384,
    env:{PATH:'/usr/bin:/bin'},stdio:['ignore','pipe','pipe']}));
}
export function auditIdentity(pid) { return invoke(['identity',String(pid)]); }
export function validateAuditIdentity(value) {
  if(!value || Object.keys(value).sort().join(',')!=='asid,pid,uid,unique,version'
    || ![value.pid,value.version,value.asid,value.uid].every(Number.isSafeInteger) || value.pid<2 || value.version<1
    || value.asid<100000 || value.uid!==process.getuid() || !/^[1-9][0-9]{0,19}$/u.test(value.unique)
    || BigInt(value.unique)>18446744073709551615n)throw new Error('invalid task audit identity');
  return value;
}
export function createAuditScope(capsule) {
  if(!capsule || !/^com\.learnrudi\.(?:fixture\.)?containment\.[a-f0-9-]{36}$/u.test(capsule.label || '')
    || !Number.isSafeInteger(capsule.creatorPid) || capsule.creatorPid<2 || process.ppid!==1) {
    throw new Error('task requires a launchd audit-session capsule');
  }
  const owner=validateAuditIdentity(auditIdentity(process.pid));
  const creator=validateAuditIdentity(auditIdentity(capsule.creatorPid));
  const job=execFileSync('/bin/launchctl',['print',`gui/${process.getuid()}/${capsule.label}`],
    {encoding:'utf8',timeout:5000,maxBuffer:65536,stdio:['ignore','pipe','pipe']});
  const pid=job.match(/^\s*pid = (\d+)$/mu);
  if(!pid || Number(pid[1])!==process.pid || owner.asid===creator.asid)throw new Error('capsule session isolation unconfirmed');
  return {schema_version:1,label:capsule.label,owner};
}
export async function drainAuditScope(scope,guardian=null) {
  if(scope?.schema_version!==1)throw new Error('invalid audit scope');
  const owner=validateAuditIdentity(scope.owner);
  if(guardian && validateAuditIdentity(guardian).asid!==owner.asid)throw new Error('guardian audit scope mismatch');
  const args=['sweep',owner.asid,owner.unique,owner.pid,owner.version,
    guardian?.pid || 0,guardian?.version || 0,9].map(String);
  const end=Date.now()+7000;
  let quiet=false;
  let last;
  while(Date.now()<end) {
    const result=invoke(args);
    last=result;
    const empty=result.members===0 && result.uncertain===0;
    if(empty && quiet)return;
    quiet=empty;
    await new Promise(resolve=>setTimeout(resolve,25));
  }
  throw new Error(`audit session drain unconfirmed; custody blocked: ${JSON.stringify(last)}`);
}
