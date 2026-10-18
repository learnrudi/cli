import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { auditHelperPath } from './task-audit.js';
import { getPrivateCodexDisabledFeatures } from './private-automation-profile.js';
import { inspectCodexTaskSeat } from './task-codex-account.js';
import { taskRouter, trustedTaskPath, trustedCodexToolApprovalArgs } from './task-integrations.js';
import { inside } from './task-profile.js';

// This boundary is qualified on this native release, not inferred from a version range.
export const TASK_CODEX_VERSION = '0.160.1';
// Unlike tool-free private automation, tasks need the native command transport.
const TASK_DISABLED = getPrivateCodexDisabledFeatures().filter(feature => !['shell_tool', 'unified_exec', 'code_mode_host'].includes(feature));

export function taskEnvironment(binaryPath, profile = null) {
  const result = { PATH: `${path.dirname(binaryPath)}:/usr/bin:/bin:/usr/sbin:/sbin:/usr/local/bin:/opt/homebrew/bin` };
  if (profile?.access_mode === 'trusted') result.PATH = trustedTaskPath(binaryPath);
  for (const key of ['HOME', 'USER', 'LOGNAME', 'LANG', 'LC_ALL']) {
    if (typeof process.env[key] === 'string') result[key] = process.env[key];
  }
  if (profile?.account) result.CODEX_HOME = profile.account.config_directory;
  return result;
}

export function taskPermissionArgs(profile) {
  const filesystem = { ':minimal': 'read' };
  for (const root of profile.read_roots) {
    filesystem[root] = profile.access_mode === 'trusted' && profile.write_roots.some(allowed => inside(root, allowed)) ? 'write' : 'read';
  }
  for (const root of profile.write_roots) filesystem[root] = 'write';
  if (profile.access_mode === 'trusted') {
    for (const root of new Set([profile.working_directory, ...profile.write_roots])) {
      for (const name of ['.git', '.codex', '.agents', 'AGENTS.md']) {
        const candidate = path.join(root, name);
        const target = fs.existsSync(candidate) ? fs.realpathSync(candidate) : candidate;
        if (profile.write_roots.some(allowed => inside(target, allowed))) filesystem[target] = 'write';
      }
    }
  }
  const rules = Object.entries(filesystem).map(([key, value]) => `${JSON.stringify(key)}=${JSON.stringify(value)}`).join(',');
  return ['-c', 'default_permissions="rudi_task"', '-c', `permissions={rudi_task={filesystem={${rules}},network={enabled=${profile.network === 'enabled'}}}}`];
}

export function taskCodexArgs(context, { spawnSyncImpl = spawnSync } = {}) {
  const args = ['--ask-for-approval', 'never', '--no-daemon', '--enable', 'code_mode_host'];
  if (context.taskProfile.account) args.push('-c', 'cli_auth_credentials_store="file"');
  if (context.taskProfile.reasoning_effort !== undefined) {
    args.push('-c', `model_reasoning_effort=${JSON.stringify(context.taskProfile.reasoning_effort)}`);
  }
  const trusted = context.taskProfile.access_mode === 'trusted';
  if (trusted) {
    // A host-local profile can link shared integrations without copying auth or
    // introducing config.toml into restricted accounts. Native auth still uses
    // the selected CODEX_HOME; CLI model/permission options take precedence.
    if (fs.existsSync(path.join(context.taskProfile.account.config_directory, 'rudi-trusted.config.toml'))) {
      args.push('--profile', 'rudi-trusted');
    }
    args.push('-c', `mcp_servers.rudi.command=${JSON.stringify(taskRouter())}`,
      '-c', 'mcp_servers.rudi.enabled=true', '-c', 'model_provider="openai"',
      '-c', 'web_search="live"');
    args.push(...trustedCodexToolApprovalArgs(context.binaryPath, args,
      taskEnvironment(context.binaryPath, context.taskProfile), context.cwd, spawnSyncImpl));
  } else {
    for (const feature of TASK_DISABLED) args.push('--disable', feature);
    args.push('-c', 'mcp_servers={}', '-c', 'web_search="disabled"');
  }
  args.push(...taskPermissionArgs(context.taskProfile),
    '-c', `shell_environment_policy.inherit=${trusted ? '"all"' : '"none"'}`,
    'exec', '-', '--json', '--skip-git-repo-check', '--color', 'never',
    '--strict-config', ...(!trusted ? ['--ignore-user-config', '--ignore-rules'] : []), '-C', context.cwd, '-m', context.model);
  return args;
}

export async function assertTaskHostCapabilities({ binaryPath, profile }, { spawnSyncImpl = spawnSync, spawnImpl } = {}) {
  if (process.platform !== 'darwin') throw new Error('task shared permissions currently qualified on macOS only');
  // User config is ignored. Reject other local layers rather than allow legacy
  // sandbox_mode or hooks to override the registered permission profile.
  for (let cursor = profile.working_directory; ; cursor = path.dirname(cursor)) {
    if (profile.access_mode !== 'trusted' && cursor !== os.homedir() && fs.existsSync(path.join(cursor, '.codex', 'config.toml'))) {
      throw new Error('task workspace ancestor contains native config; explicit qualification required');
    }
    if (cursor === path.dirname(cursor)) break;
  }
  if (profile.access_mode !== 'trusted' && fs.existsSync('/etc/codex/config.toml')) throw new Error('system Codex config requires explicit task qualification');
  const environment = taskEnvironment(binaryPath, profile);
  const account = profile.account ? await inspectCodexTaskSeat(binaryPath, profile, environment, { spawnImpl }) : null;
  const probe = (args, input) => spawnSyncImpl(binaryPath, args, { encoding: 'utf8', input, timeout: 5000, maxBuffer: 262144, env: environment });
  const version = probe(['--version']);
  if (version.status !== 0 || String(version.stdout).trim() !== `codex-cli ${TASK_CODEX_VERSION}`) {
    throw new Error('native Codex version is not qualified for task permissions');
  }
  const args = taskCodexArgs({ binaryPath, taskProfile: profile, cwd: profile.working_directory, model: profile.model }, { spawnSyncImpl });
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
  return { version: TASK_CODEX_VERSION, ...(account ? { account } : {}) };
}
