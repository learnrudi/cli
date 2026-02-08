/**
 * Serve command - HTTP + WebSocket server for RUDI Lite
 *
 * Usage:
 *   rudi serve                    Start server on dynamic port
 *   rudi serve --port 8100        Start on specific port
 *
 * Provides REST API + WebSocket for:
 *   - File system operations
 *   - Project/note/session CRUD
 *   - Agent process management
 *   - Auth status
 */

import http from 'http';
import fs from 'fs';
import fsp from 'fs/promises';
import path from 'path';
import os from 'os';
import crypto from 'crypto';
import { URL } from 'url';
import { spawn, execSync } from 'child_process';
import { PATHS } from '@learnrudi/env';
import { getDb, isDatabaseInitialized, initSchema } from '@learnrudi/db';
import { WebSocketServer } from 'ws';
import { createGitHandler, getProjectGitStatus } from './serve-git.js';
import { createAgentHandler, createIdleReaper, resolveClaudeBinary, checkProviderAuth } from './serve-agent.js';
import { createSessionsModule } from './serve-sessions.js';

// Re-exports for test compatibility
export { parseWorktreeList } from './serve-git.js';
export { extractSessionCwdFromJsonlChunk, parseSessionMessagesFromJsonl } from './serve-sessions.js';

// ---------------------------------------------------------------------------
// Server state
// ---------------------------------------------------------------------------

const PORT_FILE = path.join(PATHS.home, '.rudi-lite-port');
const TOKEN_FILE = path.join(PATHS.home, '.rudi-lite-token');
const FS_READDIR_CACHE_TTL_MS = 1200;

let wss;
const agentProcesses = new Map(); // sessionId -> { proc, provider, providerSessionId, stdoutBuffer }
const resumeSessionIndex = new Map(); // provider/resume session id -> sidecar session id
const fsWatchers = new Map(); // path -> { watcher, debounceTimer }
const fsReaddirCache = new Map(); // key -> { entries, fetchedAt }
const fsReaddirInFlight = new Map(); // key -> Promise<entries>
let fsReaddirCacheGeneration = 0;

// ---------------------------------------------------------------------------
// Auth helpers
// ---------------------------------------------------------------------------

function generateToken() {
  return crypto.randomBytes(32).toString('hex');
}

function checkAuth(req, token) {
  const headerToken = req.headers['x-rudi-token'];
  if (headerToken === token) return true;

  const url = new URL(req.url, `http://localhost`);
  if (url.searchParams.get('token') === token) return true;

  return false;
}

// ---------------------------------------------------------------------------
// JSON helpers
// ---------------------------------------------------------------------------

