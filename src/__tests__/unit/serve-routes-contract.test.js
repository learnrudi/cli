import { test, describe, after } from 'node:test';
import assert from 'node:assert';
import fs from 'fs';
import fsp from 'fs/promises';
import path from 'path';
import os from 'os';
import { createMockCtx, createMockRes, createMockReq, parseResBody } from '../helpers/serve-mocks.js';
import { buildLogsRoutes } from '../../commands/serve/routes/logs.js';
import { buildShellRoutes } from '../../commands/serve/routes/shell.js';
import { buildSuggestRoutes } from '../../commands/serve/routes/suggest.js';
import { buildTerminalRoutes } from '../../commands/serve/routes/terminal.js';
import { buildProviderRoutes } from '../../commands/serve/routes/providers.js';

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'serve-routes-test-'));

after(async () => {
  await fsp.rm(tmpDir, { recursive: true, force: true });
});

function assertErrorBody(res, expected) {
  assert.deepStrictEqual(parseResBody(res), expected);
}

// ---------------------------------------------------------------------------
// logs.js
// ---------------------------------------------------------------------------

describe('buildLogsRoutes', () => {
  test('GET /logs returns logs array', async () => {
    const ctx = createMockCtx();
    ctx.log('src', 'info', 'hello');
    ctx.log('src', 'warn', 'uh oh');
    const { handle } = buildLogsRoutes(ctx);
    const { req, url } = createMockReq('GET', '/logs');
    const res = createMockRes();
    const handled = await handle(req, res, url);
    assert.strictEqual(handled, true);
    const body = parseResBody(res);
    assert.strictEqual(body.logs.length, 2);
  });

  test('GET /logs?source=x filters by source', async () => {
    const ctx = createMockCtx();
    ctx.log('alpha', 'info', 'a');
    ctx.log('beta', 'info', 'b');
    ctx.log('alpha', 'info', 'c');
    const { handle } = buildLogsRoutes(ctx);
    const { req, url } = createMockReq('GET', '/logs', { query: 'source=alpha' });
    const res = createMockRes();
    await handle(req, res, url);
    const body = parseResBody(res);
    assert.strictEqual(body.logs.length, 2);
    assert.ok(body.logs.every(e => e.source === 'alpha'));
  });

  test('GET /logs?level=error filters by level', async () => {
    const ctx = createMockCtx();
    ctx.log('src', 'info', 'ok');
    ctx.log('src', 'error', 'bad');
    const { handle } = buildLogsRoutes(ctx);
    const { req, url } = createMockReq('GET', '/logs', { query: 'level=error' });
    const res = createMockRes();
    await handle(req, res, url);
    const body = parseResBody(res);
    assert.strictEqual(body.logs.length, 1);
    assert.strictEqual(body.logs[0].level, 'error');
  });

  test('GET /logs?limit=2 limits results', async () => {
    const ctx = createMockCtx();
    for (let i = 0; i < 5; i++) ctx.log('src', 'info', `msg-${i}`);
    const { handle } = buildLogsRoutes(ctx);
    const { req, url } = createMockReq('GET', '/logs', { query: 'limit=2' });
    const res = createMockRes();
    await handle(req, res, url);
    const body = parseResBody(res);
    assert.strictEqual(body.logs.length, 2);
    // should be the last 2
    assert.strictEqual(body.logs[0].message, 'msg-3');
    assert.strictEqual(body.logs[1].message, 'msg-4');
  });

  test('POST /logs adds entry via ctx.log', async () => {
    const ctx = createMockCtx();
    const { handle } = buildLogsRoutes(ctx);
    const { req, url } = createMockReq('POST', '/logs', {
      body: { source: 'frontend', level: 'warn', message: 'clicked' },
    });
    const res = createMockRes();
    await handle(req, res, url);
    const body = parseResBody(res);
    assert.deepStrictEqual(body, { ok: true });
    assert.strictEqual(ctx._logs.length, 1);
    assert.strictEqual(ctx._logs[0].message, 'clicked');
  });

  test('GET /logs/stream returns SSE headers and adds res to sseClients', async () => {
    const ctx = createMockCtx();
    const sseClients = ctx.getSseClients();
    const { handle } = buildLogsRoutes(ctx);
    const res = createMockRes();
    const { req, url } = createMockReq('GET', '/logs/stream');
    req.on = (event, cb) => {}; // stub req.on for close/error
    const handled = await handle(req, res, url);
    assert.strictEqual(handled, true);
    assert.strictEqual(res.state.statusCode, 200);
    assert.strictEqual(res.state.headers['Content-Type'], 'text/event-stream');
    assert.ok(sseClients.includes(res));
    // first write should be a connected message
    assert.ok(res.state.writtenChunks[0].includes('"type":"connected"'));
  });

  test('GET /logs/stream returns 429 at SSE_CLIENT_CAP', async () => {
    const ctx = createMockCtx({ SSE_CLIENT_CAP: 2 });
    const sseClients = ctx.getSseClients();
    sseClients.push({}, {}); // fill to cap
    const { handle } = buildLogsRoutes(ctx);
    const { req, url } = createMockReq('GET', '/logs/stream');
    const res = createMockRes();
    await handle(req, res, url);
    assert.strictEqual(res.state.statusCode, 429);
  });

  test('unmatched path returns false', async () => {
    const ctx = createMockCtx();
    const { handle } = buildLogsRoutes(ctx);
    const { req, url } = createMockReq('GET', '/nope');
    const res = createMockRes();
    const handled = await handle(req, res, url);
    assert.strictEqual(handled, false);
  });
});

