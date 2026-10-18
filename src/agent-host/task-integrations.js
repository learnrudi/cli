import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// Discover the host installation, not a frozen stack/tool inventory. The router
// owns secrets and connection availability. Only its executable path is passed.
export function taskRouter() {
  const command = path.join(os.homedir(), '.rudi', 'bins', 'rudi-router');
  try {
    if (!fs.statSync(command).isFile()) throw new Error();
    fs.accessSync(command, fs.constants.X_OK);
  } catch { throw new Error('trusted task requires an installed executable RUDI router'); }
  return command;
}

export function trustedTaskPath(binaryPath) {
  return [path.dirname(binaryPath), path.dirname(taskRouter()), path.join(os.homedir(), '.local/bin'),
    '/usr/bin', '/bin', '/usr/sbin', '/sbin', '/usr/local/bin', '/opt/homebrew/bin'].join(':');
}
