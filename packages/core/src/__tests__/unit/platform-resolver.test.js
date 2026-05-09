/**
 * Unit tests for platform resolution and merge logic
 * Tests schema v2 rules: exact → OS-only → default, with merge behavior
 */

import { test } from 'node:test';
import assert from 'node:assert';
import { resolveInstall, validateResolvedInstall, getSupportedPlatforms, isPlatformSupported } from '../../platform-resolver.js';
import { sqliteBinary, nodejsRuntime, ollamaAgent } from '../fixtures/manifests.js';

// =============================================================================
// PLATFORM RESOLUTION ORDER
// =============================================================================

test('resolveInstall: exact platform match takes precedence', () => {
  const resolved = resolveInstall(sqliteBinary, { platformKey: 'darwin-arm64' });

  assert.strictEqual(resolved.source, 'system');
  assert.strictEqual(resolved.preinstalled, true);
  assert.strictEqual(resolved._matchedKey, 'darwin-arm64');
});

test('resolveInstall: OS-only match when exact not found', () => {
  const resolved = resolveInstall(sqliteBinary, { platformKey: 'darwin-x64' });

  // darwin-x64 not in platforms, should match "darwin"
  assert.strictEqual(resolved.source, 'system');
  assert.strictEqual(resolved.preinstalled, true);
  assert.strictEqual(resolved._matchedKey, 'darwin');
});

test('resolveInstall: top-level defaults when no platform match', () => {
  const resolved = resolveInstall(sqliteBinary, { platformKey: 'freebsd-x64' });

  // freebsd not in platforms, should use top-level defaults
  assert.strictEqual(resolved.source, 'system');
  assert.strictEqual(resolved.delivery, 'system');
  assert.strictEqual(resolved._matchedKey, 'default');
});

// =============================================================================
// MERGE BEHAVIOR
// =============================================================================

test('resolveInstall: platform override wins over top-level', () => {
  const resolved = resolveInstall(sqliteBinary, { platformKey: 'win32-x64' });

  // Top-level: source='system', delivery='system'
  // Platform override: source='download', delivery='remote'
  assert.strictEqual(resolved.source, 'download');
  assert.strictEqual(resolved.delivery, 'remote');
  assert.ok(resolved.url);
  assert.ok(resolved.checksum);
  assert.strictEqual(resolved._matchedKey, 'win32-x64');
});

test('resolveInstall: merges top-level and platform fields', () => {
  const resolved = resolveInstall(nodejsRuntime, { platformKey: 'darwin-arm64' });

  // Top-level has: source='download', delivery='remote'
  // Platform adds: url, checksum, extract
  assert.strictEqual(resolved.source, 'download');
  assert.strictEqual(resolved.delivery, 'remote');
  assert.strictEqual(resolved.url, 'https://github.com/learnrudi/registry/releases/download/v1.0.0/node-22.12.0-darwin-arm64.tar.gz');
  assert.strictEqual(resolved.checksum.algo, 'sha256');
  assert.strictEqual(resolved.checksum.value, 'deadbeef123456');
  assert.ok(resolved.extract);
});

test('resolveInstall: preserves platform-specific metadata', () => {
  const resolved = resolveInstall(nodejsRuntime, { platformKey: 'linux-x64' });

  assert.strictEqual(resolved.url, 'https://github.com/learnrudi/registry/releases/download/v1.0.0/node-22.12.0-linux-x64.tar.gz');
  assert.strictEqual(resolved.checksum.value, 'cafebabe789');
  assert.strictEqual(resolved._platformKey, 'linux-x64');
  assert.strictEqual(resolved._matchedKey, 'linux-x64');
});

// =============================================================================
// VALIDATION BY SOURCE TYPE
// =============================================================================

test('validateResolvedInstall: download requires url and checksum', () => {
  const resolved = resolveInstall(nodejsRuntime, { platformKey: 'darwin-arm64' });
  const result = validateResolvedInstall(resolved, nodejsRuntime);

  assert.strictEqual(result.valid, true);
  assert.strictEqual(result.errors.length, 0);
});

test('validateResolvedInstall: download without url fails', () => {
  const manifest = {
    ...nodejsRuntime,
    install: {
      source: 'download',
      platforms: {
        'darwin-arm64': {
          checksum: { algo: 'sha256', value: 'abc123' }
          // Missing url
        }
      }
    }
  };

  const resolved = resolveInstall(manifest, { platformKey: 'darwin-arm64' });
  const result = validateResolvedInstall(resolved, manifest);

  assert.strictEqual(result.valid, false);
  assert.ok(result.errors.some(e => e.includes('url')));
});

test('validateResolvedInstall: download without checksum fails', () => {
  const manifest = {
    ...nodejsRuntime,
    install: {
      source: 'download',
      platforms: {
        'darwin-arm64': {
          url: 'https://example.com/node.tar.gz'
          // Missing checksum
        }
      }
    }
  };

  const resolved = resolveInstall(manifest, { platformKey: 'darwin-arm64' });
  const result = validateResolvedInstall(resolved, manifest);

  assert.strictEqual(result.valid, false);
  assert.ok(result.errors.some(e => e.includes('checksum')));
});

test('validateResolvedInstall: download with "latest" version warns', () => {
  const manifest = {
    ...nodejsRuntime,
    version: 'latest', // Should warn
    install: {
      source: 'download',
      platforms: {
        'darwin-arm64': {
          url: 'https://example.com/node.tar.gz',
          checksum: { algo: 'sha256', value: 'abc123' }
        }
      }
    }
  };

  const resolved = resolveInstall(manifest, { platformKey: 'darwin-arm64' });
  const result = validateResolvedInstall(resolved, manifest);

  assert.strictEqual(result.valid, true);
  assert.ok(result.warnings.some(w => w.includes('latest')));
});

