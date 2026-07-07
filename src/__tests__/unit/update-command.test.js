import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  resolveUpdateTarget,
  runUpdate,
} from '../../commands/update.js';

function createDeps(overrides = {}) {
  const calls = [];
  return {
    calls,
    async fetchIndex(options) {
      calls.push(['fetchIndex', options]);
      return {};
    },
    async listInstalled() {
      calls.push(['listInstalled']);
      return [
        { id: 'stack:video-editor', kind: 'stack', name: 'video-editor' },
        { id: 'runtime:node', kind: 'runtime', name: 'node' },
        { id: 'skill:video-editor', kind: 'skill', name: 'video-editor' },
      ];
    },
    async updatePackage(id, options) {
      calls.push(['updatePackage', id, options]);
      return { success: true, id, path: `/tmp/${id.replace(':', '-')}` };
    },
    async rebuildToolIndex(options) {
      calls.push(['rebuildToolIndex', options]);
      return { indexed: options.stacks.length, failed: 0, index: { byStack: {} } };
    },
    log(message) {
      calls.push(['log', message]);
    },
    error(message) {
      calls.push(['error', message]);
    },
    ...overrides,
  };
}

test('resolveUpdateTarget rejects ambiguous bare package names instead of defaulting to runtime', async () => {
  const deps = createDeps();

  await assert.rejects(
    () => resolveUpdateTarget('video-editor', deps),
    /Ambiguous package "video-editor"/
  );
});

test('runUpdate updates an explicit stack through core installer and rebuilds its tool index', async () => {
  const deps = createDeps();

  const result = await runUpdate(['stack:video-editor'], {}, deps);

  assert.equal(result.updated, 1);
  assert.equal(result.failed, 0);
  const nonLogCalls = deps.calls.filter(call => call[0] !== 'log');
  const indexCall = nonLogCalls.find(call => call[0] === 'rebuildToolIndex');
  assert.equal(typeof indexCall[1].log, 'function');
  delete indexCall[1].log;
  assert.deepEqual(
    nonLogCalls,
    [
      ['listInstalled'],
      ['fetchIndex', { force: true }],
      ['updatePackage', 'stack:video-editor', { preserveState: false }],
      ['rebuildToolIndex', {
        stacks: ['stack:video-editor'],
        timeout: 20000,
        validate: false,
      }],
    ]
  );
});

test('runUpdate preserves install-local state only when explicitly requested', async () => {
  const deps = createDeps();

  await runUpdate(['stack:video-editor'], { 'preserve-state': true }, deps);

  assert.deepEqual(
    deps.calls.find(call => call[0] === 'updatePackage'),
    ['updatePackage', 'stack:video-editor', { preserveState: true }]
  );

  const falseDeps = createDeps();
  await runUpdate(['stack:video-editor'], { 'preserve-state': 'false' }, falseDeps);

  assert.deepEqual(
    falseDeps.calls.find(call => call[0] === 'updatePackage'),
    ['updatePackage', 'stack:video-editor', { preserveState: false }]
  );
});

test('runUpdate reports native skill wrapper sync commands after updating a skill', async () => {
  const deps = createDeps();

  const result = await runUpdate(['skill:video-editor'], {}, deps);

  assert.equal(result.updated, 1);
  assert.deepEqual(
    deps.calls.filter(call => call[0] === 'rebuildToolIndex'),
    []
  );

  const logOutput = deps.calls
    .filter(call => call[0] === 'log')
    .map(call => call[1])
    .join('\n');

  assert.match(logOutput, /rudi skills sync codex --force/);
  assert.match(logOutput, /rudi skills sync claude --force/);
  assert.match(logOutput, /not overwritten automatically/i);
});

test('runUpdate all updates installed packages and rebuilds stack index once', async () => {
  const deps = createDeps();

  const result = await runUpdate([], {}, deps);

  assert.equal(result.updated, 3);
  assert.equal(result.failed, 0);
  assert.deepEqual(
    deps.calls.filter(call => call[0] === 'updatePackage').map(call => call[1]),
    ['stack:video-editor', 'runtime:node', 'skill:video-editor']
  );
  assert.equal(
    deps.calls.filter(call => call[0] === 'rebuildToolIndex').length,
    1
  );
  assert.deepEqual(
    deps.calls.find(call => call[0] === 'rebuildToolIndex')[1].stacks,
    ['stack:video-editor']
  );
});

test('runUpdate fails explicit updates for packages that are not installed', async () => {
  const deps = createDeps();

  await assert.rejects(
    () => runUpdate(['stack:not-installed'], {}, deps),
    /Package not installed: stack:not-installed/
  );
});
