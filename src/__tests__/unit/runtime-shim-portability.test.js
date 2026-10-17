import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';

const runtimeTargets = {
  node: 'runtimes/node/bin/node',
  npm: 'runtimes/node/bin/npm',
  npx: 'runtimes/node/bin/npx',
  python: 'runtimes/python/bin/python3',
  python3: 'runtimes/python/bin/python3',
  pip: 'runtimes/python/bin/pip3',
  pip3: 'runtimes/python/bin/pip3',
};

function checkPortableShims(t, args) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'rudi portable shims '));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const rudiHome = path.join(root, 'original home');
  const mountedHome = path.join(root, 'RUDI Runtime');
  const bins = path.join(rudiHome, 'bins');
  fs.mkdirSync(bins, { recursive: true });
  const payload = '#!/bin/sh\necho portable-runtime-fixture\n';
  const identities = new Map();
  for (const target of new Set(Object.values(runtimeTargets))) {
    const fullTarget = path.join(rudiHome, target);
    fs.mkdirSync(path.dirname(fullTarget), { recursive: true });
    fs.writeFileSync(fullTarget, payload, { mode: 0o755 });
    identities.set(target, fs.statSync(fullTarget).ino);
  }
  fs.symlinkSync(path.join(rudiHome, runtimeTargets.node), path.join(bins, 'node'));
  for (let attempt = 0; attempt < 2; attempt++) {
    const result = spawnSync(process.execPath, ['src/index.js', ...args], {
      cwd: process.cwd(), encoding: 'utf8', timeout: 20_000,
      env: { ...process.env, RUDI_HOME: rudiHome },
    });
    assert.equal(result.status, 0, result.stderr || result.stdout);
  }
  fs.renameSync(rudiHome, mountedHome);
  for (const [name, target] of Object.entries(runtimeTargets)) {
    const shim = path.join(mountedHome, 'bins', name);
    assert.equal(fs.readFileSync(shim, 'utf8'), payload, name);
    assert.equal(fs.statSync(shim).ino, identities.get(target), name);
    assert.equal(path.isAbsolute(fs.readlinkSync(shim)), false, name);
    assert.equal(execFileSync(shim, { encoding: 'utf8' }).trim(), 'portable-runtime-fixture');
  }
}

test('rebuilt runtime shortcuts survive a different home or share mount path', { skip: process.platform === 'win32' }, (t) => {
  checkPortableShims(t, ['shims', 'rebuild']);
});

test('initialized runtime shortcuts survive a different home or share mount path', { skip: process.platform === 'win32' }, (t) => {
  checkPortableShims(t, ['init', '--with-shims', '--skip-downloads', '--no-agent-instructions']);
});
