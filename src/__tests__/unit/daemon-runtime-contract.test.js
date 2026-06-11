import { EventEmitter } from 'events';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import { createInfrastructure } from '../../commands/serve/ctx.js';
import {
  createMockReq,
  createMockRes,
  parseResBody,
} from '../helpers/serve-mocks.js';
import { buildHttpAuthMiddleware } from '../../daemon/runtime/auth.js';
import {
  parseRequestedPort,
  printStartupBanner,
  removeConnectionFiles,
  resolveWebRoot,
  writeConnectionFiles,
} from '../../daemon/runtime/bootstrap.js';
import { createDaemonProcessManager } from '../../daemon/runtime/process-manager.js';
import { createGracefulShutdown } from '../../daemon/runtime/shutdown.js';
import {
  createWebSocketRuntime,
  isSameOriginWebSocketToken,
  readWsTokenFromProtocolHeader,
  selectWsProtocol,
} from '../../daemon/runtime/websocket.js';

describe('daemon runtime auth middleware', () => {
  test('OPTIONS preflight skips auth and preserves CORS headers', () => {
    const ctx = createInfrastructure();
    const middleware = buildHttpAuthMiddleware(ctx);
    const { req } = createMockReq('OPTIONS', '/projects');
    const res = createMockRes();
    const requestContext = ctx.createRequestContext(req);
    ctx.attachRequestContext(res, requestContext);

    const handled = middleware.handleCorsPreflight(req, res, requestContext);

    assert.equal(handled, true);
    assert.equal(res.state.statusCode, 204);
    assert.equal(res.state.headers['Access-Control-Allow-Origin'], '*');
    assert.equal(res.state.headers['x-rudi-request-id'], requestContext.requestId);
    assert.deepEqual(requestContext.auth, { required: false, result: 'skipped' });
  });

  test('requireAuth accepts valid x-rudi-token', () => {
    const ctx = createInfrastructure();
    ctx.setToken('secret-token');
    const middleware = buildHttpAuthMiddleware(ctx);
    const { req, url } = createMockReq('GET', '/projects', {
      headers: { 'x-rudi-token': 'secret-token' },
    });
    const res = createMockRes();
    const requestContext = ctx.createRequestContext(req);
    ctx.attachRequestContext(res, requestContext);

    assert.equal(middleware.requireAuth(req, res, url), true);
    assert.deepEqual(requestContext.auth, { required: true, result: 'passed' });
  });

  test('requireAuth rejects missing token with stable error body', () => {
    const ctx = createInfrastructure();
    ctx.setToken('secret-token');
    const middleware = buildHttpAuthMiddleware(ctx);
    const { req, url } = createMockReq('GET', '/projects');
    const res = createMockRes();
    const requestContext = ctx.createRequestContext(req);
    ctx.attachRequestContext(res, requestContext);

    assert.equal(middleware.requireAuth(req, res, url), false);
    assert.equal(res.state.statusCode, 401);
    assert.deepEqual(parseResBody(res), {
      error: 'Unauthorized',
      code: 'UNAUTHORIZED',
      requestId: requestContext.requestId,
    });
    assert.deepEqual(requestContext.auth, { required: true, result: 'failed' });
  });

  test('requireAuth rejects URL query token transport', () => {
    const ctx = createInfrastructure();
    ctx.setToken('secret-token');
    const middleware = buildHttpAuthMiddleware(ctx);
    const { req, url } = createMockReq('GET', '/projects?token=secret-token');
    const res = createMockRes();
    const requestContext = ctx.createRequestContext(req);
    ctx.attachRequestContext(res, requestContext);

    assert.equal(middleware.requireAuth(req, res, url), false);
    assert.equal(res.state.statusCode, 401);
    assert.deepEqual(parseResBody(res), {
      error: 'Unauthorized',
      code: 'UNAUTHORIZED',
      requestId: requestContext.requestId,
    });
    assert.deepEqual(requestContext.auth, { required: true, result: 'failed' });
  });

  test('requireAuth rejects same-origin token from external browser origins', () => {
    const ctx = createInfrastructure();
    ctx.setToken('secret-token');
    const middleware = buildHttpAuthMiddleware(ctx);
    const { req, url } = createMockReq('GET', '/env', {
      headers: {
        host: 'localhost:8123',
        origin: 'https://example.invalid',
        'x-rudi-token': 'same-origin',
      },
    });
    const res = createMockRes();
    const requestContext = ctx.createRequestContext(req);
    ctx.attachRequestContext(res, requestContext);

    assert.equal(middleware.requireAuth(req, res, url), false);
    assert.equal(res.state.statusCode, 401);
    assert.deepEqual(parseResBody(res), {
      error: 'Unauthorized',
      code: 'UNAUTHORIZED',
      requestId: requestContext.requestId,
    });
    assert.deepEqual(requestContext.auth, { required: true, result: 'failed' });
  });
});

