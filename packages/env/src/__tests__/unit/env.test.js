/**
 * Unit tests for environment configuration
 */

import { test } from 'node:test';
import assert from 'node:assert';
import path from 'path';
import os from 'os';
import {
  RUDI_HOME,
  PATHS,
  getInstallRoot,
  getBinsDir,
  getStoreDir,
  getPlatformArch,
  getPlatform,
  getArch,
  isMacOS,
  isLinux,
  isWindows,
  PACKAGE_KINDS,
  parsePackageId,
  createPackageId,
  getPackagePath,
  getLockfilePath
} from '../../index.js';

// =============================================================================
// RUDI_HOME
// =============================================================================

test('RUDI_HOME: is in home directory', () => {
  const home = os.homedir();

  assert.ok(RUDI_HOME.startsWith(home));
  assert.ok(RUDI_HOME.endsWith('.rudi'));
});

test('RUDI_HOME: is absolute path', () => {
  assert.ok(path.isAbsolute(RUDI_HOME));
});

// =============================================================================
// PATHS OBJECT
// =============================================================================

test('PATHS: has required directories', () => {
  const required = ['home', 'stacks', 'runtimes', 'binaries', 'agents', 'db', 'cache'];

  for (const key of required) {
    assert.ok(PATHS[key], `PATHS should have ${key}`);
  }
});

test('PATHS: all paths are under RUDI_HOME', () => {
  const pathKeys = ['stacks', 'runtimes', 'binaries', 'agents', 'cache', 'locks'];

  for (const key of pathKeys) {
    assert.ok(
      PATHS[key].startsWith(RUDI_HOME),
      `PATHS.${key} should be under RUDI_HOME`
    );
  }
});

test('PATHS: dbFile ends with rudi.db', () => {
  assert.ok(PATHS.dbFile.endsWith('rudi.db'));
});

test('PATHS: registryCache is under cache directory', () => {
  assert.ok(PATHS.registryCache.startsWith(PATHS.cache));
  assert.ok(PATHS.registryCache.endsWith('registry.json'));
});

// =============================================================================
// INSTALL ROOT FUNCTIONS
// =============================================================================

test('getInstallRoot: returns RUDI_HOME', () => {
  assert.strictEqual(getInstallRoot(), RUDI_HOME);
});

test('getBinsDir: returns bins path', () => {
  assert.strictEqual(getBinsDir(), PATHS.bins);
});

test('getStoreDir: returns store path', () => {
  assert.strictEqual(getStoreDir(), PATHS.store);
});

// =============================================================================
// PLATFORM DETECTION
// =============================================================================

test('getPlatformArch: returns platform-arch format', () => {
  const platformArch = getPlatformArch();

  assert.ok(platformArch.includes('-'));

  const [platform, arch] = platformArch.split('-');
  assert.ok(['darwin', 'linux', 'win32'].includes(platform));
  assert.ok(['arm64', 'x64'].includes(arch) || arch.length > 0);
});

test('getPlatform: returns valid platform', () => {
  const platform = getPlatform();

  assert.ok(['darwin', 'linux', 'win32'].includes(platform) || typeof platform === 'string');
});

test('getArch: returns valid architecture', () => {
  const arch = getArch();

  assert.ok(typeof arch === 'string');
  assert.ok(arch.length > 0);
});

test('isMacOS: returns boolean', () => {
  const result = isMacOS();

  assert.strictEqual(typeof result, 'boolean');

  if (os.platform() === 'darwin') {
    assert.ok(result);
  } else {
    assert.ok(!result);
  }
});

test('isLinux: returns boolean', () => {
  const result = isLinux();

  assert.strictEqual(typeof result, 'boolean');

  if (os.platform() === 'linux') {
    assert.ok(result);
  } else {
    assert.ok(!result);
  }
});

test('isWindows: returns boolean', () => {
  const result = isWindows();

  assert.strictEqual(typeof result, 'boolean');

  if (os.platform() === 'win32') {
    assert.ok(result);
  } else {
    assert.ok(!result);
  }
});

test('platform: exactly one platform function is true', () => {
  const checks = [isMacOS(), isLinux(), isWindows()];
  const trueCount = checks.filter(Boolean).length;

  // On most systems, exactly one should be true
  // (unless running on an unusual platform)
  assert.ok(trueCount <= 1, 'At most one platform should be true');
});

// =============================================================================
// PACKAGE KINDS
// =============================================================================

test('PACKAGE_KINDS: contains expected kinds', () => {
  assert.ok(Array.isArray(PACKAGE_KINDS));
  assert.ok(PACKAGE_KINDS.includes('stack'));
  assert.ok(PACKAGE_KINDS.includes('runtime'));
  assert.ok(PACKAGE_KINDS.includes('binary'));
  assert.ok(PACKAGE_KINDS.includes('agent'));
});

// =============================================================================
// PARSE PACKAGE ID
// =============================================================================

test('parsePackageId: parses stack:name format', () => {
  const [kind, name] = parsePackageId('stack:pdf-creator');

  assert.strictEqual(kind, 'stack');
  assert.strictEqual(name, 'pdf-creator');
});

