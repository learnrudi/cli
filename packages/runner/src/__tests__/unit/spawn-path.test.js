import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const CLI_ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '../../../../..');

test('buildStackRunEnv exposes RUDI-managed binary directories on PATH', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'rudi-runner-path-'));
  const rudiHome = path.join(root, '.rudi');
  const binaryRoot = path.join(rudiHome, 'binaries', 'provided-tool');

  fs.mkdirSync(binaryRoot, { recursive: true });

  try {
    const output = execFileSync(process.execPath, ['--input-type=module', '-e', `
      const { buildStackRunEnv } = await import('@learnrudi/runner/spawn');
      const env = buildStackRunEnv({
        baseEnv: { PATH: '/usr/bin' },
        env: {},
        secrets: {},
        inputs: {},
        id: 'stack:path-demo',
        packagePath: '/tmp/path-demo'
      });
      console.log(JSON.stringify({ path: env.PATH }));
    `], {
      cwd: CLI_ROOT,
      env: {
        ...process.env,
        RUDI_HOME: rudiHome,
      },
      encoding: 'utf8',
    });

    const result = JSON.parse(output.trim().split(/\r?\n/).at(-1));
    const entries = result.path.split(path.delimiter);

    assert.equal(entries.includes(path.join(rudiHome, 'bins')), true);
    assert.equal(entries.includes(binaryRoot), true);
    assert.equal(entries.at(-1), '/usr/bin');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
