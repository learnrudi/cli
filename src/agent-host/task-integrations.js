import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

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

// Native `never` denies MCP calls that would need a prompt. Trusted jobs need
// explicit defaults for the discovered servers; retain per-tool/managed rules.
export function trustedCodexToolApprovalArgs(binary, args, env, cwd, spawnSyncImpl = spawnSync) {
  const result = spawnSyncImpl(binary, [...args, 'mcp', 'list', '--json'], {
    env, cwd, encoding: 'utf8', timeout: 10000, maxBuffer: 2 * 1024 * 1024,
  });
  if (result.error || result.status !== 0) throw new Error('trusted task MCP configuration discovery failed');
  let servers;
  try { servers = JSON.parse(result.stdout); }
  catch { throw new Error('invalid trusted task MCP configuration inventory'); }
  if (!Array.isArray(servers) || servers.length > 128 || servers.some(server =>
    !server || typeof server.name !== 'string' || !/^[a-zA-Z0-9_-]{1,128}$/u.test(server.name)
    || typeof server.enabled !== 'boolean')) throw new Error('invalid trusted task MCP configuration inventory');
  const names = new Set(['rudi', ...servers.filter(server => server.enabled).map(server => server.name)]);
  return ['-c', 'apps._default.default_tools_approval_mode="approve"',
    ...[...names].flatMap(name => ['-c', `mcp_servers.${name}.default_tools_approval_mode="approve"`])];
}
