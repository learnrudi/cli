/**
 * Shared mock factories for serve module contract tests.
 */

import { URL } from 'url';

/**
 * Creates a mock ctx object matching the createInfrastructure() interface.
 * Captures calls into _logs and _broadcasts arrays for assertions.
 */
export function createMockCtx(overrides = {}) {
  const _logs = [];
  const _broadcasts = [];
  const _sseClients = [];
  let _token = 'test-token';

  const ctx = {
    _logs,
    _broadcasts,
    SSE_CLIENT_CAP: 50,

    log(source, level, message, data) {
      _logs.push({ source, level, message, data });
    },
    broadcast(type, data) {
      _broadcasts.push({ type, data });
    },
    json(res, data, status = 200) {
      res.writeHead(status, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
      res.end(JSON.stringify(data));
      return true;
    },
    error(res, message, status = 400) {
      ctx.json(res, { error: message }, status);
      return true;
    },
    async readBody(req) {
      const chunks = [];
      for await (const chunk of req) chunks.push(chunk);
      return JSON.parse(Buffer.concat(chunks).toString());
    },
    getLogs() { return _logs; },
    getSseClients() { return _sseClients; },
    setToken(t) { _token = t; },
    getToken() { return _token; },

    ...overrides,
  };

  return ctx;
}

/**
 * Creates a mock HTTP response that captures statusCode, headers, and body.
 */
export function createMockRes() {
  const state = {
    statusCode: 0,
    headers: {},
    body: '',
    writtenChunks: [],
  };
  return {
    state,
    writeHead(code, headers) {
      state.statusCode = code;
      state.headers = headers || {};
    },
    end(chunk = '') {
      state.body += String(chunk || '');
    },
    write(chunk) {
      state.writtenChunks.push(String(chunk));
      return true;
    },
    on(event, cb) {
      // store event handlers for SSE close/error simulation
      if (!state._handlers) state._handlers = {};
      state._handlers[event] = cb;
    },
  };
}

/**
 * Creates a mock HTTP request + parsed URL.
 * Supports opts.body (for POST), opts.query (string), opts.headers.
 * Implements Symbol.asyncIterator for readBody compatibility.
 */
export function createMockReq(method, pathname, opts = {}) {
  const query = opts.query ? `?${opts.query}` : '';
  const url = new URL(`http://localhost${pathname}${query}`);

  const bodyBuf = opts.body ? Buffer.from(JSON.stringify(opts.body)) : null;

  const req = {
    method,
    url: `${pathname}${query}`,
    headers: opts.headers || {},
    [Symbol.asyncIterator]: async function* () {
      if (bodyBuf) yield bodyBuf;
    },
    on(event, cb) {
      if (!req._handlers) req._handlers = {};
      req._handlers[event] = cb;
    },
  };

  return { req, url };
}

/**
 * Parses the JSON body from a mock response's state.
 */
export function parseResBody(res) {
  return JSON.parse(res.state.body);
}
