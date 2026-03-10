/**
 * Unit tests for stack lifecycle checks
 * Tests checkInstalled, checkLaunchable, checkSecretsReady, checkMcpReady, checkIndexed, checkStackLifecycle
 */

import { test } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {
  checkInstalled,
  checkLaunchable,
  checkSecretsReady,
  checkMcpReady,
  checkIndexed,
  checkStackLifecycle
} from '../../stack-lifecycle.js';

// =============================================================================
// checkInstalled
// =============================================================================

test('checkInstalled: passes with valid stack config', () => {
  // Create temp directory with manifest.json
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'stack-test-'));
  fs.writeFileSync(path.join(tmpDir, 'manifest.json'), '{}');

  const config = {
    path: tmpDir,
    installed: true
  };

  const result = checkInstalled('test-stack', config);

  assert.strictEqual(result.passed, true);
  assert.strictEqual(result.state, 'installed');
  assert.strictEqual(result.error, null);
  assert.strictEqual(result.details.path, tmpDir);

  // Cleanup
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

test('checkInstalled: fails when installed is false', () => {
  const config = {
    path: '/tmp',
    installed: false
  };

  const result = checkInstalled('test-stack', config);

  assert.strictEqual(result.passed, false);
  assert.strictEqual(result.state, 'installed');
  assert.ok(result.error.includes('not marked as installed'));
  assert.strictEqual(result.details.path, '/tmp');
});

test('checkInstalled: fails when path does not exist', () => {
  const config = {
    path: '/nonexistent/path/that/does/not/exist',
    installed: true
  };

  const result = checkInstalled('test-stack', config);

  assert.strictEqual(result.passed, false);
  assert.strictEqual(result.state, 'installed');
  assert.ok(result.error.includes('directory not found'));
  assert.strictEqual(result.details.path, '/nonexistent/path/that/does/not/exist');
});

test('checkInstalled: fails when manifest.json is missing', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'stack-test-'));

  const config = {
    path: tmpDir,
    installed: true
  };

  const result = checkInstalled('test-stack', config);

  assert.strictEqual(result.passed, false);
  assert.strictEqual(result.state, 'installed');
  assert.ok(result.error.includes('manifest.json not found'));
  assert.strictEqual(result.details.path, tmpDir);

  // Cleanup
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

// =============================================================================
// checkLaunchable
// =============================================================================

test('checkLaunchable: passes when binary exists and is executable', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'stack-test-'));

  const config = {
    path: tmpDir,
    launch: {
      bin: '/usr/bin/env',
      args: ['node'],
      cwd: tmpDir
    }
  };

  const result = checkLaunchable('test-stack', config);

  assert.strictEqual(result.passed, true);
  assert.strictEqual(result.state, 'launchable');
  assert.strictEqual(result.error, null);
  assert.strictEqual(result.details.bin, '/usr/bin/env');
  assert.strictEqual(result.details.cwd, tmpDir);

  // Cleanup
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

test('checkLaunchable: fails when binary does not exist', () => {
  const config = {
    path: '/tmp',
    launch: {
      bin: '/nonexistent/binary',
      args: [],
      cwd: '/tmp'
    }
  };

  const result = checkLaunchable('test-stack', config);

  assert.strictEqual(result.passed, false);
  assert.strictEqual(result.state, 'launchable');
  assert.ok(result.error.includes('bin not found'));
  assert.strictEqual(result.details.bin, '/nonexistent/binary');
  assert.strictEqual(result.details.cwd, '/tmp');
});

test('checkLaunchable: fails when cwd does not exist', () => {
  const config = {
    path: '/tmp',
    launch: {
      bin: '/usr/bin/env',
      args: ['node'],
      cwd: '/nonexistent/working/directory'
    }
  };

  const result = checkLaunchable('test-stack', config);

  assert.strictEqual(result.passed, false);
  assert.strictEqual(result.state, 'launchable');
  assert.ok(result.error.includes('cwd directory not found'));
  assert.strictEqual(result.details.bin, '/usr/bin/env');
  assert.strictEqual(result.details.cwd, '/nonexistent/working/directory');
});

test('checkLaunchable: fails when no launch config', () => {
  const config = {
    path: '/tmp'
    // No launch property
  };

  const result = checkLaunchable('test-stack', config);

  assert.strictEqual(result.passed, false);
  assert.strictEqual(result.state, 'launchable');
  assert.ok(result.error.includes('No launch configuration'));
  assert.strictEqual(result.details.bin, null);
  assert.strictEqual(result.details.cwd, null);
});

// =============================================================================
// checkSecretsReady
// =============================================================================

test('checkSecretsReady: passes when no required secrets defined', async () => {
  const config = {
    path: '/tmp',
    secrets: []
  };

  const result = await checkSecretsReady('test-stack', config);

  assert.strictEqual(result.passed, true);
  assert.strictEqual(result.state, 'secrets_ready');
  assert.strictEqual(result.error, null);
  assert.deepStrictEqual(result.details.missing, []);
  assert.strictEqual(result.details.checked, 0);
});

test('checkSecretsReady: passes when secrets is undefined', async () => {
  const config = {
    path: '/tmp'
    // No secrets property
  };

  const result = await checkSecretsReady('test-stack', config);

  assert.strictEqual(result.passed, true);
  assert.strictEqual(result.state, 'secrets_ready');
  assert.strictEqual(result.error, null);
  assert.deepStrictEqual(result.details.missing, []);
  assert.strictEqual(result.details.checked, 0);
});