describe('daemon runtime bootstrap helpers', () => {
  test('parseRequestedPort returns requested port or dynamic fallback', () => {
    assert.equal(parseRequestedPort({ port: '8100' }), 8100);
    assert.equal(parseRequestedPort({ port: 'not-a-port' }), 0);
    assert.equal(parseRequestedPort({}), 0);
  });

  test('resolveWebRoot requires index.html', () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'rudi-web-root-'));
    fs.writeFileSync(path.join(tmp, 'index.html'), '<html></html>');

    assert.equal(resolveWebRoot({ 'web-root': tmp }), tmp);

    const missing = path.join(tmp, 'missing');
    assert.throws(
      () => resolveWebRoot({ 'web-root': missing }),
      { code: 'RUDI_WEB_ROOT_INDEX_MISSING' },
    );
  });

  test('connection file helpers write and remove port/token files', () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'rudi-connection-'));
    const portFile = path.join(tmp, '.rudi-lite-port');
    const tokenFile = path.join(tmp, '.rudi-lite-token');

    writeConnectionFiles({ port: 8123, token: 'token-value', portFile, tokenFile });

    assert.equal(fs.readFileSync(portFile, 'utf8'), '8123');
    assert.equal(fs.readFileSync(tokenFile, 'utf8'), 'token-value');

    removeConnectionFiles({ portFile, tokenFile });

    assert.equal(fs.existsSync(portFile), false);
    assert.equal(fs.existsSync(tokenFile), false);
  });

  test('startup banner truncates token', () => {
    const lines = [];

    printStartupBanner({
      port: 8123,
      token: '1234567890abcdef',
      writeLine: (line) => lines.push(line),
    });

    assert.ok(lines.some((line) => line.includes('Token: 12345678...')));
    assert.equal(lines.some((line) => line.includes('1234567890abcdef')), false);
  });
});

describe('daemon process manager', () => {
  test('cleanup kills owned agent processes and clears indexes', () => {
    const manager = createDaemonProcessManager();
    let killed = 0;
    manager.agentProcesses.set('a', { proc: { kill: () => { killed += 1; } } });
    manager.agentProcesses.set('b', { proc: { kill: () => { killed += 1; } } });
    manager.resumeSessionIndex.set('resume', 'session-id');

    const result = manager.cleanup();

    assert.deepEqual(result, { killed: 2 });
    assert.equal(killed, 2);
    assert.equal(manager.agentProcesses.size, 0);
    assert.equal(manager.resumeSessionIndex.size, 0);
  });
});

