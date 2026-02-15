import { test, describe } from 'node:test';
import assert from 'node:assert';
import { createMockCtx, createMockRes, createMockReq, parseResBody } from '../helpers/serve-mocks.js';
import { buildLogsRoutes } from '../../commands/serve/routes/logs.js';
import { buildShellRoutes } from '../../commands/serve/routes/shell.js';
import { buildSuggestRoutes } from '../../commands/serve/routes/suggest.js';
import { buildTerminalRoutes } from '../../commands/serve/routes/terminal.js';
import { buildProviderRoutes } from '../../commands/serve/routes/providers.js';

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
    assert.deepStrictEqual(parseResBody(res), { error: 'path required' });
  });

  test('POST /shell/open missing path returns error', async () => {
    const ctx = createMockCtx();
    const { handle } = buildShellRoutes(ctx);
    const { req, url } = createMockReq('POST', '/shell/open', { body: { app: 'vscode' } });
    const res = createMockRes();
    await handle(req, res, url);
    assert.strictEqual(res.state.statusCode, 400);
    assert.deepStrictEqual(parseResBody(res), { error: 'path required' });
  });

  test('POST /shell/open missing app returns error', async () => {
    const ctx = createMockCtx();
    const { handle } = buildShellRoutes(ctx);
    const { req, url } = createMockReq('POST', '/shell/open', { body: { path: '/tmp' } });
    const res = createMockRes();
    await handle(req, res, url);
    assert.strictEqual(res.state.statusCode, 400);
    assert.deepStrictEqual(parseResBody(res), { error: 'app required' });
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
    assert.deepStrictEqual(parseResBody(res), { error: 'unknown app: notepad' });
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
    assert.deepStrictEqual(parseResBody(res), { error: 'cwd required' });
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
    assert.deepStrictEqual(parseResBody(res), { error: 'terminal session not found' });
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
    assert.deepStrictEqual(parseResBody(res), { error: 'terminal session not found' });
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