function json(res, data, status = 200) {
  res.writeHead(status, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
  res.end(JSON.stringify(data));
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

function invalidateFsReaddirCache() {
  fsReaddirCacheGeneration += 1;
  fsReaddirCache.clear();
}

function getFsReaddirCacheKey(dirPath, showHidden) {
  return `${showHidden ? '1' : '0'}:${dirPath}`;
}

async function readDirectoryEntries(dirPath, showHidden) {
  const cacheKey = getFsReaddirCacheKey(dirPath, showHidden);
  const now = Date.now();
  const cached = fsReaddirCache.get(cacheKey);
  if (cached && (now - cached.fetchedAt) <= FS_READDIR_CACHE_TTL_MS) {
    return cached.entries;
  }

  const inFlight = fsReaddirInFlight.get(cacheKey);
  if (inFlight) {
    return inFlight;
  }

  const generationAtStart = fsReaddirCacheGeneration;
  const request = (async () => {
    const names = await fsp.readdir(dirPath);
    const entries = await Promise.all(
      names
        .filter(n => showHidden || !n.startsWith('.'))
        .map(async (name) => {
          const fullPath = path.join(dirPath, name);
          try {
            const stat = await fsp.stat(fullPath);
            return {
              name,
              path: fullPath,
              isDirectory: stat.isDirectory(),
              isFile: stat.isFile(),
              size: stat.size,
              mtime: stat.mtime.toISOString(),
            };
          } catch {
            return null;
          }
        }),
    );
    return entries.filter(Boolean);
  })();

  fsReaddirInFlight.set(cacheKey, request);
  try {
    const entries = await request;
    if (generationAtStart === fsReaddirCacheGeneration) {
      fsReaddirCache.set(cacheKey, { entries, fetchedAt: Date.now() });
    }
    return entries;
  } finally {
    fsReaddirInFlight.delete(cacheKey);
  }
}

// ---------------------------------------------------------------------------
// Route: File System
// ---------------------------------------------------------------------------

async function handleFs(req, res, url) {
  const pathname = url.pathname;

  // GET /fs/read?path=
  if (req.method === 'GET' && pathname === '/fs/read') {
    const filePath = url.searchParams.get('path');
    if (!filePath) return error(res, 'path required');
    try {
      const content = await fsp.readFile(filePath, 'utf-8');
      json(res, { content });
    } catch (err) {
      error(res, err.message, 404);
    }
    return true;
  }

  // POST /fs/write {path, content}
  if (req.method === 'POST' && pathname === '/fs/write') {
    const body = await readBody(req);
    if (!body.path || body.content === undefined) return error(res, 'path and content required');
    try {
      await fsp.mkdir(path.dirname(body.path), { recursive: true });
      await fsp.writeFile(body.path, body.content, 'utf-8');
      invalidateFsReaddirCache();
      json(res, { ok: true });
    } catch (err) {
      error(res, err.message, 500);
    }
    return true;
  }

  // POST /fs/write-binary {path, base64}
  if (req.method === 'POST' && pathname === '/fs/write-binary') {
    const body = await readBody(req);
    if (!body.path || body.base64 === undefined) return error(res, 'path and base64 required');
    try {
      await fsp.mkdir(path.dirname(body.path), { recursive: true });
      const buffer = Buffer.from(body.base64, 'base64');
      await fsp.writeFile(body.path, buffer);
      invalidateFsReaddirCache();
      json(res, { ok: true });
    } catch (err) {
      error(res, err.message, 500);
    }
    return true;
  }

  // GET /fs/readdir?path=&showHidden=1
  if (req.method === 'GET' && pathname === '/fs/readdir') {
    const dirPath = url.searchParams.get('path');
    if (!dirPath) return error(res, 'path required');
    const showHidden = url.searchParams.get('showHidden') === '1';
    try {
      const entries = await readDirectoryEntries(dirPath, showHidden);
      json(res, { entries });
    } catch (err) {
      error(res, err.message, 404);
    }
    return true;
  }

  // GET /fs/stat?path=
  if (req.method === 'GET' && pathname === '/fs/stat') {
    const filePath = url.searchParams.get('path');
    if (!filePath) return error(res, 'path required');
    try {
      const stat = await fsp.stat(filePath);
      json(res, {
        name: path.basename(filePath),
        path: filePath,
        isDirectory: stat.isDirectory(),
        isFile: stat.isFile(),
        size: stat.size,
        mtime: stat.mtime.toISOString(),
      });
    } catch (err) {
      error(res, err.message, 404);
    }
    return true;
  }

  // GET /fs/serve?path= (binary file serving for images, PDFs)
  if (req.method === 'GET' && pathname === '/fs/serve') {
    const filePath = url.searchParams.get('path');
    if (!filePath) return error(res, 'path required');
    try {
      const stat = await fsp.stat(filePath);
      const ext = path.extname(filePath).toLowerCase();
      const mimeTypes = {
        '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
        '.gif': 'image/gif', '.svg': 'image/svg+xml', '.webp': 'image/webp',
        '.pdf': 'application/pdf', '.mp4': 'video/mp4', '.webm': 'video/webm',
        '.mp3': 'audio/mpeg', '.wav': 'audio/wav',
        '.json': 'application/json', '.csv': 'text/csv',
        '.html': 'text/html', '.txt': 'text/plain',
      };
      const contentType = mimeTypes[ext] || 'application/octet-stream';
      const etag = `"${stat.mtimeMs.toString(36)}-${stat.size.toString(36)}"`;
      if (req.headers['if-none-match'] === etag) {
        res.writeHead(304, { 'Access-Control-Allow-Origin': '*' });
        res.end();
        return true;
      }
      res.writeHead(200, {
        'Content-Type': contentType,
        'Content-Length': stat.size,
        'Access-Control-Allow-Origin': '*',
        'Cache-Control': 'public, max-age=5',
        'ETag': etag,
      });
      fs.createReadStream(filePath).pipe(res);
    } catch (err) {
      error(res, err.message, 404);
    }
    return true;
  }

  // POST /fs/mkdir {path}
  if (req.method === 'POST' && pathname === '/fs/mkdir') {
    const body = await readBody(req);
    if (!body.path) return error(res, 'path required');
    try {
      await fsp.mkdir(body.path, { recursive: true });
      invalidateFsReaddirCache();
      json(res, { ok: true });
    } catch (err) {
      error(res, err.message, 500);
    }
    return true;
  }

  // POST /fs/remove {path}
  if (req.method === 'POST' && pathname === '/fs/remove') {
    const body = await readBody(req);
    if (!body.path) return error(res, 'path required');
    try {
      await fsp.rm(body.path, { recursive: true });
      invalidateFsReaddirCache();
      json(res, { ok: true });
    } catch (err) {
      error(res, err.message, 500);
    }
    return true;
  }

  // POST /fs/rename {oldPath, newPath}
  if (req.method === 'POST' && pathname === '/fs/rename') {
    const body = await readBody(req);
    if (!body.oldPath || !body.newPath) return error(res, 'oldPath and newPath required');
    try {
      await fsp.rename(body.oldPath, body.newPath);
      invalidateFsReaddirCache();
      json(res, { ok: true });
    } catch (err) {
      error(res, err.message, 500);
    }
    return true;
  }

  // POST /fs/watch {path}
  if (req.method === 'POST' && pathname === '/fs/watch') {
    const body = await readBody(req);
    if (!body.path) return error(res, 'path required');
    const watchPath = body.path;

    if (fsWatchers.has(watchPath)) {
      json(res, { ok: true, already: true });
      return true;
    }

    try {
      const watcher = fs.watch(watchPath, { recursive: true }, (eventType, filename) => {
        if (!filename) return;
        const entry = fsWatchers.get(watchPath);
        if (!entry) return;

        clearTimeout(entry.debounceTimer);
        entry.debounceTimer = setTimeout(() => {
          const fullPath = path.join(watchPath, filename);
          const dirPath = path.dirname(fullPath);
          invalidateFsReaddirCache();
          broadcast('fs:change', { event: eventType, path: fullPath, dir: dirPath });
        }, 100);
      });

      fsWatchers.set(watchPath, { watcher, debounceTimer: null });
      log('fs', 'info', `watching ${watchPath}`);
      json(res, { ok: true });
    } catch (err) {
      error(res, err.message, 500);
    }
    return true;
  }

  // POST /fs/unwatch {path}
  if (req.method === 'POST' && pathname === '/fs/unwatch') {
    const body = await readBody(req);
    if (!body.path) return error(res, 'path required');
    const entry = fsWatchers.get(body.path);
    if (entry) {
      clearTimeout(entry.debounceTimer);
      entry.watcher.close();
      fsWatchers.delete(body.path);
      log('fs', 'info', `unwatched ${body.path}`);
    }
    json(res, { ok: true });
    return true;
  }

  return false;
}

// ---------------------------------------------------------------------------
// Route: Auth
// ---------------------------------------------------------------------------

async function handleAuth(req, res, url) {
  // GET /auth/status?provider=
  if (req.method === 'GET' && url.pathname === '/auth/status') {
    const provider = url.searchParams.get('provider') || 'claude';
    try {
      const status = await checkProviderAuth(provider);
      json(res, status);
    } catch (err) {
      json(res, {
        provider,
        ready: false,
        runtime: { installed: false },
        credential: { authenticated: false, method: 'none' },
        action: { type: 'install', message: err.message },
      });
    }
    return true;
  }

  // POST /auth/login {provider, apiKey?}
  if (req.method === 'POST' && url.pathname === '/auth/login') {
    const body = await readBody(req);
    const provider = body.provider || 'claude';

    if (body.apiKey || body.oauthToken) {
      try {
        const envPath = path.join(PATHS.home, '.env');
        let content = '';
        if (fs.existsSync(envPath)) {
          content = fs.readFileSync(envPath, 'utf-8');
        }
        if (body.oauthToken) {
          content = content.replace(/^CLAUDE_CODE_OAUTH_TOKEN=.*$/m, '').trim();
          content += `\nCLAUDE_CODE_OAUTH_TOKEN=${body.oauthToken}\n`;
          process.env.CLAUDE_CODE_OAUTH_TOKEN = body.oauthToken;
          log('auth', 'info', 'OAuth token saved to .env');
        } else {
          content = content.replace(/^ANTHROPIC_API_KEY=.*$/m, '').trim();
          content += `\nANTHROPIC_API_KEY=${body.apiKey}\n`;
          process.env.ANTHROPIC_API_KEY = body.apiKey;
          log('auth', 'info', 'API key saved to .env');
        }
        fs.writeFileSync(envPath, content.trim() + '\n');
        json(res, { ok: true });
      } catch (err) {
        log('auth', 'error', `Failed to save credential: ${err.message}`);
        error(res, `Failed to save credential: ${err.message}`, 500);
      }
    } else {
      const binaryPath = resolveClaudeBinary();
      if (binaryPath && os.platform() === 'darwin') {
        try {
          const helperPath = path.join(PATHS.home, '.login-helper.sh');
          const envPath = path.join(PATHS.home, '.env');
          const captureFile = path.join(PATHS.home, '.setup-token-output');
          const script = [
            '#!/bin/bash',
            `CAPTURE="${captureFile}"`,
            `ENV_FILE="${envPath}"`,
            `script -q "$CAPTURE" "${binaryPath}" setup-token`,
            `CLEAN=$(sed 's/\\x1b\\[[0-9;]*[a-zA-Z]//g; s/\\x1b\\[[?][0-9]*[a-z]//g' "$CAPTURE" | tr -d '\\r')`,
            `TOKEN=$(echo "$CLEAN" | sed -n '/^sk-ant-oat/{N;s/\\n//;p;}' | grep -oE 'sk-ant-oat[A-Za-z0-9_-]+' | head -1)`,
            '# Reject placeholders and short matches (real tokens are 80+ chars)',
            'if [ -n "$TOKEN" ] && [ ${#TOKEN} -gt 30 ]; then',
            '  touch "$ENV_FILE"',
            '  sed -i \'\' \'/^CLAUDE_CODE_OAUTH_TOKEN=/d\' "$ENV_FILE"',
            '  echo "CLAUDE_CODE_OAUTH_TOKEN=$TOKEN" >> "$ENV_FILE"',
            '  rm -f "$CAPTURE"',
            '  echo ""',
            '  echo "✓ Token saved to RUDI. You can close this window."',
            'else',
            '  echo ""',
            '  echo "Could not detect a valid token. Capture file kept for debugging:"',
            '  echo "  $CAPTURE"',
            'fi',
          ].join('\n');
          fs.writeFileSync(helperPath, script, { mode: 0o755 });

          execSync(`osascript -e 'tell application "Terminal" to do script "${helperPath}"'`, { stdio: 'pipe' });
          log('auth', 'info', 'Launched login helper in Terminal.app');
          json(res, { ok: true, launched: true });
        } catch (err) {
          log('auth', 'warn', `Failed to launch login helper: ${err.message}`);
          json(res, { ok: true, message: `Run 'claude setup-token' in a terminal to authenticate` });
        }
      } else {
        json(res, { ok: true, message: `Run 'claude setup-token' in a terminal to authenticate` });
      }
    }
    return true;
  }

  return false;
}

// ---------------------------------------------------------------------------
// Route: Projects
// ---------------------------------------------------------------------------

function handleProjects(req, res, url) {
  if (!isDatabaseInitialized()) {
    return error(res, 'Database not initialized', 503), true;
  }

  const db = getDb();

  // GET /projects
  if (req.method === 'GET' && url.pathname === '/projects') {
    const rows = db.prepare(`
      SELECT p.id, p.provider, p.name, p.color, p.created_at, p.updated_at,
        COUNT(s.id) as session_count
      FROM projects p
      LEFT JOIN sessions s ON s.project_id = p.id
      GROUP BY p.id
      ORDER BY p.updated_at DESC
    `).all();
    const projects = rows.map(r => ({
      id: r.id,
      name: r.name,
      provider: r.provider,
      color: r.color,
      path: '',
      sessionCount: r.session_count,
      createdAt: r.created_at,
      updatedAt: r.updated_at,
    }));
    json(res, { projects });
    return true;
  }

  // POST /projects {name, path?}
  if (req.method === 'POST' && url.pathname === '/projects') {
    return (async () => {
      const body = await readBody(req);
      if (!body.name) return error(res, 'name required');
      const id = `proj-${body.name.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '')}`;
      try {
        db.prepare(`
          INSERT INTO projects (id, provider, name, created_at, updated_at)
          VALUES (?, 'claude', ?, datetime('now'), datetime('now'))
        `).run(id, body.name);
        json(res, { id, name: body.name, path: body.path || '', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() }, 201);
      } catch (err) {
        error(res, err.message, 409);
      }
    })(), true;
  }

  // Match /projects/:id
  const match = url.pathname.match(/^\/projects\/([^/]+)$/);
  if (match) {
    const id = decodeURIComponent(match[1]);

    // POST /projects/:id (update)
    if (req.method === 'POST') {
      return (async () => {
        const body = await readBody(req);
        const sets = [];
        const params = [];
        if (body.name) { sets.push('name = ?'); params.push(body.name); }
        if (body.color) { sets.push('color = ?'); params.push(body.color); }
        sets.push("updated_at = datetime('now')");
        params.push(id);
        db.prepare(`UPDATE projects SET ${sets.join(', ')} WHERE id = ?`).run(...params);
        json(res, { id, ...body });
      })(), true;
    }

    // DELETE /projects/:id
    if (req.method === 'DELETE') {
      db.prepare('UPDATE sessions SET project_id = NULL WHERE project_id = ?').run(id);
      db.prepare('DELETE FROM projects WHERE id = ?').run(id);
      json(res, { ok: true });
      return true;
    }
  }

  return false;
}

// ---------------------------------------------------------------------------
// Route: Notes (file-based in ~/.rudi/notes/)
// ---------------------------------------------------------------------------

const NOTES_DIR = path.join(PATHS.home, 'notes');

async function handleNotes(req, res, url) {
  await fsp.mkdir(NOTES_DIR, { recursive: true });

  // GET /notes
  if (req.method === 'GET' && url.pathname === '/notes') {
    try {
      const files = await fsp.readdir(NOTES_DIR);
      const notes = await Promise.all(
        files.filter(f => f.endsWith('.json')).map(async (f) => {
          const content = await fsp.readFile(path.join(NOTES_DIR, f), 'utf-8');
          return JSON.parse(content);
        })
      );
      notes.sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());
      json(res, { notes });
    } catch {
      json(res, { notes: [] });
    }
    return true;
  }

  // POST /notes {title, content}
  if (req.method === 'POST' && url.pathname === '/notes') {
    const body = await readBody(req);
    if (!body.title) return error(res, 'title required');
    const id = crypto.randomUUID();
    const now = new Date().toISOString();
    const note = { id, title: body.title, content: body.content || '', createdAt: now, updatedAt: now };
    await fsp.writeFile(path.join(NOTES_DIR, `${id}.json`), JSON.stringify(note, null, 2));
    json(res, note, 201);
    return true;
  }

  // Match /notes/:id
  const match = url.pathname.match(/^\/notes\/([^/]+)$/);
  if (match) {
    const id = decodeURIComponent(match[1]);
    const filePath = path.join(NOTES_DIR, `${id}.json`);

    // GET /notes/:id
    if (req.method === 'GET') {
      try {
        const content = await fsp.readFile(filePath, 'utf-8');
        json(res, JSON.parse(content));
      } catch {
        error(res, 'Note not found', 404);
      }
      return true;
    }

    // POST /notes/:id (update)
    if (req.method === 'POST') {
      try {
        const existing = JSON.parse(await fsp.readFile(filePath, 'utf-8'));
        const body = await readBody(req);
        const updated = {
          ...existing,
          ...body,
          id,
          updatedAt: new Date().toISOString(),
        };
        await fsp.writeFile(filePath, JSON.stringify(updated, null, 2));
        json(res, updated);
      } catch {
        error(res, 'Note not found', 404);
      }
      return true;
    }

    // DELETE /notes/:id
    if (req.method === 'DELETE') {
      try {
        await fsp.rm(filePath);
        json(res, { ok: true });
      } catch {
        error(res, 'Note not found', 404);
      }
      return true;
    }
  }

  return false;
}

// ---------------------------------------------------------------------------
// Instantiate extracted route modules
// ---------------------------------------------------------------------------

const handleGit = createGitHandler({ readBody, error, json });

// Sessions module (stateful — owns watcher, cache, debounce timers)
const sessionsModule = createSessionsModule({
  log, broadcast, json, error, readBody, getProjectGitStatus,
});
const { handleSessions, startSessionsWatcher, queueSessionsUpdated, cleanup: cleanupSessions } = sessionsModule;

const MAX_CONCURRENT = parseInt(process.env.RUDI_MAX_AGENT_PROCESSES || '3', 10) || 3;
const IDLE_TIMEOUT_MS = parseInt(process.env.RUDI_IDLE_TIMEOUT_MS || String(10 * 60 * 1000), 10) || 10 * 60 * 1000;

const handleAgent = createAgentHandler({
  agentProcesses,
  resumeSessionIndex,
  readBody,
  error,
  json,
  log,
  broadcast,
  queueSessionsUpdated,
  maxConcurrent: MAX_CONCURRENT,
});

// ---------------------------------------------------------------------------
// Shell operations
// ---------------------------------------------------------------------------

async function handleShell(req, res, url) {
  // POST /shell/reveal
  if (req.method === 'POST' && url.pathname === '/shell/reveal') {
    const body = await readBody(req);
    if (!body.path) { error(res, 'path required'); return true; }
    const child = spawn('open', ['-R', body.path], { detached: true, stdio: 'ignore' });
    child.unref();
    json(res, { ok: true });
    return true;
  }

  // POST /shell/open
  if (req.method === 'POST' && url.pathname === '/shell/open') {
    const body = await readBody(req);
    if (!body.path) { error(res, 'path required'); return true; }
    if (!body.app) { error(res, 'app required'); return true; }

    const p = body.path;
    let cmd, args;
    switch (body.app) {
      case 'vscode':      cmd = 'code';       args = [p]; break;
      case 'cursor':      cmd = 'cursor';     args = [p]; break;
      case 'finder':      cmd = 'open';       args = [p]; break;
      case 'xcode':       cmd = 'open';       args = ['-a', 'Xcode', p]; break;
      case 'antigravity': cmd = 'open';       args = ['-a', 'Antigravity', p]; break;
      case 'warp':        cmd = 'open';       args = ['-a', 'Warp', p]; break;
      case 'terminal': {
        const script = [
          'tell application "Terminal"',
          '  activate',
          `  do script "cd ${p.replace(/"/g, '\\"')}"`,
          'end tell',
        ].join('\n');
        cmd = 'osascript';
        args = ['-e', script];
        break;
      }
      default: error(res, `unknown app: ${body.app}`); return true;
    }

    console.log(`[shell/open] ${cmd} ${args.join(' ')}`);
    const child = spawn(cmd, args, { detached: true, stdio: 'pipe' });
    child.stderr.on('data', (d) => console.error(`[shell/open] stderr: ${d}`));
    child.on('error', (err) => console.error(`[shell/open] spawn error:`, err));
    child.unref();
    json(res, { ok: true });
    return true;
  }

  return false;
}

// ---------------------------------------------------------------------------
// Observability: ring buffer log + SSE stream
// ---------------------------------------------------------------------------

const LOG_MAX = 500;
const _logs = [];
const _sseClients = [];

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

async function handleLogs(req, res, url) {
  // GET /logs
  if (req.method === 'GET' && url.pathname === '/logs') {
    const limit = parseInt(url.searchParams.get('limit') || '50', 10);
    const source = url.searchParams.get('source');
    const level = url.searchParams.get('level');
    let filtered = _logs;
    if (source) filtered = filtered.filter(e => e.source === source);
    if (level) filtered = filtered.filter(e => e.level === level);
    json(res, { logs: filtered.slice(-limit) });
    return true;
  }

  // POST /logs
  if (req.method === 'POST' && url.pathname === '/logs') {
    const body = await readBody(req);
    log(body.source || 'frontend', body.level || 'info', body.message || '', body.data);
    json(res, { ok: true });
    return true;
  }

  // GET /logs/stream — SSE
  if (req.method === 'GET' && url.pathname === '/logs/stream') {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
      'Access-Control-Allow-Origin': '*',
    });
    res.write(`data: ${JSON.stringify({ type: 'connected', buffered: _logs.length })}\n\n`);
    _sseClients.push(res);
    req.on('close', () => {
      const idx = _sseClients.indexOf(res);
      if (idx >= 0) _sseClients.splice(idx, 1);
    });
    return true;
  }

  return false;
}

