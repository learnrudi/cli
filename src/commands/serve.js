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
import { buildAnalyticsRoutes } from './serve/routes/analytics.js';
import { buildPlansRoutes } from './serve/routes/plans.js';
import { buildPackageRoutes } from './serve/routes/packages.js';

// Re-exports for test compatibility
export { parseWorktreeList } from './serve/git.js';
export { extractSessionCwdFromJsonlChunk, parseSessionMessagesFromJsonl } from './serve/sessions.js';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const PORT_FILE = path.join(PATHS.home, '.rudi-lite-port');
const TOKEN_FILE = path.join(PATHS.home, '.rudi-lite-token');
const WS_TOKEN_PROTOCOL_PREFIX = 'rudi-token.';

export function clampedInt(value, { min = 0, max = Number.MAX_SAFE_INTEGER, fallback }) {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(Math.max(parsed, min), max);
}

const MAX_CONCURRENT = clampedInt(process.env.RUDI_MAX_AGENT_PROCESSES, {
  min: 1,
  max: 100,
  fallback: 10,
});
const IDLE_TIMEOUT_MS = clampedInt(process.env.RUDI_IDLE_TIMEOUT_MS, {
  min: 60_000,
  max: 3_600_000,
  fallback: 10 * 60 * 1000,
});

export function shouldRunInitialTurnBackfill(db) {
  if (!db || typeof db.prepare !== 'function') return false;
  try {
    const turnsCount = Number(db.prepare('SELECT COUNT(*) as c FROM turns').get()?.c || 0);
    const sessionsCount = Number(db.prepare(`SELECT COUNT(*) as c FROM sessions WHERE status != 'deleted'`).get()?.c || 0);
    return turnsCount === 0 && sessionsCount > 0;
  } catch {
    return false;
  }
}

