import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { reconcileNativeSkill, getManagedNativeSkillHosts, summarizeNativeSkillHost, removeNativeSkillProjection } from '../../native-skills/lifecycle.js';

function fixture(t) {
  const homeDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rudi-native-policy-'));
  t.after(() => fs.rmSync(homeDir, { recursive: true, force: true }));
  const entryPath = path.join(homeDir, '.rudi', 'skills', 'image-generator', 'SKILL.md');
  fs.mkdirSync(path.dirname(entryPath), { recursive: true });
  fs.writeFileSync(entryPath, '---\nname: image-generator\ndescription: Generate an image\n---\n\nUse the image workflow.\n');
  const options = { homeDir, env: {}, host: 'codex', skill: {
    id: 'skill:image-generator', entryPath, version: '1.0.0', source: 'rudi',
  } };
  const policyPath = path.join(homeDir, '.rudi', 'native-skills.json');
  const writePolicy = (skills) => fs.writeFileSync(policyPath, JSON.stringify({ schemaVersion: 1, skills }));
  return { options, policyPath, writePolicy };
}

test('private native naming renders an alias while retaining the package and receipt identity', async t => {
  const { options, writePolicy } = fixture(t);
  writePolicy({ 'skill:image-generator': { name: 'image-generate' } });
  const result = await reconcileNativeSkill(options);
  assert.equal(result.action, 'created');
  assert.equal(path.basename(result.targetDir), 'image-generate');
  assert.equal(path.basename(result.receiptPath), 'image-generator.json');
  assert.equal(result.id, 'skill:image-generator');
  assert.match(fs.readFileSync(path.join(result.targetDir, 'SKILL.md'), 'utf8'), /name: "image-generate"/);
  assert.match(fs.readFileSync(path.join(result.targetDir, 'agents/openai.yaml'), 'utf8'), /\$image-generate\b/);
  assert.equal(fs.existsSync(path.join(path.dirname(result.targetDir), 'image-generator')), false);
  assert.equal((await reconcileNativeSkill(options)).action, 'current');
});

test('host restrictions skip excluded projections even with force and a missing source', async t => {
  const { options, writePolicy } = fixture(t);
  writePolicy({ 'skill:image-generator': { name: 'image-generate', hosts: ['codex'] } });
  fs.unlinkSync(options.skill.entryPath);
  const result = await reconcileNativeSkill({ ...options, host: 'claude', force: true });
  assert.equal(result.action, 'excluded');
  assert.equal(fs.existsSync(path.join(options.homeDir, '.claude')), false);
});

test('a schema 2 receipt adopts an exact renamed tree without recreating the retired name', async t => {
  const { options, writePolicy } = fixture(t);
  const old = await reconcileNativeSkill(options);
  const legacy = JSON.parse(fs.readFileSync(old.receiptPath, 'utf8'));
  legacy.schemaVersion = 2;
  fs.writeFileSync(old.receiptPath, JSON.stringify(legacy));
  fs.rmSync(old.targetDir, { recursive: true });
  writePolicy({ 'skill:image-generator': { name: 'image-generate' } });
  const staged = await reconcileNativeSkill({ ...options, receiptRoot: path.join(options.homeDir, 'staged-receipts') });
  const before = fs.readFileSync(path.join(staged.targetDir, 'SKILL.md'));
  assert.equal((await reconcileNativeSkill({ ...options, dryRun: true })).action, 'would_adopt');
  assert.equal(JSON.parse(fs.readFileSync(old.receiptPath)).schemaVersion, 2);
  const adopted = await reconcileNativeSkill(options);
  assert.equal(adopted.action, 'adopted');
  assert.deepEqual(fs.readFileSync(path.join(staged.targetDir, 'SKILL.md')), before);
  const receipt = JSON.parse(fs.readFileSync(adopted.receiptPath));
  assert.equal(receipt.schemaVersion, 3);
  assert.equal(receipt.skillName, 'image-generate');
  assert.equal(receipt.createdAt, legacy.createdAt);
  assert.equal(fs.existsSync(old.targetDir), false);
  assert.equal((await reconcileNativeSkill(options)).action, 'current');
});


