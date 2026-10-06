import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import { PATHS } from '@learnrudi/env';
import { getInstallPathForPackage } from '../../installer.js';

test('bundled and flat skills use distinct compatible install destinations', () => {
  assert.equal(
    getInstallPathForPackage({
      id: 'skill:bundle-path-contract',
      kind: 'skill',
      path: 'catalog/skills/bundle-path-contract',
    }),
    path.join(PATHS.skills, 'bundle-path-contract')
  );

  assert.equal(
    getInstallPathForPackage({
      id: 'skill:flat-path-contract',
      kind: 'skill',
      path: 'catalog/skills/flat-path-contract.md',
    }),
    path.join(PATHS.skills, 'flat-path-contract.md')
  );
});

function runSkillUpdate(extra = '', action = 'await updatePackage(initial.id, options)') {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'rudi-skill-upgrade-'));
  const repoRoot = fileURLToPath(new URL('../../../../../', import.meta.url));
  try {
    const script = `
      import fs from 'node:fs';
      import path from 'node:path';
      import { installPackage, updatePackage, listInstalled } from './packages/core/src/installer.js';
      import { readLockfile } from './packages/core/src/lockfile.js';
      const source = path.join(process.env.RUDI_REGISTRY_ROOT, 'catalog/skills');
      fs.mkdirSync(source, { recursive: true });
      fs.writeFileSync(path.join(source, 'upgrade-demo.md'), '---\\nname: Demo\\ndescription: Old skill\\n---\\n');
      const initial = { id: 'skill:upgrade-demo', kind: 'skill', name: 'Demo', version: '1.0.0', path: 'catalog/skills/upgrade-demo.md', dependencies: [] };
      const first = await installPackage(initial.id, { resolvedPackage: initial });
      if (!first.success) throw new Error(first.error);
      const oldPath = first.path;
      const oldContent = fs.readFileSync(oldPath, 'utf8');
      const oldLock = readLockfile(initial.id);
      fs.mkdirSync(path.join(source, 'upgrade-demo', 'agents'), { recursive: true });
      fs.writeFileSync(path.join(source, 'upgrade-demo/SKILL.md'), '---\\nname: Demo\\ndescription: Updated skill\\n---\\n');
      fs.writeFileSync(path.join(source, 'upgrade-demo/agents/openai.yaml'), 'policy:\\n  allow_implicit_invocation: false\\n');
      const next = { ...initial, version: '1.1.0', path: 'catalog/skills/upgrade-demo', installed: true };
      const options = { resolvedPackage: next };
      ${extra}
      const result = ${action};
      console.log(JSON.stringify({ result, oldExists: fs.existsSync(oldPath), oldContent,
        legacyContent: fs.existsSync(oldPath) ? fs.readFileSync(oldPath, 'utf8') : null,
        folderExists: fs.existsSync(path.join(process.env.RUDI_HOME, 'skills/upgrade-demo/SKILL.md')),
        preservedOutput: fs.existsSync(path.join(process.env.RUDI_HOME, 'skills/upgrade-demo/outputs/user-research.md')) ? fs.readFileSync(path.join(process.env.RUDI_HOME, 'skills/upgrade-demo/outputs/user-research.md'), 'utf8') : null,
        lock: readLockfile(initial.id), oldLock,
        installed: (await listInstalled('skill')).filter(s => s.id === initial.id),
        metadata: result.success ? fs.readFileSync(path.join(result.path, 'agents/openai.yaml'), 'utf8') : null,
        savedBackups: fs.readdirSync(path.join(process.env.RUDI_HOME, 'skills'))
          .filter(name => name.startsWith('.upgrade-demo.install-'))
          .flatMap(name => {
            const backup = path.join(process.env.RUDI_HOME, 'skills', name, 'previous');
            return fs.existsSync(backup) && fs.statSync(backup).isFile() ? [fs.readFileSync(backup, 'utf8')] : [];
          }),
      }));
    `;
    const output = execFileSync(process.execPath, ['--input-type=module', '-e', script], {
      cwd: repoRoot,
      env: { ...process.env, RUDI_HOME: path.join(root, 'home'), CLAUDE_HOME: path.join(root, 'claude'),
        RUDI_REGISTRY_ROOT: path.join(root, 'registry'), USE_LOCAL_REGISTRY: 'true' },
      encoding: 'utf8',
    });
    return JSON.parse(output);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

test('updating an owned flat skill leaves one complete bundle and a directory lock', () => {
  const result = runSkillUpdate();
  assert.equal(result.result.success, true);
  assert.equal(result.oldExists, false, 'the obsolete owned file must not shadow the bundle');
  assert.equal(result.folderExists, true);
  assert.equal(result.installed.length, 1);
  assert.equal(result.installed[0].format, 'directory');
  assert.equal(result.lock.installLayout, 'directory');
  assert.match(result.metadata, /allow_implicit_invocation: false/);
});

test('an edited canonical skill is preserved instead of being migrated', () => {
  const result = runSkillUpdate("fs.appendFileSync(oldPath, 'User-authored instructions.');");
  assert.equal(result.result.success, false);
  assert.match(result.result.error, /Modified skill/);
  assert.equal(result.legacyContent, result.oldContent + 'User-authored instructions.');
  assert.equal(result.folderExists, false);
  assert.deepEqual(result.lock, result.oldLock);
});

test('a failed lockfile write restores the previous skill and lock', () => {
  const result = runSkillUpdate(`
    const writeFile = fs.writeFileSync;
    let failed = false;
    fs.writeFileSync = (file, ...args) => {
      if (!failed && path.dirname(String(file)) === path.join(process.env.RUDI_HOME, 'locks/skills')) {
        failed = true;
        throw new Error('injected lock write failure');
      }
      return writeFile(file, ...args);
    };
  `);
  assert.equal(result.result.success, false);
  assert.match(result.result.error, /injected lock write failure/);
  assert.equal(result.legacyContent, result.oldContent);
  assert.equal(result.folderExists, false);
  assert.deepEqual(result.lock, result.oldLock);
});

test('a skill without ownership evidence is preserved', () => {
  const result = runSkillUpdate("fs.rmSync(path.join(process.env.RUDI_HOME, 'locks/skills/upgrade-demo.lock.yaml'));");
  assert.equal(result.result.success, false);
  assert.match(result.result.error, /Cannot prove ownership/);
  assert.equal(result.legacyContent, result.oldContent);
  assert.equal(result.folderExists, false);
  assert.equal(result.lock, null);
});

test('a concurrent edit during replacement is never adopted or deleted by rollback', () => {
  const result = runSkillUpdate(`
    options.onProgress = event => {
      if (event.phase === 'lockfile') {
        fs.appendFileSync(path.join(process.env.RUDI_HOME, 'skills/upgrade-demo/SKILL.md'), 'Concurrent user edit.');
      }
    };
  `);
  assert.equal(result.result.success, false);
  assert.match(result.result.error, /recovery failed.*Preserve/);
  assert.equal(result.folderExists, true);
  assert.deepEqual(result.savedBackups, [result.oldContent]);
  assert.deepEqual(result.lock, result.oldLock);
});


test('update dry run identifies a modified skill and leaves its file and lock intact', () => {
  const result = runSkillUpdate(`
    fs.appendFileSync(oldPath, 'User-authored instructions.');
    const { runUpdate } = await import('./src/commands/update.js');
    const deps = { listInstalled, fetchIndex: async () => ({ packages: { [next.id]: next } }),
      log() {}, error() {} };
  `, "await runUpdate([initial.id], { 'dry-run': true, 'no-sync-skills': true }, deps)");
  assert.equal(result.result.packageFailed, 1);
  assert.match(result.result.failures[0].error, /Modified skill/);
  assert.equal(result.legacyContent, result.oldContent + 'User-authored instructions.');
  assert.deepEqual(result.lock, result.oldLock);
  assert.equal(result.folderExists, false);
});


test('update dry run reports the file-to-folder destination without installing it', () => {
  const result = runSkillUpdate(`
    const { runUpdate } = await import('./src/commands/update.js');
    const deps = { listInstalled, fetchIndex: async () => ({ packages: { [next.id]: next } }),
      log() {}, error() {} };
  `, "await runUpdate([initial.id], { 'dry-run': true, 'no-sync-skills': true }, deps)");
  assert.equal(result.result.packageFailed, 0, JSON.stringify(result.result.failures));
  assert.equal(result.result.skillMigrations[0].action, 'migrate');
  assert.match(result.result.skillMigrations[0].to, /skills\/upgrade-demo$/);
  assert.equal(result.legacyContent, result.oldContent);
  assert.deepEqual(result.lock, result.oldLock);
  assert.equal(result.folderExists, false);
});


test('a previous file remains recoverable when an open writer edits its moved inode', () => {
  const result = runSkillUpdate(`
    const oldFd = fs.openSync(oldPath, 'a');
    options.onProgress = event => {
      if (event.phase === 'lockfile') fs.writeSync(oldFd, 'Concurrent old-file edit.');
    };
  `);
  assert.equal(result.result.success, true);
  assert.deepEqual(result.savedBackups, [result.oldContent + 'Concurrent old-file edit.']);
});


test('bundle updates preserve unowned content excluded from historical checksums', () => {
  const result = runSkillUpdate(`
    const bundle = await updatePackage(initial.id, options);
    if (!bundle.success) throw new Error(bundle.error);
    fs.mkdirSync(path.join(bundle.path, 'outputs'));
    fs.writeFileSync(path.join(bundle.path, 'outputs/user-research.md'), 'User research');
  `);
  assert.equal(result.result.success, false);
  assert.match(result.result.error, /Untracked skill content/);
  assert.equal(result.preservedOutput, 'User research');
});


test('malformed downloaded skill metadata cannot replace a working skill', () => {
  const result = runSkillUpdate("fs.writeFileSync(path.join(source, 'upgrade-demo/SKILL.md'), '---\\nname: [broken YAML\\n---\\n');");
  assert.equal(result.result.success, false);
  assert.equal(result.legacyContent, result.oldContent);
  assert.deepEqual(result.lock, result.oldLock);
  assert.equal(result.folderExists, false);
});


test('update dry run reads canonical schema-v2 install paths', () => {
  const result = runSkillUpdate(`
    const { runUpdate } = await import('./src/commands/update.js');
    const { path: sourcePath, ...metadata } = next;
    const deps = { listInstalled, fetchIndex: async () => ({ packages: { [next.id]: { ...metadata, delivery: 'local', install: { source: 'catalog', path: sourcePath } } } }), log() {}, error() {} };
  `, "await runUpdate([initial.id], { 'dry-run': true, 'no-sync-skills': true }, deps)");
  assert.equal(result.result.packageFailed, 0, JSON.stringify(result.result.failures));
  assert.equal(result.result.skillMigrations[0].action, 'migrate');
  assert.equal(result.legacyContent, result.oldContent);
});