function readWsTokenFromProtocolHeader(headerValue) {
  if (!headerValue) return null;
  const raw = Array.isArray(headerValue) ? headerValue.join(',') : headerValue;
  const protocols = raw.split(',').map((p) => p.trim()).filter(Boolean);
  for (const protocol of protocols) {
    // Some clients/libraries may quote protocol values; strip optional quotes.
    const normalized = protocol.replace(/^"+|"+$/g, '');
    if (normalized.startsWith(WS_TOKEN_PROTOCOL_PREFIX)) {
      return normalized.slice(WS_TOKEN_PROTOCOL_PREFIX.length);
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// Main server
// ---------------------------------------------------------------------------

// MIME types for static file serving (web mode)
const MIME_TYPES = {
  '.html': 'text/html',
  '.js': 'application/javascript',
  '.mjs': 'application/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.wasm': 'application/wasm',
};

export async function cmdServe(args, flags) {
  // 1. Create shared infrastructure (log, broadcast, json, error, etc.)
  const ctx = createInfrastructure();
  const {
    log,
    broadcast,
    json,
    error,
    readBody,
    checkAuth,
    createRequestContext,
    attachRequestContext,
    updateRequestAuth,
    generateToken,
    setWss,
    setToken,
    REQUEST_ID_HEADER,
  } = ctx;

  // Web mode: resolve --web-root to absolute path
  const webRoot = flags['web-root'] ? path.resolve(flags['web-root']) : null;
  if (webRoot) {
    if (!fs.existsSync(path.join(webRoot, 'index.html'))) {
      console.error(`[web-root] No index.html found in ${webRoot}`);
      console.error('  Build the frontend first: cd lite && pnpm build');
      process.exit(1);
    }
  }

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
    reconcileSessionsToDb, backfillProjectPaths, reconcileSessionTurnsToDb, backfillSessionTurnsToDb,
    repairNoTextSessionTurnsToDb,
    startPeriodicReconcile, startTurnIngestReconcile,
    enableDbSpine, isDbSpineEnabled, getTurnIngestStats,
    backfillSessionTitles, getTitleBackfillStats,
    backfillSessionMetadata, getMetadataBackfillStats,
  } = sessionsModule;

  // 5. Run fast synchronous startup tasks (schema, stale sweep, orphan cleanup)
  runStartupTasks({ log });

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
  const analyticsRoutes = buildAnalyticsRoutes(ctx);
  const plansRoutes = buildPlansRoutes(ctx);
  const packageRoutes = buildPackageRoutes(ctx);

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
    const requestContext = createRequestContext(req);
    attachRequestContext(res, requestContext);

    // CORS preflight
    if (req.method === 'OPTIONS') {
      updateRequestAuth(res, { required: false, result: 'skipped' });
      res.writeHead(204, {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type, X-Rudi-Token, X-Rudi-Caller-Session',
        [REQUEST_ID_HEADER]: requestContext.requestId,
      });
      res.end();
      return;
    }

    const url = new URL(req.url, `http://localhost`);
    const start = Date.now();

    try {
      // Health check (no auth required)
      if (url.pathname === '/health') {
        updateRequestAuth(res, { required: false, result: 'skipped' });
        json(res, { status: 'ok', version: '0.1.0' });
        return;
      }

      // Environment info (needs auth)
      if (url.pathname === '/env') {
        if (!checkAuth(req)) {
          updateRequestAuth(res, { required: true, result: 'failed' });
          log('http', 'warn', 'auth_failed', {
            requestId: requestContext.requestId,
            method: req.method,
            path: url.pathname,
            status: 401,
          });
          error(res, 'Unauthorized', 401);
          return;
        }
        updateRequestAuth(res, { required: true, result: 'passed' });
        json(res, { home: os.homedir(), platform: os.platform() });
        return;
      }

      // Auth check
      if (!checkAuth(req)) {
        updateRequestAuth(res, { required: true, result: 'failed' });
        log('http', 'warn', 'auth_failed', {
          requestId: requestContext.requestId,
          method: req.method,
          path: url.pathname,
          status: 401,
        });
        error(res, 'Unauthorized', 401);
        return;
      }
      updateRequestAuth(res, { required: true, result: 'passed' });

      // Route to handlers — order preserved from original
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
      if (url.pathname.startsWith('/packages')) {
        if (await packageRoutes.handle(req, res, url)) return;
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
      if (url.pathname.startsWith('/analytics/')) {
        if (analyticsRoutes.handle(req, res, url)) return;
      }
      if (url.pathname.startsWith('/plans')) {
        if (plansRoutes.handle(req, res, url)) return;
      }
      if (url.pathname === '/admin/ingester' && req.method === 'GET') {
        const stats = getTurnIngestStats();
        json(res, { status: stats.errors.length > 0 ? 'degraded' : 'healthy', ...stats });
        return;
      }
      if (url.pathname === '/admin/backfill' && req.method === 'POST') {
        const stats = getTurnIngestStats();
        if (!stats.backfillRunning) {
          backfillSessionTurnsToDb()
            .then((result) => log('sessions', 'info', 'Manual backfill complete', result))
            .catch((err) => log('sessions', 'warn', `Manual backfill failed: ${err.message}`));
          const next = getTurnIngestStats();
          json(res, {
            status: 'started',
            backfillRunning: next.backfillRunning,
            progress: {
              filesDone: next.backfillFilesDone || 0,
              filesTotal: next.backfillFilesTotal || 0,
            },
          });
        } else {
          json(res, {
            status: 'running',
            backfillRunning: true,
            progress: {
              filesDone: stats.backfillFilesDone || 0,
              filesTotal: stats.backfillFilesTotal || 0,
            },
          });
        }
        return;
      }
      if (url.pathname === '/admin/repair-no-text' && req.method === 'POST') {
        const stats = getTurnIngestStats();
        if (!stats.repairRunning) {
          const limitRaw = url.searchParams.get('limit');
          const limit = limitRaw ? Number.parseInt(limitRaw, 10) : 0;
          repairNoTextSessionTurnsToDb({ limit: Number.isFinite(limit) ? limit : 0 })
            .then((result) => log('sessions', 'info', 'Manual no-text repair complete', result))
            .catch((err) => log('sessions', 'warn', `Manual no-text repair failed: ${err.message}`));
          const next = getTurnIngestStats();
          json(res, {
            status: 'started',
            repairRunning: next.repairRunning,
            progress: {
              sessionsDone: next.repairSessionsDone || 0,
              sessionsTotal: next.repairSessionsTotal || 0,
            },
          });
        } else {
          json(res, {
            status: 'running',
            repairRunning: true,
            progress: {
              sessionsDone: stats.repairSessionsDone || 0,
              sessionsTotal: stats.repairSessionsTotal || 0,
            },
          });
        }
        return;
      }
      if (url.pathname === '/admin/title-backfill' && req.method === 'GET') {
        json(res, getTitleBackfillStats());
        return;
      }
      if (url.pathname === '/admin/title-backfill' && req.method === 'POST') {
        const stats = getTitleBackfillStats();
        if (!stats.running) {
          const useLlm = url.searchParams.get('llm') !== 'false';
          const minTurnsRaw = url.searchParams.get('minTurns');
          const parsedMinTurns = minTurnsRaw == null ? 1 : Number.parseInt(minTurnsRaw, 10);
          const minTurns = Number.isFinite(parsedMinTurns) && parsedMinTurns >= 0 ? parsedMinTurns : 1;
          backfillSessionTitles({ llm: useLlm, minTurns })
            .then((result) => log('sessions', 'info', 'Manual title backfill complete', result))
            .catch((err) => log('sessions', 'warn', `Manual title backfill failed: ${err.message}`));
          json(res, { status: 'started', ...getTitleBackfillStats() });
        } else {
          json(res, { status: 'running', ...stats });
        }
        return;
      }
      if (url.pathname === '/admin/metadata-backfill' && req.method === 'GET') {
        json(res, getMetadataBackfillStats());
        return;
      }
      if (url.pathname === '/admin/metadata-backfill' && req.method === 'POST') {
        const stats = getMetadataBackfillStats();
        if (!stats.running) {
          backfillSessionMetadata()
            .then((result) => log('sessions', 'info', 'Manual metadata backfill complete', result))
            .catch((err) => log('sessions', 'warn', `Manual metadata backfill failed: ${err.message}`));
          json(res, { status: 'started', ...getMetadataBackfillStats() });
        } else {
          json(res, { status: 'running', ...stats });
        }
        return;
      }

      // Web mode: serve static files from --web-root
      if (webRoot && req.method === 'GET') {
        const reqPath = decodeURIComponent(url.pathname);
        // Prevent directory traversal
        const safePath = path.normalize(reqPath).replace(/^(\.\.[/\\])+/, '');
        let filePath = path.join(webRoot, safePath);

        // Try the exact file, then fall back to index.html (SPA routing)
        let stat = null;
        try { stat = fs.statSync(filePath); } catch {}
        if (!stat || stat.isDirectory()) {
          filePath = path.join(webRoot, 'index.html');
          try { stat = fs.statSync(filePath); } catch { stat = null; }
        }

        if (stat && stat.isFile()) {
          const ext = path.extname(filePath).toLowerCase();
          const contentType = MIME_TYPES[ext] || 'application/octet-stream';
          res.writeHead(200, {
            'Content-Type': contentType,
            'Content-Length': stat.size,
            'Cache-Control': ext === '.html' ? 'no-cache' : 'public, max-age=31536000, immutable',
          });
          fs.createReadStream(filePath).pipe(res);
          return;
        }
      }

      log('http', 'warn', `404 ${req.method} ${url.pathname}`);
      error(res, 'Not found', 404);
    } catch (err) {
      const status = err.statusCode || 500;
      log('http', status >= 500 ? 'error' : 'warn', `${status} ${req.method} ${url.pathname}: ${err.message}`, { stack: status >= 500 ? err.stack : undefined });
      error(res, err.message, status);
    } finally {
      const ms = Date.now() - start;
      if (!url.pathname.startsWith('/logs') && url.pathname !== '/health') {
        const status = res.statusCode || requestContext.response?.status || 200;
        const level = status >= 500 ? 'error' : status >= 400 ? 'warn' : 'info';
        log('http', level, 'request_complete', {
          requestId: requestContext.requestId,
          method: req.method,
          path: url.pathname,
          status,
          latencyMs: ms,
          auth: requestContext.auth?.result || 'unknown',
          errorCode: requestContext.response?.errorCode || null,
        });
      }
    }
  });

  // 10. WebSocket server
  const wss = new WebSocketServer({
    noServer: true,
    // Avoid extension negotiation edge-cases across runtimes/webviews.
    perMessageDeflate: false,
    handleProtocols: (protocols) => {
      for (const offered of protocols) {
        const normalized = offered.replace(/^"+|"+$/g, '');
        if (normalized.startsWith(WS_TOKEN_PROTOCOL_PREFIX)) {
          return normalized;
        }
      }
      // Allow connections that authenticate via query token and don't send
      // Sec-WebSocket-Protocol.
      return protocols.size === 0 ? undefined : false;
    },
  });
  setWss(wss);

  server.on('upgrade', (req, socket, head) => {
    const url = new URL(req.url, `http://localhost`);
    const protocolToken = readWsTokenFromProtocolHeader(req.headers['sec-websocket-protocol']);
    const queryToken = url.searchParams.get('token');
    const presentedToken = protocolToken ?? queryToken;
    // Allow same-origin token for web mode (localhost only)
    const isSameOrigin = presentedToken === 'same-origin' &&
      (req.headers.host || '').match(/^(127\.0\.0\.1|localhost)(:|$)/);
    if (presentedToken !== token && !isSameOrigin) {
      log('ws', 'warn', 'upgrade auth failed', {
        path: url.pathname,
        hasProtocolToken: !!protocolToken,
        hasQueryToken: !!queryToken,
      });
      socket.destroy();
      return;
    }
    wss.handleUpgrade(req, socket, head, (ws) => {
      wss.emit('connection', ws, req);
    });
  });

  wss.on('connection', (ws) => {
    log('ws', 'info', `client connected (total: ${wss.clients.size})`, { protocol: ws.protocol || null });

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
    console.log(webRoot ? '  RUDI Dashboard' : '  RUDI Lite Server');
    console.log('═'.repeat(50));
    if (webRoot) {
      console.log(`  Open:  http://localhost:${actualPort}`);
    }
    console.log(`  Port:  ${actualPort}`);
    console.log(`  Token: ${token.slice(0, 8)}...`);
    console.log(`  PID:   ${process.pid}`);
    if (webRoot) {
      console.log(`  Web:   ${webRoot}`);
    }
    console.log('');
    console.log(`  Port file:  ${PORT_FILE}`);
    console.log(`  Token file: ${TOKEN_FILE}`);
    console.log('═'.repeat(50));
    console.log('');

    // DB spine: enable immediately if DB has rows from a prior boot, then reconcile in background
    const db = sessionsResolveDb();
    if (db) {
      try {
        const { c } = db.prepare(`SELECT COUNT(*) as c FROM sessions WHERE status != 'deleted'`).get();
        if (c > 0) {
          enableDbSpine();
          log('sessions', 'info', `DB-as-spine enabled immediately (${c} existing rows)`);
        }
      } catch {
        // DB not ready — will enable after reconciliation
      }
    }

    reconcileSessionsToDb().catch(err => {
      log('sessions', 'warn', `Reconciliation failed (continuing): ${err.message}`);
    }).then(async () => {
      if (!isDbSpineEnabled()) {
        enableDbSpine();
        log('sessions', 'info', 'DB-as-spine enabled after reconciliation');
      }
      // Backfill missing/corrupted project_path values (runs even if reconcile failed)
      try {
        const db = sessionsResolveDb();
        await backfillProjectPaths(db);
      } catch (bfErr) {
        log('sessions', 'warn', `[backfill] project paths failed: ${bfErr.message}`);
      }
      try {
        const db = sessionsResolveDb();
        const shouldBackfill = shouldRunInitialTurnBackfill(db);
        if (shouldBackfill) {
          await backfillSessionTurnsToDb();
        } else {
          await reconcileSessionTurnsToDb();
        }
      } catch (ingestErr) {
        log('sessions', 'warn', `Turn ingest reconcile failed: ${ingestErr.message}`);
      }
      // Title backfill runs after turn ingest (needs turn data for first-message lookup)
      try {
        await backfillSessionTitles({ llm: true, minTurns: 1 });
      } catch (titleErr) {
        log('sessions', 'warn', `Title backfill failed: ${titleErr.message}`);
      }
      // Metadata backfill runs after turn ingest (enriches subagent sessions)
      try {
        await backfillSessionMetadata();
      } catch (metaErr) {
        log('sessions', 'warn', `Metadata backfill failed: ${metaErr.message}`);
      }
    }).finally(() => {
      startPeriodicReconcile();
      startTurnIngestReconcile();
    });
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
    packageRoutes.cleanup();
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