test('discovery, status and removal follow the receipt native name with a stable package ID', async t => {
  const { options, writePolicy } = fixture(t);
  writePolicy({ 'skill:image-generator': { name: 'image-generate', hosts: ['codex'] } });
  const created = await reconcileNativeSkill(options);
  assert.deepEqual(await getManagedNativeSkillHosts(options.skill, options), ['codex']);
  const summary = await summarizeNativeSkillHost('codex', options);
  assert.equal(summary.current, 1);
  assert.equal(summary.failed, 0);
  assert.equal((await removeNativeSkillProjection({ ...options, dryRun: true })).action, 'would_remove');
  assert.equal(fs.existsSync(created.targetDir), true);
  assert.equal((await removeNativeSkillProjection(options)).action, 'removed');
  assert.equal(fs.existsSync(created.targetDir), false);
  assert.equal(fs.existsSync(created.receiptPath), false);
});

test('alias rendering rewrites only exact self-invocations in bundled metadata', async t => {
  const { options, writePolicy } = fixture(t);
  const agents = path.join(path.dirname(options.skill.entryPath), 'agents');
  fs.mkdirSync(agents);
  fs.writeFileSync(path.join(agents, 'openai.yaml'), 'interface:\n  default_prompt: "Use $image-generator, then $image-generator-extra."\npolicy:\n  allow_implicit_invocation: false\n');
  writePolicy({ 'skill:image-generator': { name: 'image-generate' } });
  const result = await reconcileNativeSkill(options);
  assert.equal(result.action, 'created');
  assert.equal(fs.readFileSync(path.join(result.targetDir, 'agents/openai.yaml'), 'utf8'), 'interface:\n  default_prompt: "Use $image-generate, then $image-generator-extra."\npolicy:\n  allow_implicit_invocation: false\n');
});

test('a mapped name cannot take ownership from another package even with force', async t => {
  const { options, writePolicy } = fixture(t);
  const owner = await reconcileNativeSkill({ ...options, skill: { ...options.skill, id: 'skill:image-generate' } });
  const original = fs.readFileSync(owner.receiptPath);
  writePolicy({ 'skill:image-generator': { name: 'image-generate' } });
  const result = await reconcileNativeSkill({ ...options, force: true });
  assert.equal(result.action, 'failed');
  assert.match(result.error, /already owned/);
  assert.deepEqual(fs.readFileSync(owner.receiptPath), original);
  assert.equal(fs.existsSync(path.join(path.dirname(owner.receiptPath), 'image-generator.json')), false);
});

test('invalid policies fail closed without creating native files', async t => {
  const cases = [
    '{', JSON.stringify({ schemaVersion: 2, skills: {} }),
    JSON.stringify({ schemaVersion: 1, skills: { 'skill:image-generator': { name: '../escape' } } }),
    JSON.stringify({ schemaVersion: 1, skills: { 'skill:image-generator': { hosts: ['unknown'] } } }),
    JSON.stringify({ schemaVersion: 1, skills: { 'skill:image-generator': { hosts: ['codex', 'codex'] } } }),
    JSON.stringify({ schemaVersion: 1, skills: { 'skill:image-generator': { names: 'typo' } } }),
    JSON.stringify({ schemaVersion: 1, skills: { 'skill:a': { name: 'same' }, 'skill:b': { name: 'same' } } }),
  ];
  for (const content of cases) {
    const { options, policyPath } = fixture(t);
    fs.writeFileSync(policyPath, content);
    assert.equal((await reconcileNativeSkill(options)).action, 'failed');
    assert.equal(fs.existsSync(path.join(options.homeDir, '.codex')), false);
  }
});

test('policy file symlinks are rejected without writing through them', async t => {
  const { options, policyPath } = fixture(t);
  const outside = path.join(options.homeDir, 'outside.json');
  fs.writeFileSync(outside, '{"schemaVersion":1,"skills":{}}');
  fs.symlinkSync(outside, policyPath);
  const result = await reconcileNativeSkill(options);
  assert.equal(result.action, 'failed');
  assert.match(result.error, /symbolic links/);
});