describe('daemon graceful shutdown', () => {
  test('shutdown closes server, websocket clients, resources, then exits', async () => {
    let serverClosed = false;
    let wssClosed = false;
    let clientClosed = false;
    let cleaned = false;
    const exitCodes = [];

    const server = {
      close(cb) {
        serverClosed = true;
        cb();
      },
    };
    const wss = {
      clients: new Set([{
        close(code, reason) {
          clientClosed = code === 1001 && reason === 'daemon shutting down';
        },
      }]),
      close(cb) {
        wssClosed = true;
        cb();
      },
    };
    const shutdown = createGracefulShutdown({
      server,
      wss,
      cleanupResources: () => { cleaned = true; },
      exit: (code) => exitCodes.push(code),
      log: () => {},
    });

    await shutdown.shutdown(0, 'test');

    assert.equal(serverClosed, true);
    assert.equal(clientClosed, true);
    assert.equal(wssClosed, true);
    assert.equal(cleaned, true);
    assert.deepEqual(exitCodes, [0]);
  });
});

describe('daemon websocket runtime', () => {
  test('parses websocket protocol auth tokens', () => {
    assert.equal(readWsTokenFromProtocolHeader('rudi-token.abc'), 'abc');
    assert.equal(readWsTokenFromProtocolHeader('"rudi-token.quoted", chat'), 'quoted');
    assert.equal(readWsTokenFromProtocolHeader('chat, rudi-token.second'), 'second');
    assert.equal(readWsTokenFromProtocolHeader('chat'), null);
  });

  test('selectWsProtocol accepts token protocol and rejects unknown protocols', () => {
    assert.equal(selectWsProtocol(new Set(['chat', 'rudi-token.abc'])), 'rudi-token.abc');
    assert.equal(selectWsProtocol(new Set()), undefined);
    assert.equal(selectWsProtocol(new Set(['chat'])), false);
  });

  test('same-origin websocket token is not accepted as authentication', () => {
    assert.equal(isSameOriginWebSocketToken('same-origin', 'localhost:8123'), false);
    assert.equal(isSameOriginWebSocketToken('same-origin', '127.0.0.1:8123'), false);
    assert.equal(isSameOriginWebSocketToken('same-origin', 'example.com'), false);
    assert.equal(isSameOriginWebSocketToken('not-same-origin', 'localhost:8123'), false);
  });

  test('upgrade rejects invalid tokens and dispatches valid websocket messages', () => {
    class FakeWebSocketServer extends EventEmitter {
      constructor(options) {
        super();
        this.options = options;
        this.clients = new Set();
        this.lastSocket = null;
      }

      handleUpgrade(req, socket, head, cb) {
        const ws = new EventEmitter();
        ws.protocol = '';
        this.clients.add(ws);
        this.lastSocket = ws;
        cb(ws);
      }
    }

    const handlers = {};
    const server = {
      on(event, handler) {
        handlers[event] = handler;
      },
    };
    const messages = [];
    const runtime = createWebSocketRuntime({
      getToken: () => 'valid-token',
      handleMessage: (ws, msg) => messages.push(msg),
      handleDisconnect: () => {},
      log: () => {},
      WebSocketServerImpl: FakeWebSocketServer,
    });
    runtime.attachToServer(server);

    let destroyed = false;
    handlers.upgrade(
      { url: '/ws?token=bad', headers: { host: 'localhost:8123' } },
      { destroy: () => { destroyed = true; } },
      null,
    );
    assert.equal(destroyed, true);

    destroyed = false;
    handlers.upgrade(
      { url: '/ws?token=same-origin', headers: { host: 'localhost:8123', origin: 'https://example.invalid' } },
      { destroy: () => { destroyed = true; } },
      null,
    );
    assert.equal(destroyed, true);

    destroyed = false;
    handlers.upgrade(
      { url: '/ws?token=valid-token', headers: { host: 'localhost:8123' } },
      { destroy: () => { destroyed = true; } },
      null,
    );
    assert.equal(destroyed, true);

    handlers.upgrade(
      { url: '/ws', headers: { host: 'localhost:8123', 'sec-websocket-protocol': 'rudi-token.valid-token' } },
      { destroy: () => {} },
      null,
    );
    runtime.wss.lastSocket.emit('message', JSON.stringify({ type: 'session:follow' }));

    assert.deepEqual(messages, [{ type: 'session:follow' }]);
  });
});
