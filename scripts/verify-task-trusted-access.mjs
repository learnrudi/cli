// No inference or login: exercise native file permissions and MCP configuration.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { taskPermissionArgs, taskCodexArgs } from '../src/agent-host/task-codex.js';
import { claudeSandboxPolicy } from '../src/agent-host/task-claude-sandbox.js';

const [codex, claude] = process.argv.slice(2);
if (!codex || !claude || ![codex, claude].every(value => path.isAbsolute(value) && fs.existsSync(value))) {
  throw new Error('usage: node scripts/verify-task-trusted-access.mjs /absolute/codex /absolute/claude');
}
const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'trusted-native-smoke-')));
const evidence = [];
try {
  for (const name of ['project', 'project/child', 'account', 'tmp', 'anthropic', 'outside']) fs.mkdirSync(path.join(root, name));
  const profile = { access_mode: 'trusted', working_directory: path.join(root, 'project'),
    read_roots: [path.join(root, 'project')], write_roots: [path.join(root, 'project')], network: 'enabled',
    account: { config_directory: path.join(root, 'account'), anthropic_directory: path.join(root, 'anthropic') } };
  const env = { HOME: os.homedir(), PATH: '/usr/bin:/bin', CODEX_HOME: profile.account.config_directory };
  fs.symlinkSync(path.join(os.homedir(), '.codex/config.toml'), path.join(root, 'account/rudi-trusted.config.toml'));
  for (const [provider, binary] of [['codex', codex], ['claude', claude]]) {
    const version = spawnSync(binary, ['--version'], { encoding: 'utf8', timeout: 5000 });
    assert.equal(version.status, 0, `${provider} version probe failed`);
    const prefix = provider === 'codex'
      ? ['sandbox', '-P', 'rudi_task', ...taskPermissionArgs(profile), '-C', profile.working_directory, '--']
      : ['-p', claudeSandboxPolicy(binary, profile, path.join(root, 'tmp'))];
    const command = provider === 'codex' ? binary : '/usr/bin/sandbox-exec';
    const init = spawnSync(command, [...prefix, '/bin/mkdir', path.join(root, 'project/.git')], { encoding: 'utf8', timeout: 5000, env });
    assert.equal(init.status, 0, `${provider} could not create Git metadata`);
    const writes = [];
    for (const name of ['project/root.txt', 'project/child/nested.txt', 'project/.git/HEAD', 'outside/denied.txt']) {
      const target = path.join(root, name);
      const result = spawnSync(command, [...prefix, '/usr/bin/touch', target], { encoding: 'utf8', timeout: 5000, env });
      const allowed = name.startsWith('project/');
      assert.equal(result.status === 0, allowed, `${provider}: ${name}`);
      assert.equal(fs.existsSync(target), allowed, `${provider} write evidence: ${name}`);
      writes.push({ name, allowed });
      if (allowed) fs.unlinkSync(target);
    }
    fs.rmdirSync(path.join(root, 'project/.git'));
    evidence.push({ provider, version: version.stdout.trim(), writes });
  }
  const args = taskCodexArgs({ binaryPath: codex, taskProfile: profile, cwd: profile.working_directory, model: 'gpt-6.1-sol' });
  const listed = spawnSync(codex, [...args.slice(0, args.indexOf('exec')), 'mcp', 'list', '--json'],
    { encoding: 'utf8', timeout: 10000, maxBuffer: 4 * 1024 * 1024, env });
  assert.equal(listed.status, 0, 'native MCP configuration listing failed');
  const servers = JSON.parse(listed.stdout).map(server => ({ name: server.name, enabled: server.enabled }));
  assert.ok(servers.some(server => server.name === 'rudi' && server.enabled));
  evidence.push({ configured_mcp_servers: servers });
  console.log(JSON.stringify({ status: 'passed', evidence }, null, 2));
} finally { fs.rmSync(root, { recursive: true, force: true }); }
