import { after, before, beforeEach, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';

const originalHome = process.env.HOME;
const originalFetch = global.fetch;
const originalLog = console.log;
const originalError = console.error;
const tempRoot = path.resolve(process.cwd(), 'tmp');
fs.mkdirSync(tempRoot, { recursive: true });
const tempHomeRoot = fs.mkdtempSync(path.join(tempRoot, 'run-group-command-test-'));
const rudiHome = path.join(tempHomeRoot, '.rudi');
const portFile = path.join(rudiHome, '.rudi-lite-port');
const tokenFile = path.join(rudiHome, '.rudi-lite-token');

let cmdRunGroup;
let selectDefaultMergeSessionIds;
let fetchCalls = [];
let consoleLines = [];

function installFetchStub(handlers) {
  fetchCalls = [];
  global.fetch = async (url, options = {}) => {
    const next = handlers[fetchCalls.length];
    fetchCalls.push({
      url: String(url),
      method: options.method || 'GET',
      headers: options.headers || {},
      body: options.body || null,
    });

    if (typeof next === 'function') {
      return next(url, options);
    }

    return {
      ok: true,
      status: 200,
      async text() {
        return JSON.stringify(next ?? {});
      },
    };
  };
}

before(async () => {
  process.env.HOME = tempHomeRoot;
  ({ cmdRunGroup, selectDefaultMergeSessionIds } = await import('../../commands/run-group.js'));
});

beforeEach(() => {
  fs.rmSync(rudiHome, { recursive: true, force: true });
  fs.mkdirSync(rudiHome, { recursive: true });
  fs.writeFileSync(portFile, '8123');
  fs.writeFileSync(tokenFile, 'test-token');

  consoleLines = [];
  console.log = (...args) => {
    consoleLines.push(args.join(' '));
  };
  console.error = (...args) => {
    consoleLines.push(args.join(' '));
  };
  global.fetch = originalFetch;
  process.exitCode = undefined;
});

after(async () => {
  console.log = originalLog;
  console.error = originalError;
  global.fetch = originalFetch;
  process.env.HOME = originalHome;
  await fsp.rm(tempHomeRoot, { recursive: true, force: true });
});

describe('run-group command', () => {
  test('selectDefaultMergeSessionIds keeps only completed sessions without validation failure', () => {
    const sessionIds = selectDefaultMergeSessionIds([
      { id: 'session-1', status: 'completed', validation_passed: true },
      { id: 'session-2', status: 'completed', validation_passed: null },
      { id: 'session-3', status: 'failed', validation_passed: true },
      { id: 'session-4', status: 'completed', validation_passed: false },
    ]);

    assert.deepEqual(sessionIds, ['session-1', 'session-2']);
  });

  test('list emits JSON and forwards filters to the sidecar', async () => {
    installFetchStub([{
      groups: [{ id: 'group-1', status: 'running' }],
    }]);

    await cmdRunGroup(['list'], { json: true, status: 'running', limit: '5' });

    assert.equal(fetchCalls.length, 1);
    const requestUrl = new URL(fetchCalls[0].url);
    assert.equal(requestUrl.pathname, '/agent/run-groups');
    assert.equal(requestUrl.searchParams.get('status'), 'running');
    assert.equal(requestUrl.searchParams.get('limit'), '5');
    assert.deepEqual(JSON.parse(consoleLines[0]), {
      groups: [{ id: 'group-1', status: 'running' }],
    });
  });

  test('merge defaults to completed validated sessions and posts target branch', async () => {
    installFetchStub([
      {
        group: { id: 'group-1' },
        sessions: [
          { id: 'session-ok', status: 'completed', validation_passed: true },
          { id: 'session-pending', status: 'running', validation_passed: null },
          { id: 'session-bad', status: 'completed', validation_passed: false },
        ],
      },
      {
        results: [
          { sessionId: 'session-ok', branch: 'dev-session-ok', ok: true },
        ],
      },
    ]);

    await cmdRunGroup(['merge', 'group-1'], { to: 'dev' });

    assert.equal(fetchCalls.length, 2);
    assert.equal(new URL(fetchCalls[0].url).pathname, '/agent/run-group/group-1');
    assert.equal(new URL(fetchCalls[1].url).pathname, '/agent/run-group/group-1/merge');
    assert.deepEqual(JSON.parse(fetchCalls[1].body), {
      sessionIds: ['session-ok'],
      targetBranch: 'dev',
    });
    assert.match(consoleLines.join('\n'), /session-ok: ok/);
  });

  test('cleanup forwards deleteBranches flag and can emit JSON', async () => {
    installFetchStub([{
      ok: true,
      cleaned: 2,
      errors: [],
    }]);

    await cmdRunGroup(['cleanup', 'group-1'], { json: true, 'delete-branches': true });

    assert.equal(fetchCalls.length, 1);
    assert.equal(new URL(fetchCalls[0].url).pathname, '/agent/run-group/group-1/cleanup');
    assert.deepEqual(JSON.parse(fetchCalls[0].body), {
      deleteBranches: true,
    });
    assert.deepEqual(JSON.parse(consoleLines[0]), {
      ok: true,
      cleaned: 2,
      errors: [],
    });
  });
});
