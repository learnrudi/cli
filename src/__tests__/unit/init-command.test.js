import { execFileSync } from 'node:child_process';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

test('init bootstraps core local home without touching legacy database state', (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'rudi-init-core-'));
  const rudiHome = path.join(root, '.rudi');
  const home = path.join(root, 'home');
  fs.mkdirSync(home, { recursive: true });
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));

  const output = execFileSync(
    process.execPath,
    ['src/index.js', 'init', '--skip-downloads', '--no-agent-instructions'],
    {
      cwd: process.cwd(),
      env: {
        ...process.env,
        HOME: home,
        RUDI_HOME: rudiHome,
      },
      encoding: 'utf-8',
    }
  );

  assert.match(output, /RUDI Initialization/);
  assert.doesNotMatch(output, /Checking database|Database created|Database exists|Database error/);
  assert.equal(fs.existsSync(path.join(rudiHome, 'rudi.db')), false);
  assert.equal(fs.existsSync(path.join(rudiHome, 'settings.json')), true);
  assert.equal(fs.existsSync(path.join(rudiHome, 'stacks')), true);
  assert.equal(fs.existsSync(path.join(rudiHome, 'skills')), true);
});
