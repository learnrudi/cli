import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import {
  inspectNativeSkillProjection,
  reconcileNativeSkill,
  removeNativeSkillProjection,
  summarizeNativeSkillHost,
} from '../../native-skills/lifecycle.js';

function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'rudi-native-skill-lifecycle-'));
  const sourceDir = path.join(root, 'canonical', 'demo');
  const sourcePath = path.join(sourceDir, 'SKILL.md');
  fs.mkdirSync(path.join(sourceDir, 'references'), { recursive: true });
  fs.writeFileSync(sourcePath, [
    '---',
    'name: Demo Skill',
    'description: Exercise managed native projection',
    'version: 2.4.0',
    '---',
    '',
    'Run the canonical workflow.',
    '',
  ].join('\n'));
  fs.writeFileSync(path.join(sourceDir, 'references', 'contract.md'), 'canonical resource\n');
  return {
    root,
    nativeRoot: path.join(root, 'codex', 'skills'),
    receiptRoot: path.join(root, 'rudi', 'state', 'native-skills'),
    skill: {
      id: 'skill:demo-skill',
      kind: 'skill',
      name: 'Demo Skill',
      version: '2.4.0',
      description: 'Exercise managed native projection',
      source: 'rudi',
      path: sourceDir,
      entryPath: sourcePath,
    },
  };
}

test('reconcileNativeSkill creates a complete Codex tree and ownership receipt', async () => {
  const state = fixture();
  try {
    const result = await reconcileNativeSkill({
      host: 'codex',
      skill: state.skill,
      targetRoot: state.nativeRoot,
      receiptRoot: state.receiptRoot,
    });

    assert.equal(result.action, 'created');
    assert.equal(result.previousState, 'missing');
    assert.equal(result.restartRequired, true);
    assert.equal(fs.existsSync(path.join(result.targetDir, 'SKILL.md')), true);
    assert.equal(fs.existsSync(path.join(result.targetDir, 'agents', 'openai.yaml')), true);
    assert.equal(fs.readFileSync(path.join(result.targetDir, 'references', 'contract.md'), 'utf8'), 'canonical resource\n');

    const receipt = JSON.parse(fs.readFileSync(result.receiptPath, 'utf8'));
    assert.equal(receipt.host, 'codex');
    assert.equal(receipt.skillId, 'skill:demo-skill');
    assert.equal(receipt.packageVersion, '2.4.0');
    assert.equal(receipt.sourceIdentity, 'rudi');
    assert.match(receipt.sourceDigest, /^[a-f0-9]{64}$/);
    assert.match(receipt.packageDigest, /^[a-f0-9]{64}$/);
    assert.match(receipt.renderedTreeDigest, /^[a-f0-9]{64}$/);
    assert.equal(fs.statSync(result.receiptPath).mode & 0o777, 0o600);
  } finally {
    fs.rmSync(state.root, { recursive: true, force: true });
  }
});

test('forced reconciliation preserves bundled Codex metadata verbatim', async () => {
  const state = fixture();
  try {
    const canonicalMetadata = [
      'interface:',
      '  display_name: Demo Skill',
      '  short_description: Canonical metadata fixture',
      '  default_prompt: Run the canonical metadata fixture.',
      '',
      'policy:',
      '  allow_implicit_invocation: false',
      '',
    ].join('\n');
    const agentsDir = path.join(path.dirname(state.skill.entryPath), 'agents');
    fs.mkdirSync(agentsDir, { recursive: true });
    fs.writeFileSync(path.join(agentsDir, 'openai.yaml'), canonicalMetadata);

    const created = await reconcileNativeSkill({
      host: 'codex',
      skill: state.skill,
      targetRoot: state.nativeRoot,
      receiptRoot: state.receiptRoot,
    });
    fs.writeFileSync(path.join(created.targetDir, 'agents', 'openai.yaml'), 'stale metadata\n');

    const forced = await reconcileNativeSkill({
      host: 'codex',
      skill: state.skill,
      targetRoot: state.nativeRoot,
      receiptRoot: state.receiptRoot,
      force: true,
    });

    assert.equal(forced.action, 'updated');
    assert.equal(forced.forced, true);
    assert.equal(
      fs.readFileSync(path.join(forced.targetDir, 'agents', 'openai.yaml'), 'utf8'),
      canonicalMetadata,
    );
  } finally {
    fs.rmSync(state.root, { recursive: true, force: true });
  }
});

