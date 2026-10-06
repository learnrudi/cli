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
  assert.equal(pkg.engines.node, '^22.0.0 || ^24.0.0');
  const { isSupportedNodeVersion } = await import('../../commands/doctor.js');
  for (const version of ['v22.23.2', 'v24.21.0', '24.21.0']) {
    assert.equal(isSupportedNodeVersion(version), true, version);
  }
  for (const version of ['v18.0.0', 'v20.10.0', 'v25.2.1', 'v26.10.0', 'v24.0.0-rc.1', '24garbage', '', null]) {
    assert.equal(isSupportedNodeVersion(version), false, String(version));
  }
});
