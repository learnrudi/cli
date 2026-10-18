import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { sha256, validateTaskProfile } from '../../agent-host/task-profile.js';
import { taskCodexArgs, taskEnvironment, taskPermissionArgs } from '../../agent-host/task-codex.js';
import { taskClaudeArgs, taskClaudeEnvironment } from '../../agent-host/task-claude.js';
import { claudeSandboxPolicy } from '../../agent-host/task-claude-sandbox.js';
import { readAgentTask, runAgentTaskInSession } from '../../agent-host/task-run.js';
import { trustedCodexToolApprovalArgs } from '../../agent-host/task-integrations.js';

function fixture(t, provider = 'codex') {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'task-trusted-')));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  for (const name of ['project', 'out', 'runtime', 'runtime/account', 'anthropic']) {
    fs.mkdirSync(path.join(root, name), { mode: 0o700 });
  }
  const project = path.join(root, 'project');
  const binding = { working_directory: project, outputs: {
    deliverables: [path.join(root, 'out')], runtime: path.join(root, 'runtime') } };
  const input = { schema_version: 1, provider,
    model: provider === 'codex' ? 'gpt-6.1-sol' : 'claude-haiku-4-5-20251001',
    workspace_mode: 'registered-shared', access_mode: 'trusted', working_directory: project,
    read_roots: [project, path.join(root, 'runtime')],
    write_roots: [project, path.join(root, 'runtime'), ...binding.outputs.deliverables],
    network: 'enabled', timeout_ms: 1000, account: {
      id: `${provider}-fixture`, email: 'fixture@example.test', config_directory: path.join(root, 'runtime/account'),
      ...(provider === 'claude' ? { organization_id: 'fixture-org', anthropic_directory: path.join(root, 'anthropic') } : {}),
    } };
  return { root, project, binding, input };
}

test('explicit trusted profile accepts project and runtime writes with ordinary repository links', t => {
  const { project, binding, input } = fixture(t);
  fs.writeFileSync(path.join(project, 'source'), 'existing work');
  fs.symlinkSync('source', path.join(project, 'link'));
  const profile = validateTaskProfile(input, binding);
  assert.deepEqual(profile.write_roots, input.write_roots);
  assert.equal(fs.readFileSync(path.join(project, 'source'), 'utf8'), 'existing work');
  assert.throws(() => validateTaskProfile({ ...input, access_mode: 'anything' }, binding), /access mode/);
  assert.throws(() => validateTaskProfile({ ...input, account: undefined }, binding), /account/);
  assert.throws(() => validateTaskProfile({ ...input, network: 'disabled' }, binding), /network/);
  assert.throws(() => validateTaskProfile({ ...input, write_roots: [project] }, binding), /deliverable/);
});

test('trusted Codex explicitly grants protected repository metadata only within approved write roots', t => {
  const { root, project, input, binding } = fixture(t);
  const profile = validateTaskProfile(input, binding);
  const policy = taskPermissionArgs(profile).at(-1);
  assert.ok(policy.includes(`${JSON.stringify(path.join(project, '.git'))}="write"`));
  const outside = path.join(root, 'outside');
  fs.mkdirSync(outside);
  fs.symlinkSync(outside, path.join(project, '.codex'));
  assert.ok(!taskPermissionArgs(profile).at(-1).includes(`${JSON.stringify(outside)}="write"`));
});

test('nested read roots do not mask an approved parent write grant', t => {
  const { project, input, binding } = fixture(t);
  const child = path.join(project, 'child');
  fs.mkdirSync(child);
  const profile = validateTaskProfile({ ...input, read_roots: [...input.read_roots, child] }, binding);
  assert.ok(taskPermissionArgs(profile).at(-1).includes(`${JSON.stringify(child)}="write"`));
});

test('restricted profiles retain explicit read exceptions inside writable roots', t => {
  const { input, binding, project } = fixture(t);
  const child = path.join(binding.outputs.deliverables[0], 'input');
  fs.mkdirSync(child);
  delete input.access_mode;
  delete input.account;
  input.network = 'disabled';
  input.read_roots = [project, child];
  input.write_roots = binding.outputs.deliverables;
  for (const value of [input, { ...input, access_mode: 'restricted' }]) {
    const profile = validateTaskProfile(value, binding);
    assert.ok(taskPermissionArgs(profile).at(-1).includes(`${JSON.stringify(child)}="read"`));
  }
});

test('trusted runtime access admits hashed controls but only reports declared deliverables', async t => {
  const { input, binding } = fixture(t);
  const ref = (name, text) => {
    const filename = path.join(binding.outputs.runtime, name);
    fs.writeFileSync(filename, text);
    return { path: filename, sha256: sha256(text) };
  };
  const request = ref('request.json', JSON.stringify({ schema_version: 1,
    task: { id: 'trusted', revision: 1, definition_sha256: 'a'.repeat(64) },
    instructions: ref('instructions.md', 'fixture'), execution_profile: ref('profile.json', JSON.stringify(input)),
    ...binding, timeout_seconds: 30 }));
  assert.equal(readAgentTask(request).profile.access_mode, 'trusted');
  const output = path.join(binding.outputs.deliverables[0], 'report.md');
  fs.writeFileSync(output, 'report');
  for (const [index, filename] of [output, request.path].entries()) {
    const result = await runAgentTaskInSession(request, {
      environment: { RUDI_COMPUTE_JOB_ID: `job_trusted_${index}`, RUDI_COMPUTE_ATTEMPT: '1', RUDI_COMPUTE_SPEC_HASH: 'b'.repeat(64) },
      custodyFactory: async () => ({ track: async () => {}, close: async () => {}, stop: async () => {} }),
      launchImpl: async () => ({ launchId: `launch_trusted_${index}`, nativeSessionId: 'native_fixture', status: 'completed',
        taskFinalOutput: { outcome: 'complete', outputs: [filename] } }),
    });
    assert.equal(result.status, index === 0 ? 'completed' : 'failed');
    const receipt = JSON.parse(fs.readFileSync(result.receipt.path));
    assert.equal(receipt.access_mode, 'trusted');
    if (index === 1) assert.match(receipt.error, /output path/);
  }
  fs.appendFileSync(request.path, ' ');
  assert.throws(() => readAgentTask(request), /hash mismatch/);
});