test('managed updates replace the complete tree, prune stale resources, and become idempotent', async () => {
  const state = fixture();
  try {
    const oldResource = path.join(path.dirname(state.skill.entryPath), 'references', 'contract.md');
    const created = await reconcileNativeSkill({
      host: 'claude',
      skill: state.skill,
      targetRoot: state.nativeRoot,
      receiptRoot: state.receiptRoot,
    });
    assert.equal(created.action, 'created');

    fs.rmSync(oldResource);
    fs.writeFileSync(
      state.skill.entryPath,
      fs.readFileSync(state.skill.entryPath, 'utf8').replace('canonical workflow', 'updated workflow'),
    );
    const updated = await reconcileNativeSkill({
      host: 'claude',
      skill: state.skill,
      targetRoot: state.nativeRoot,
      receiptRoot: state.receiptRoot,
    });
    assert.equal(updated.action, 'updated');
    assert.equal(fs.existsSync(path.join(updated.targetDir, 'references', 'contract.md')), false);
    assert.match(fs.readFileSync(path.join(updated.targetDir, 'SKILL.md'), 'utf8'), /updated workflow/);

    const current = await reconcileNativeSkill({
      host: 'claude',
      skill: state.skill,
      targetRoot: state.nativeRoot,
      receiptRoot: state.receiptRoot,
    });
    assert.equal(current.action, 'current');
    assert.equal(current.restartRequired, false);
  } finally {
    fs.rmSync(state.root, { recursive: true, force: true });
  }
});

test('managed source identity updates return the identity committed to the receipt', async () => {
  const state = fixture();
  try {
    const firstIdentity = 'a'.repeat(40);
    const secondIdentity = 'b'.repeat(40);
    state.skill.source = { type: 'github', resolvedCommit: firstIdentity };
    await reconcileNativeSkill({
      host: 'codex',
      skill: state.skill,
      targetRoot: state.nativeRoot,
      receiptRoot: state.receiptRoot,
    });

    state.skill.source = { type: 'github', resolvedCommit: secondIdentity };
    fs.appendFileSync(state.skill.entryPath, '\nUpdated canonical behavior.\n');
    const updated = await reconcileNativeSkill({
      host: 'codex',
      skill: state.skill,
      targetRoot: state.nativeRoot,
      receiptRoot: state.receiptRoot,
    });
    const receipt = JSON.parse(fs.readFileSync(updated.receiptPath, 'utf8'));
    assert.equal(updated.action, 'updated');
    assert.equal(updated.sourceIdentity, secondIdentity);
    assert.equal(receipt.sourceIdentity, secondIdentity);
  } finally {
    fs.rmSync(state.root, { recursive: true, force: true });
  }
});

test('complete canonical package changes refresh the package digest without rewriting an unchanged projection', async () => {
  const state = fixture();
  try {
    const agentsDir = path.join(path.dirname(state.skill.entryPath), 'agents');
    const agentMetadata = path.join(agentsDir, 'openai.yaml');
    fs.mkdirSync(agentsDir, { recursive: true });
    fs.writeFileSync(agentMetadata, 'interface:\n  display_name: Demo\n');

    const created = await reconcileNativeSkill({
      host: 'claude',
      skill: state.skill,
      targetRoot: state.nativeRoot,
      receiptRoot: state.receiptRoot,
    });
    const originalReceipt = JSON.parse(fs.readFileSync(created.receiptPath, 'utf8'));
    fs.appendFileSync(agentMetadata, '  short_description: Updated metadata\n');

    const inspected = await inspectNativeSkillProjection({
      host: 'claude',
      skill: state.skill,
      targetRoot: state.nativeRoot,
      receiptRoot: state.receiptRoot,
    });
    assert.equal(inspected.state, 'update_available');
    assert.notEqual(inspected.packageDigest, originalReceipt.packageDigest);

    const refreshed = await reconcileNativeSkill({
      host: 'claude',
      skill: state.skill,
      targetRoot: state.nativeRoot,
      receiptRoot: state.receiptRoot,
    });
    assert.equal(refreshed.action, 'updated');
    assert.equal(refreshed.restartRequired, false);
    const refreshedReceipt = JSON.parse(fs.readFileSync(created.receiptPath, 'utf8'));
    assert.equal(refreshedReceipt.packageDigest, inspected.packageDigest);
  } finally {
    fs.rmSync(state.root, { recursive: true, force: true });
  }
});

