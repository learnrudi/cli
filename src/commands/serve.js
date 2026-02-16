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
import path from 'path';
import os from 'os';
import { URL } from 'url';
import { PATHS } from '@learnrudi/env';
import { getDb } from '@learnrudi/db';
import { WebSocketServer } from 'ws';

// Serve subsystem modules
import { createGitHandler, getProjectGitStatus } from './serve/git.js';
import { createAgentHandler, createIdleReaper } from './serve/agent.js';
import { createSessionsModule } from './serve/sessions.js';
import { createInfrastructure } from './serve/ctx.js';
import { runStartupTasks } from './serve/startup.js';
import { buildLogsRoutes } from './serve/routes/logs.js';
import { buildFsRoutes } from './serve/routes/fs.js';
import { buildAuthRoutes } from './serve/routes/auth.js';
import { buildProjectRoutes } from './serve/routes/projects.js';
import { buildNotesRoutes } from './serve/routes/notes.js';
import { buildShellRoutes } from './serve/routes/shell.js';
import { buildTerminalRoutes } from './serve/routes/terminal.js';
import { buildSuggestRoutes } from './serve/routes/suggest.js';
import { buildProviderRoutes } from './serve/routes/providers.js';

// Re-exports for test compatibility
export { parseWorktreeList } from './serve/git.js';
export { extractSessionCwdFromJsonlChunk, parseSessionMessagesFromJsonl } from './serve/sessions.js';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const PORT_FILE = path.join(PATHS.home, '.rudi-lite-port');
const TOKEN_FILE = path.join(PATHS.home, '.rudi-lite-token');
const MAX_CONCURRENT = parseInt(process.env.RUDI_MAX_AGENT_PROCESSES || '10', 10) || 10;
const IDLE_TIMEOUT_MS = parseInt(process.env.RUDI_IDLE_TIMEOUT_MS || String(10 * 60 * 1000), 10) || 10 * 60 * 1000;

// ---------------------------------------------------------------------------
// Main server
// ---------------------------------------------------------------------------

