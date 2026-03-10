/**
 * Shared infrastructure factory for serve modules.
 *
 * Creates log, broadcast, json/error/readBody helpers, auth helpers,
 * and mutable state accessors (wss, token, logs ring buffer, SSE clients).
 * All mutable state is closure-private.
 */

import crypto from 'crypto';
import { URL } from 'url';

const LOG_MAX = 500;
const SSE_CLIENT_CAP = 50;

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

  function json(res, data, status = 200) {
    res.writeHead(status, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
    res.end(JSON.stringify(data));
    return true;
  }

  function error(res, message, status = 400) {
    json(res, { error: message }, status);
    return true;
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
    json, error, readBody,
    generateToken, checkAuth,
    // Constants
    SSE_CLIENT_CAP,
  };
}