test('a symlink anywhere in the canonical package fails closed even when it is not projected', async () => {
  const state = fixture();
  try {
    const agentsDir = path.join(path.dirname(state.skill.entryPath), 'agents');
    fs.mkdirSync(agentsDir, { recursive: true });
    fs.symlinkSync(state.skill.entryPath, path.join(agentsDir, 'unsafe-link'));

    const result = await reconcileNativeSkill({
      host: 'claude',
      skill: state.skill,
      targetRoot: state.nativeRoot,
      receiptRoot: state.receiptRoot,
    });
    assert.equal(result.action, 'failed');
    assert.match(result.error, /symbolic link/i);
    assert.equal(fs.existsSync(state.nativeRoot), false);
    assert.equal(fs.existsSync(state.receiptRoot), false);
  } finally {
    fs.rmSync(state.root, { recursive: true, force: true });
  }
});

test('drifted and unmanaged wrappers are preserved unless exact force is supplied', async () => {
  const state = fixture();
  try {
    const managed = await reconcileNativeSkill({
      host: 'codex',
      skill: state.skill,
      targetRoot: state.nativeRoot,
      receiptRoot: state.receiptRoot,
    });
    fs.appendFileSync(path.join(managed.targetDir, 'SKILL.md'), '\nuser edit\n');
    const drifted = await reconcileNativeSkill({
      host: 'codex',
      skill: state.skill,
      targetRoot: state.nativeRoot,
      receiptRoot: state.receiptRoot,
    });
    assert.equal(drifted.action, 'drifted');
    assert.match(fs.readFileSync(path.join(managed.targetDir, 'SKILL.md'), 'utf8'), /user edit/);

    const forced = await reconcileNativeSkill({
      host: 'codex',
      skill: state.skill,
      targetRoot: state.nativeRoot,
      receiptRoot: state.receiptRoot,
      force: true,
    });
    assert.equal(forced.action, 'updated');
    assert.equal(forced.forced, true);
    assert.doesNotMatch(fs.readFileSync(path.join(managed.targetDir, 'SKILL.md'), 'utf8'), /user edit/);

    const unmanagedRoot = path.join(state.root, 'unmanaged', 'skills');
    const unmanagedTarget = path.join(unmanagedRoot, 'demo-skill');
    fs.mkdirSync(unmanagedTarget, { recursive: true });
    fs.writeFileSync(path.join(unmanagedTarget, 'SKILL.md'), 'unmanaged body\n');
    const unmanaged = await reconcileNativeSkill({
      host: 'claude',
      skill: state.skill,
      targetRoot: unmanagedRoot,
      receiptRoot: state.receiptRoot,
    });
    assert.equal(unmanaged.action, 'unmanaged');
    assert.equal(fs.readFileSync(path.join(unmanagedTarget, 'SKILL.md'), 'utf8'), 'unmanaged body\n');
  } finally {
    fs.rmSync(state.root, { recursive: true, force: true });
  }
});

