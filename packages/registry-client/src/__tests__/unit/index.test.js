/**
 * Unit tests for registry client
 */

import { test } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  DEFAULT_REGISTRY_URL,
  RUNTIMES_DOWNLOAD_BASE,
  CACHE_TTL,
  downloadPackage
} from '../../index.js';

// =============================================================================
// CONFIGURATION CONSTANTS
// =============================================================================

test('config: DEFAULT_REGISTRY_URL is valid GitHub URL', () => {
  assert.ok(DEFAULT_REGISTRY_URL.startsWith('https://'));
  assert.ok(DEFAULT_REGISTRY_URL.includes('github'));
  assert.ok(DEFAULT_REGISTRY_URL.endsWith('.json'));
});

test('config: RUNTIMES_DOWNLOAD_BASE is valid URL', () => {
  assert.ok(RUNTIMES_DOWNLOAD_BASE.startsWith('https://'));
  assert.ok(RUNTIMES_DOWNLOAD_BASE.includes('github'));
});

test('config: CACHE_TTL is 1 hour in milliseconds', () => {
  const expectedMs = 60 * 60 * 1000;
  assert.strictEqual(CACHE_TTL, expectedMs);
});

// =============================================================================
// URL CONSTRUCTION
// =============================================================================

test('url: runtime download URL construction', () => {
  const base = RUNTIMES_DOWNLOAD_BASE;
  const version = 'v1.0.0';
  const filename = 'node-22.12.0-darwin-arm64.tar.gz';

  const url = `${base}/${version}/${filename}`;

  assert.ok(url.includes('v1.0.0'));
  assert.ok(url.includes('node-22.12.0'));
  assert.ok(url.endsWith('.tar.gz'));
});

test('url: handles different platforms', () => {
  const base = RUNTIMES_DOWNLOAD_BASE;
  const version = 'v1.0.0';

  const platforms = ['darwin-arm64', 'darwin-x64', 'linux-x64', 'win32-x64'];

  for (const platform of platforms) {
    const filename = `node-22.12.0-${platform}.tar.gz`;
    const url = `${base}/${version}/${filename}`;

    assert.ok(url.includes(platform), `URL should contain platform ${platform}`);
  }
});

// =============================================================================
// PACKAGE ID PARSING
// =============================================================================

test('packageId: parses stack:name format', () => {
  const id = 'stack:pdf-creator';
  const [kind, name] = id.split(':');

  assert.strictEqual(kind, 'stack');
  assert.strictEqual(name, 'pdf-creator');
});

test('packageId: parses runtime:name format', () => {
  const id = 'runtime:node';
  const [kind, name] = id.split(':');

  assert.strictEqual(kind, 'runtime');
  assert.strictEqual(name, 'node');
});

test('packageId: parses binary:name format', () => {
  const id = 'binary:ffmpeg';
  const [kind, name] = id.split(':');

  assert.strictEqual(kind, 'binary');
  assert.strictEqual(name, 'ffmpeg');
});

test('packageId: normalizes id without prefix', () => {
  const id = 'pdf-creator';
  const normalizedId = id.includes(':') ? id : `stack:${id}`;

  assert.strictEqual(normalizedId, 'stack:pdf-creator');
});

// =============================================================================
// CACHE LOGIC
// =============================================================================

test('cache: TTL check logic', () => {
  const now = Date.now();
  const cacheTime = now - (CACHE_TTL - 1000); // Just under TTL
  const expiredTime = now - (CACHE_TTL + 1000); // Just over TTL

  assert.ok(now - cacheTime < CACHE_TTL, 'Recent cache should be valid');
  assert.ok(now - expiredTime > CACHE_TTL, 'Old cache should be expired');
});

// =============================================================================
// INDEX STRUCTURE
// =============================================================================

test('index: expected structure', () => {
  // Sample index structure
  const index = {
    version: 1,
    packages: {
      stacks: [],
      runtimes: [],
      binaries: [],
      skills: [],
      prompts: [],
      workflows: [],
      agents: []
    }
  };

  assert.ok(index.version);
  assert.ok(Array.isArray(index.packages.stacks));
  assert.ok(Array.isArray(index.packages.runtimes));
  assert.ok(Array.isArray(index.packages.binaries));
});

