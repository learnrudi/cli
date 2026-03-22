import { test, describe } from 'node:test';
import assert from 'node:assert';
import { createInfrastructure } from '../../commands/serve/ctx.js';
import { createMockRes } from '../helpers/serve-mocks.js';

describe('createInfrastructure', () => {
  // --- generateToken ---

  describe('generateToken', () => {
    test('returns a 64-char hex string', () => {
      const ctx = createInfrastructure();
      const token = ctx.generateToken();
      assert.strictEqual(token.length, 64);
      assert.match(token, /^[0-9a-f]{64}$/);
    });

    test('returns unique values on successive calls', () => {
      const ctx = createInfrastructure();
      const a = ctx.generateToken();
      const b = ctx.generateToken();
      assert.notStrictEqual(a, b);
    });
  });

  // --- json ---

  describe('json', () => {
    test('writes 200 + JSON + CORS headers', () => {
      const ctx = createInfrastructure();
      const res = createMockRes();
      ctx.json(res, { hello: 'world' });
      assert.strictEqual(res.state.statusCode, 200);
      assert.strictEqual(res.state.headers['Content-Type'], 'application/json');
      assert.strictEqual(res.state.headers['Access-Control-Allow-Origin'], '*');
      assert.deepStrictEqual(JSON.parse(res.state.body), { hello: 'world' });
    });

    test('supports custom status code', () => {
      const ctx = createInfrastructure();
      const res = createMockRes();
      ctx.json(res, { ok: true }, 201);
      assert.strictEqual(res.state.statusCode, 201);
    });

    test('returns true', () => {
      const ctx = createInfrastructure();
      const res = createMockRes();
      assert.strictEqual(ctx.json(res, {}), true);
    });

    test('includes request ID header when request context is attached', () => {
      const ctx = createInfrastructure();
      const req = { method: 'GET', url: '/projects' };
      const res = createMockRes();
      const requestContext = ctx.createRequestContext(req);
      ctx.attachRequestContext(res, requestContext);

      ctx.json(res, { ok: true });

      assert.strictEqual(res.state.headers['x-rudi-request-id'], requestContext.requestId);
    });
  });

  // --- error ---

  describe('error', () => {
    test('writes 400 + structured error JSON', () => {
      const ctx = createInfrastructure();
      const res = createMockRes();
      ctx.error(res, 'bad request');
      assert.strictEqual(res.state.statusCode, 400);
      assert.deepStrictEqual(JSON.parse(res.state.body), {
        error: 'bad request',
        code: 'BAD_REQUEST',
      });
    });

    test('supports custom status code', () => {
      const ctx = createInfrastructure();
      const res = createMockRes();
      ctx.error(res, 'not found', 404);
      assert.strictEqual(res.state.statusCode, 404);
    });

    test('returns true', () => {
      const ctx = createInfrastructure();
      const res = createMockRes();
      assert.strictEqual(ctx.error(res, 'fail'), true);
    });

    test('includes request ID and details when request context is attached', () => {
      const ctx = createInfrastructure();
      const req = { method: 'POST', url: '/fs/write' };
      const res = createMockRes();
      const requestContext = ctx.createRequestContext(req);
      ctx.attachRequestContext(res, requestContext);

      ctx.error(res, 'path required', 400, {
        code: 'MISSING_REQUIRED_FIELD',
        details: { field: 'path', location: 'body' },
      });

      assert.deepStrictEqual(JSON.parse(res.state.body), {
        error: 'path required',
        code: 'MISSING_REQUIRED_FIELD',
        details: { field: 'path', location: 'body' },
        requestId: requestContext.requestId,
      });
      assert.strictEqual(res.state.headers['x-rudi-request-id'], requestContext.requestId);
    });
  });

  describe('request context', () => {
    test('createRequestContext captures request metadata', () => {
      const ctx = createInfrastructure();
      const requestContext = ctx.createRequestContext({
        method: 'POST',
        url: '/notes?draft=1',
      });

      assert.strictEqual(requestContext.method, 'POST');
      assert.strictEqual(requestContext.path, '/notes');
      assert.strictEqual(typeof requestContext.requestId, 'string');
      assert.ok(requestContext.requestId.length > 0);
      assert.strictEqual(requestContext.auth.result, 'unknown');
    });

    test('attachRequestContext sets the response header', () => {
      const ctx = createInfrastructure();
      const res = createMockRes();
      const requestContext = ctx.createRequestContext({ method: 'GET', url: '/health' });

      ctx.attachRequestContext(res, requestContext);

      assert.strictEqual(ctx.getRequestContext(res), requestContext);
      assert.strictEqual(res.state.headers['x-rudi-request-id'], requestContext.requestId);
    });
  });

  describe('validation helpers', () => {
    test('requiredField emits a stable code and field details', () => {
      const ctx = createInfrastructure();
      const res = createMockRes();

      ctx.requiredField(res, 'path');

      assert.deepStrictEqual(JSON.parse(res.state.body), {
        error: 'path required',
        code: 'MISSING_REQUIRED_FIELD',
        details: { field: 'path', location: 'body' },
      });
    });

    test('requiredFields emits the missing field list', () => {
      const ctx = createInfrastructure();
      const res = createMockRes();

      ctx.requiredFields(res, ['path', 'content']);

      assert.deepStrictEqual(JSON.parse(res.state.body), {
        error: 'path and content required',
        code: 'MISSING_REQUIRED_FIELD',
        details: { fields: ['path', 'content'], location: 'body' },
      });
    });

    test('invalidField emits a stable code and reason', () => {
      const ctx = createInfrastructure();
      const res = createMockRes();

      ctx.invalidField(res, 'kind', 'invalid kind', { location: 'query', reason: 'unsupported_value' });

      assert.deepStrictEqual(JSON.parse(res.state.body), {
        error: 'invalid kind',
        code: 'INVALID_FIELD',
        details: { field: 'kind', location: 'query', reason: 'unsupported_value' },
      });
    });
  });

  // --- readBody ---

  describe('readBody', () => {
    test('parses JSON from event-based request', async () => {
      const ctx = createInfrastructure();
      const payload = { foo: 'bar', n: 42 };
      const listeners = {};
      const req = {
        on(event, handler) {
          listeners[event] = handler;
        },
        destroy() {},
      };
      const resultPromise = ctx.readBody(req);
      // Simulate data and end events
      setImmediate(() => {
        listeners.data(Buffer.from(JSON.stringify(payload)));
        listeners.end();
      });
      const result = await resultPromise;
      assert.deepStrictEqual(result, payload);
    });

    test('throws on invalid JSON', async () => {
      const ctx = createInfrastructure();
      const listeners = {};
      const req = {
        on(event, handler) {
          listeners[event] = handler;
        },
        destroy() {},
      };
      const resultPromise = ctx.readBody(req);
      setImmediate(() => {
        listeners.data(Buffer.from('not json'));
        listeners.end();
      });
      await assert.rejects(() => resultPromise, { message: 'Invalid JSON in request body' });
    });

    test('supports a per-request body size override', async () => {
      const ctx = createInfrastructure();
      const listeners = {};
      let destroyed = false;
      const req = {
        on(event, handler) {
          listeners[event] = handler;
        },
        destroy() {
          destroyed = true;
        },
      };
      const resultPromise = ctx.readBody(req, { maxBodySize: 4 });
      setImmediate(() => {
        listeners.data(Buffer.from('{"abc":1}'));
      });
      await assert.rejects(() => resultPromise, { message: 'Request body too large' });
      assert.strictEqual(destroyed, true);
    });
  });

  // --- log ---

  describe('log', () => {
    test('pushes entry with correct shape', () => {
      const ctx = createInfrastructure();
      ctx.log('test-source', 'info', 'hello', { key: 1 });
      const logs = ctx.getLogs();
      assert.strictEqual(logs.length, 1);
      const entry = logs[0];
      assert.strictEqual(entry.source, 'test-source');
      assert.strictEqual(entry.level, 'info');
      assert.strictEqual(entry.message, 'hello');
      assert.deepStrictEqual(entry.data, { key: 1 });
      assert.strictEqual(typeof entry.ts, 'number');
      assert.strictEqual(typeof entry.time, 'string');
    });

    test('trims at 500 entries', () => {
      const ctx = createInfrastructure();
      for (let i = 0; i < 510; i++) {
        ctx.log('src', 'info', `msg-${i}`);
      }
      assert.strictEqual(ctx.getLogs().length, 500);
      // oldest entries should have been shifted off
      assert.strictEqual(ctx.getLogs()[0].message, 'msg-10');
    });

    test('writes to SSE clients', () => {
      const ctx = createInfrastructure();
      const sseClients = ctx.getSseClients();
      const written = [];
      sseClients.push({ write(chunk) { written.push(chunk); } });
      ctx.log('src', 'info', 'test-msg');
      assert.strictEqual(written.length, 1);
      assert.ok(written[0].startsWith('data: '));
      const parsed = JSON.parse(written[0].replace('data: ', '').trim());
      assert.strictEqual(parsed.message, 'test-msg');
    });

    test('removes broken SSE clients', () => {
      const ctx = createInfrastructure();
      const sseClients = ctx.getSseClients();
      sseClients.push({ write() { throw new Error('broken'); } });
      sseClients.push({ write() { /* ok */ } });
      ctx.log('src', 'info', 'test');
      assert.strictEqual(sseClients.length, 1);
    });
  });

  // --- checkAuth ---

  describe('checkAuth', () => {
    test('validates header token', () => {
      const ctx = createInfrastructure();
      const token = ctx.generateToken();
      ctx.setToken(token);
      const result = ctx.checkAuth({ url: '/test', headers: { 'x-rudi-token': token } });
      assert.strictEqual(result, true);
    });

    test('validates query param token', () => {
      const ctx = createInfrastructure();
      const token = ctx.generateToken();
      ctx.setToken(token);
      const result = ctx.checkAuth({ url: `/test?token=${token}`, headers: {} });
      assert.strictEqual(result, true);
    });

    test('rejects missing token', () => {
      const ctx = createInfrastructure();
      ctx.setToken('secret');
      const result = ctx.checkAuth({ url: '/test', headers: {} });
      assert.strictEqual(result, false);
    });

    test('rejects wrong token', () => {
      const ctx = createInfrastructure();
      ctx.setToken('secret');
      const result = ctx.checkAuth({ url: '/test', headers: { 'x-rudi-token': 'wrong' } });
      assert.strictEqual(result, false);
    });
  });

  // --- broadcast ---

  describe('broadcast', () => {
    test('sends to wss clients with readyState=1', () => {
      const ctx = createInfrastructure();
      const sent = [];
      ctx.setWss({
        clients: [
          { readyState: 1, send(msg) { sent.push(msg); } },
          { readyState: 1, send(msg) { sent.push(msg); } },
        ],
      });
      ctx.broadcast('test-event', { sessionId: 'abc' });
      assert.strictEqual(sent.length, 2);
      const parsed = JSON.parse(sent[0]);
      assert.strictEqual(parsed.type, 'test-event');
      assert.deepStrictEqual(parsed.data, { sessionId: 'abc' });
    });

    test('no-op without wss', () => {
      const ctx = createInfrastructure();
      // wss is null by default — should not throw
      ctx.broadcast('test', {});
    });

    test('skips clients with readyState != 1', () => {
      const ctx = createInfrastructure();
      const sent = [];
      ctx.setWss({
        clients: [
          { readyState: 0, send(msg) { sent.push(msg); } },
          { readyState: 1, send(msg) { sent.push(msg); } },
          { readyState: 3, send(msg) { sent.push(msg); } },
        ],
      });
      ctx.broadcast('evt', {});
      assert.strictEqual(sent.length, 1);
    });
  });
});
