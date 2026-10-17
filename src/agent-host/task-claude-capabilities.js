import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { auditHelperPath } from './task-audit.js';
import { inspectClaudeTaskSeat, taskClaudeEnvironment } from './task-claude.js';
import { claudeSandboxPolicy } from './task-claude-sandbox.js';

export const TASK_CLAUDE_VERSION = '2.1.294';

export function assertClaudeTaskCapabilities({binaryPath,profile}, {spawnSyncImpl=spawnSync,helperPathImpl=auditHelperPath}={}) {
  const helper = helperPathImpl(); // Enforces the qualified OS/architecture and installed helper.
  if (!profile.account || profile.network !== 'disabled') throw new Error('Claude task requires an explicit account and disabled tool network');
  for (const policy of ['/Library/Application Support/ClaudeCode/managed-settings.json',
    '/Library/Application Support/ClaudeCode/managed-settings.d',path.join(profile.account.config_directory,'managed-settings.json')]) {
    if (fs.existsSync(policy)) throw new Error('Managed Claude policy requires separate task qualification');
  }
  const env = taskClaudeEnvironment(binaryPath,profile);
  const version = spawnSyncImpl(binaryPath,['--version'],{encoding:'utf8',timeout:5000,maxBuffer:65536,env});
  if (version.error || version.status !== 0 || version.stdout.trim() !== `${TASK_CLAUDE_VERSION} (Claude Code)`) {
    throw new Error('Native Claude version is not qualified for task execution');
  }
  const seat = inspectClaudeTaskSeat(binaryPath,{profile,spawnSyncImpl});
  const temporary = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(),'rudi-claude-capability-')));
  try {
    const probe = path.join(temporary,'audit-probe');
    fs.copyFileSync(helper,probe,fs.constants.COPYFILE_EXCL);
    fs.chmodSync(probe,0o700);
    const checked = spawnSyncImpl('/usr/bin/sandbox-exec', ['-p',claudeSandboxPolicy(binaryPath,profile,temporary),probe,'probe',String(process.pid)],
      {encoding:'utf8',timeout:5000,maxBuffer:65536,env});
    if (checked.error || checked.status !== 0 || checked.stdout.trim() !== '{"audit_session_escape_denied":true,"supervisor_signal_denied":true}') {
      throw new Error('Claude OS sandbox containment capability probe failed');
    }
  } finally {fs.rmSync(temporary,{recursive:true,force:true});}
  return {version:TASK_CLAUDE_VERSION,account:seat.account};
}
