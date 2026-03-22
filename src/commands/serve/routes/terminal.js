/**
 * Embedded terminal — PTY management via @lydell/node-pty.
 *
 * Owns: terminalSessions Map, pendingTerminalOpens Set, ptyModulePromise.
 */

export function buildTerminalRoutes(ctx) {
  const { json, error, readBody, broadcast, requiredField, requiredFields } = ctx;

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
    if (!ptyModulePromise) {
      ptyModulePromise = import('@lydell/node-pty')
        .then((mod) => (mod?.spawn ? mod : (mod?.default?.spawn ? mod.default : null)))
        .catch(() => null);
    }
    return ptyModulePromise;
  }

  async function handle(req, res, url) {
    // POST /terminal/open { sessionKey, cwd, shell? }
    if (req.method === 'POST' && url.pathname === '/terminal/open') {
      const body = await readBody(req);
      const sessionKey = String(body.sessionKey || 'global');
      const cwd = body.cwd;
      const shellPath = body.shell || '/bin/zsh';
      if (!cwd || typeof cwd !== 'string') return requiredField(res, 'cwd');

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
        try { existing.proc.kill(); } catch {}
        terminalSessions.delete(sessionKey);
      }

      const nodePty = await getPtyModule();
      if (!nodePty?.spawn) {
        return error(res, 'Real PTY backend unavailable: install @lydell/node-pty in cli workspace', 503);
      }

      pendingTerminalOpens.add(sessionKey);
      try {
        const cols = Number(body.cols) || 80;
        const rows = Number(body.rows) || 24;
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
      const data = typeof body.data === 'string' ? body.data : '';
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
      try { entry.proc.kill(); } catch {}
      terminalSessions.delete(sessionKey);
      return json(res, { ok: true });
    }

    return false;
  }

  function cleanup() {
    for (const [, { proc }] of terminalSessions) {
      try { proc.kill(); } catch {}
    }
    terminalSessions.clear();
  }

  return { handle, cleanup };
}
