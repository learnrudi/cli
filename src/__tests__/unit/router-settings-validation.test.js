import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { loadRouterSettings } from '../../router-settings.js';

function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'rudi-settings-validation-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  return root;
}

test('missing router settings retain the existing defaults', (t) => {
  assert.deepEqual(loadRouterSettings(fixture(t)), {});
});

const invalidSettings = [
  ['unsupported schema', { schemaVersion: 2, stacks: {} }],
  ['array of stacks', { schemaVersion: 1, stacks: [] }],
  ['unknown root field', { schemaVersion: 1, stacks: {}, typo: true }],
  ['invalid stack id', { schemaVersion: 1, stacks: { '../fixture': {} } }],
  ['unknown stack field', { typo: true }],
  ['non-string environment', { env: { MODEL: 42 } }],
  ['invalid environment name', { env: { 'BAD=NAME': 'value' } }],
  ['NUL environment value', { env: { MODEL: 'value\0' } }],
  ['array environment', { env: [] }],
  ['zero timeout', { toolTimeoutMs: { transcribe: 0 } }],
  ['negative timeout', { toolTimeoutMs: { transcribe: -1 } }],
  ['fractional timeout', { toolTimeoutMs: { transcribe: 1.5 } }],
  ['string timeout', { toolTimeoutMs: { transcribe: '900000' } }],
  ['excessive timeout', { toolTimeoutMs: { transcribe: 900001 } }],
  ['blank tool name', { toolTimeoutMs: { ' ': 1000 } }],
  ['control character in tool name', { toolTimeoutMs: { 'tool\nname': 1000 } }],
];

for (const [label, value] of invalidSettings) {
  test(`router settings reject ${label}`, (t) => {
    const root = fixture(t);
    const settings = Object.hasOwn(value, 'schemaVersion')
      ? value : { schemaVersion: 1, stacks: { 'stack:fixture': value } };
    fs.writeFileSync(path.join(root, 'router-settings.json'), JSON.stringify(settings));
    assert.throws(() => loadRouterSettings(root), /Invalid router-settings.json:/);
  });
}

test('oversized settings fail with a bounded diagnostic', (t) => {
  const root = fixture(t);
  fs.writeFileSync(path.join(root, 'router-settings.json'), 'x'.repeat(1024 * 1024 + 1));
  assert.throws(() => loadRouterSettings(root), /file exceeds 1 MiB/);
});

test('unreadable settings are not silently replaced by defaults', (t) => {
  const root = fixture(t);
  fs.mkdirSync(path.join(root, 'router-settings.json'));
  assert.throws(() => loadRouterSettings(root), /Cannot read router-settings.json/);
});