export async function cmdServe(args, flags) {
  // 1. Create shared infrastructure (log, broadcast, json, error, etc.)
  const ctx = createInfrastructure();
  const { log, broadcast, json, error, readBody, checkAuth, generateToken, setWss, setToken } = ctx;

  // 2. Shared maps (owned by serve.js, passed to agent handler)
  const agentProcesses = new Map();
  const resumeSessionIndex = new Map();

  // 3. Lazy DB resolver for sessions module
  let _sessionsDb = null;
  let _sessionsDbChecked = false;
  function sessionsResolveDb() {
    if (_sessionsDb) return _sessionsDb;
    if (_sessionsDbChecked) return null;
    _sessionsDbChecked = true;
    try { _sessionsDb = getDb(); } catch { _sessionsDb = null; }
    return _sessionsDb;
  }

  // 4. Sessions module (stateful — owns watcher, cache, debounce timers)
  const sessionsModule = createSessionsModule({
    log, broadcast, json, error, readBody, getProjectGitStatus,
    resolveDb: sessionsResolveDb,
  });
  const {
    handleSessions, startSessionsWatcher, queueSessionsUpdated,
    handleWsMessage: handleSessionsWsMessage,
    handleWsDisconnect: handleSessionsWsDisconnect,
    cleanup: cleanupSessions,
    reconcileSessionsToDb, startPeriodicReconcile, enableDbSpine,
  } = sessionsModule;

  // 5. Run startup tasks (schema, stale sweep, orphan cleanup)
  await runStartupTasks({ log, reconcileSessionsToDb, enableDbSpine, startPeriodicReconcile });

  // 6. Sidecar port/token — resolved after listen()
  let sidecarPort = 0;
  let sidecarToken = '';

  // 7. Build all route modules
  const logsRoutes    = buildLogsRoutes(ctx);
  const fsRoutes      = buildFsRoutes(ctx);
  const authRoutes    = buildAuthRoutes(ctx);
  const projectRoutes = buildProjectRoutes(ctx);
  const notesRoutes   = buildNotesRoutes(ctx);
  const shellRoutes   = buildShellRoutes(ctx);
  const terminalRoutes = buildTerminalRoutes(ctx);
  const suggestRoutes = buildSuggestRoutes(ctx);
  const providerRoutes = buildProviderRoutes(ctx);

  // 8. Previously-extracted handlers (git, agent)
  const handleGit = createGitHandler({ readBody, error, json });
  const handleAgent = createAgentHandler({
    agentProcesses, resumeSessionIndex,
    readBody, error, json, log, broadcast,
    queueSessionsUpdated,
    maxConcurrent: MAX_CONCURRENT,
    getSidecarPort: () => sidecarPort,
    getSidecarToken: () => sidecarToken,
  });

  // 9. Create HTTP server
  const requestedPort = parseInt(flags.port, 10) || 0;
  const token = generateToken();
  setToken(token);

  const server = http.createServer(async (req, res) => {
    // CORS preflight
    if (req.method === 'OPTIONS') {
      res.writeHead(204, {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type, X-Rudi-Token, X-Rudi-Caller-Session',
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
      if (!checkAuth(req)) { error(res, 'Unauthorized', 401); return; }
      json(res, { home: os.homedir(), platform: os.platform() });
      return;
    }

    // Auth check
    if (!checkAuth(req)) {
      log('http', 'warn', `401 ${req.method} ${url.pathname}`);
      error(res, 'Unauthorized', 401);
      return;
    }

    // Route to handlers — order preserved from original
    try {
      if (url.pathname.startsWith('/logs')) {
        if (await logsRoutes.handle(req, res, url)) return;
      }
      if (url.pathname.startsWith('/fs/')) {
        if (await fsRoutes.handle(req, res, url)) return;
      }
      if (url.pathname.startsWith('/auth/')) {
        if (await authRoutes.handle(req, res, url)) return;
      }
      if (url.pathname.startsWith('/projects')) {
        if (projectRoutes.handle(req, res, url)) return;
      }
      if (url.pathname.startsWith('/notes')) {
        if (await notesRoutes.handle(req, res, url)) return;
      }
      if (url.pathname.startsWith('/sessions')) {
        if (await handleSessions(req, res, url)) return;
      }
      if (url.pathname.startsWith('/git/')) {
        if (await handleGit(req, res, url)) return;
      }
      if (url.pathname.startsWith('/agent/')) {
        if (await providerRoutes.handle(req, res, url)) return;
        if (await suggestRoutes.handle(req, res, url)) return;
        if (await handleAgent(req, res, url)) return;
      }
      if (url.pathname.startsWith('/shell/')) {
        if (await shellRoutes.handle(req, res, url)) return;
      }
      if (url.pathname.startsWith('/terminal/')) {
        if (await terminalRoutes.handle(req, res, url)) return;
      }

      log('http', 'warn', `404 ${req.method} ${url.pathname}`);
      error(res, 'Not found', 404);
    } catch (err) {
      log('http', 'error', `500 ${req.method} ${url.pathname}: ${err.message}`, { stack: err.stack });
      error(res, `Internal server error: ${err.message}`, 500);
    } finally {
      const ms = Date.now() - start;
      if (!url.pathname.startsWith('/logs') && url.pathname !== '/health') {
        log('http', 'info', `${req.method} ${url.pathname} ${ms}ms`);
      }
    }
  });

  // 10. WebSocket server
  const wss = new WebSocketServer({ noServer: true });
  setWss(wss);

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

    ws.on('message', (raw) => {
      try {
        const msg = JSON.parse(typeof raw === 'string' ? raw : raw.toString());
        handleSessionsWsMessage(ws, msg);
      } catch {
        // Ignore malformed messages
      }
    });

    ws.on('close', () => {
      log('ws', 'info', `client disconnected (total: ${wss.clients.size})`);
      handleSessionsWsDisconnect(ws);
    });
  });

  // 11. Start watchers and reapers
  startSessionsWatcher();

  const stopIdleReaper = createIdleReaper({
    agentProcesses, broadcast, log,
    idleTimeoutMs: IDLE_TIMEOUT_MS,
    maxConcurrent: MAX_CONCURRENT,
  });

  // 12. Start listening
  server.listen(requestedPort, '127.0.0.1', () => {
    const actualPort = server.address().port;
    sidecarPort = actualPort;
    sidecarToken = token;

    fs.mkdirSync(PATHS.home, { recursive: true });
    fs.writeFileSync(PORT_FILE, String(actualPort), { mode: 0o600 });
    fs.writeFileSync(TOKEN_FILE, token, { mode: 0o600 });

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

  // 13. Cleanup on exit
  let cleanupDone = false;
  const cleanup = (exitCode = 0) => {
    if (cleanupDone) return;
    cleanupDone = true;
    try { fs.unlinkSync(PORT_FILE); } catch {}
    try { fs.unlinkSync(TOKEN_FILE); } catch {}
    for (const [, { proc }] of agentProcesses) {
      try { proc.kill(); } catch {}
    }
    terminalRoutes.cleanup();
    fsRoutes.cleanup();
    suggestRoutes.cleanup();
    resumeSessionIndex.clear();
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
