import { test } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

test('home json explains active lifecycle categories without secret values', async () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'rudi-home-command-'));
  const rudiHome = path.join(tempRoot, '.rudi');
  process.env.RUDI_HOME = rudiHome;

  fs.mkdirSync(path.join(rudiHome, 'stacks', 'google-workspace'), { recursive: true });
  fs.mkdirSync(path.join(rudiHome, 'state', 'stacks', 'google-workspace'), { recursive: true });
  fs.mkdirSync(path.join(rudiHome, 'logs'), { recursive: true });
  fs.mkdirSync(path.join(rudiHome, 'bins'), { recursive: true });
  fs.mkdirSync(path.join(rudiHome, 'binaries', 'large-tool'), { recursive: true });
  const targetPath = path.join(rudiHome, 'binaries', 'large-tool', 'large-tool');
  fs.writeFileSync(targetPath, Buffer.alloc(1024 * 1024));
  if (process.platform !== 'win32') {
    fs.symlinkSync(targetPath, path.join(rudiHome, 'bins', 'large-tool'));
  }
  fs.writeFileSync(path.join(rudiHome, 'secrets.json'), JSON.stringify({ API_TOKEN: 'do-not-print' }));
  fs.writeFileSync(path.join(rudiHome, 'logs', 'daemon.err.log'), 'error line\n');

  const { cmdHome } = await import('../../commands/home.js');
  const originalLog = console.log;
  const output = [];
  console.log = (...args) => output.push(args.join(' '));

  try {
    await cmdHome([], { json: true });
  } finally {
    console.log = originalLog;
    fs.rmSync(tempRoot, { recursive: true, force: true });
    delete process.env.RUDI_HOME;
  }

  const rendered = output.join('\n');
  assert.doesNotMatch(rendered, /^═/u, 'json mode should not print a decorative header');
  assert.doesNotMatch(rendered, /do-not-print/u, 'secret values must not appear in home output');

  const data = JSON.parse(rendered);
  assert.equal(data.entries.state.lifecycle, 'persistent-state');
  assert.equal(data.entries.state.sensitivity, 'sensitive');
  assert.equal(data.entries.secretsJson.lifecycle, 'secret-store');
  assert.equal(data.entries.secretsJson.sensitivity, 'secret');
  assert.equal(data.entries.logs.lifecycle, 'operational-logs');
  assert.equal(data.entries.logs.cleanable, 'rotate-or-archive');
  if (process.platform !== 'win32') {
    assert.ok(data.entries.bins.size < 1024 * 16, 'bins size should count the symlink, not its target');
  }
});
