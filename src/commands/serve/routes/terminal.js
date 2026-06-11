/**
 * Embedded terminal — PTY management via @lydell/node-pty.
 *
 * Owns: terminalSessions Map, pendingTerminalOpens Set, ptyModulePromise.
 */

import fs from 'fs';
import { rejectInvalidPathField } from '../validation.js';

const DEFAULT_TERMINAL_SHELL = '/bin/zsh';
const ALLOWED_TERMINAL_SHELLS = ['/bin/zsh', '/bin/bash', '/bin/sh'];
const ALLOWED_TERMINAL_SHELL_SET = new Set(ALLOWED_TERMINAL_SHELLS);
const MAX_TERMINAL_DIMENSION = 1000;

export function buildTerminalRoutes(ctx, deps = {}) {
  const { json, error, readBody, broadcast, requiredField, requiredFields, invalidField, log } = ctx;

  const terminalSessions = new Map(); // sessionKey -> { proc, cwd, shell, buffer }
  const pendingTerminalOpens = new Set(); // sessionKey lock to prevent double-spawn races
  let ptyModulePromise = null;

  class TerminalBuffer {
    constructor(maxBytes = 100 * 1024) {
      this._maxBytes = maxBytes;
      this._chunks = [];
      this._totalBytes = 0;
    }
    append(data) {
      const len = Buffer.byteLength(data);
      this._chunks.push({ data, len });
      this._totalBytes += len;
      while (this._totalBytes > this._maxBytes && this._chunks.length > 1) {
        const evicted = this._chunks.shift();
        this._totalBytes -= evicted.len;
      }
    }
    getAll() {
      return this._chunks.map((c) => c.data).join('');
    }
  }

  async function getPtyModule() {
    if (Object.prototype.hasOwnProperty.call(deps, 'ptyModule')) {
      return deps.ptyModule;
    }

    if (!ptyModulePromise) {
      ptyModulePromise = import('@lydell/node-pty')
        .then((mod) => (mod?.spawn ? mod : (mod?.default?.spawn ? mod.default : null)))
        .catch(() => null);
    }
    return ptyModulePromise;
  }

  function rejectTerminalCwd(cwd, res) {
    if (!cwd || typeof cwd !== 'string') {
      return requiredField(res, 'cwd');
    }

    if (rejectInvalidPathField({
      value: cwd,
      field: 'cwd',
      res,
      invalidField,
      error,
    })) {
      return true;
    }

    let stat;
    try {
      stat = fs.statSync(cwd);
    } catch {
      invalidField(res, 'cwd', 'cwd must reference an existing directory', {
        reason: 'path_not_found',
      });
      return true;
    }

    if (!stat.isDirectory()) {
      invalidField(res, 'cwd', 'cwd must reference an existing directory', {
        reason: 'not_directory',
      });
      return true;
    }

    return false;
  }

  function rejectTerminalShell(shellPath, res) {
    if (typeof shellPath !== 'string' || !ALLOWED_TERMINAL_SHELL_SET.has(shellPath)) {
      invalidField(res, 'shell', `shell must be one of ${ALLOWED_TERMINAL_SHELLS.join(', ')}`, {
        reason: 'unsupported_value',
        details: {
          allowed: ALLOWED_TERMINAL_SHELLS,
          value: shellPath,
        },
      });
      return true;
    }

    return false;
  }

  function parseTerminalDimension(value, field, fallback, res) {
    if (value === undefined || value === null || value === '') {
      return fallback;
    }

    const dimension = Number(value);
    if (!Number.isInteger(dimension) || dimension <= 0 || dimension > MAX_TERMINAL_DIMENSION) {
      invalidField(res, field, `${field} must be a positive integer`, {
        reason: 'invalid_terminal_dimension',
      });
      return null;
    }

    return dimension;
  }

  function killTerminalProcess(proc, reason) {
    try {
      proc.kill();
    } catch (err) {
      log?.('terminal', 'warn', `failed to kill terminal process during ${reason}: ${err.message}`);
    }
  }

  async function handle(req, res, url) {
    // POST /terminal/open { sessionKey, cwd, shell? }
    if (req.method === 'POST' && url.pathname === '/terminal/open') {
      const body = await readBody(req);
      const sessionKey = String(body.sessionKey || 'global');
      const cwd = body.cwd;
      const shellPath = body.shell === undefined ? DEFAULT_TERMINAL_SHELL : body.shell;
      if (rejectTerminalCwd(cwd, res)) return true;
      if (rejectTerminalShell(shellPath, res)) return true;

      // Prevent double-spawn races
      if (pendingTerminalOpens.has(sessionKey)) {
        return error(res, 'Terminal open already in progress for this key', 409);
      }

      // Reuse existing session if CWD matches
      const existing = terminalSessions.get(sessionKey);
      if (existing) {
        if (existing.cwd === cwd) {
          return json(res, { ok: true, sessionKey, reused: true, buffer: existing.buffer.getAll() });
        }
        killTerminalProcess(existing.proc, 'session replacement');
        terminalSessions.delete(sessionKey);
      }

      const nodePty = await getPtyModule();
      if (!nodePty?.spawn) {
        return error(res, 'Real PTY backend unavailable: install @lydell/node-pty in cli workspace', 503);
      }

      const cols = parseTerminalDimension(body.cols, 'cols', 80, res);
      if (cols === null) return true;
      const rows = parseTerminalDimension(body.rows, 'rows', 24, res);
      if (rows === null) return true;

      pendingTerminalOpens.add(sessionKey);
      try {
        const proc = nodePty.spawn(shellPath, ['-il'], {
          name: 'xterm-256color',
          cols,
          rows,
          cwd,
          env: { ...process.env, TERM: 'xterm-256color', COLORTERM: 'truecolor' },
        });

        const buffer = new TerminalBuffer();
        const entry = { proc, cwd, shell: shellPath, buffer };
        terminalSessions.set(sessionKey, entry);

        proc.onData((data) => {
          entry.buffer.append(data);
          broadcast('terminal:data', { sessionKey, data });
        });
        proc.onExit(({ exitCode }) => {
          if (terminalSessions.get(sessionKey)?.proc === proc) {
            terminalSessions.delete(sessionKey);
          }
          broadcast('terminal:exit', { sessionKey, code: typeof exitCode === 'number' ? exitCode : null });
        });

        return json(res, { ok: true, sessionKey, reused: false });
      } catch (err) {
        return error(res, err.message || 'Failed to open terminal', 500);
      } finally {
        pendingTerminalOpens.delete(sessionKey);
      }
    }

    // POST /terminal/write { sessionKey, data }
    if (req.method === 'POST' && url.pathname === '/terminal/write') {
      const body = await readBody(req);
      const sessionKey = String(body.sessionKey || 'global');
      if (body.data === undefined) return requiredField(res, 'data');
      if (typeof body.data !== 'string') {
        return invalidField(res, 'data', 'data must be a string', {
          reason: 'invalid_type',
        });
      }
      const data = body.data;
      const entry = terminalSessions.get(sessionKey);
      if (!entry) return error(res, 'terminal session not found', 404);
      try {
        entry.proc.write(data);
        return json(res, { ok: true });
      } catch (err) {
        return error(res, err.message || 'Failed to write terminal', 500);
      }
    }

    // POST /terminal/resize { sessionKey, cols, rows }
    if (req.method === 'POST' && url.pathname === '/terminal/resize') {
      const body = await readBody(req);
      const sessionKey = String(body.sessionKey || 'global');
      const cols = Number(body.cols || 0);
      const rows = Number(body.rows || 0);
      const entry = terminalSessions.get(sessionKey);
      if (!entry) return error(res, 'terminal session not found', 404);
      if (!Number.isFinite(cols) || !Number.isFinite(rows) || cols <= 0 || rows <= 0) {
        return requiredFields(res, ['cols', 'rows']);
      }
      try {
        entry.proc.resize(Math.floor(cols), Math.floor(rows));
        return json(res, { ok: true });
      } catch (err) {
        return error(res, err.message || 'Failed to resize terminal', 500);
      }
    }

    // POST /terminal/close { sessionKey }
    if (req.method === 'POST' && url.pathname === '/terminal/close') {
      const body = await readBody(req);
      const sessionKey = String(body.sessionKey || 'global');
      const entry = terminalSessions.get(sessionKey);
      if (!entry) return json(res, { ok: true });
      killTerminalProcess(entry.proc, 'session close');
      terminalSessions.delete(sessionKey);
      return json(res, { ok: true });
    }

    return false;
  }

  function cleanup() {
    for (const [, { proc }] of terminalSessions) {
      killTerminalProcess(proc, 'route cleanup');
    }
    terminalSessions.clear();
  }

  return { handle, cleanup };
}
