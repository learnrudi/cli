import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'rudi-runtime-install-'));
const previousHome = process.env.RUDI_HOME;
process.env.RUDI_HOME = root;
after(() => {
  if (previousHome === undefined) delete process.env.RUDI_HOME;
  else process.env.RUDI_HOME = previousHome;
  fs.rmSync(root, { recursive: true, force: true });
});

function runtimeArchive({ npmLink = false } = {}) {
  const archiveRoot = fs.mkdtempSync(path.join(root, 'node-archive-'));
  fs.mkdirSync(path.join(archiveRoot, 'bin'), { recursive: true });
  fs.writeFileSync(path.join(archiveRoot, 'bin/node'), '#!/bin/sh\necho new-runtime\n');
  const bins = { node: { path: 'bin/node' } };
  if (npmLink) {
    fs.mkdirSync(path.join(archiveRoot, 'lib/node_modules/npm/bin'), { recursive: true });
    fs.writeFileSync(path.join(archiveRoot, 'lib/node_modules/npm/bin/npm-cli.js'), '#!/usr/bin/env node\n');
    fs.symlinkSync('../lib/node_modules/npm/bin/npm-cli.js', path.join(archiveRoot, 'bin/npm'));
    bins.npm = { path: 'bin/npm' };
  }
  const archive = `${archiveRoot}.tar.gz`;
  execFileSync('tar', ['-czf', archive, '-C', root, path.basename(archiveRoot)]);
  const bytes = fs.readFileSync(archive);
  return { bytes, resolved: {
    id: 'runtime:node', kind: 'runtime', name: 'Node.js', version: '24.21.0',
    installed: true, dependencies: [],
    install: {
      source: 'download', url: 'https://example.test/node.tar.gz',
      checksum: { algo: 'sha256', value: crypto.createHash('sha256').update(bytes).digest('hex') },
      extract: { type: 'tar.gz', strip: 1 },
    },
    bins,
  } };
}

test('installer preserves the existing runtime when its download fails', async () => {
  const destination = path.join(root, 'runtimes/node');
  fs.mkdirSync(path.join(destination, 'bin'), { recursive: true });
  fs.writeFileSync(path.join(destination, 'bin/node'), 'working runtime');
  const previousFetch = globalThis.fetch;
  try {
    globalThis.fetch = async () => { throw new Error('download unavailable'); };
    const { installPackage } = await import('../../installer.js');
    const resolved = {
      id: 'runtime:node', kind: 'runtime', name: 'Node.js', version: '24.21.0',
      installed: true, dependencies: [],
      install: {
        source: 'download', url: 'https://example.test/node.tar.gz',
        checksum: { algo: 'sha256', value: '0'.repeat(64) },
        extract: { type: 'tar.gz', strip: 1 },
      },
      bins: { node: { path: 'bin/node' } },
    };
    const result = await installPackage(resolved.id, { force: true, resolvedPackage: resolved });
    assert.equal(result.success, false);
    assert.match(result.error, /download unavailable/);
    assert.equal(fs.readFileSync(path.join(destination, 'bin/node'), 'utf8'), 'working runtime');
  } finally {
    globalThis.fetch = previousFetch;
  }
});

test('runtime replacement restores the previous runtime and lock when locking fails', async () => {
  const { installPackage } = await import('../../installer.js');
  const { getLockfilePath } = await import('@learnrudi/env');
  const destination = path.join(root, 'runtimes/node');
  const lockPath = getLockfilePath('runtime:node');
  fs.mkdirSync(path.join(destination, 'bin'), { recursive: true });
  fs.writeFileSync(path.join(destination, 'bin/node'), 'working runtime');
  fs.mkdirSync(path.dirname(lockPath), { recursive: true });
  const oldLock = '# preserve exact previous bytes\nid: runtime:node\nversion: 20.10.0\n';
  fs.writeFileSync(lockPath, oldLock);
  const { bytes, resolved } = runtimeArchive();
  const previousFetch = globalThis.fetch;
  const writeFile = fs.writeFileSync;
  try {
    globalThis.fetch = async () => new Response(bytes);
    fs.writeFileSync = (file, ...args) => {
      if (typeof file === 'string' && path.dirname(file) === path.dirname(lockPath)) {
        writeFile(file, 'partial lock');
        throw new Error('simulated lock failure');
      }
      return writeFile(file, ...args);
    };
    const result = await installPackage(resolved.id, { force: true, resolvedPackage: resolved })
      .catch(error => ({ success: false, error: error.message }));
    assert.equal(result.success, false);
    assert.match(result.error, /simulated lock failure/);
    assert.equal(fs.readFileSync(path.join(destination, 'bin/node'), 'utf8'), 'working runtime');
    assert.equal(fs.readFileSync(lockPath, 'utf8'), oldLock);
  } finally {
    fs.writeFileSync = writeFile;
    globalThis.fetch = previousFetch;
  }
});

