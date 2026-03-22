/**
 * Shared infrastructure factory for serve modules.
 *
 * Creates log, broadcast, json/error/readBody helpers, auth helpers,
 * and mutable state accessors (wss, token, logs ring buffer, SSE clients).
 * All mutable state is closure-private.
 */

import crypto from 'crypto';
import { URL } from 'url';
import { SIDECAR_ERROR_CODES, resolveSidecarErrorDefinition } from './error-codes.js';

const LOG_MAX = 500;
const SSE_CLIENT_CAP = 50;
const REQUEST_ID_HEADER = 'x-rudi-request-id';

export function createInfrastructure() {
  // Closure-private mutable state
  let _wss = null;
  const _logs = [];
  const _sseClients = [];
  let _token = '';

  // --- Setters / Getters ---

  function setWss(wss) { _wss = wss; }
  function getWss() { return _wss; }
  function setToken(t) { _token = t; }
  function getToken() { return _token; }
  function getLogs() { return _logs; }
  function getSseClients() { return _sseClients; }

  // --- Observability ---

  function log(source, level, message, data) {
    const entry = {
      ts: Date.now(),
      time: new Date().toISOString().slice(11, 23),
      source,
      level,
      message,
      data,
    };
    _logs.push(entry);
    if (_logs.length > LOG_MAX) _logs.shift();

    const tag = `[${entry.time}] [${source}]`;
    if (level === 'error') {
      console.error(`${tag} ERROR: ${message}`, data || '');
    } else if (level === 'warn') {
      console.warn(`${tag} WARN: ${message}`, data || '');
    } else {
      console.log(`${tag} ${message}`, data ? JSON.stringify(data) : '');
    }

    const line = JSON.stringify(entry);
    for (let i = _sseClients.length - 1; i >= 0; i--) {
      try {
        _sseClients[i].write(`data: ${line}\n\n`);
      } catch {
        _sseClients.splice(i, 1);
      }
    }
  }

  function broadcast(type, data) {
    if (!_wss) return;
    const msg = JSON.stringify({ type, data });
    log('ws', 'debug', `broadcast ${type}`, { type, sessionId: data?.sessionId });
    _wss.clients.forEach(client => {
      if (client.readyState === 1) {
        client.send(msg);
      }
    });
  }

  // --- HTTP helpers ---

  function generateRequestId() {
    return typeof crypto.randomUUID === 'function'
      ? crypto.randomUUID()
      : crypto.randomBytes(16).toString('hex');
  }

  function createRequestContext(req) {
    let pathname = '/';
    try {
      pathname = new URL(req?.url || '/', 'http://localhost').pathname;
    } catch {
      pathname = '/';
    }

    return {
      requestId: generateRequestId(),
      method: req?.method || null,
      path: pathname,
      startedAt: Date.now(),
      auth: {
        required: true,
        result: 'unknown',
      },
      response: null,
    };
  }

  function getRequestContext(res) {
    return res?._rudiRequestContext || null;
  }

  function attachRequestContext(res, requestContext) {
    if (!res || !requestContext) return requestContext;
    res._rudiRequestContext = requestContext;
    if (typeof res.setHeader === 'function') {
      res.setHeader(REQUEST_ID_HEADER, requestContext.requestId);
    }
    return requestContext;
  }

  function updateRequestAuth(res, authPatch) {
    const requestContext = getRequestContext(res);
    if (!requestContext) return null;
    requestContext.auth = {
      ...(requestContext.auth || {}),
      ...(authPatch || {}),
    };
    return requestContext.auth;
  }

  function markResponse(res, patch) {
    const requestContext = getRequestContext(res);
    if (!requestContext) return null;
    requestContext.response = {
      ...(requestContext.response || {}),
      ...(patch || {}),
    };
    return requestContext.response;
  }

  function buildJsonHeaders(res, headers = {}) {
    const requestContext = getRequestContext(res);
    return {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
      ...(requestContext?.requestId ? { [REQUEST_ID_HEADER]: requestContext.requestId } : {}),
      ...(headers || {}),
    };
  }

  function json(res, data, status = 200, options = {}) {
    markResponse(res, { status });
    res.writeHead(status, buildJsonHeaders(res, options.headers));
    res.end(JSON.stringify(data));
    return true;
  }

  function error(res, message, status = 400, options = {}) {
    const requestContext = getRequestContext(res);
    const errorDefinition = resolveSidecarErrorDefinition(options.code, status);
    const finalStatus = errorDefinition?.status ?? status;
    const payload = {
      error: message || errorDefinition?.defaultMessage || 'Error',
      code: errorDefinition?.code || 'ERROR',
    };
    if (options.details !== undefined) {
      payload.details = options.details;
    }
    if (requestContext?.requestId) {
      payload.requestId = requestContext.requestId;
    }

    markResponse(res, {
      status: finalStatus,
      errorCode: payload.code,
      errorDetails: payload.details,
    });
    json(res, payload, finalStatus, options);
    return true;
  }

  function errorCode(res, codeDefinition, options = {}) {
    const errorDefinition = resolveSidecarErrorDefinition(codeDefinition, options.status || 500);
    return error(
      res,
      options.message || errorDefinition?.defaultMessage || 'Error',
      options.status ?? errorDefinition?.status ?? 500,
      {
        ...options,
        code: errorDefinition,
      },
    );
  }

  function requiredField(res, field, options = {}) {
    return error(res, options.message || `${field} required`, options.status || 400, {
      ...options,
      code: options.code || SIDECAR_ERROR_CODES.MISSING_REQUIRED_FIELD,
      details: {
        field,
        location: options.location || 'body',
        ...(options.details || {}),
      },
    });
  }

  function requiredFields(res, fields, options = {}) {
    const normalizedFields = (Array.isArray(fields) ? fields : [fields]).filter(Boolean);
    const fieldLabel = normalizedFields.join(' and ');
    return error(res, options.message || `${fieldLabel} required`, options.status || 400, {
      ...options,
      code: options.code || SIDECAR_ERROR_CODES.MISSING_REQUIRED_FIELD,
      details: {
        fields: normalizedFields,
        location: options.location || 'body',
        ...(options.details || {}),
      },
    });
  }

  function invalidField(res, field, message, options = {}) {
    return error(res, message, options.status || 400, {
      ...options,
      code: options.code || SIDECAR_ERROR_CODES.INVALID_FIELD,
      details: {
        field,
        location: options.location || 'body',
        ...(options.reason ? { reason: options.reason } : {}),
        ...(options.details || {}),
      },
    });
  }

  const DEFAULT_MAX_BODY_SIZE = 10 * 1024 * 1024; // 10MB
  const BODY_READ_TIMEOUT = 30_000; // 30s

  async function readBody(req, options = {}) {
    const maxBodySize = Number.isFinite(options.maxBodySize) && options.maxBodySize > 0
      ? options.maxBodySize
      : DEFAULT_MAX_BODY_SIZE;
    const timeoutMs = Number.isFinite(options.timeoutMs) && options.timeoutMs > 0
      ? options.timeoutMs
      : BODY_READ_TIMEOUT;
    return new Promise((resolve, reject) => {
      const chunks = [];
      let size = 0;
      let settled = false;

      function resolveOnce(value) {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve(value);
      }

      function rejectOnce(err) {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        reject(err);
      }

      const timer = setTimeout(() => {
        try { req.destroy(); } catch {}
        const err = new Error('Request body read timed out');
        err.statusCode = 408;
        rejectOnce(err);
      }, timeoutMs);

      req.on('data', (chunk) => {
        size += chunk.length;
        if (size > maxBodySize) {
          try { req.destroy(); } catch {}
          const err = new Error('Request body too large');
          err.statusCode = 413;
          rejectOnce(err);
          return;
        }
        chunks.push(chunk);
      });

      req.on('end', () => {
        if (settled) return;
        try {
          resolveOnce(JSON.parse(Buffer.concat(chunks).toString()));
        } catch {
          const parseErr = new Error('Invalid JSON in request body');
          parseErr.statusCode = 400;
          rejectOnce(parseErr);
        }
      });

      req.on('error', (err) => {
        rejectOnce(err);
      });
    });
  }

  // --- Auth ---

  function generateToken() {
    return crypto.randomBytes(32).toString('hex');
  }

  function checkAuth(req) {
    const headerToken = req.headers['x-rudi-token'];
    if (headerToken === _token) return true;

    // Same-origin web mode: frontend served by sidecar sends 'same-origin' token
    if (headerToken === 'same-origin') {
      const host = req.headers.host || '';
      if (host.startsWith('127.0.0.1') || host.startsWith('localhost')) {
        return true;
      }
    }

    const url = new URL(req.url, `http://localhost`);
    if (url.searchParams.get('token') === _token) return true;

    return false;
  }

  return {
    // State accessors
    setWss, getWss,
    setToken, getToken,
    getLogs, getSseClients,
    // Functions
    log, broadcast,
    createRequestContext, attachRequestContext, getRequestContext, updateRequestAuth,
    json, error, errorCode, requiredField, requiredFields, invalidField, readBody,
    generateToken, checkAuth,
    // Constants
    SSE_CLIENT_CAP, REQUEST_ID_HEADER,
  };
}