test('an identical legacy wrapper is adopted without replacing its tree', async () => {
  const state = fixture();
  try {
    const firstReceiptRoot = path.join(state.root, 'first-receipts');
    const created = await reconcileNativeSkill({
      host: 'gemini',
      skill: state.skill,
      targetRoot: state.nativeRoot,
      receiptRoot: firstReceiptRoot,
    });
    const originalStat = fs.statSync(path.join(created.targetDir, 'SKILL.md'));
    fs.rmSync(firstReceiptRoot, { recursive: true, force: true });

    const adopted = await reconcileNativeSkill({
      host: 'gemini',
      skill: state.skill,
      targetRoot: state.nativeRoot,
      receiptRoot: state.receiptRoot,
    });
    assert.equal(adopted.action, 'adopted');
    assert.equal(adopted.restartRequired, false);
    assert.equal(fs.statSync(path.join(adopted.targetDir, 'SKILL.md')).ino, originalStat.ino);
    assert.equal(fs.existsSync(adopted.receiptPath), true);
  } finally {
    fs.rmSync(state.root, { recursive: true, force: true });
  }
});

test('a receipt commit failure restores the prior wrapper and prior receipt', async () => {
  const state = fixture();
  try {
    const created = await reconcileNativeSkill({
      host: 'antigravity',
      skill: state.skill,
      targetRoot: state.nativeRoot,
      receiptRoot: state.receiptRoot,
    });
    const priorWrapper = fs.readFileSync(path.join(created.targetDir, 'SKILL.md'), 'utf8');
    const priorReceipt = fs.readFileSync(created.receiptPath, 'utf8');
    fs.writeFileSync(
      state.skill.entryPath,
      fs.readFileSync(state.skill.entryPath, 'utf8').replace('canonical workflow', 'replacement workflow'),
    );

    const failed = await reconcileNativeSkill({
      host: 'antigravity',
      skill: state.skill,
      targetRoot: state.nativeRoot,
      receiptRoot: state.receiptRoot,
      operations: {
        async writeReceipt() {
          throw new Error('fixture receipt commit failure');
        },
      },
    });
    assert.equal(failed.action, 'failed');
    assert.match(failed.error, /fixture receipt commit failure/);
    assert.equal(fs.readFileSync(path.join(created.targetDir, 'SKILL.md'), 'utf8'), priorWrapper);
    assert.equal(fs.readFileSync(created.receiptPath, 'utf8'), priorReceipt);
  } finally {
    fs.rmSync(state.root, { recursive: true, force: true });
  }
});

test('remove deletes only unchanged managed projections and host status uses receipts', async () => {
  const state = fixture();
  try {
    const created = await reconcileNativeSkill({
      host: 'codex',
      skill: state.skill,
      targetRoot: state.nativeRoot,
      receiptRoot: state.receiptRoot,
    });
    const before = await summarizeNativeSkillHost('codex', {
      targetRoot: state.nativeRoot,
      receiptRoot: state.receiptRoot,
    });
    assert.equal(before.skillsSynchronized, true);
    assert.equal(before.current, 1);

    fs.appendFileSync(path.join(created.targetDir, 'SKILL.md'), '\nlocal edit\n');
    const driftedSummary = await summarizeNativeSkillHost('codex', {
      targetRoot: state.nativeRoot,
      receiptRoot: state.receiptRoot,
    });
    assert.equal(driftedSummary.skillsSynchronized, false);
    assert.equal(driftedSummary.drifted, 1);

    const preserved = await removeNativeSkillProjection({
      host: 'codex',
      skill: state.skill,
      targetRoot: state.nativeRoot,
      receiptRoot: state.receiptRoot,
    });
    assert.equal(preserved.action, 'drifted');
    assert.equal(fs.existsSync(created.targetDir), true);
    assert.equal(fs.existsSync(created.receiptPath), true);

    await reconcileNativeSkill({
      host: 'codex',
      skill: state.skill,
      targetRoot: state.nativeRoot,
      receiptRoot: state.receiptRoot,
      force: true,
    });
    const removed = await removeNativeSkillProjection({
      host: 'codex',
      skill: state.skill,
      targetRoot: state.nativeRoot,
      receiptRoot: state.receiptRoot,
    });
    assert.equal(removed.action, 'removed');
    assert.equal(removed.restartRequired, true);
    assert.equal(fs.existsSync(created.targetDir), false);
    assert.equal(fs.existsSync(created.receiptPath), false);

    const after = await summarizeNativeSkillHost('codex', {
      targetRoot: state.nativeRoot,
      receiptRoot: state.receiptRoot,
    });
    assert.equal(after.skillsSynchronized, false);
  } finally {
    fs.rmSync(state.root, { recursive: true, force: true });
  }
});