// ---------------------------------------------------------------------------
// shell.js
// ---------------------------------------------------------------------------

describe('buildShellRoutes', () => {
  test('POST /shell/reveal missing path returns error', async () => {
    const ctx = createMockCtx();
    const { handle } = buildShellRoutes(ctx);
    const { req, url } = createMockReq('POST', '/shell/reveal', { body: {} });
    const res = createMockRes();
    await handle(req, res, url);
    assert.strictEqual(res.state.statusCode, 400);
    assertErrorBody(res, {
      error: 'path required',
      code: 'MISSING_REQUIRED_FIELD',
      details: { field: 'path', location: 'body' },
    });
  });

  test('POST /shell/open missing path returns error', async () => {
    const ctx = createMockCtx();
    const { handle } = buildShellRoutes(ctx);
    const { req, url } = createMockReq('POST', '/shell/open', { body: { app: 'vscode' } });
    const res = createMockRes();
    await handle(req, res, url);
    assert.strictEqual(res.state.statusCode, 400);
    assertErrorBody(res, {
      error: 'path required',
      code: 'MISSING_REQUIRED_FIELD',
      details: { field: 'path', location: 'body' },
    });
  });

  test('POST /shell/open missing app returns error', async () => {
    const ctx = createMockCtx();
    const { handle } = buildShellRoutes(ctx);
    const { req, url } = createMockReq('POST', '/shell/open', { body: { path: '/tmp' } });
    const res = createMockRes();
    await handle(req, res, url);
    assert.strictEqual(res.state.statusCode, 400);
    assertErrorBody(res, {
      error: 'app required',
      code: 'MISSING_REQUIRED_FIELD',
      details: { field: 'app', location: 'body' },
    });
  });

  test('POST /shell/open rejects relative path before app validation', async () => {
    const ctx = createMockCtx();
    const { handle } = buildShellRoutes(ctx);
    const { req, url } = createMockReq('POST', '/shell/open', {
      body: { path: 'relative.txt', app: 'notepad' },
    });
    const res = createMockRes();
    await handle(req, res, url);
    assert.strictEqual(res.state.statusCode, 400);
    assertErrorBody(res, {
      error: 'path must be an absolute filesystem path',
      code: 'INVALID_FIELD',
      details: { field: 'path', location: 'body', reason: 'absolute_path_required' },
    });
  });

  test('POST /shell/reveal rejects missing filesystem path', async () => {
    const ctx = createMockCtx();
    const { handle } = buildShellRoutes(ctx);
    const missingPath = path.join(tmpDir, 'missing-shell-target');
    const { req, url } = createMockReq('POST', '/shell/reveal', {
      body: { path: missingPath },
    });
    const res = createMockRes();
    await handle(req, res, url);
    assert.strictEqual(res.state.statusCode, 400);
    assertErrorBody(res, {
      error: 'path must reference an existing filesystem path',
      code: 'INVALID_FIELD',
      details: { field: 'path', location: 'body', reason: 'path_not_found' },
    });
  });

  test('POST /shell/open unknown app returns error', async () => {
    const ctx = createMockCtx();
    const { handle } = buildShellRoutes(ctx);
    const { req, url } = createMockReq('POST', '/shell/open', {
      body: { path: '/tmp', app: 'notepad' },
    });
    const res = createMockRes();
    await handle(req, res, url);
    assert.strictEqual(res.state.statusCode, 400);
    assertErrorBody(res, {
      error: 'unknown app: notepad',
      code: 'INVALID_FIELD',
      details: { field: 'app', location: 'body', reason: 'unsupported_value', value: 'notepad' },
    });
  });

  test('POST /shell/open terminal quotes path for shell evaluation', async () => {
    const ctx = createMockCtx();
    const spawned = [];
    const spawn = (command, args) => {
      spawned.push({ command, args });
      return {
        stderr: { on() {} },
        on() {},
        unref() {},
      };
    };
    const { handle } = buildShellRoutes(ctx, { spawn });
    const riskyPath = path.join(tmpDir, 'terminal path $(touch should-not-run)');
    await fsp.mkdir(riskyPath, { recursive: true });
    const { req, url } = createMockReq('POST', '/shell/open', {
      body: { path: riskyPath, app: 'terminal' },
    });
    const res = createMockRes();
    await handle(req, res, url);
    assert.strictEqual(res.state.statusCode, 200);
    assert.strictEqual(spawned.length, 1);
    assert.strictEqual(spawned[0].command, 'osascript');
    const script = spawned[0].args[1];
    assert.match(script, /quoted form of POSIX path/);
    assert.doesNotMatch(script, new RegExp(`cd ${riskyPath.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`));
  });
});

