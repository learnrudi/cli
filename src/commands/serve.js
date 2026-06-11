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
import { URL } from 'url';
import { getDb } from '@learnrudi/db';

// Serve subsystem modules
import { createGitHandler, getProjectGitStatus } from './serve/git.js';
import { createAgentHandler, createIdleReaper } from './serve/agent.js';
import { createSessionsModule } from './serve/sessions.js';
import { createInfrastructure } from './serve/ctx.js';
import { runStartupTasks } from './serve/startup.js';
import {
  buildAnalyticsRoutes,
  buildAuthRoutes,
  buildFsRoutes,
  buildLogsRoutes,
  buildNotesRoutes,
  buildPackageRoutes,
  buildPlansRoutes,
  buildProjectRoutes,
  buildProviderRoutes,
  buildShellRoutes,
  buildSuggestRoutes,
  buildTerminalRoutes,
} from '../daemon/routes/index.js';
import {
  buildDaemonHealthRoutes,
} from '../daemon/routes/health.js';
import { buildEnvRoutes } from '../daemon/routes/env.js';
import { buildAdminRoutes } from '../daemon/routes/admin.js';
import { buildLocalLlmRoutes } from '../daemon/routes/local-llm.js';
import { buildHttpAuthMiddleware } from '../daemon/runtime/auth.js';
import {
  parseRequestedPort,
  printStartupBanner,
  removeConnectionFiles,
  resolveWebRoot,
  startDaemonHttpServer,
  writeConnectionFiles,
} from '../daemon/runtime/bootstrap.js';
import { createDaemonProcessManager } from '../daemon/runtime/process-manager.js';
import { createGracefulShutdown } from '../daemon/runtime/shutdown.js';
import { createWebSocketRuntime } from '../daemon/runtime/websocket.js';

// Re-exports for test compatibility
export { parseWorktreeList } from './serve/git.js';
export { extractSessionCwdFromJsonlChunk, parseSessionMessagesFromJsonl } from './serve/sessions.js';
export { createHealthResponse } from '../daemon/routes/health.js';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

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
  const startedAtMs = Date.now();

  // 1. Create shared infrastructure (log, broadcast, json, error, etc.)
  const ctx = createInfrastructure();
  const {
    log,
    broadcast,
    json,
    error,
    readBody,
    createRequestContext,
    attachRequestContext,
    generateToken,
    setWss,
    setToken,
  } = ctx;
  const authMiddleware = buildHttpAuthMiddleware(ctx);

  // Web mode: resolve --web-root to absolute path.
  let webRoot = null;
  try {
    webRoot = resolveWebRoot(flags);
  } catch (err) {
    if (err.code === 'RUDI_WEB_ROOT_INDEX_MISSING') {
      console.error(`[web-root] ${err.message}`);
      console.error('  Build the frontend first: cd lite && pnpm build');
      process.exit(1);
    }
    throw err;
  }

  // 2. Process ownership maps (owned by daemon runtime, passed to agent handler)
  const processManager = createDaemonProcessManager();
  const { agentProcesses, resumeSessionIndex } = processManager;

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
  const localLlmRoutes = buildLocalLlmRoutes(ctx);
  const daemonHealthRoutes = buildDaemonHealthRoutes(ctx, {
    agentProcesses,
    getPort: () => sidecarPort,
    startedAtMs,
  });
  const envRoutes = buildEnvRoutes(ctx);
  const adminRoutes = buildAdminRoutes(ctx, {
    backfillSessionMetadata,
    backfillSessionTitles,
    backfillSessionTurnsToDb,
    getMetadataBackfillStats,
    getTitleBackfillStats,
    getTurnIngestStats,
    repairNoTextSessionTurnsToDb,
  });

  // 8. Previously-extracted handlers (git, agent)
  const handleGit = createGitHandler({ readBody, error, json, invalidField });
  const handleAgent = createAgentHandler({
    agentProcesses, resumeSessionIndex,
    readBody, error, json, log, broadcast,
    queueSessionsUpdated,
    maxConcurrent: MAX_CONCURRENT,
    getSidecarPort: () => sidecarPort,
    getSidecarToken: () => sidecarToken,
  });

  // 9. Create HTTP server
  const requestedPort = parseRequestedPort(flags);
  const token = generateToken();
  setToken(token);

  const server = http.createServer(async (req, res) => {
    const requestContext = createRequestContext(req);
    attachRequestContext(res, requestContext);

    if (authMiddleware.handleCorsPreflight(req, res, requestContext)) {
      return;
    }

    const url = new URL(req.url, `http://localhost`);
    const start = Date.now();

    try {
      // Health check (no auth required)
      if (daemonHealthRoutes.handlePublic(req, res, url)) {
        return;
      }

      if (!authMiddleware.requireAuth(req, res, url)) {
        return;
      }

      // Route to handlers — order preserved from original
      if (await daemonHealthRoutes.handle(req, res, url)) return;
      if (await envRoutes.handle(req, res, url)) return;
      if (url.pathname.startsWith('/local-llm') || url.pathname.startsWith('/runtimes/')) {
        if (await localLlmRoutes.handle(req, res, url)) return;
      }
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
        if (await projectRoutes.handle(req, res, url)) return;
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
      if (await adminRoutes.handle(req, res, url)) return;

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
  const wsRuntime = createWebSocketRuntime({
    getToken: () => token,
    handleMessage: handleSessionsWsMessage,
    handleDisconnect: handleSessionsWsDisconnect,
    log,
  });
  setWss(wsRuntime.wss);
  wsRuntime.attachToServer(server);

  // 11. Start watchers and reapers
  startSessionsWatcher();

  const stopIdleReaper = createIdleReaper({
    agentProcesses, broadcast, log,
    idleTimeoutMs: IDLE_TIMEOUT_MS,
    maxConcurrent: MAX_CONCURRENT,
  });

  // 12. Start listening
  startDaemonHttpServer(server, {
    port: requestedPort,
    onListening: (actualPort) => {
      sidecarPort = actualPort;
      sidecarToken = token;

      writeConnectionFiles({ port: actualPort, token });
      printStartupBanner({ port: actualPort, token, webRoot });

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
    },
  });

  // 13. Cleanup on exit
  function cleanupStep(name, fn) {
    try {
      fn();
    } catch (err) {
      log('serve', 'warn', `Cleanup step failed: ${name}: ${err.message}`);
    }
  }

  const gracefulShutdown = createGracefulShutdown({
    server,
    wss: wsRuntime.wss,
    log,
    cleanupResources: () => {
      cleanupStep('connection-files', () => removeConnectionFiles());
      cleanupStep('process-manager', () => processManager.cleanup());
      cleanupStep('terminal-routes', () => terminalRoutes.cleanup());
      cleanupStep('fs-routes', () => fsRoutes.cleanup());
      cleanupStep('suggest-routes', () => suggestRoutes.cleanup());
      cleanupStep('package-routes', () => packageRoutes.cleanup());
      cleanupStep('sessions', () => cleanupSessions());
      cleanupStep('idle-reaper', () => stopIdleReaper());
    },
  });
  gracefulShutdown.registerProcessHandlers({
    onUncaughtException: (err) => {
      log('serve', 'error', `Uncaught exception: ${err.message}`);
    },
    onUnhandledRejection: (err) => {
      log('serve', 'error', `Unhandled rejection: ${err}`);
    },
  });
}