test('dry-run and unsafe source rejection perform no target or receipt writes', async () => {
  const state = fixture();
  try {
    const dry = await reconcileNativeSkill({
      host: 'claude',
      skill: state.skill,
      targetRoot: state.nativeRoot,
      receiptRoot: state.receiptRoot,
      dryRun: true,
    });
    assert.equal(dry.action, 'would_create');
    assert.equal(fs.existsSync(state.nativeRoot), false);
    assert.equal(fs.existsSync(state.receiptRoot), false);

    const symlinkPath = path.join(path.dirname(state.skill.entryPath), 'references', 'unsafe-link');
    fs.symlinkSync(state.skill.entryPath, symlinkPath);
    const rejected = await reconcileNativeSkill({
      host: 'claude',
      skill: state.skill,
      targetRoot: state.nativeRoot,
      receiptRoot: state.receiptRoot,
    });
    assert.equal(rejected.action, 'failed');
    assert.match(rejected.error, /symbolic links/);
    assert.equal(fs.existsSync(state.nativeRoot), false);
    assert.equal(fs.existsSync(state.receiptRoot), false);
  } finally {
    fs.rmSync(state.root, { recursive: true, force: true });
  }
});

test('inspection distinguishes current, drifted, unmanaged, and missing states', async () => {
  const state = fixture();
  try {
    const missing = await inspectNativeSkillProjection({
      host: 'claude',
      skill: state.skill,
      targetRoot: state.nativeRoot,
      receiptRoot: state.receiptRoot,
    });
    assert.equal(missing.state, 'missing');
    const created = await reconcileNativeSkill({
      host: 'claude',
      skill: state.skill,
      targetRoot: state.nativeRoot,
      receiptRoot: state.receiptRoot,
    });
    assert.equal((await inspectNativeSkillProjection({
      host: 'claude', skill: state.skill, targetRoot: state.nativeRoot, receiptRoot: state.receiptRoot,
    })).state, 'current');
    fs.appendFileSync(path.join(created.targetDir, 'SKILL.md'), '\ndrift\n');
    assert.equal((await inspectNativeSkillProjection({
      host: 'claude', skill: state.skill, targetRoot: state.nativeRoot, receiptRoot: state.receiptRoot,
    })).state, 'drifted');
    fs.rmSync(created.receiptPath);
    assert.equal((await inspectNativeSkillProjection({
      host: 'claude', skill: state.skill, targetRoot: state.nativeRoot, receiptRoot: state.receiptRoot,
    })).state, 'unmanaged');
  } finally {
    fs.rmSync(state.root, { recursive: true, force: true });
  }
});