// ---------------------------------------------------------------------------
// suggest.js
// ---------------------------------------------------------------------------

describe('buildSuggestRoutes', () => {
  test('POST /agent/suggest empty lastMessage returns empty suggestions', async () => {
    const ctx = createMockCtx();
    const { handle } = buildSuggestRoutes(ctx);
    const { req, url } = createMockReq('POST', '/agent/suggest', { body: { lastMessage: '' } });
    const res = createMockRes();
    const handled = await handle(req, res, url);
    assert.strictEqual(handled, true);
    assert.deepStrictEqual(parseResBody(res), { suggestions: [] });
  });

  test('POST /agent/name-session empty firstMessage returns empty title', async () => {
    const ctx = createMockCtx();
    const { handle } = buildSuggestRoutes(ctx);
    const { req, url } = createMockReq('POST', '/agent/name-session', { body: { firstMessage: '' } });
    const res = createMockRes();
    const handled = await handle(req, res, url);
    assert.strictEqual(handled, true);
    assert.deepStrictEqual(parseResBody(res), { title: '' });
  });

  test('POST /agent/generate-branch-name empty prompt returns empty branchName', async () => {
    const ctx = createMockCtx();
    const { handle } = buildSuggestRoutes(ctx);
    const { req, url } = createMockReq('POST', '/agent/generate-branch-name', { body: { prompt: '' } });
    const res = createMockRes();
    const handled = await handle(req, res, url);
    assert.strictEqual(handled, true);
    assert.deepStrictEqual(parseResBody(res), { branchName: '' });
  });

  test('GET /agent/suggest returns false (method mismatch)', async () => {
    const ctx = createMockCtx();
    const { handle } = buildSuggestRoutes(ctx);
    const { req, url } = createMockReq('GET', '/agent/suggest');
    const res = createMockRes();
    const handled = await handle(req, res, url);
    assert.strictEqual(handled, false);
  });
});

// ---------------------------------------------------------------------------
// terminal.js
// ---------------------------------------------------------------------------

