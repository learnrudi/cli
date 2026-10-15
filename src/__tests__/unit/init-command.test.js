import { execFileSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

test('init bootstraps core local home without touching legacy database state', (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'rudi-init-core-'));
  const rudiHome = path.join(root, '.rudi');
  const home = path.join(root, 'home');
  fs.mkdirSync(home, { recursive: true });
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));

  const output = execFileSync(
    process.execPath,
    ['src/index.js', 'init', '--skip-downloads', '--no-agent-instructions'],
    {
      cwd: process.cwd(),
      env: {
        ...process.env,
        HOME: home,
        RUDI_HOME: rudiHome,
      },
      encoding: 'utf-8',
    }
  );

  assert.match(output, /RUDI Initialization/);
  assert.doesNotMatch(output, /Checking database|Database created|Database exists|Database error/);
  assert.equal(fs.existsSync(path.join(rudiHome, 'rudi.db')), false);
  assert.equal(fs.existsSync(path.join(rudiHome, 'settings.json')), true);
  assert.equal(fs.existsSync(path.join(rudiHome, 'stacks')), true);
  assert.equal(fs.existsSync(path.join(rudiHome, 'skills')), true);
});

function bootstrapFixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'rudi-init-v2-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const registry = path.join(root, 'registry');
  const payload = path.join(root, 'payload');
  fs.mkdirSync(registry);
  fs.mkdirSync(path.join(payload, 'bin'), { recursive: true });
  for (const executable of ['bin/node', 'bin/python3', 'bin/pip3', 'sqlite3', 'rg']) {
    fs.writeFileSync(path.join(payload, executable), '#!/bin/sh\necho bootstrap-fixture\n', { mode: 0o755 });
  }
  const archive = path.join(root, 'bootstrap.tar.gz');
  execFileSync('tar', ['-czf', archive, '-C', root, 'payload']);
  const checksum = createHash('sha256').update(fs.readFileSync(archive)).digest('hex');
  const packages = Object.fromEntries([
    ['runtime:node', { node: { path: 'bin/node' } }],
    ['runtime:python', { python3: { path: 'bin/python3' }, pip3: { path: 'bin/pip3' } }],
    ['binary:sqlite', ['sqlite3']],
    ['binary:ripgrep', ['rg']],
  ].map(([id, bins]) => [id, {
    id, kind: id.split(':')[0], name: id, version: '1.0.0', delivery: 'remote', bins,
    install: {
      source: 'download', url: 'https://fixture.invalid/bootstrap.tar.gz',
      checksum: { algo: 'sha256', value: checksum }, extract: { type: 'tar.gz', strip: 1 },
    },
  }]));
  const index = { schemaVersion: 2, packages };
  const indexPath = path.join(registry, 'index.json');
  fs.writeFileSync(indexPath, JSON.stringify(index));
  const rudiHome = path.join(root, '.rudi');
  const script = `
    import fs from 'node:fs';
    globalThis.fetch = async () => new Response(fs.readFileSync(process.argv[1]));
    const { cmdInit } = await import('./src/commands/init.js');
    await cmdInit([], JSON.parse(process.argv[2]));
  `;
  const run = (flags = {}) => spawnSync(process.execPath, [
    '--input-type=module', '-e', script, archive,
    JSON.stringify({ 'no-agent-instructions': true, ...flags }),
  ], {
    cwd: process.cwd(), encoding: 'utf8', timeout: 20_000,
    env: { ...process.env, HOME: root, RUDI_HOME: rudiHome,
      USE_LOCAL_REGISTRY: 'true', RUDI_REGISTRY_ROOT: registry },
  });
  return { run, rudiHome, index, indexPath };
}

test('init installs all bootstrap packages from a schema-v2 registry', (t) => {
  const { run, rudiHome } = bootstrapFixture(t);
  const result = run();
  assert.equal(result.status, 0, result.stderr);
  for (const relativePath of ['runtimes/node/bin/node', 'runtimes/python/bin/python3',
    'binaries/sqlite/sqlite3', 'binaries/ripgrep/rg']) {
    assert.equal(fs.existsSync(path.join(rudiHome, relativePath)), true, relativePath);
  }
  assert.equal(fs.existsSync(path.join(rudiHome, 'locks/runtimes/node.lock.yaml')), true);
  assert.equal(fs.existsSync(path.join(rudiHome, 'rudi.db')), false);
});