test('source, target, and receipt root symlinks fail closed', async () => {
  const state = fixture();
  try {
    const linkedSourceRoot = path.join(state.root, 'linked-source');
    fs.symlinkSync(path.dirname(state.skill.entryPath), linkedSourceRoot);
    const sourceEscape = await reconcileNativeSkill({
      host: 'codex',
      skill: {
        ...state.skill,
        path: linkedSourceRoot,
        entryPath: path.join(linkedSourceRoot, 'SKILL.md'),
      },
      targetRoot: path.join(state.root, 'source-target'),
      receiptRoot: path.join(state.root, 'source-receipts'),
    });
    assert.equal(sourceEscape.action, 'failed');
    assert.match(sourceEscape.error, /symbolic link/i);

    const realTargetRoot = path.join(state.root, 'real-target', 'skills');
    const firstReceiptRoot = path.join(state.root, 'first-receipts');
    const created = await reconcileNativeSkill({
      host: 'claude',
      skill: state.skill,
      targetRoot: realTargetRoot,
      receiptRoot: firstReceiptRoot,
    });
    fs.rmSync(firstReceiptRoot, { recursive: true, force: true });

    const linkedTargetRoot = path.join(state.root, 'linked-target');
    fs.symlinkSync(realTargetRoot, linkedTargetRoot);
    const adoption = await reconcileNativeSkill({
      host: 'claude',
      skill: state.skill,
      targetRoot: linkedTargetRoot,
      receiptRoot: state.receiptRoot,
    });
    assert.equal(adoption.action, 'failed');
    assert.match(adoption.error, /symbolic link/i);
    assert.equal(fs.existsSync(state.receiptRoot), false);

    const realReceiptRoot = path.join(state.root, 'real-receipts');
    fs.mkdirSync(realReceiptRoot, { recursive: true });
    const linkedReceiptRoot = path.join(state.root, 'linked-receipts');
    fs.symlinkSync(realReceiptRoot, linkedReceiptRoot);
    const receiptEscape = await reconcileNativeSkill({
      host: 'codex',
      skill: state.skill,
      targetRoot: path.join(state.root, 'second-target'),
      receiptRoot: linkedReceiptRoot,
    });
    assert.equal(receiptEscape.action, 'failed');
    assert.match(receiptEscape.error, /symbolic link/i);

    const removal = await removeNativeSkillProjection({
      host: 'claude',
      skill: state.skill,
      targetRoot: linkedTargetRoot,
      receiptRoot: firstReceiptRoot,
    });
    assert.equal(removal.action, 'failed');
    assert.match(removal.error, /symbolic link/i);
    assert.equal(fs.existsSync(created.targetDir), true);
  } finally {
    fs.rmSync(state.root, { recursive: true, force: true });
  }
});

test('inspection rejects a symlinked per-host receipt directory without following it', async () => {
  const state = fixture();
  try {
    const created = await reconcileNativeSkill({
      host: 'codex',
      skill: state.skill,
      targetRoot: state.nativeRoot,
      receiptRoot: state.receiptRoot,
    });
    const outsideHostRoot = path.join(state.root, 'outside-receipts', 'codex');
    fs.mkdirSync(outsideHostRoot, { recursive: true });
    const outsideReceipt = path.join(outsideHostRoot, 'demo-skill.json');
    fs.copyFileSync(created.receiptPath, outsideReceipt);
    fs.rmSync(path.dirname(created.receiptPath), { recursive: true });
    fs.symlinkSync(outsideHostRoot, path.dirname(created.receiptPath));

    await assert.rejects(
      () => inspectNativeSkillProjection({
        host: 'codex',
        skill: state.skill,
        targetRoot: state.nativeRoot,
        receiptRoot: state.receiptRoot,
      }),
      /symbolic link/i,
    );
    assert.equal(fs.existsSync(created.targetDir), true);
    assert.equal(fs.existsSync(outsideReceipt), true);
  } finally {
    fs.rmSync(state.root, { recursive: true, force: true });
  }
});

test('removal rejects a symlinked per-host receipt directory without deleting either side', async () => {
  const state = fixture();
  try {
    const created = await reconcileNativeSkill({
      host: 'codex',
      skill: state.skill,
      targetRoot: state.nativeRoot,
      receiptRoot: state.receiptRoot,
    });
    const outsideHostRoot = path.join(state.root, 'outside-removal-receipts', 'codex');
    fs.mkdirSync(outsideHostRoot, { recursive: true });
    const outsideReceipt = path.join(outsideHostRoot, 'demo-skill.json');
    fs.copyFileSync(created.receiptPath, outsideReceipt);
    fs.rmSync(path.dirname(created.receiptPath), { recursive: true });
    fs.symlinkSync(outsideHostRoot, path.dirname(created.receiptPath));

    const result = await removeNativeSkillProjection({
      host: 'codex',
      skill: state.skill,
      targetRoot: state.nativeRoot,
      receiptRoot: state.receiptRoot,
    });
    assert.equal(result.action, 'failed');
    assert.match(result.error, /symbolic link/i);
    assert.equal(fs.existsSync(created.targetDir), true);
    assert.equal(fs.existsSync(outsideReceipt), true);
  } finally {
    fs.rmSync(state.root, { recursive: true, force: true });
  }
});

