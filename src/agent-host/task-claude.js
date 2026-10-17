import path from 'node:path';
import { spawnSync } from 'node:child_process';

// Native tool permissions complement the separately enforced OS sandbox.
export function taskClaudeArgs(context) {
  const profile = context.taskProfile;
  if (profile.network !== 'disabled') throw new Error('Claude task requires disabled tool network');
  // Claude permission rules have their own glob/delimiter syntax. Do not let
  // canonical but unrepresentable paths silently widen a permission rule.
  const roots = [...new Set([...profile.read_roots, ...profile.write_roots])];
  if (roots.some(root => /[(){}!,\\]/u.test(root))) throw new Error('Claude task root cannot be represented as a literal permission rule');
  const settings = {
    permissions: {
      defaultMode: 'dontAsk',
      blockReadsOutsideWorkingDirectories: true,
      allow: profile.write_roots.flatMap(root => [`Write(/${root}/**)`, `Edit(/${root}/**)`]),
    },
    disableAllHooks: true,
  };
  return ['--print', '--verbose', '--output-format', 'stream-json', '--input-format', 'text',
    '--model', context.model, '--safe-mode', '--restricted',
    '--no-chrome', '--disable-slash-commands', '--tools', 'Read,Write,Edit',
    '--strict-mcp-config', '--mcp-config', '{"mcpServers":{}}', '--setting-sources', '',
    '--permission-mode', 'dontAsk', '--settings', JSON.stringify(settings),
    ...roots.flatMap(root => ['--add-dir', root])];
}

export function taskClaudeEnvironment(binaryPath, profile = null) {
  const environment = { PATH: `${path.dirname(binaryPath)}:/usr/bin:/bin:/usr/sbin:/sbin`,
    CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: '1', CLAUDE_CODE_DISABLE_BACKGROUND_TASKS: '1',
    CLAUDE_CODE_DISABLE_AUTO_MEMORY: '1', CLAUDE_CODE_NO_MODEL_FALLBACK: '1' };
  // Native seat discovery uses the original HOME/keychain. Never forward API
  // keys, OAuth tokens, alternate config homes, proxy or provider overrides.
  for (const key of ['HOME', 'USER', 'LOGNAME', 'LANG', 'LC_ALL']) {
    if (typeof process.env[key] === 'string') environment[key] = process.env[key];
  }
  if (profile?.account) {
    environment.CLAUDE_CONFIG_DIR = profile.account.config_directory;
    environment.ANTHROPIC_CONFIG_DIR = profile.account.anthropic_directory;
  }
  return environment;
}

export function inspectClaudeTaskSeat(binaryPath, { spawnSyncImpl = spawnSync, profile = null } = {}) {
  const result = spawnSyncImpl(binaryPath, ['auth', 'status'], { encoding: 'utf8',
    timeout: 5000, maxBuffer: 65536, env: taskClaudeEnvironment(binaryPath, profile) });
  let status;
  try { status = JSON.parse(result.stdout); } catch { /* fail closed below */ }
  if (result.error || result.status !== 0 || status?.loggedIn !== true
      || status.authMethod !== 'claude.ai' || status.apiProvider !== 'firstParty') {
    throw new Error('native Claude authenticated first-party seat required; run claude auth login on this host');
  }
  let account;
  if (profile?.account) {
    const expected = profile.account;
    if (status.email !== expected.email || status.orgId !== expected.organization_id
        || status.configDirectory !== expected.config_directory
        || status.projectsDirectory !== path.join(expected.config_directory, 'projects')) {
      throw new Error('native Claude account does not match the pinned execution profile');
    }
    account = Object.freeze({...expected, projects_directory: status.projectsDirectory});
  }
  return { authenticated: true, authMethod: 'claude.ai', apiProvider: 'firstParty', ...(account ? {account} : {}) };
}
