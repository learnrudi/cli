import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { validateTaskProfile } from '../../agent-host/task-profile.js';

test('registered profile preserves shared inputs and rejects broad or aliased write roots', t => {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'rudi-task-')));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  for (const name of ['project', 'project/output', 'runtime']) fs.mkdirSync(path.join(root, name));
  const project = path.join(root, 'project');
  const output = path.join(project, 'output');
  fs.writeFileSync(path.join(project, 'dirty.txt'), 'uncommitted');
  const profile = { schema_version: 1, provider: 'codex', model: 'gpt-5.6-sol',
    workspace_mode: 'registered-shared', working_directory: project,
    read_roots: [project], write_roots: [output], network: 'disabled', timeout_ms: 1000 };
  const binding = { working_directory: project, outputs: { deliverables: [output], runtime: path.join(root, 'runtime') } };
  assert.equal(validateTaskProfile(profile, binding).working_directory, project);
  assert.equal(validateTaskProfile({ ...profile, timeout_ms: 0 }, binding).timeout_ms, 0);
  for (const timeout_ms of [-1, null, false, '0', 3600001]) {
    assert.throws(() => validateTaskProfile({ ...profile, timeout_ms }, binding), /timeout/);
  }
  assert.equal(fs.readFileSync(path.join(project, 'dirty.txt'), 'utf8'), 'uncommitted');
  assert.throws(() => validateTaskProfile({ ...profile, write_roots: [project] }, binding), /write roots/);
  assert.throws(() => validateTaskProfile({ ...profile, fallback_model: 'x' }, binding), /fields/);
  fs.symlinkSync(output, path.join(project, 'alias'));
  assert.throws(() => validateTaskProfile({ ...profile, write_roots: [path.join(project, 'alias')] }, binding), /canonical/);
  fs.linkSync(path.join(project, 'dirty.txt'), path.join(output, 'hardlink'));
  assert.throws(() => validateTaskProfile(profile, binding), /hardlink/);
  assert.equal(fs.readFileSync(path.join(project, 'dirty.txt'), 'utf8'), 'uncommitted');
});

test('shared workspace uses the registered directory with scoped native arguments', async t => {
  const { resolveAgentWorkspace, cleanupUnstartedWorkspace } = await import('../../agent-host/workspace.js');
  const { buildCodexPlan } = await import('../../agent-host/providers/codex.js');
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'rudi-task-plan-')));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  for (const name of ['project', 'project/output', 'runtime']) fs.mkdirSync(path.join(root, name));
  const binding = { working_directory: path.join(root, 'project'), outputs: { deliverables: [path.join(root, 'project/output')], runtime: path.join(root, 'runtime') } };
  const profile = validateTaskProfile({ schema_version: 1, provider: 'codex', model: 'gpt-5.6-sol',
    workspace_mode: 'registered-shared', working_directory: binding.working_directory,
    read_roots: [binding.working_directory], write_roots: binding.outputs.deliverables,
    network: 'disabled', timeout_ms: 1000 }, binding);
  assert.throws(() => resolveAgentWorkspace({ artifactsRoot: binding.outputs.runtime, launchId: 'launch_no_profile', mode: 'registered-shared', workspace: binding.working_directory }), /validated/);
  const workspace = resolveAgentWorkspace({ artifactsRoot: binding.outputs.runtime, launchId: 'launch_fixture',
    mode: 'registered-shared', workspace: binding.working_directory, taskProfile: profile });
  assert.equal(workspace.executionWorkspace, binding.working_directory);
  const plan = buildCodexPlan({ binaryPath: '/native/codex', cwd: workspace.executionWorkspace,
    workspaceMode: workspace.mode, taskProfile: profile, model: profile.model, prompt: 'test', runtimeDirectory: workspace.outputDestination });
  assert.equal(plan.permissionMode, 'registered-shared');
  assert.equal(plan.taskProfile, profile);
  assert.equal(plan.stdin, 'test');
  assert.ok(plan.args.includes('default_permissions="rudi_task"'));
  assert.ok(plan.args.includes('--ignore-user-config'));
  assert.ok(!plan.args.includes('-s'));
  assert.ok(!plan.args.includes('--add-dir'));
  const featureModes = new Map(plan.args.flatMap((arg, index) =>
    ['--enable', '--disable'].includes(arg) ? [[plan.args[index + 1], arg]] : []));
  assert.equal(featureModes.get('code_mode_host'), '--enable', 'native command tools require their transport');
  for (const feature of ['apps', 'browser_use', 'plugins', 'multi_agent']) {
    assert.equal(featureModes.get(feature), '--disable');
  }
  assert.throws(() => buildCodexPlan({ binaryPath: '/native/codex', cwd: workspace.executionWorkspace,
    workspaceMode: workspace.mode, taskProfile: profile, model: profile.model, prompt: 'test',
    runtimeDirectory: workspace.outputDestination, extraArgs: ['--sandbox', 'danger-full-access'] }), /forbids/);
  cleanupUnstartedWorkspace(workspace);
  assert.ok(fs.existsSync(binding.working_directory));
});

test('a FIFO reference is rejected promptly without blocking the host', async t => {
  const { spawnSync } = await import('node:child_process');
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'task-fifo-')));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const fifo = path.join(root, 'reference');
  assert.equal(spawnSync('/usr/bin/mkfifo', [fifo]).status, 0);
  const module = new URL('../../agent-host/task-profile.js', import.meta.url).href;
  const script = `import {readTaskReference} from ${JSON.stringify(module)}; try { readTaskReference(${JSON.stringify({path:fifo,sha256:'a'.repeat(64)})},'fixture'); process.exit(2); } catch { process.exit(0); }`;
  const result = spawnSync(process.execPath, ['--input-type=module', '-e', script], { timeout: 1500 });
  assert.equal(result.error, undefined, 'reference validation must not block on a FIFO');
  assert.equal(result.status, 0);
});

test('task JSON rejects duplicate keys instead of silently replacing permissions', async () => {
  const { parseTaskJson } = await import('../../agent-host/task-profile.js');
  assert.throws(() => parseTaskJson('{"write_roots":[],"write_roots":["/tmp"]}'), /duplicate/);
  assert.deepEqual(parseTaskJson('{"a":[{"b":"x\\\"y"}],"c":1}'), { a: [{ b: 'x"y' }], c: 1 });
});