describe('buildTerminalRoutes', () => {
  test('POST /terminal/open missing cwd returns error', async () => {
    const ctx = createMockCtx();
    const { handle } = buildTerminalRoutes(ctx);
    const { req, url } = createMockReq('POST', '/terminal/open', { body: { sessionKey: 'k1' } });
    const res = createMockRes();
    await handle(req, res, url);
    assert.strictEqual(res.state.statusCode, 400);
    assertErrorBody(res, {
      error: 'cwd required',
      code: 'MISSING_REQUIRED_FIELD',
      details: { field: 'cwd', location: 'body' },
    });
  });

  test('POST /terminal/open rejects relative cwd', async () => {
    const ctx = createMockCtx();
    const { handle } = buildTerminalRoutes(ctx);
    const { req, url } = createMockReq('POST', '/terminal/open', {
      body: { sessionKey: 'k1', cwd: 'relative-cwd' },
    });
    const res = createMockRes();
    await handle(req, res, url);
    assert.strictEqual(res.state.statusCode, 400);
    assertErrorBody(res, {
      error: 'cwd must be an absolute filesystem path',
      code: 'INVALID_FIELD',
      details: { field: 'cwd', location: 'body', reason: 'absolute_path_required' },
    });
  });

  test('POST /terminal/open rejects unsupported shell path', async () => {
    const ctx = createMockCtx();
    const { handle } = buildTerminalRoutes(ctx);
    const { req, url } = createMockReq('POST', '/terminal/open', {
      body: { sessionKey: 'k1', cwd: tmpDir, shell: '/tmp/not-a-rudi-shell' },
    });
    const res = createMockRes();
    await handle(req, res, url);
    assert.strictEqual(res.state.statusCode, 400);
    assertErrorBody(res, {
      error: 'shell must be one of /bin/zsh, /bin/bash, /bin/sh',
      code: 'INVALID_FIELD',
      details: {
        field: 'shell',
        location: 'body',
        reason: 'unsupported_value',
        allowed: ['/bin/zsh', '/bin/bash', '/bin/sh'],
        value: '/tmp/not-a-rudi-shell',
      },
    });
  });

  test('POST /terminal/open rejects invalid dimensions before PTY spawn', async () => {
    const ctx = createMockCtx();
    const spawned = [];
    const { handle } = buildTerminalRoutes(ctx, {
      ptyModule: {
        spawn(...args) {
          spawned.push(args);
          return {
            onData() {},
            onExit() {},
            kill() {},
          };
        },
      },
    });
    const { req, url } = createMockReq('POST', '/terminal/open', {
      body: { sessionKey: 'k1', cwd: tmpDir, cols: 'Infinity', rows: 24 },
    });
    const res = createMockRes();
    await handle(req, res, url);
    assert.strictEqual(res.state.statusCode, 400);
    assertErrorBody(res, {
      error: 'cols must be a positive integer',
      code: 'INVALID_FIELD',
      details: { field: 'cols', location: 'body', reason: 'invalid_terminal_dimension' },
    });
    assert.strictEqual(spawned.length, 0);
  });

  test('POST /terminal/write rejects non-string data before session lookup', async () => {
    const ctx = createMockCtx();
    const { handle } = buildTerminalRoutes(ctx);
    const { req, url } = createMockReq('POST', '/terminal/write', {
      body: { sessionKey: 'nope', data: { text: 'ls' } },
    });
    const res = createMockRes();
    await handle(req, res, url);
    assert.strictEqual(res.state.statusCode, 400);
    assertErrorBody(res, {
      error: 'data must be a string',
      code: 'INVALID_FIELD',
      details: { field: 'data', location: 'body', reason: 'invalid_type' },
    });
  });

  test('POST /terminal/write nonexistent session returns 404', async () => {
    const ctx = createMockCtx();
    const { handle } = buildTerminalRoutes(ctx);
    const { req, url } = createMockReq('POST', '/terminal/write', {
      body: { sessionKey: 'nope', data: 'ls\n' },
    });
    const res = createMockRes();
    await handle(req, res, url);
    assert.strictEqual(res.state.statusCode, 404);
    assertErrorBody(res, {
      error: 'terminal session not found',
      code: 'NOT_FOUND',
    });
  });

  test('POST /terminal/resize nonexistent session returns 404', async () => {
    const ctx = createMockCtx();
    const { handle } = buildTerminalRoutes(ctx);
    const { req, url } = createMockReq('POST', '/terminal/resize', {
      body: { sessionKey: 'nope', cols: 80, rows: 24 },
    });
    const res = createMockRes();
    await handle(req, res, url);
    assert.strictEqual(res.state.statusCode, 404);
    assertErrorBody(res, {
      error: 'terminal session not found',
      code: 'NOT_FOUND',
    });
  });

  test('POST /terminal/close nonexistent session returns ok (idempotent)', async () => {
    const ctx = createMockCtx();
    const { handle } = buildTerminalRoutes(ctx);
    const { req, url } = createMockReq('POST', '/terminal/close', {
      body: { sessionKey: 'nope' },
    });
    const res = createMockRes();
    await handle(req, res, url);
    assert.strictEqual(res.state.statusCode, 200);
    assert.deepStrictEqual(parseResBody(res), { ok: true });
  });

  test('POST /terminal/close logs process kill failures', async () => {
    const ctx = createMockCtx();
    const proc = {
      onData() {},
      onExit() {},
      kill() {
        throw new Error('kill denied');
      },
    };
    const { handle } = buildTerminalRoutes(ctx, {
      ptyModule: {
        spawn() {
          return proc;
        },
      },
    });

    const open = createMockReq('POST', '/terminal/open', {
      body: { sessionKey: 'k1', cwd: tmpDir },
    });
    const openRes = createMockRes();
    await handle(open.req, openRes, open.url);
    assert.strictEqual(openRes.state.statusCode, 200);

    const close = createMockReq('POST', '/terminal/close', {
      body: { sessionKey: 'k1' },
    });
    const closeRes = createMockRes();
    await handle(close.req, closeRes, close.url);
    assert.strictEqual(closeRes.state.statusCode, 200);
    assert.ok(ctx._logs.some((entry) =>
      entry.source === 'terminal' &&
      entry.level === 'warn' &&
      entry.message.includes('session close') &&
      entry.message.includes('kill denied')
    ));
  });

  test('unmatched path returns false', async () => {
    const ctx = createMockCtx();
    const { handle } = buildTerminalRoutes(ctx);
    const { req, url } = createMockReq('GET', '/terminal/nope');
    const res = createMockRes();
    const handled = await handle(req, res, url);
    assert.strictEqual(handled, false);
  });
});