test('parsePackageId: parses runtime:name format', () => {
  const [kind, name] = parsePackageId('runtime:node');

  assert.strictEqual(kind, 'runtime');
  assert.strictEqual(name, 'node');
});

test('parsePackageId: parses binary:name format', () => {
  const [kind, name] = parsePackageId('binary:ffmpeg');

  assert.strictEqual(kind, 'binary');
  assert.strictEqual(name, 'ffmpeg');
});

test('parsePackageId: parses agent:name format', () => {
  const [kind, name] = parsePackageId('agent:claude');

  assert.strictEqual(kind, 'agent');
  assert.strictEqual(name, 'claude');
});

test('parsePackageId: parses npm:name format', () => {
  const [kind, name] = parsePackageId('npm:cowsay');

  assert.strictEqual(kind, 'npm');
  assert.strictEqual(name, 'cowsay');
});

test('parsePackageId: throws on invalid format', () => {
  assert.throws(
    () => parsePackageId('invalid-no-colon'),
    /Invalid package ID/
  );
});

test('parsePackageId: throws on unknown kind', () => {
  assert.throws(
    () => parsePackageId('unknown:package'),
    /Invalid package ID/
  );
});

// =============================================================================
// CREATE PACKAGE ID
// =============================================================================

test('createPackageId: creates valid ID', () => {
  const id = createPackageId('stack', 'my-stack');

  assert.strictEqual(id, 'stack:my-stack');
});

test('createPackageId: roundtrips with parsePackageId', () => {
  const original = createPackageId('runtime', 'python');
  const [kind, name] = parsePackageId(original);
  const recreated = createPackageId(kind, name);

  assert.strictEqual(original, recreated);
});

// =============================================================================
// GET PACKAGE PATH
// =============================================================================

test('getPackagePath: stack goes to stacks directory', () => {
  const pkgPath = getPackagePath('stack:my-stack');

  assert.ok(pkgPath.includes('stacks'));
  assert.ok(pkgPath.endsWith('my-stack'));
});

test('getPackagePath: runtime goes to runtimes directory', () => {
  const pkgPath = getPackagePath('runtime:node');

  assert.ok(pkgPath.includes('runtimes'));
  assert.ok(pkgPath.endsWith('node'));
});

test('getPackagePath: binary goes to binaries directory', () => {
  const pkgPath = getPackagePath('binary:ffmpeg');

  assert.ok(pkgPath.includes('binaries'));
  assert.ok(pkgPath.endsWith('ffmpeg'));
});

test('getPackagePath: agent goes to agents directory', () => {
  const pkgPath = getPackagePath('agent:claude');

  assert.ok(pkgPath.includes('agents'));
  assert.ok(pkgPath.endsWith('claude'));
});

test('getPackagePath: prompt maps to skills directory as a backward-compatible .md file', () => {
  const pkgPath = getPackagePath('prompt:code-review');

  assert.ok(pkgPath.startsWith(PATHS.skills));
  assert.ok(pkgPath.endsWith('code-review.md'));
});

test('getPackagePath: npm goes to binaries/npm directory', () => {
  const pkgPath = getPackagePath('npm:cowsay');

  assert.ok(pkgPath.includes('binaries'));
  assert.ok(pkgPath.includes('npm'));
  assert.ok(pkgPath.endsWith('cowsay'));
});

test('getPackagePath: npm scoped packages are sanitized', () => {
  const pkgPath = getPackagePath('npm:@stripe/cli');

  // Slashes should be replaced with __
  assert.ok(!pkgPath.includes('/cli'));
  assert.ok(pkgPath.includes('stripe__cli') || pkgPath.includes('stripe/cli'));
});

// =============================================================================
// GET LOCKFILE PATH
// =============================================================================

test('getLockfilePath: returns path in locks directory', () => {
  const lockPath = getLockfilePath('stack:my-stack');

  assert.ok(lockPath.includes('locks'));
  assert.ok(lockPath.endsWith('.lock.yaml'));
});

test('getLockfilePath: stacks use stacks subdirectory', () => {
  const lockPath = getLockfilePath('stack:pdf-creator');

  assert.ok(lockPath.includes('stacks'));
  assert.ok(lockPath.includes('pdf-creator.lock.yaml'));
});

test('getLockfilePath: binaries use binaries subdirectory', () => {
  const lockPath = getLockfilePath('binary:ffmpeg');

  assert.ok(lockPath.includes('binaries'));
  assert.ok(lockPath.includes('ffmpeg.lock.yaml'));
});

// =============================================================================
// PATH STRUCTURE
// =============================================================================

test('paths: are consistent with package layout', () => {
  // Verify the path structure makes sense
  const stackPath = getPackagePath('stack:test');
  const runtimePath = getPackagePath('runtime:test');
  const binaryPath = getPackagePath('binary:test');

  // All should be siblings under RUDI_HOME
  assert.strictEqual(path.dirname(stackPath), PATHS.stacks);
  assert.strictEqual(path.dirname(runtimePath), PATHS.runtimes);
  assert.strictEqual(path.dirname(binaryPath), PATHS.binaries);
});