test('init reports failure when a bootstrap checksum is rejected and preserves successful packages', (t) => {
  const { run, rudiHome, index, indexPath } = bootstrapFixture(t);
  index.packages['binary:ripgrep'].install.checksum.value = '0'.repeat(64);
  fs.writeFileSync(indexPath, JSON.stringify(index));
  const result = run();
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /binary:ripgrep/);
  assert.doesNotMatch(result.stdout, /RUDI initialized!|RUDI is up to date!/);
  assert.equal(fs.existsSync(path.join(rudiHome, 'runtimes/node/bin/node')), true);
  assert.equal(fs.existsSync(path.join(rudiHome, 'binaries/ripgrep')), false);
});

test('init is repeatable, honors force, and only creates shims when requested', (t) => {
  const { run, rudiHome } = bootstrapFixture(t);
  assert.equal(run().status, 0);
  assert.equal(fs.existsSync(path.join(rudiHome, 'bins/node')), false);
  const nodePath = path.join(rudiHome, 'runtimes/node/bin/node');
  fs.appendFileSync(nodePath, '# existing installation\n');
  const repeat = run({ 'with-shims': true });
  assert.equal(repeat.status, 0, repeat.stderr);
  assert.match(repeat.stdout, /node: already installed/);
  assert.match(fs.readFileSync(nodePath, 'utf8'), /existing installation/);
  assert.equal(execFileSync(path.join(rudiHome, 'bins/node'), [], { encoding: 'utf8' }).trim(), 'bootstrap-fixture');
  const forced = run({ force: true });
  assert.equal(forced.status, 0, forced.stderr);
  assert.doesNotMatch(fs.readFileSync(nodePath, 'utf8'), /existing installation/);
});

test('quiet init fails visibly when a required registry entry is missing', (t) => {
  const { run, index, indexPath } = bootstrapFixture(t);
  delete index.packages['binary:ripgrep'];
  fs.writeFileSync(indexPath, JSON.stringify(index));
  const result = run({ quiet: true });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /binary:ripgrep/);
  assert.equal(result.stdout, '');
});

test('init can enable system binary shims after initialization without downloads', (t) => {
  const { run, rudiHome, index, indexPath } = bootstrapFixture(t);
  index.packages['binary:sqlite'] = {
    id: 'binary:sqlite', kind: 'binary', name: 'SQLite', version: 'system', delivery: 'system',
    install: { source: 'system' }, bins: ['sqlite3'],
    detect: { command: `${process.execPath} --version` },
  };
  fs.writeFileSync(indexPath, JSON.stringify(index));
  const initial = run();
  assert.equal(initial.status, 0, initial.stderr);
  const shim = path.join(rudiHome, 'bins/sqlite3');
  assert.equal(fs.existsSync(shim), false);
  const repeat = run({ 'with-shims': true, 'skip-downloads': true });
  assert.equal(repeat.status, 0, repeat.stderr);
  assert.equal(execFileSync(shim, ['--version'], { encoding: 'utf8' }).trim(), process.version);
});

test('quiet init creates downloaded and system shims without success output', (t) => {
  const { run, rudiHome, index, indexPath } = bootstrapFixture(t);
  index.packages['binary:sqlite'] = {
    id: 'binary:sqlite', kind: 'binary', name: 'SQLite', version: 'system', delivery: 'system',
    install: { source: 'system' }, bins: ['sqlite3'],
    detect: { command: `${process.execPath} --version` },
  };
  fs.writeFileSync(indexPath, JSON.stringify(index));
  for (const skipDownloads of [false, true]) {
    const result = run({ quiet: true, 'with-shims': true, 'skip-downloads': skipDownloads });
    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.stdout, '');
    assert.equal(execFileSync(path.join(rudiHome, 'bins/sqlite3'), ['--version'], { encoding: 'utf8' }).trim(), process.version);
    assert.equal(execFileSync(path.join(rudiHome, 'bins/rg'), [], { encoding: 'utf8' }).trim(), 'bootstrap-fixture');
  }
});
