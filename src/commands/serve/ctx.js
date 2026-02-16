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

  async function readBody(req) {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    return JSON.parse(Buffer.concat(chunks).toString());
  }

  // --- Auth ---

  function generateToken() {
    return crypto.randomBytes(32).toString('hex');
  }

  function checkAuth(req) {
    const headerToken = req.headers['x-rudi-token'];
    if (headerToken === _token) return true;

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