test('divergent renamed trees and their legacy receipt remain untouched on repeated sync', async t => {
  const { options, writePolicy } = fixture(t);
  const old = await reconcileNativeSkill(options);
  const originalReceipt = fs.readFileSync(old.receiptPath);
  fs.rmSync(old.targetDir, { recursive: true });
  writePolicy({ 'skill:image-generator': { name: 'image-generate' } });
  const custom = path.join(path.dirname(old.targetDir), 'image-generate');
  fs.mkdirSync(custom);
  fs.writeFileSync(path.join(custom, 'SKILL.md'), 'private workflow');
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const result = await reconcileNativeSkill(options);
    assert.equal(result.action, 'unmanaged');
    assert.equal(fs.readFileSync(path.join(custom, 'SKILL.md'), 'utf8'), 'private workflow');
    assert.deepEqual(fs.readFileSync(old.receiptPath), originalReceipt);
    assert.equal(fs.existsSync(old.targetDir), false);
  }
});

test('a surviving old target blocks migration without modifying either tree or receipt', async t => {
  const { options, writePolicy } = fixture(t);
  const old = await reconcileNativeSkill(options);
  const originalReceipt = fs.readFileSync(old.receiptPath);
  writePolicy({ 'skill:image-generator': { name: 'image-generate' } });
  const result = await reconcileNativeSkill({ ...options, force: true });
  assert.equal(result.action, 'failed');
  assert.match(result.error, /Prior native skill target still exists/);
  assert.deepEqual(fs.readFileSync(old.receiptPath), originalReceipt);
  assert.equal(fs.existsSync(old.targetDir), true);
  assert.equal(fs.existsSync(path.join(path.dirname(old.targetDir), 'image-generate')), false);
});

test('native naming rejects IDs without the skill namespace', async t => {
  const { options, writePolicy } = fixture(t);
  writePolicy({});
  const result = await reconcileNativeSkill({ ...options, skill: { ...options.skill, id: 'image-generator' } });
  assert.equal(result.action, 'failed');
  assert.match(result.error, /Invalid native skill package id/);
  assert.equal(fs.existsSync(path.join(options.homeDir, '.codex')), false);
});

test('ambiguous receipt ownership blocks removal and is not reported as synchronized', async t => {
  const { options, writePolicy } = fixture(t);
  writePolicy({ 'skill:image-generator': { name: 'image-generate' } });
  const created = await reconcileNativeSkill(options);
  const original = fs.readFileSync(created.receiptPath);
  const duplicate = { ...JSON.parse(original), skillId: 'skill:another-package' };
  const duplicatePath = path.join(path.dirname(created.receiptPath), 'another-package.json');
  fs.writeFileSync(duplicatePath, JSON.stringify(duplicate));
  assert.equal((await removeNativeSkillProjection({ ...options, dryRun: true })).action, 'failed');
  const result = await removeNativeSkillProjection(options);
  assert.equal(result.action, 'failed');
  assert.match(result.error, /already owned/);
  assert.equal(fs.existsSync(created.targetDir), true);
  assert.deepEqual(fs.readFileSync(created.receiptPath), original);
  assert.equal(fs.existsSync(duplicatePath), true);
  const summary = await summarizeNativeSkillHost('codex', options);
  assert.equal(summary.current, 0);
  assert.equal(summary.failed, 2);
  assert.equal(summary.skillsSynchronized, false);
});

test('excluding a previously managed host preserves it during sync but explicit removal cleans it', async t => {
  const { options, writePolicy } = fixture(t);
  const created = await reconcileNativeSkill(options);
  writePolicy({ 'skill:image-generator': { hosts: [] } });
  assert.equal((await reconcileNativeSkill(options)).action, 'excluded');
  assert.equal(fs.existsSync(created.targetDir), true);
  assert.deepEqual(await getManagedNativeSkillHosts(options.skill, options), []);
  assert.equal((await removeNativeSkillProjection(options)).action, 'removed');
  assert.equal(fs.existsSync(created.targetDir), false);
});
