import { test } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

test('a rejected runtime download preserves the existing installation', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'rudi-runtime-preserve-'));
  const previousFetch = globalThis.fetch;
  const destination = path.join(root, 'node');
  fs.mkdirSync(path.join(destination, 'bin'), { recursive: true });
  fs.writeFileSync(path.join(destination, 'bin/node'), 'working runtime');
  try {
    globalThis.fetch = async () => new Response('corrupt archive');
    const { downloadResolvedPackage } = await import('../../index.js');
    await assert.rejects(downloadResolvedPackage({
      id: 'runtime:node', kind: 'runtime', name: 'Node.js', version: '24.21.0',
      install: {
        source: 'download', url: 'https://example.test/node.tar.gz',
        checksum: { algo: 'sha256', value: '0'.repeat(64) },
        extract: { type: 'tar.gz', strip: 1 },
      },
      bins: { node: { path: 'bin/node' } },
    }, destination), /Checksum mismatch/);
    assert.equal(fs.readFileSync(path.join(destination, 'bin/node'), 'utf8'), 'working runtime');
  } finally {
    globalThis.fetch = previousFetch;
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('runtime archive validation completes before replacing the working runtime', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'rudi-runtime-stage-'));
  const previousFetch = globalThis.fetch;
  const destination = path.join(root, 'node');
  fs.mkdirSync(path.join(destination, 'bin'), { recursive: true });
  fs.writeFileSync(path.join(destination, 'bin/node'), 'working runtime');
  const archiveRoot = path.join(root, 'archive');
  fs.mkdirSync(archiveRoot);
  fs.writeFileSync(path.join(archiveRoot, 'unexpected-file'), 'incomplete download');
  const archive = path.join(root, 'node.tar.gz');
  execFileSync('tar', ['-czf', archive, '-C', root, 'archive']);
  const bytes = fs.readFileSync(archive);
  try {
    globalThis.fetch = async () => new Response(bytes);
    const { downloadResolvedPackage } = await import('../../index.js');
    await assert.rejects(downloadResolvedPackage({
      id: 'runtime:node', kind: 'runtime', name: 'Node.js', version: '24.21.0',
      install: {
        source: 'download', url: 'https://example.test/node.tar.gz',
        checksum: { algo: 'sha256', value: crypto.createHash('sha256').update(bytes).digest('hex') },
        extract: { type: 'tar.gz', strip: 1 },
      },
      bins: { node: { path: 'bin/node' } },
    }, destination), /runtime binary not found/);
    assert.equal(fs.readFileSync(path.join(destination, 'bin/node'), 'utf8'), 'working runtime');
    assert.deepEqual(fs.readdirSync(destination), ['bin']);
  } finally {
    globalThis.fetch = previousFetch;
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('downloadResolvedPackage verifies v2 checksum and cleans failed installs', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'rudi-v2-download-'));
  const previous = {
    RUDI_HOME: process.env.RUDI_HOME,
    fetch: globalThis.fetch,
  };
  const bytes = Buffer.from('#!/bin/sh\necho demo\n');
  const sha256 = crypto.createHash('sha256').update(bytes).digest('hex');

  try {
    process.env.RUDI_HOME = path.join(root, '.rudi');
    globalThis.fetch = async () => new Response(bytes);
    const { downloadResolvedPackage } = await import(`../../index.js?v2download=${Date.now()}`);
    const destination = path.join(root, 'installed', 'demo');
    const pkg = {
      id: 'binary:demo',
      kind: 'binary',
      name: 'Demo',
      version: '1.0.0',
      delivery: 'remote',
      install: {
        source: 'download',
        url: 'https://example.test/demo',
        checksum: { algo: 'sha256', value: sha256 },
        extract: { type: 'raw' },
      },
      bins: ['demo'],
    };

    await downloadResolvedPackage(pkg, destination);
    assert.deepEqual(fs.readFileSync(path.join(destination, 'demo')), bytes);
    assert.equal(JSON.parse(fs.readFileSync(path.join(destination, 'manifest.json'))).id, 'binary:demo');

    const failedDestination = path.join(root, 'installed', 'bad-demo');
    await assert.rejects(
      downloadResolvedPackage({
        ...pkg,
        id: 'binary:bad-demo',
        install: {
          ...pkg.install,
          checksum: { algo: 'sha256', value: '0'.repeat(64) },
        },
      }, failedDestination),
      /Checksum mismatch for binary:bad-demo/
    );
    assert.equal(fs.existsSync(failedDestination), false);
  } finally {
    globalThis.fetch = previous.fetch;
    if (previous.RUDI_HOME === undefined) delete process.env.RUDI_HOME;
    else process.env.RUDI_HOME = previous.RUDI_HOME;
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('downloadResolvedPackage preserves mapped runtime bin layout', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'rudi-v2-runtime-download-'));
  const previousFetch = globalThis.fetch;

  try {
    const archiveRoot = path.join(root, 'node-v1');
    fs.mkdirSync(path.join(archiveRoot, 'bin'), { recursive: true });
    fs.mkdirSync(path.join(archiveRoot, 'lib/node_modules/npm/bin'), { recursive: true });
    fs.writeFileSync(path.join(archiveRoot, 'bin/node'), '#!/bin/sh\n');
    fs.writeFileSync(path.join(archiveRoot, 'lib/node_modules/npm/bin/npm-cli.js'), '#!/usr/bin/env node\n');
    fs.symlinkSync('../lib/node_modules/npm/bin/npm-cli.js', path.join(archiveRoot, 'bin/npm'));
    const archive = path.join(root, 'node.tar.gz');
    execFileSync('tar', ['-czf', archive, '-C', root, 'node-v1']);
    const bytes = fs.readFileSync(archive);
    const sha256 = crypto.createHash('sha256').update(bytes).digest('hex');
    globalThis.fetch = async () => new Response(bytes);

    const { downloadResolvedPackage } = await import(`../../index.js?runtimeLayout=${Date.now()}`);
    const destination = path.join(root, 'installed');
    await downloadResolvedPackage({
      id: 'runtime:node',
      kind: 'runtime',
      name: 'Node.js',
      version: '1.0.0',
      delivery: 'remote',
      install: {
        source: 'download',
        url: 'https://example.test/node.tar.gz',
        checksum: { algo: 'sha256', value: sha256 },
        extract: { type: 'tar.gz', strip: 1 },
      },
      bins: {
        node: { path: 'bin/node' },
        npm: { path: 'bin/npm' },
      },
    }, destination);

    assert.equal(fs.existsSync(path.join(destination, 'bin/node')), true);
    assert.equal(fs.existsSync(path.join(destination, 'bin/npm')), true);
    assert.equal(fs.existsSync(path.join(destination, 'node')), false);
  } finally {
    globalThis.fetch = previousFetch;
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('runtime bins cannot resolve outside their staged installation', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'rudi-runtime-bin-boundary-'));
  const previousFetch = globalThis.fetch;
  const outside = path.join(root, 'outside-node');
  fs.writeFileSync(outside, 'outside file', { mode: 0o600 });
  const source = path.join(root, 'archive');
  fs.mkdirSync(path.join(source, 'bin'), { recursive: true });
  fs.symlinkSync(outside, path.join(source, 'bin/node'));
  const archive = path.join(root, 'node.tar.gz');
  execFileSync('tar', ['-czf', archive, '-C', root, 'archive']);
  const bytes = fs.readFileSync(archive);
  const destination = path.join(root, 'installed');
  fs.mkdirSync(destination);
  fs.writeFileSync(path.join(destination, 'old'), 'preserve');
  try {
    globalThis.fetch = async () => new Response(bytes);
    const { downloadResolvedPackage } = await import('../../index.js');
    await assert.rejects(downloadResolvedPackage({
      id: 'runtime:node', kind: 'runtime', name: 'Node.js', version: '24.21.0',
      install: {
        source: 'download', url: 'https://example.test/node.tar.gz',
        checksum: { algo: 'sha256', value: crypto.createHash('sha256').update(bytes).digest('hex') },
        extract: { type: 'tar.gz', strip: 1 },
      },
      bins: { node: { path: 'bin/node' } },
    }, destination), /runtime binary.*outside|runtime binary.*escapes/);
    assert.equal(fs.readFileSync(path.join(destination, 'old'), 'utf8'), 'preserve');
    assert.equal(fs.statSync(outside).mode & 0o777, 0o600);
  } finally {
    globalThis.fetch = previousFetch;
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('runtime metadata creation never follows archive-owned links', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'rudi-runtime-metadata-'));
  const previousFetch = globalThis.fetch;
  try {
    const { downloadResolvedPackage } = await import('../../index.js');
    for (const metadata of ['manifest.json', 'runtime.json']) {
      const outside = path.join(root, `outside-${metadata}`);
      fs.writeFileSync(outside, 'preserve outside content');
      const source = path.join(root, metadata);
      fs.mkdirSync(path.join(source, 'bin'), { recursive: true });
      fs.writeFileSync(path.join(source, 'bin/node'), '#!/bin/sh\n');
      fs.symlinkSync(outside, path.join(source, metadata));
      const archive = path.join(root, `${metadata}.tar.gz`);
      execFileSync('tar', ['-czf', archive, '-C', root, metadata]);
      const bytes = fs.readFileSync(archive);
      globalThis.fetch = async () => new Response(bytes);
      const destination = path.join(root, `installed-${metadata}`);
      fs.mkdirSync(destination);
      fs.writeFileSync(path.join(destination, 'old'), 'working runtime');
      await assert.rejects(downloadResolvedPackage({
        id: 'runtime:node', kind: 'runtime', name: 'Node.js', version: '24.21.0',
        install: {
          source: 'download', url: 'https://example.test/node.tar.gz',
          checksum: { algo: 'sha256', value: crypto.createHash('sha256').update(bytes).digest('hex') },
          extract: { type: 'tar.gz', strip: 1 },
        },
        bins: { node: { path: 'bin/node' } },
      }, destination), /EEXIST/);
      assert.equal(fs.readFileSync(outside, 'utf8'), 'preserve outside content');
      assert.equal(fs.readFileSync(path.join(destination, 'old'), 'utf8'), 'working runtime');
    }
  } finally {
    globalThis.fetch = previousFetch;
    fs.rmSync(root, { recursive: true, force: true });
  }
});