test('validateResolvedInstall: system requires detect.command', () => {
  const resolved = resolveInstall(ollamaAgent, { platformKey: 'darwin' });
  const result = validateResolvedInstall(resolved, ollamaAgent);

  assert.strictEqual(result.valid, true);
  assert.strictEqual(result.errors.length, 0);
});

test('validateResolvedInstall: system without detect.command fails', () => {
  const manifest = {
    id: 'binary:bad',
    kind: 'binary',
    name: 'Bad',
    version: 'system',
    delivery: 'system',
    install: {
      source: 'system'
      // Missing detect
    },
    bins: ['bad']
  };

  const resolved = resolveInstall(manifest, { platformKey: 'darwin' });
  const result = validateResolvedInstall(resolved, manifest);

  assert.strictEqual(result.valid, false);
  assert.ok(result.errors.some(e => e.includes('detect')));
});

test('validateResolvedInstall: npm requires package field', () => {
  const manifest = {
    id: 'binary:ffmpeg',
    kind: 'binary',
    name: 'ffmpeg',
    version: '1.0.0',
    delivery: 'remote',
    install: {
      source: 'npm',
      package: '@ffmpeg-installer/ffmpeg'
    },
    bins: ['ffmpeg']
  };

  const resolved = resolveInstall(manifest, { platformKey: 'darwin' });
  const result = validateResolvedInstall(resolved, manifest);

  assert.strictEqual(result.valid, true);
  assert.strictEqual(result.errors.length, 0);
});

test('validateResolvedInstall: npm without package fails', () => {
  const manifest = {
    id: 'binary:bad',
    kind: 'binary',
    name: 'Bad',
    version: '1.0.0',
    delivery: 'remote',
    install: {
      source: 'npm'
      // Missing package
    },
    bins: ['bad']
  };

  const resolved = resolveInstall(manifest, { platformKey: 'darwin' });
  const result = validateResolvedInstall(resolved, manifest);

  assert.strictEqual(result.valid, false);
  assert.ok(result.errors.some(e => e.includes('package')));
});

// =============================================================================
// BINS REQUIREMENT
// =============================================================================

test('validateResolvedInstall: runtime requires bins', () => {
  const manifest = {
    id: 'runtime:node',
    kind: 'runtime',
    name: 'Node.js',
    version: '22.0.0',
    delivery: 'remote',
    install: { source: 'download' }
    // Missing bins
  };

  const resolved = resolveInstall(manifest, { platformKey: 'darwin-arm64' });
  const result = validateResolvedInstall(resolved, manifest);

  assert.strictEqual(result.valid, false);
  assert.ok(result.errors.some(e => e.includes('bins')));
});

test('validateResolvedInstall: binary requires bins', () => {
  const manifest = {
    id: 'binary:sqlite',
    kind: 'binary',
    name: 'SQLite',
    version: 'system',
    delivery: 'system',
    install: { source: 'system', detect: { command: 'sqlite3 --version' } }
    // Missing bins
  };

  const resolved = resolveInstall(manifest, { platformKey: 'darwin' });
  const result = validateResolvedInstall(resolved, manifest);

  assert.strictEqual(result.valid, false);
  assert.ok(result.errors.some(e => e.includes('bins')));
});

test('validateResolvedInstall: agent requires bins', () => {
  const manifest = {
    id: 'agent:ollama',
    kind: 'agent',
    name: 'Ollama',
    version: 'system',
    delivery: 'system',
    install: { source: 'system', detect: { command: 'ollama --version' } }
    // Missing bins
  };

  const resolved = resolveInstall(manifest, { platformKey: 'darwin' });
  const result = validateResolvedInstall(resolved, manifest);

  assert.strictEqual(result.valid, false);
  assert.ok(result.errors.some(e => e.includes('bins')));
});

test('validateResolvedInstall: stack does not require bins', () => {
  const manifest = {
    id: 'stack:pdf',
    kind: 'stack',
    name: 'PDF Creator',
    version: '1.0.0',
    delivery: 'local',
    install: { source: 'git' }
    // bins not required for stacks
  };

  const resolved = resolveInstall(manifest, { platformKey: 'darwin' });
  const result = validateResolvedInstall(resolved, manifest);

  assert.strictEqual(result.valid, true);
});

// =============================================================================
// PLATFORM SUPPORT CHECKS
// =============================================================================

test('getSupportedPlatforms: returns all platform keys', () => {
  const platforms = getSupportedPlatforms(sqliteBinary);

  assert.ok(platforms.includes('darwin-arm64'));
  assert.ok(platforms.includes('darwin'));
  assert.ok(platforms.includes('win32-x64'));
  assert.strictEqual(platforms.length, 3);
});

test('isPlatformSupported: true for exact match', () => {
  const supported = isPlatformSupported(sqliteBinary, 'darwin-arm64');
  assert.strictEqual(supported, true);
});

test('isPlatformSupported: true for OS-only match', () => {
  const supported = isPlatformSupported(sqliteBinary, 'darwin-x64');
  assert.strictEqual(supported, true);
});

test('isPlatformSupported: false for unsupported platform', () => {
  const manifest = {
    ...nodejsRuntime,
    install: {
      source: 'download',
      platforms: {
        'darwin-arm64': { url: 'x', checksum: { algo: 'sha256', value: 'y' } },
        'linux-x64': { url: 'x', checksum: { algo: 'sha256', value: 'y' } }
      }
    }
  };

  const supported = isPlatformSupported(manifest, 'win32-x64');
  assert.strictEqual(supported, false);
});