test('trusted Claude exposes native tools and configured MCPs while retaining declared filesystem roots', t => {
  const { root, input, binding } = fixture(t, 'claude');
  t.mock.method(os, 'homedir', () => root);
  const router = path.join(root, '.rudi/bins/rudi-router');
  fs.mkdirSync(path.dirname(router), { recursive: true });
  fs.writeFileSync(router, '#!/bin/sh\nexit 0\n', { mode: 0o700 });
  const profile = validateTaskProfile(input, binding);
  const args = taskClaudeArgs({ taskProfile: profile, model: profile.model });
  assert.equal(args[args.indexOf('--tools') + 1], 'default');
  assert.equal(args[args.indexOf('--permission-mode') + 1], 'bypassPermissions');
  for (const flag of ['--safe-mode', '--restricted', '--strict-mcp-config', '--setting-sources']) {
    assert.ok(!args.includes(flag));
  }
  const mcp = JSON.parse(args[args.indexOf('--mcp-config') + 1]);
  assert.deepEqual(mcp.mcpServers.rudi, { command: router, args: [] });
  const env = taskClaudeEnvironment('/native/claude', profile);
  assert.equal(env.CLAUDE_CONFIG_DIR, profile.account.config_directory);
  assert.ok(env.PATH.split(':').includes(path.dirname(router)));
  const sandbox = claudeSandboxPolicy('/native/claude', profile, binding.outputs.runtime);
  assert.ok(sandbox.includes('(deny file-write*)'));
  assert.ok(sandbox.includes(`(subpath ${JSON.stringify(input.working_directory)})`));
  assert.ok(sandbox.includes(`(subpath ${JSON.stringify(path.join(root, '.rudi'))})`));
});

test('trusted Codex uses native configuration and RUDI without clearing configured MCPs or apps', t => {
  const { root, input, binding } = fixture(t);
  t.mock.method(os, 'homedir', () => root);
  const router = path.join(root, '.rudi/bins/rudi-router');
  fs.mkdirSync(path.dirname(router), { recursive: true });
  fs.writeFileSync(router, '#!/bin/sh\nexit 0\n', { mode: 0o700 });
  fs.writeFileSync(path.join(input.account.config_directory, 'config.toml'), '[mcp_servers.configured]\ncommand="configured-server"\n');
  fs.symlinkSync('config.toml', path.join(input.account.config_directory, 'rudi-trusted.config.toml'));
  const profile = validateTaskProfile(input, binding);
  const args = taskCodexArgs({ binaryPath: '/native/codex', taskProfile: profile, cwd: profile.working_directory, model: profile.model }, {
    spawnSyncImpl: (_binary, probeArgs, options) => {
      assert.deepEqual(probeArgs.slice(-3), ['mcp', 'list', '--json']);
      assert.equal(options.cwd, profile.working_directory);
      return { status: 0, stdout: JSON.stringify([{ name: 'configured', enabled: true }, { name: 'disabled', enabled: false }]) };
    },
  });
  assert.ok(args.includes('mcp_servers.rudi.default_tools_approval_mode="approve"'));
  assert.ok(args.includes('mcp_servers.configured.default_tools_approval_mode="approve"'));
  assert.ok(!args.includes('mcp_servers.disabled.default_tools_approval_mode="approve"'));
  assert.ok(args.includes('apps._default.default_tools_approval_mode="approve"'));
  assert.ok(!args.includes('mcp_servers={}'));
  assert.ok(!args.includes('--ignore-user-config'));
  assert.ok(!args.includes('--ignore-rules'));
  for (const feature of ['apps', 'plugins', 'remote_plugin']) {
    assert.ok(!args.some((arg, i) => arg === '--disable' && args[i + 1] === feature));
  }
  assert.ok(args.includes(`mcp_servers.rudi.command=${JSON.stringify(router)}`));
  assert.ok(args.includes('model_provider="openai"'));
  assert.ok(args.includes('web_search="live"'));
  assert.equal(args[args.indexOf('--profile') + 1], 'rudi-trusted');
  const environment = taskEnvironment('/native/codex', profile);
  assert.equal(environment.CODEX_HOME, profile.account.config_directory);
  assert.ok(environment.PATH.split(':').includes(path.dirname(router)));
  assert.equal(environment.OPENAI_API_KEY, undefined);
  fs.unlinkSync(router);
  assert.throws(() => taskCodexArgs({ taskProfile: profile }), /RUDI router/);
});

test('trusted MCP discovery fails closed without exposing configuration on invalid inventory', () => {
  for (const result of [{ status: 1, stderr: 'private config' }, { status: 0, stdout: 'not json' },
    { status: 0, stdout: JSON.stringify([{ name: 'rudi.default_tools_approval_mode', enabled: true }]) },
    { status: 0, stdout: JSON.stringify([{ name: 'rudi', enabled: 'yes' }]) }]) {
    assert.throws(() => trustedCodexToolApprovalArgs('/native/codex', [], {}, '/task/project', () => result),
      error => /trusted task MCP configuration/.test(error.message) && !error.message.includes('private'));
  }
});
