import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { validateTaskProfile } from '../../agent-host/task-profile.js';
import { taskCodexArgs } from '../../agent-host/task-codex.js';

test('Astra high is accepted and passed unchanged to native Codex', t => {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'catalog-astra-')));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  for (const name of ['project', 'out', 'runtime']) fs.mkdirSync(path.join(root, name));
  const profile = { schema_version: 1, provider: 'codex', model: 'gpt-6-astra',
    reasoning_effort: 'high', workspace_mode: 'registered-shared',
    working_directory: path.join(root, 'project'), read_roots: [path.join(root, 'project')],
    write_roots: [path.join(root, 'out')], network: 'disabled', timeout_ms: 1000 };
  const binding = { working_directory: profile.working_directory,
    outputs: { deliverables: profile.write_roots, runtime: path.join(root, 'runtime') } };
  const validated = validateTaskProfile(profile, binding);
  const args = taskCodexArgs({ taskProfile: validated, cwd: profile.working_directory, model: validated.model });
  assert.equal(args[args.indexOf('-m') + 1], 'gpt-6-astra');
  assert.ok(args.includes('model_reasoning_effort="high"'));
  assert.throws(() => validateTaskProfile({ ...profile, reasoning_effort: 'impossible' }, binding), /reasoning effort/);
  assert.throws(() => validateTaskProfile({ ...profile, model: 'astra' }, binding), /exact configured model/);
});

test('public Codex choices retain exact identity and reject unsupported effort', t => {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'catalog-codex-')));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  for (const name of ['project', 'out', 'runtime']) fs.mkdirSync(path.join(root, name));
  const profile = { schema_version: 1, provider: 'codex', reasoning_effort: 'high',
    workspace_mode: 'registered-shared', working_directory: path.join(root, 'project'),
    read_roots: [path.join(root, 'project')], write_roots: [path.join(root, 'out')],
    network: 'disabled', timeout_ms: 1000 };
  const binding = { working_directory: profile.working_directory,
    outputs: { deliverables: profile.write_roots, runtime: path.join(root, 'runtime') } };
  for (const model of ['gpt-6.1-sol', 'gpt-6-astra', 'gpt-6-sol', 'gpt-6-luna',
    'gpt-5.6-sol', 'gpt-5.6-terra', 'gpt-5.6-luna']) {
    const validated = validateTaskProfile({ ...profile, model }, binding);
    const args = taskCodexArgs({ taskProfile: validated, cwd: profile.working_directory, model });
    assert.equal(args[args.indexOf('-m') + 1], model);
    assert.ok(args.includes('model_reasoning_effort="high"'));
  }
  assert.throws(() => validateTaskProfile({ ...profile, model: 'gpt-6-luna', reasoning_effort: 'ultra' }, binding), /reasoning effort/);
  for (const model of ['gpt-reserve', 'codex-auto-review', 'unknown-model']) {
    assert.throws(() => validateTaskProfile({ ...profile, model }, binding), /exact configured model/);
  }
});

test('current and active legacy Claude models preserve their native effort boundaries', async t => {
  const { taskClaudeArgs } = await import('../../agent-host/task-claude.js');
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'catalog-claude-')));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  for (const name of ['project', 'out', 'runtime', 'claude', 'anthropic']) fs.mkdirSync(path.join(root, name), { mode: 0o700 });
  const profile = { schema_version: 1, provider: 'claude', reasoning_effort: 'high',
    account: { id: 'claude-fixture', email: 'fixture@example.test', organization_id: 'org-fixture',
      config_directory: path.join(root, 'claude'), anthropic_directory: path.join(root, 'anthropic') },
    workspace_mode: 'registered-shared', working_directory: path.join(root, 'project'),
    read_roots: [path.join(root, 'project')], write_roots: [path.join(root, 'out')],
    network: 'disabled', timeout_ms: 1000 };
  const binding = { working_directory: profile.working_directory,
    outputs: { deliverables: profile.write_roots, runtime: path.join(root, 'runtime') } };
  for (const model of ['claude-fable-5-1', 'claude-opus-5-5', 'claude-sonnet-5-5', 'claude-haiku-5-5',
    'claude-fable-5', 'claude-opus-5', 'claude-sonnet-5', 'claude-opus-4-8', 'claude-opus-4-7',
    'claude-opus-4-6', 'claude-sonnet-4-6']) {
    const validated = validateTaskProfile({ ...profile, model }, binding);
    const args = taskClaudeArgs({ taskProfile: validated, model });
    assert.equal(args[args.indexOf('--model') + 1], model);
    assert.equal(args[args.indexOf('--effort') + 1], 'high');
    assert.throws(() => validateTaskProfile({ ...profile, model, reasoning_effort: 'ultra' }, binding), /reasoning effort/);
  }
  for (const model of ['claude-opus-4-6', 'claude-sonnet-4-6']) {
    assert.throws(() => validateTaskProfile({ ...profile, model, reasoning_effort: 'xhigh' }, binding), /reasoning effort/);
    assert.equal(validateTaskProfile({ ...profile, model, reasoning_effort: 'max' }, binding).reasoning_effort, 'max');
  }
  for (const model of ['claude-haiku-4-5-20251001', 'claude-opus-4-5-20251101']) {
    assert.throws(() => validateTaskProfile({ ...profile, model }, binding), /reasoning effort/);
    const { reasoning_effort: unused, ...withoutEffort } = profile;
    assert.equal(validateTaskProfile({ ...withoutEffort, model }, binding).model, model);
  }
});
