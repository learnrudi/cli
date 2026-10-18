import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { validateTaskProfile } from '../../agent-host/task-profile.js';
import { buildCodexPlan } from '../../agent-host/providers/codex.js';

function fixture(t) {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'task-effort-')));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  for (const name of ['project', 'out', 'runtime']) fs.mkdirSync(path.join(root, name));
  const binding = { working_directory: path.join(root, 'project'), outputs: {
    runtime: path.join(root, 'runtime'), deliverables: [path.join(root, 'out')] } };
  return { binding, input: { schema_version: 1, provider: 'codex', model: 'gpt-5.6-sol',
    workspace_mode: 'registered-shared', working_directory: binding.working_directory,
    read_roots: [binding.working_directory], write_roots: binding.outputs.deliverables,
    network: 'disabled', timeout_ms: 1000, reasoning_effort: 'high' } };
}

test('registered Codex job pins its requested reasoning effort in the native invocation', t => {
  const { input, binding } = fixture(t);
  const profile = validateTaskProfile(input, binding);
  const plan = buildCodexPlan({ binaryPath: '/native/codex', cwd: profile.working_directory,
    workspaceMode: profile.workspace_mode, taskProfile: profile, model: profile.model,
    prompt: 'fixture', runtimeDirectory: binding.outputs.runtime });
  assert.ok(plan.args.includes('model_reasoning_effort="high"'));
  assert.equal(plan.taskProfile.reasoning_effort, 'high');
});

test('registered Codex jobs admit current models and preserve their exact effort', t => {
  const { input, binding } = fixture(t);
  for (const model of ['gpt-6-astra', 'gpt-6.1-sol', 'gpt-6-sol', 'gpt-6-luna']) {
    const profile = validateTaskProfile({ ...input, model, reasoning_effort: 'xhigh' }, binding);
    const plan = buildCodexPlan({ binaryPath: '/native/codex', cwd: profile.working_directory,
      workspaceMode: profile.workspace_mode, taskProfile: profile, model: profile.model,
      prompt: 'fixture', runtimeDirectory: binding.outputs.runtime });
    assert.equal(plan.args[plan.args.indexOf('-m') + 1], model);
    assert.ok(plan.args.includes('model_reasoning_effort="xhigh"'));
  }
  assert.throws(() => validateTaskProfile({ ...input, model: 'gpt-6-luna', reasoning_effort: 'ultra' }, binding), /reasoning effort/);
  assert.throws(() => validateTaskProfile({ ...input, model: 'gpt-6-astra', reasoning_effort: 'none' }, binding), /reasoning effort/);
});

test('registered profiles reject unsupported effort instead of silently choosing another level', t => {
  const { input, binding } = fixture(t);
  for (const reasoning_effort of ['', null, 3, {}, 'HIGH', 'automatic', 'high"\npermissions={}']) {
    assert.throws(() => validateTaskProfile({ ...input, reasoning_effort }, binding), /reasoning effort/);
  }
  assert.throws(() => validateTaskProfile({ ...input, model: 'gpt-5.6-luna', reasoning_effort: 'ultra' }, binding), /reasoning effort/);
  const { reasoning_effort: unused, ...legacy } = input;
  assert.equal(validateTaskProfile(legacy, binding).reasoning_effort, undefined);
});

test('Claude effort is explicit and Haiku 4.5 cannot silently ignore it', async t => {
  const { input, binding } = fixture(t);
  const root = path.dirname(binding.working_directory);
  for (const name of ['claude', 'anthropic']) fs.mkdirSync(path.join(root, name), { mode: 0o700 });
  const account = { id: 'claude-work', email: 'work@example.test', organization_id: 'org-fixture',
    config_directory: path.join(root, 'claude'), anthropic_directory: path.join(root, 'anthropic') };
  const { buildClaudePlan } = await import('../../agent-host/providers/claude.js');
  const profile = validateTaskProfile({ ...input, provider: 'claude', model: 'claude-sonnet-5', account }, binding);
  const plan = buildClaudePlan({ binaryPath: '/native/claude', cwd: profile.working_directory,
    workspaceMode: profile.workspace_mode, taskProfile: profile, model: profile.model,
    prompt: 'fixture', runtimeDirectory: binding.outputs.runtime });
  const index = plan.args.indexOf('--effort');
  assert.ok(index >= 0);
  assert.equal(plan.args[index + 1], 'high');
  assert.throws(() => validateTaskProfile({ ...profile, model: 'claude-haiku-4-5-20251001' }, binding), /reasoning effort/);
  assert.throws(() => validateTaskProfile({ ...profile, reasoning_effort: 'ultra' }, binding), /reasoning effort/);
});
