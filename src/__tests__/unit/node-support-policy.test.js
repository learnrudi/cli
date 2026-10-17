import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

function doctorForVersion(version) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'rudi-node-policy-'));
  try {
    const code = `Object.defineProperty(process, 'version', { value: ${JSON.stringify(version)} });
      const { cmdDoctor } = await import('./src/commands/doctor.js');
      await cmdDoctor([], {});`;
    const result = spawnSync(process.execPath, ['--input-type=module', '-e', code], {
      cwd: process.cwd(), encoding: 'utf8', timeout: 15_000,
      env: { ...process.env, RUDI_HOME: root, PATH: '/usr/bin:/bin' },
    });
    assert.equal(result.status, 0, result.stderr);
    return result.stdout;
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

test('doctor identifies Node 20 as outside the supported CLI runtime policy', () => {
  const output = doctorForVersion('v20.10.0');
  assert.match(output, /✗ Node\.js: v20\.10\.0/);
  assert.match(output, /supported.*22.*24/i);
});

test('package metadata and doctor agree on the supported stable Node majors', async () => {
  const pkg = JSON.parse(fs.readFileSync('package.json', 'utf8'));
  assert.equal(pkg.engines.node, '^22.0.0 || ^24.22.0');
  const { isSupportedNodeVersion } = await import('../../commands/doctor.js');
  for (const version of ['v22.23.2', 'v24.22.0', '24.22.1']) {
    assert.equal(isSupportedNodeVersion(version), true, version);
  }
  for (const version of ['v18.0.0', 'v20.10.0', 'v24.18.1', 'v24.19.0', 'v24.21.0', 'v25.2.1', 'v26.10.0', 'v24.22.0-rc.1', '24garbage', '', null]) {
    assert.equal(isSupportedNodeVersion(version), false, String(version));
  }
});

test('doctor rejects Node 24 releases before the native cleanup correction', () => {
  const output = doctorForVersion('v24.21.0');
  assert.match(output, /✗ Node\.js: v24\.21\.0/);
  assert.match(output, /24\.22/);
});

test('Agent Host rejects an unsafe Node runtime before creating database files', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'rudi-node-admission-'));
  try {
    const databasePath = path.join(root, 'absent', 'agent-hosts.db');
    const code = `
      import assert from 'node:assert/strict';
      Object.defineProperty(process, 'version', { value: 'v24.21.0' });
      const { createLaunchStore } = await import('./src/agent-host/launch-store.js');
      assert.throws(() => createLaunchStore({ databasePath: ${JSON.stringify(databasePath)} }),
        { code: 'RUDI_UNSUPPORTED_NODE' });
    `;
    const result = spawnSync(process.execPath, ['--input-type=module', '-e', code], {
      cwd: process.cwd(), encoding: 'utf8', timeout: 15_000,
    });
    assert.equal(result.status, 0, result.stderr);
    assert.equal(fs.existsSync(path.dirname(databasePath)), false);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