test('orphan receipt cleanup preserves a concurrently recreated target and receipt pair', async () => {
  const state = fixture();
  try {
    const created = await reconcileNativeSkill({
      host: 'codex',
      skill: state.skill,
      targetRoot: state.nativeRoot,
      receiptRoot: state.receiptRoot,
    });
    const originalReceipt = JSON.parse(fs.readFileSync(created.receiptPath, 'utf8'));
    fs.rmSync(created.targetDir, { recursive: true });

    const result = await removeNativeSkillProjection({
      host: 'codex',
      skill: state.skill,
      targetRoot: state.nativeRoot,
      receiptRoot: state.receiptRoot,
      operations: {
        async afterOrphanReceiptIsolation() {
          fs.appendFileSync(state.skill.entryPath, '\nConcurrent canonical update.\n');
          const concurrent = await reconcileNativeSkill({
            host: 'codex',
            skill: state.skill,
            targetRoot: state.nativeRoot,
            receiptRoot: state.receiptRoot,
          });
          assert.equal(concurrent.action, 'created');
        },
      },
    });

    assert.equal(result.action, 'failed');
    assert.match(result.error, /changed during orphan receipt removal/i);
    assert.match(fs.readFileSync(path.join(created.targetDir, 'SKILL.md'), 'utf8'), /Concurrent canonical update/);
    const concurrentReceipt = JSON.parse(fs.readFileSync(created.receiptPath, 'utf8'));
    assert.notEqual(concurrentReceipt.sourceDigest, originalReceipt.sourceDigest);
  } finally {
    fs.rmSync(state.root, { recursive: true, force: true });
  }
});

test('remove restores a managed projection changed after its ownership check', async () => {
  const state = fixture();
  try {
    const created = await reconcileNativeSkill({
      host: 'codex',
      skill: state.skill,
      targetRoot: state.nativeRoot,
      receiptRoot: state.receiptRoot,
    });
    const result = await removeNativeSkillProjection({
      host: 'codex',
      skill: state.skill,
      targetRoot: state.nativeRoot,
      receiptRoot: state.receiptRoot,
      operations: {
        async afterRemoveRename(backupDir) {
          fs.appendFileSync(path.join(backupDir, 'SKILL.md'), '\nconcurrent edit\n');
        },
      },
    });
    assert.equal(result.action, 'failed');
    assert.match(result.error, /changed during removal/i);
    assert.match(fs.readFileSync(path.join(created.targetDir, 'SKILL.md'), 'utf8'), /concurrent edit/);
    assert.equal(fs.existsSync(created.receiptPath), true);
  } finally {
    fs.rmSync(state.root, { recursive: true, force: true });
  }
});

test('malformed or misplaced receipts never establish ownership', async () => {
  const state = fixture();
  try {
    const created = await reconcileNativeSkill({
      host: 'codex',
      skill: state.skill,
      targetRoot: state.nativeRoot,
      receiptRoot: state.receiptRoot,
    });
    const receipt = JSON.parse(fs.readFileSync(created.receiptPath, 'utf8'));
    receipt.skillName = 'different-skill';
    receipt.targetDir = path.join(state.root, 'unrelated-target');
    delete receipt.packageVersion;
    fs.writeFileSync(created.receiptPath, `${JSON.stringify(receipt, null, 2)}\n`);

    const result = await reconcileNativeSkill({
      host: 'codex',
      skill: state.skill,
      targetRoot: state.nativeRoot,
      receiptRoot: state.receiptRoot,
    });
    assert.equal(result.action, 'failed');
    assert.match(result.error, /receipt/i);
    assert.equal(fs.existsSync(created.targetDir), true);
  } finally {
    fs.rmSync(state.root, { recursive: true, force: true });
  }
});