test('checkSecretsReady: fails when required secret is missing', async () => {
  const config = {
    path: '/tmp',
    secrets: [
      { name: 'NONEXISTENT_SECRET_FOR_TESTING', required: true }
    ]
  };

  const result = await checkSecretsReady('test-stack', config);

  assert.strictEqual(result.passed, false);
  assert.strictEqual(result.state, 'secrets_ready');
  assert.ok(result.error.includes('Missing required secrets'));
  assert.ok(result.error.includes('NONEXISTENT_SECRET_FOR_TESTING'));
  assert.ok(result.details.missing.includes('NONEXISTENT_SECRET_FOR_TESTING'));
  assert.strictEqual(result.details.checked, 1);
});

// =============================================================================
// checkMcpReady
// =============================================================================

test('checkMcpReady: returns expected shape with toolCount', async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'stack-test-'));

  const config = {
    path: tmpDir,
    launch: {
      bin: '/usr/bin/env',
      args: ['node'],
      cwd: tmpDir
    }
  };

  const result = await checkMcpReady('test-stack', config, { timeout: 1000 });

  assert.ok(result.hasOwnProperty('passed'));
  assert.ok(result.hasOwnProperty('state'));
  assert.strictEqual(result.state, 'mcp_ready');
  assert.ok(result.hasOwnProperty('error'));
  assert.ok(result.hasOwnProperty('details'));
  assert.ok(result.details.hasOwnProperty('toolCount'));
  assert.ok(result.details.hasOwnProperty('tools'));
  assert.ok(Array.isArray(result.details.tools));

  // Cleanup
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

test('checkMcpReady: handles errors from discoverStackTools', async () => {
  const config = {
    path: '/tmp',
    launch: {
      bin: '/nonexistent/binary',
      args: [],
      cwd: '/tmp'
    }
  };

  const result = await checkMcpReady('test-stack', config, { timeout: 1000 });

  // Should handle the error gracefully
  assert.ok(result.hasOwnProperty('passed'));
  assert.strictEqual(result.state, 'mcp_ready');
  assert.ok(result.hasOwnProperty('error'));
  assert.strictEqual(result.details.toolCount, 0);
  assert.deepStrictEqual(result.details.tools, []);
});

// =============================================================================
// checkIndexed
// =============================================================================

test('checkIndexed: fails when stack not in index', () => {
  const config = {
    path: '/tmp'
  };

  const result = checkIndexed('nonexistent-stack-for-testing', config);

  assert.strictEqual(result.passed, false);
  assert.strictEqual(result.state, 'indexed');
  assert.ok(result.error.includes('not found in tool index'));
  assert.strictEqual(result.details.toolCount, 0);
  assert.ok(result.details.hasOwnProperty('indexPath'));
});

// =============================================================================
// checkStackLifecycle
// =============================================================================

test('checkStackLifecycle: stops at first failure', async () => {
  const config = {
    path: '/tmp',
    installed: false
  };

  const result = await checkStackLifecycle('test-stack', config);

  assert.strictEqual(result.stackId, 'test-stack');
  assert.strictEqual(result.healthy, false);
  assert.strictEqual(result.finalState, null); // No state passed, so finalState is null
  assert.strictEqual(result.failedAt, 'installed');
  assert.strictEqual(result.checks.length, 1);
  assert.strictEqual(result.fixCommand, 'rudi install stack:test-stack');
});

test('checkStackLifecycle: returns correct shape', async () => {
  const config = {
    path: '/tmp',
    installed: false
  };

  const result = await checkStackLifecycle('test-stack', config);

  assert.ok(result.hasOwnProperty('stackId'));
  assert.ok(result.hasOwnProperty('finalState'));
  assert.ok(result.hasOwnProperty('healthy'));
  assert.ok(result.hasOwnProperty('checks'));
  assert.ok(result.hasOwnProperty('failedAt'));
  assert.ok(result.hasOwnProperty('fixCommand'));
  assert.ok(Array.isArray(result.checks));
});

test('checkStackLifecycle: returns correct fixCommand for installed failure', async () => {
  const config = {
    path: '/tmp',
    installed: false
  };

  const result = await checkStackLifecycle('test-stack', config);

  assert.strictEqual(result.fixCommand, 'rudi install stack:test-stack');
});

test('checkStackLifecycle: passes multiple checks until failure', async () => {
  // Create valid installed stack that fails at launchable
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'stack-test-'));
  fs.writeFileSync(path.join(tmpDir, 'manifest.json'), '{}');

  const config = {
    path: tmpDir,
    installed: true,
    launch: {
      bin: '/nonexistent/binary',
      args: [],
      cwd: tmpDir
    }
  };

  const result = await checkStackLifecycle('test-stack', config);

  assert.strictEqual(result.healthy, false);
  assert.strictEqual(result.finalState, 'installed'); // Last PASSED state
  assert.strictEqual(result.failedAt, 'launchable');
  assert.ok(result.checks.length >= 2); // Should have passed installed, failed at launchable
  assert.strictEqual(result.checks[0].passed, true); // Installed passed
  assert.strictEqual(result.checks[0].state, 'installed');
  assert.strictEqual(result.checks[1].passed, false); // Launchable failed
  assert.strictEqual(result.checks[1].state, 'launchable');
  assert.strictEqual(result.fixCommand, 'Check stack runtime and launch configuration');

  // Cleanup
  fs.rmSync(tmpDir, { recursive: true, force: true });
});