// ---------------------------------------------------------------------------
// providers.js
// ---------------------------------------------------------------------------

describe('buildProviderRoutes', () => {
  test('GET /agent/providers returns providers array with correct shape', async () => {
    const ctx = createMockCtx();
    const { handle } = buildProviderRoutes(ctx);
    const { req, url } = createMockReq('GET', '/agent/providers');
    const res = createMockRes();
    const handled = await handle(req, res, url);
    assert.strictEqual(handled, true);
    assert.strictEqual(res.state.statusCode, 200);
    const body = parseResBody(res);
    assert.ok(Array.isArray(body.providers));
    assert.ok(body.providers.length >= 1, 'should have at least 1 provider');
    for (const p of body.providers) {
      assert.strictEqual(typeof p.id, 'string');
      assert.strictEqual(typeof p.name, 'string');
      assert.ok(Array.isArray(p.models));
      assert.ok(p.models.length >= 1, `provider ${p.id} should have at least 1 model`);
      for (const m of p.models) {
        assert.strictEqual(typeof m.id, 'string');
        assert.strictEqual(typeof m.name, 'string');
        assert.strictEqual(typeof m.default, 'boolean');
      }
      assert.strictEqual(typeof p.capabilities.planMode, 'boolean');
      assert.strictEqual(typeof p.capabilities.askPermission, 'boolean');
    }
  });

  test('POST /agent/providers returns false (method mismatch)', async () => {
    const ctx = createMockCtx();
    const { handle } = buildProviderRoutes(ctx);
    const { req, url } = createMockReq('POST', '/agent/providers');
    const res = createMockRes();
    const handled = await handle(req, res, url);
    assert.strictEqual(handled, false);
  });
});