test('an overlapping runtime installation is rejected before downloading', async () => {
  const { installPackage } = await import('../../installer.js');
  const { bytes, resolved } = runtimeArchive();
  let releaseDownload;
  let signalStarted;
  let downloads = 0;
  const started = new Promise(resolve => { signalStarted = resolve; });
  const released = new Promise(resolve => { releaseDownload = resolve; });
  const previousFetch = globalThis.fetch;
  let first;
  try {
    globalThis.fetch = async () => {
      downloads += 1;
      if (downloads === 1) { signalStarted(); await released; }
      return new Response(bytes);
    };
    first = installPackage(resolved.id, { force: true, resolvedPackage: resolved });
    await started;
    const second = await installPackage(resolved.id, { force: true, resolvedPackage: resolved });
    assert.equal(second.success, false);
    assert.match(second.error, /runtime installation.*in progress/i);
    assert.equal(downloads, 1);
  } finally {
    releaseDownload();
    if (first) await first;
    globalThis.fetch = previousFetch;
  }
});

test('runtime locks cover internal npm links and bundled dependency contents', async () => {
  const { installPackage } = await import('../../installer.js');
  const { verifyLockfile, computeInstalledContentChecksum } = await import('../../lockfile.js');
  const { bytes, resolved } = runtimeArchive({ npmLink: true });
  const oldNode = path.join(root, 'runtimes/node/bin/node');
  fs.mkdirSync(path.dirname(oldNode), { recursive: true });
  fs.writeFileSync(oldNode, 'previous runtime');
  const previousFetch = globalThis.fetch;
  try {
    globalThis.fetch = async () => new Response(bytes);
    const result = await installPackage(resolved.id, { force: true, resolvedPackage: resolved });
    assert.equal(result.success, true, result.error);
    assert.ok(result.backupPath, 'replacement retains a recoverable runtime directory');
    assert.equal(fs.readFileSync(path.join(result.backupPath, 'bin/node'), 'utf8'), 'previous runtime');
    assert.deepEqual(await verifyLockfile(resolved.id), { valid: true, errors: [] });
    await assert.rejects(computeInstalledContentChecksum(result.path), /symbolic link/);
    fs.appendFileSync(path.join(result.path, 'lib/node_modules/npm/bin/npm-cli.js'), 'changed');
    const verification = await verifyLockfile(resolved.id);
    assert.equal(verification.valid, false);
    assert.match(verification.errors.join(' '), /checksum does not match/);
  } finally {
    globalThis.fetch = previousFetch;
  }
});

test('scratch cleanup failure cannot leave a new runtime with an old lock', async () => {
  const { installPackage } = await import('../../installer.js');
  const { getLockfilePath } = await import('@learnrudi/env');
  const destination = path.join(root, 'runtimes/node');
  const lockPath = getLockfilePath('runtime:node');
  fs.mkdirSync(path.join(destination, 'bin'), { recursive: true });
  fs.writeFileSync(path.join(destination, 'bin/node'), 'old runtime');
  fs.writeFileSync(lockPath, 'id: runtime:node\nversion: 20.10.0\n');
  const { bytes, resolved } = runtimeArchive();
  const previousFetch = globalThis.fetch;
  const unlink = fs.unlinkSync;
  try {
    globalThis.fetch = async () => new Response(bytes);
    fs.unlinkSync = file => {
      if (String(file).endsWith('.download')) throw new Error('scratch cleanup denied');
      return unlink(file);
    };
    const result = await installPackage(resolved.id, { force: true, resolvedPackage: resolved });
    assert.equal(result.success, false);
    assert.match(result.error, /scratch cleanup denied/);
    assert.equal(fs.readFileSync(path.join(destination, 'bin/node'), 'utf8'), 'old runtime');
    assert.equal(fs.readFileSync(lockPath, 'utf8'), 'id: runtime:node\nversion: 20.10.0\n');
  } finally {
    globalThis.fetch = previousFetch;
    fs.unlinkSync = unlink;
  }
});
