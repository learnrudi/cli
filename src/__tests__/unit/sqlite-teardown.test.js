import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';

test('SQLite objects survive allocation-driven garbage collection and process teardown', () => {
  const result = spawnSync(process.execPath, [
    '--max-semi-space-size=1',
    'scripts/verify-sqlite-teardown.mjs',
  ], { cwd: process.cwd(), encoding: 'utf8', timeout: 30_000 });
  assert.equal(result.signal, null, result.stderr);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /sqlite teardown passed/);
});