test('index: package entry structure', () => {
  const pkg = {
    id: 'stack:pdf-creator',
    kind: 'stack',
    name: 'PDF Creator',
    version: '1.0.0',
    description: 'Create PDF documents',
    path: 'stacks/pdf-creator'
  };

  assert.ok(pkg.id.includes(':'));
  assert.ok(['stack', 'runtime', 'binary', 'skill', 'prompt', 'workflow', 'agent'].includes(pkg.kind));
  assert.ok(pkg.name);
  assert.ok(pkg.version);
});

test('downloadPackage local registry copy excludes generated stack state and dependency directories', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'rudi-local-registry-copy-'));
  const registryRoot = path.join(root, 'registry');
  const stackRoot = path.join(registryRoot, 'catalog', 'stacks', 'demo');
  const destRoot = path.join(root, 'dest');
  const previousUseLocal = process.env.USE_LOCAL_REGISTRY;
  const previousRegistryRoot = process.env.RUDI_REGISTRY_ROOT;

  try {
    fs.mkdirSync(path.join(stackRoot, 'src'), { recursive: true });
    fs.mkdirSync(path.join(stackRoot, 'runs', 'run-1'), { recursive: true });
    fs.mkdirSync(path.join(stackRoot, 'outputs'), { recursive: true });
    fs.mkdirSync(path.join(stackRoot, '.test-rudi'), { recursive: true });
    fs.mkdirSync(path.join(stackRoot, 'node_modules', 'dep'), { recursive: true });
    fs.mkdirSync(path.join(stackRoot, 'composer', 'public', 'media'), { recursive: true });
    fs.writeFileSync(path.join(stackRoot, 'manifest.json'), '{"id":"stack:demo"}');
    fs.writeFileSync(path.join(stackRoot, 'src', 'index.js'), 'export {};');
    fs.writeFileSync(path.join(stackRoot, 'runs', 'run-1', 'project.json'), '{}');
    fs.writeFileSync(path.join(stackRoot, 'outputs', 'render.mp4'), 'fake');
    fs.writeFileSync(path.join(stackRoot, '.test-rudi', 'state.json'), '{}');
    fs.writeFileSync(path.join(stackRoot, 'node_modules', 'dep', 'package.json'), '{}');
    fs.writeFileSync(path.join(stackRoot, 'composer', 'public', 'media', 'cache.mp4'), 'fake');

    process.env.USE_LOCAL_REGISTRY = 'true';
    process.env.RUDI_REGISTRY_ROOT = registryRoot;

    await downloadPackage({
      id: 'stack:demo',
      kind: 'stack',
      name: 'demo',
      path: 'catalog/stacks/demo'
    }, destRoot);

    assert.equal(fs.existsSync(path.join(destRoot, 'manifest.json')), true);
    assert.equal(fs.existsSync(path.join(destRoot, 'src', 'index.js')), true);
    assert.equal(fs.existsSync(path.join(destRoot, 'runs')), false);
    assert.equal(fs.existsSync(path.join(destRoot, 'outputs')), false);
    assert.equal(fs.existsSync(path.join(destRoot, '.test-rudi')), false);
    assert.equal(fs.existsSync(path.join(destRoot, 'node_modules')), false);
    assert.equal(fs.existsSync(path.join(destRoot, 'composer', 'public', 'media')), false);
  } finally {
    if (previousUseLocal === undefined) {
      delete process.env.USE_LOCAL_REGISTRY;
    } else {
      process.env.USE_LOCAL_REGISTRY = previousUseLocal;
    }
    if (previousRegistryRoot === undefined) {
      delete process.env.RUDI_REGISTRY_ROOT;
    } else {
      process.env.RUDI_REGISTRY_ROOT = previousRegistryRoot;
    }
    fs.rmSync(root, { recursive: true, force: true });
  }
});