// ---------------------------------------------------------------------------
// WebSocket broadcast
// ---------------------------------------------------------------------------

function broadcast(type, data) {
  if (!wss) return;
  const msg = JSON.stringify({ type, data });
  log('ws', 'debug', `broadcast ${type}`, { type, sessionId: data?.sessionId });
  wss.clients.forEach(client => {
    if (client.readyState === 1) {
      client.send(msg);
    }
  });
}

// ---------------------------------------------------------------------------
// Main server
// ---------------------------------------------------------------------------

export async function cmdServe(args, flags) {
  // Ensure database exists so /projects endpoints work
  if (!isDatabaseInitialized()) {
    try {
      initSchema();
      console.log('[serve] Initialized database schema');
    } catch (err) {
      console.warn('[serve] Failed to initialize database schema:', err);
    }
  }

  // Kill orphaned Claude CLI processes from previous sidecar runs.
  // Only target orphaned stream-json Claude processes (PPID 1).
  try {
    const psOutput = execSync('ps -axo pid=,ppid=,command=', {
      encoding: 'utf-8',
      timeout: 3000,
    });
    const orphanPids = psOutput
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => {
        const match = line.match(/^(\d+)\s+(\d+)\s+(.*)$/);
        if (!match) return null;
        return {
          pid: parseInt(match[1], 10),
          ppid: parseInt(match[2], 10),
          command: match[3],
        };
      })
      .filter((entry) => (
        entry
        && entry.ppid <= 1
        && entry.command.includes('claude')
        && entry.command.includes('--output-format stream-json')
        && entry.command.includes('--input-format stream-json')
      ))
      .map((entry) => entry.pid);

    if (orphanPids.length > 0) {
      log('serve', 'warn', `Killing ${orphanPids.length} orphaned Claude CLI process(es)`, { pids: orphanPids });
      for (const pid of orphanPids) {
        try { process.kill(pid, 'SIGTERM'); } catch {}
      }
      for (const pid of orphanPids) {
        try {
          const alive = execSync(`ps -p ${pid} -o pid=`, {
            encoding: 'utf-8',
            timeout: 500,
          }).trim();
          if (alive) {
            try { process.kill(pid, 'SIGKILL'); } catch {}
          }
        } catch {
          // already exited
        }
      }
    }
  } catch {
    // best effort only
  }

  const requestedPort = parseInt(flags.port, 10) || 0;
  const token = generateToken();

  const server = http.createServer(async (req, res) => {
    // CORS preflight
    if (req.method === 'OPTIONS') {
      res.writeHead(204, {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type, X-Rudi-Token',
      });
      res.end();
      return;
    }

    const url = new URL(req.url, `http://localhost`);
    const start = Date.now();

    // Health check (no auth required)
    if (url.pathname === '/health') {
      json(res, { status: 'ok', version: '0.1.0' });
      return;
    }

    // Environment info (needs auth)
    if (url.pathname === '/env') {
      if (!checkAuth(req, token)) { error(res, 'Unauthorized', 401); return; }
      json(res, { home: os.homedir(), platform: os.platform() });
      return;
    }

    // Auth check
    if (!checkAuth(req, token)) {
      log('http', 'warn', `401 ${req.method} ${url.pathname}`);
      error(res, 'Unauthorized', 401);
      return;
    }

    // Route to handlers
    try {
      if (url.pathname.startsWith('/logs')) {
        if (await handleLogs(req, res, url)) return;
      }
      if (url.pathname.startsWith('/fs/')) {
        if (await handleFs(req, res, url)) return;
      }
      if (url.pathname.startsWith('/auth/')) {
        if (await handleAuth(req, res, url)) return;
      }
      if (url.pathname.startsWith('/projects')) {
        if (handleProjects(req, res, url)) return;
      }
      if (url.pathname.startsWith('/notes')) {
        if (await handleNotes(req, res, url)) return;
      }
      if (url.pathname.startsWith('/sessions')) {
        if (await handleSessions(req, res, url)) return;
      }
      if (url.pathname.startsWith('/git/')) {
        if (await handleGit(req, res, url)) return;
      }
      if (url.pathname.startsWith('/agent/')) {
        if (await handleAgent(req, res, url)) return;
      }
      if (url.pathname.startsWith('/shell/')) {
        if (await handleShell(req, res, url)) return;
      }

      log('http', 'warn', `404 ${req.method} ${url.pathname}`);
      error(res, 'Not found', 404);
    } catch (err) {
      log('http', 'error', `500 ${req.method} ${url.pathname}: ${err.message}`, { stack: err.stack });
      error(res, 'Internal server error', 500);
    } finally {
      const ms = Date.now() - start;
      if (!url.pathname.startsWith('/logs') && url.pathname !== '/health') {
        log('http', 'info', `${req.method} ${url.pathname} ${ms}ms`);
      }
    }
  });

  // WebSocket server
  wss = new WebSocketServer({ noServer: true });

  server.on('upgrade', (req, socket, head) => {
    const url = new URL(req.url, `http://localhost`);
    if (url.searchParams.get('token') !== token) {
      socket.destroy();
      return;
    }
    wss.handleUpgrade(req, socket, head, (ws) => {
      wss.emit('connection', ws, req);
    });
  });

  wss.on('connection', (ws) => {
    log('ws', 'info', `client connected (total: ${wss.clients.size})`);
    ws.send(JSON.stringify({ type: 'connected', data: { version: '0.1.0' } }));
    ws.on('close', () => {
      log('ws', 'info', `client disconnected (total: ${wss.clients.size})`);
    });
  });

  startSessionsWatcher();

  const stopIdleReaper = createIdleReaper({
    agentProcesses,
    broadcast,
    log,
    idleTimeoutMs: IDLE_TIMEOUT_MS,
    maxConcurrent: MAX_CONCURRENT,
  });

  // Start listening
  server.listen(requestedPort, '127.0.0.1', () => {
    const actualPort = server.address().port;

    // Write port and token files
    fs.mkdirSync(PATHS.home, { recursive: true });
    fs.writeFileSync(PORT_FILE, String(actualPort));
    fs.writeFileSync(TOKEN_FILE, token);

    console.log('');
    console.log('═'.repeat(50));
    console.log('  RUDI Lite Server');
    console.log('═'.repeat(50));
    console.log(`  Port:  ${actualPort}`);
    console.log(`  Token: ${token.slice(0, 8)}...`);
    console.log(`  PID:   ${process.pid}`);
    console.log('');
    console.log(`  Port file:  ${PORT_FILE}`);
    console.log(`  Token file: ${TOKEN_FILE}`);
    console.log('═'.repeat(50));
    console.log('');
  });

  // Cleanup on exit
  let cleanupDone = false;
  const cleanup = (exitCode = 0) => {
    if (cleanupDone) return;
    cleanupDone = true;
    try { fs.unlinkSync(PORT_FILE); } catch {}
    try { fs.unlinkSync(TOKEN_FILE); } catch {}
    for (const [, { proc }] of agentProcesses) {
      try { proc.kill(); } catch {}
    }
    resumeSessionIndex.clear();
    for (const [, entry] of fsWatchers) {
      try {
        clearTimeout(entry.debounceTimer);
        entry.watcher.close();
      } catch {}
    }
    fsWatchers.clear();
    cleanupSessions();
    stopIdleReaper();
    process.exit(exitCode);
  };

  process.on('SIGINT', () => cleanup(0));
  process.on('SIGTERM', () => cleanup(0));
  process.on('uncaughtException', (err) => {
    log('serve', 'error', `Uncaught exception: ${err.message}`);
    cleanup(1);
  });
  process.on('unhandledRejection', (err) => {
    log('serve', 'error', `Unhandled rejection: ${err}`);
    cleanup(1);
  });
}
