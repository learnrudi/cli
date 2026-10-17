import { spawn } from 'node:child_process';
import { parseTaskJson } from './task-profile.js';

// Keep a trusted group leader alive even when the native executable exits.
// It also drains its own group if the caller disappears or misses its deadline.
const PROBE_SUPERVISOR = `
const { spawn } = require('node:child_process');
const stop = () => process.kill(-process.pid, 'SIGKILL');
process.on('disconnect', stop);
process.on('SIGTERM', stop);
process.on('SIGINT', stop);
setTimeout(stop, 10000);
const native = spawn(process.argv[1], process.argv.slice(2), { stdio: [0, 1, 2] });
const failed = () => {
  if (process.connected) process.send('native-exited', error => { if (error) stop(); });
  else stop();
};
native.on('error', failed);
native.on('exit', failed);
`;

// The native protocol returns account metadata, never credential material.
// No session, thread, login, refresh, or inference request is sent here.
export async function inspectCodexTaskSeat(binaryPath, profile, environment, { spawnImpl = spawn } = {}) {
  const expected = profile.account;
  if (!expected) throw new Error('Codex account selection required');
  const account = await readNativeAccount(binaryPath, expected.config_directory, environment, spawnImpl);
  if (account?.type !== 'chatgpt' || account.email !== expected.email) {
    throw new Error('native Codex account does not match the pinned execution profile');
  }
  return Object.freeze({ ...expected, auth_method: 'chatgpt' });
}

function readNativeAccount(binaryPath, directory, environment, spawnImpl) {
  return new Promise((resolve, reject) => {
    const child = spawnImpl(process.execPath, ['-e', PROBE_SUPERVISOR, binaryPath, '--no-daemon', '-c', 'cli_auth_credentials_store="file"',
      '-c', 'mcp_servers={}', '-c', 'model_provider="openai"', 'app-server', '--stdio', '--strict-config'],
    { cwd: directory, env: environment, stdio: ['pipe', 'pipe', 'pipe', 'ipc'], detached: true });
    let buffer = '', bytes = 0, state = 'initialize', result, failure, stopping = false, settled = false, exited = false;
    const finish = error => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      child.stdin.destroy(); child.stdout.destroy(); child.stderr.destroy();
      if (child.connected) child.disconnect();
      child.unref?.();
      if (error) reject(error);
      else resolve(result);
    };
    const stop = error => {
      if (stopping) return;
      stopping = true;
      failure = error;
      // Only signal the process group while its owned leader is still live.
      // Descendants can retain pipes after the leader exits; never await those pipes.
      if (!exited) {
        try {
          if (child.pid) process.kill(-child.pid, 'SIGKILL');
          else child.kill('SIGKILL');
        } catch { child.kill('SIGKILL'); }
      }
    };
    const fail = () => stop(new Error('native Codex account inspection failed'));
    const timer = setTimeout(() => {
      const error = new Error('native Codex account inspection timed out');
      stop(error);
      finish(error); // Deadline settlement is independent of process/pipe closure.
    }, 10000);
    const send = value => child.stdin.write(`${JSON.stringify(value)}\n`);
    child.on('error', () => {
      const error = new Error('native Codex account inspection unavailable');
      stop(error);
      finish(error);
    });
    child.stdin.on('error', fail);
    child.on('message', fail); // The private supervisor reports early native exit.
    child.stderr.on('data', data => { bytes += data.length; if (bytes > 262144) fail(); });
    child.stdout.setEncoding('utf8');
    child.stdout.on('data', data => {
      if (stopping) return;
      bytes += Buffer.byteLength(data);
      if (bytes > 262144) { fail(); return; }
      buffer += data;
      while (buffer.includes('\n') && !stopping) {
        const end = buffer.indexOf('\n');
        const line = buffer.slice(0, end); buffer = buffer.slice(end + 1);
        let message;
        try { message = parseTaskJson(line); } catch { fail(); return; }
        if (!message || typeof message !== 'object' || Array.isArray(message)) { fail(); return; }
        if (message.id === undefined) continue; // Native status notifications carry no credentials.
        if (message.error || !message.result) { fail(); return; }
        if (state === 'initialize' && message.id === 1) {
          state = 'account';
          send({ method: 'initialized', params: {} });
          send({ id: 2, method: 'account/read', params: { refreshToken: false } });
        } else if (state === 'account' && message.id === 2) {
          result = message.result.account;
          stop(null);
        } else { fail(); return; }
      }
    });
    const onExit = () => {
      exited = true;
      finish(failure || (!stopping && new Error('native Codex account inspection ended early')));
    };
    child.on('exit', onExit);
    child.on('close', onExit);
    send({ id: 1, method: 'initialize', params: { clientInfo: { name: 'rudi_task_account_check', version: '1' }, capabilities: {} } });
  });
}
