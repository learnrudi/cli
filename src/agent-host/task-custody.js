import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFileSync, spawn } from 'node:child_process';
import { canonicalDirectory, parseTaskJson, readTaskRegularFile } from './task-profile.js';

const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

export function processIdentity(pid) {
  if (!Number.isSafeInteger(pid) || pid < 2) throw new Error('invalid custody PID');
  try {
    const value = execFileSync('/bin/ps', ['-p', String(pid), '-o', 'pid=,pgid=,uid=,lstart='],
      { encoding:'utf8', timeout:2000, maxBuffer:4096, env:{PATH:'/usr/bin:/bin',LC_ALL:'C'}, stdio:['ignore','pipe','pipe'] }).trim();
    const match = value.match(/^(\d+)\s+(\d+)\s+(\d+)\s+(.+)$/u);
    if (!match) throw new Error('invalid process identity');
    const boot = process.platform === 'linux' ? fs.readFileSync('/proc/sys/kernel/random/boot_id','utf8').trim()
      : execFileSync('/usr/sbin/sysctl', ['-n','kern.bootsessionuuid'],
        {encoding:'utf8',timeout:2000,maxBuffer:4096,stdio:['ignore','pipe','pipe']}).trim();
    return {pid:Number(match[1]),pgid:Number(match[2]),uid:Number(match[3]),started:match[4],boot};
  } catch (error) {
    if (error.status === 1 && !String(error.stdout || '').trim()) return null;
    throw new Error('cannot establish process identity');
  }
}

