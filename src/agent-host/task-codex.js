import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { auditHelperPath } from './task-audit.js';
import { getPrivateCodexDisabledFeatures } from './private-automation-profile.js';

// This boundary is qualified on this native release, not inferred from a version range.
export const TASK_CODEX_VERSION = '0.160.1';
// Unlike tool-free private automation, tasks need the native command transport.
const TASK_DISABLED = getPrivateCodexDisabledFeatures().filter(feature => !['shell_tool', 'unified_exec', 'code_mode_host'].includes(feature));

export function taskEnvironment(binaryPath) {
  const result = { PATH: `${path.dirname(binaryPath)}:/usr/bin:/bin:/usr/sbin:/sbin:/usr/local/bin:/opt/homebrew/bin` };
  for (const key of ['HOME', 'USER', 'LOGNAME', 'LANG', 'LC_ALL']) {
    if (typeof process.env[key] === 'string') result[key] = process.env[key];
  }
  return result;
}

export function taskPermissionArgs(profile) {
  const filesystem = { ':minimal': 'read' };
  for (const root of profile.read_roots) filesystem[root] = 'read';
  for (const root of profile.write_roots) filesystem[root] = 'write';
  const rules = Object.entries(filesystem).map(([key, value]) => `${JSON.stringify(key)}=${JSON.stringify(value)}`).join(',');
  return ['-c', 'default_permissions="rudi_task"', '-c', `permissions={rudi_task={filesystem={${rules}},network={enabled=${profile.network === 'enabled'}}}}`];
}

export function taskCodexArgs(context) {
  const args = ['--ask-for-approval', 'never', '--no-daemon', '--enable', 'code_mode_host'];
  for (const feature of TASK_DISABLED) args.push('--disable', feature);
  args.push(...taskPermissionArgs(context.taskProfile), '-c', 'mcp_servers={}',
    '-c', 'shell_environment_policy.inherit="none"', '-c', 'web_search="disabled"',
    'exec', '-', '--json', '--skip-git-repo-check', '--color', 'never',
    '--strict-config', '--ignore-user-config', '--ignore-rules', '-C', context.cwd, '-m', context.model);
  return args;
}

export function assertTaskHostCapabilities({ binaryPath, profile }, { spawnSyncImpl = spawnSync } = {}) {
  if (process.platform !== 'darwin') throw new Error('task shared permissions currently qualified on macOS only');
  // User config is ignored. Reject other local layers rather than allow legacy
  // sandbox_mode or hooks to override the registered permission profile.
  for (let cursor = profile.working_directory; ; cursor = path.dirname(cursor)) {
    if (cursor !== os.homedir() && fs.existsSync(path.join(cursor, '.codex', 'config.toml'))) {
      throw new Error('task workspace ancestor contains native config; explicit qualification required');
    }
    if (cursor === path.dirname(cursor)) break;
  }
  if (fs.existsSync('/etc/codex/config.toml')) throw new Error('system Codex config requires explicit task qualification');
  const probe = (args, input) => spawnSyncImpl(binaryPath, args, { encoding: 'utf8', input, timeout: 5000, maxBuffer: 262144, env: taskEnvironment(binaryPath) });
  const version = probe(['--version']);
  if (version.status !== 0 || String(version.stdout).trim() !== `codex-cli ${TASK_CODEX_VERSION}`) {
    throw new Error('native Codex version is not qualified for task permissions');
  }
  const args = taskCodexArgs({ taskProfile: profile, cwd: profile.working_directory, model: profile.model });
  const config = probe(args, '');
  if (config.error || config.status === 0 || !`${config.stdout}${config.stderr}`.includes('No prompt provided via stdin.')) {
    throw new Error('native task configuration probe failed');
  }
  const helper=auditHelperPath();
  const containment=probe(['sandbox','-P','rudi_task',...taskPermissionArgs({...profile,read_roots:[...profile.read_roots,helper]}),
    '-C',profile.working_directory,'--',helper,'probe',String(process.pid)]);
  if(containment.status!==0 || String(containment.stdout).trim()!==JSON.stringify({audit_session_escape_denied:true,supervisor_signal_denied:true})) {
    throw new Error('native audit containment capability probe failed');
  }
  return { version: TASK_CODEX_VERSION };
}
