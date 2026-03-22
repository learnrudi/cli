/**
 * Shared mock factories for serve module contract tests.
 */

import { URL } from 'url';
import { SIDECAR_ERROR_CODES, resolveSidecarErrorDefinition } from '../../commands/serve/error-codes.js';

const REQUEST_ID_HEADER = 'x-rudi-request-id';

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
    REQUEST_ID_HEADER,

    log(source, level, message, data) {
      _logs.push({ source, level, message, data });
    },
    broadcast(type, data) {
      _broadcasts.push({ type, data });
    },
    createRequestContext(req) {
      return {
        requestId: 'test-request-id',
        method: req?.method || null,
        path: new URL(req?.url || '/', 'http://localhost').pathname,
        startedAt: Date.now(),
        auth: { required: true, result: 'unknown' },
        response: null,
      };
    },
    attachRequestContext(res, requestContext) {
      res._rudiRequestContext = requestContext;
      if (typeof res.setHeader === 'function') {
        res.setHeader(REQUEST_ID_HEADER, requestContext.requestId);
      }
      return requestContext;
    },
    getRequestContext(res) {
      return res?._rudiRequestContext || null;
    },
    updateRequestAuth(res, authPatch) {
      if (!res?._rudiRequestContext) return null;
      res._rudiRequestContext.auth = {
        ...(res._rudiRequestContext.auth || {}),
        ...(authPatch || {}),
      };
      return res._rudiRequestContext.auth;
    },
    json(res, data, status = 200, options = {}) {
      const requestContext = ctx.getRequestContext(res);
      res.writeHead(status, {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
        ...(requestContext?.requestId ? { [REQUEST_ID_HEADER]: requestContext.requestId } : {}),
        ...(options.headers || {}),
      });
      res.end(JSON.stringify(data));
      return true;
    },
    error(res, message, status = 400, options = {}) {
      const requestContext = ctx.getRequestContext(res);
      const errorDefinition = resolveSidecarErrorDefinition(options.code, status);
      const payload = {
        error: message,
        code: errorDefinition?.code || 'ERROR',
      };
      if (options.details !== undefined) payload.details = options.details;
      if (requestContext?.requestId) payload.requestId = requestContext.requestId;
      ctx.json(res, payload, errorDefinition?.status ?? status, options);
      return true;
    },
    errorCode(res, codeDefinition, options = {}) {
      const errorDefinition = resolveSidecarErrorDefinition(codeDefinition, options.status || 500);
      return ctx.error(
        res,
        options.message || errorDefinition?.defaultMessage || 'Error',
        options.status ?? errorDefinition?.status ?? 500,
        { ...options, code: errorDefinition },
      );
    },
    requiredField(res, field, options = {}) {
      return ctx.error(res, options.message || `${field} required`, options.status || 400, {
        ...options,
        code: options.code || SIDECAR_ERROR_CODES.MISSING_REQUIRED_FIELD,
        details: {
          field,
          location: options.location || 'body',
          ...(options.details || {}),
        },
      });
    },
    requiredFields(res, fields, options = {}) {
      const normalizedFields = (Array.isArray(fields) ? fields : [fields]).filter(Boolean);
      return ctx.error(res, options.message || `${normalizedFields.join(' and ')} required`, options.status || 400, {
        ...options,
        code: options.code || SIDECAR_ERROR_CODES.MISSING_REQUIRED_FIELD,
        details: {
          fields: normalizedFields,
          location: options.location || 'body',
          ...(options.details || {}),
        },
      });
    },
    invalidField(res, field, message, options = {}) {
      return ctx.error(res, message, options.status || 400, {
        ...options,
        code: options.code || SIDECAR_ERROR_CODES.INVALID_FIELD,
        details: {
          field,
          location: options.location || 'body',
          ...(options.reason ? { reason: options.reason } : {}),
          ...(options.details || {}),
        },
      });
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
    statusCode: 200,
    headers: {},
    body: '',
    writtenChunks: [],
  };
  return {
    state,
    statusCode: 200,
    setHeader(name, value) {
      state.headers[name] = value;
    },
    writeHead(code, headers) {
      state.statusCode = code;
      this.statusCode = code;
      state.headers = {
        ...state.headers,
        ...(headers || {}),
      };
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