function sameProcess(left, right) { return JSON.stringify(left) === JSON.stringify(right); }
function record(directory, name, value) {
  const fd = fs.openSync(path.join(directory,name), 'wx', 0o600);
  try { fs.writeFileSync(fd, `${JSON.stringify(value)}\n`); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
}
function read(directory, name) { return parseTaskJson(readTaskRegularFile(path.join(directory,name),16384,true).toString('utf8')); }
function validateIdentity(value) {
  if (!value || !Number.isSafeInteger(value.pid) || value.pid < 2 || !Number.isSafeInteger(value.pgid)
      || value.uid !== process.getuid() || typeof value.started !== 'string' || typeof value.boot !== 'string'
      || Object.keys(value).sort().join(',') !== 'boot,pgid,pid,started,uid') throw new Error('invalid custody identity');
  return value;
}
export function groupAlive(pgid) {
  try { process.kill(-pgid,0); return true; } catch (error) { if(error.code==='ESRCH') return false; throw error; }
}

export async function stopOwnedNative(directory) {
  const native = validateIdentity(read(directory,'native.json'));
  if (native.pid !== native.pgid) throw new Error('native custody requires its own process group');
  const currentBoot = processIdentity(process.pid).boot;
  if (native.boot !== currentBoot) return; // No process survives a boot identity change.
  for (const [signal, budget] of [['SIGTERM',5000],['SIGKILL',2000]]) {
    if (!groupAlive(native.pgid)) return;
    if (!sameProcess(processIdentity(native.pid),native)) throw new Error('native group ownership ambiguous; custody blocked');
    process.kill(-native.pgid,signal);
    const end=Date.now()+budget;
    while(Date.now()<end) { if(!groupAlive(native.pgid)) return; await delay(50); }
  }
  throw new Error('native process group did not exit; custody blocked');
}

export async function runTaskWatchdog(directory) {
  canonicalDirectory(directory,'custody directory');
  const owner=validateIdentity(read(directory,'owner.json').process);
  if (owner.pid !== process.ppid || !sameProcess(processIdentity(owner.pid),owner) || !process.send) throw new Error('watchdog requires its verified parent IPC');
  record(directory,'guardian.json',processIdentity(process.pid));
  let stopping=false;
  const cleanup=async (normal=false) => {
    if(stopping) return; stopping=true;
    try {
      if(!normal) record(directory,'quarantine.json',{reason:'supervisor lost; descendant containment unqualified',at:new Date().toISOString()});
      await stopOwnedNative(directory);
      record(directory,'orphan-cleanup.json',{native_group_gone:true,mode:normal?'normal':'quarantined',at:new Date().toISOString()});
      process.exit(0);
    } catch { process.exit(1); } // Leave the custody lock for explicit fail-closed reconciliation.
  };
  process.once('disconnect',()=>void cleanup());
  process.once('message',message=>{if(message==='done') void cleanup(true);});
  process.once('SIGTERM',()=>void cleanup());
  process.once('SIGINT',()=>void cleanup());
  process.send('ready');
}

export async function recoverTaskCustody(runtime) {
  canonicalDirectory(runtime,'task runtime');
  const directory=path.join(runtime,'custody.lock');
  if(!fs.existsSync(directory)) return {status:'clear'};
  canonicalDirectory(directory,'custody directory');
  const gate=path.join(runtime,'custody-recovery.lock');
  fs.mkdirSync(gate,{mode:0o700}); // Concurrent recovery never signals the same group twice.
  try {
    const owner=read(directory,'owner.json');validateIdentity(owner.process);
    if(sameProcess(processIdentity(owner.process.pid),owner.process)) throw new Error('active task custody');
    if(!fs.existsSync(path.join(directory,'quarantine.json'))) record(directory,'quarantine.json',{
      reason:'owner lost; descendant containment unqualified',at:new Date().toISOString()});
    if(!fs.existsSync(path.join(directory,'native.json'))) throw new Error('unrecorded native spawn; custody requires operator reconciliation');
    if(fs.existsSync(path.join(directory,'guardian.json'))) {
      const guardian=validateIdentity(read(directory,'guardian.json'));
      const end=Date.now()+8000;
      while(sameProcess(processIdentity(guardian.pid),guardian) && Date.now()<end) await delay(100);
      if(sameProcess(processIdentity(guardian.pid),guardian)) throw new Error('active guardian custody');
    }
    await stopOwnedNative(directory);
    record(directory,`recovery-${crypto.randomUUID()}.json`,{native_group_gone:true,at:new Date().toISOString()});
    // Group absence is not proof that a detached descendant cannot still write.
    // Keep the lock and immutable evidence; there is no automatic clear command.
    return {status:'quarantined',evidence:directory};
  } finally { fs.rmdirSync(gate); }
}

export async function openTaskCustody({runtime,runDirectory,jobId,workerPath}) {
  canonicalDirectory(runtime,'task runtime');canonicalDirectory(runDirectory,'task attempt');
  if(!/^job_[A-Za-z0-9_-]{4,123}$/u.test(jobId)) throw new Error('invalid custody job');
  const recovered=await recoverTaskCustody(runtime);
  if(recovered.status!=='clear') throw new Error('task custody quarantined; containment reconciliation required');
  const directory=path.join(runtime,'custody.lock');fs.mkdirSync(directory,{mode:0o700});
  record(directory,'owner.json',{process:processIdentity(process.pid),job_id:jobId,attempt:runDirectory});
  let guardian=null;let guardianExit=null;let closed=false;let closing=false;let guardianLost=false;
  return {
    async track(pid) {
      const native=processIdentity(pid);
      if(!native || native.pid!==native.pgid) throw new Error('native process lacks isolated group');
      record(directory,'native.json',native);
      const entry=process.argv[1] || '';
      const worker=workerPath || path.join(path.dirname(entry),entry.endsWith('.cjs')
        ? 'task-custody-worker.cjs' : 'agent-host/task-custody-worker.js');
      guardian=spawn(process.execPath,[worker,directory],{detached:true,stdio:['ignore','ignore','ignore','ipc'],env:{PATH:'/usr/bin:/bin'}});
      guardianExit=new Promise(resolve=>guardian.once('exit',code=>{
        if(!closing || code!==0) { guardianLost=true; void stopOwnedNative(directory).catch(()=>{}); }
        resolve(code);
      }));
      await new Promise((resolve,reject)=>{
        const timer=setTimeout(()=>reject(new Error('custody watchdog startup timed out')),5000);
        guardian.once('error',error=>{clearTimeout(timer);reject(error);});
        guardian.once('exit',()=>{clearTimeout(timer);reject(new Error('custody watchdog exited'));});
        guardian.once('message',message=>{clearTimeout(timer);if(message==='ready')resolve();else reject(new Error('invalid watchdog response'));});
      });
    },
    async close() {
      if(closed) return;
      if(fs.existsSync(path.join(directory,'quarantine.json'))) throw new Error('task custody quarantined');
      closing=true;
      if(fs.existsSync(path.join(directory,'native.json'))) await stopOwnedNative(directory);
      if(guardian?.connected) guardian.send('done');
      if(guardianExit) {
        let timer;
        try { await Promise.race([guardianExit,new Promise((_,reject)=>{timer=setTimeout(()=>reject(new Error('watchdog shutdown unconfirmed')),9000);})]); }
        finally {clearTimeout(timer);}
      }
      if(guardianLost) throw new Error('watchdog custody lost');
      if(fs.existsSync(path.join(directory,'quarantine.json'))) throw new Error('task custody quarantined');
      if(guardian && read(directory,'orphan-cleanup.json').mode!=='normal') throw new Error('watchdog normal completion unconfirmed');
      record(directory,'closed.json',{at:new Date().toISOString(),native_group_gone:true});
      fs.renameSync(directory,path.join(runDirectory,'custody'));
      closed=true;
    },
  };
}
