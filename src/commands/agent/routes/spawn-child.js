/**
 * POST /agent/spawn-child — spawn a child session in its own worktree.
 * GET /agent/children/:parentSessionId — list child sessions.
 * Provider-agnostic: uses declarative configs from providers/*.json.
 */

import os from 'os';
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { spawn, execFileSync } from 'child_process';
import { PATHS } from '@learnrudi/env';
import { getDb } from '@learnrudi/db';
import { loadProviderConfig, resolveProviderBinary, buildArgs, getPermissionArgs, buildEnv, hasCapability, expandConditional } from '../providers/index.js';
import { buildSystemPrompt } from '../prompts.js';
import { dbWrite } from '../db.js';
import { countAlive, broadcastProcessCount, normalizeHeader } from '../helpers.js';
import { getRepoRoot, createChildWorktree } from '../worktree.js';
import { attachStdoutHandler, attachStderrHandler } from '../process-io.js';

export function buildSpawnChildRoutes(ctx) {
  const {
    json, error, readBody, log, broadcast,
    agentProcesses, queueSessionsUpdated, resumeSessionIndex,
    maxConcurrent, getSidecarPort, getSidecarToken,
    spawnRateMap, MAX_SPAWNS_PER_WINDOW, SPAWN_RATE_WINDOW_MS, MAX_CHILDREN_PER_PARENT,
  } = ctx;

  return async (req, res, url) => {
    // POST /agent/spawn-child
    if (req.method === 'POST' && url.pathname === '/agent/spawn-child') {
      // Guard: sidecar must be fully initialized
      if (getSidecarPort() === 0) {
        return json(res, { error: 'SIDECAR_NOT_READY', message: 'Sidecar server is still initializing' }, 503);
      }

      const body = await readBody(req);
      const { parentSessionId, prompt: childPrompt, description, model: childModel, baseRef, provider: childProvider, origin: childOrigin } = body;
      const callerSession = normalizeHeader(req.headers['x-rudi-caller-session']);
      const provider = childProvider || 'claude';
      const origin = childOrigin || 'unknown';

      // Load provider config — fail fast if unknown
      let providerConfig;
      try {
        providerConfig = loadProviderConfig(provider);
      } catch (configErr) {
        return error(res, configErr.message, 400);
      }

      // --- Validation ---
      if (!childPrompt || typeof childPrompt !== 'string' || !childPrompt.trim()) {
        return error(res, 'prompt required', 400);
      }
      if (childPrompt.length > 25000) {
        return error(res, 'prompt too long (max 25000 chars)', 400);
      }
      if (!parentSessionId || typeof parentSessionId !== 'string') {
        return error(res, 'parentSessionId required', 400);
      }
      if (!/^[0-9a-f-]{36}$/i.test(parentSessionId)) {
        return error(res, 'parentSessionId must be a valid UUID', 400);
      }
      if (!callerSession || callerSession !== parentSessionId) {
        return error(res, 'X-Rudi-Caller-Session must match parentSessionId', 403);
      }
      if (description && description.length > 64) {
        return error(res, 'description too long (max 64 chars)', 400);
      }
      if (childModel && typeof childModel !== 'string') {
        return error(res, 'model must be a string', 400);
      }

      // Rate limit: max 3 spawns per 10s per parent
      const now = Date.now();
      const parentTimestamps = spawnRateMap.get(parentSessionId) || [];
      const recentTimestamps = parentTimestamps.filter(t => now - t < SPAWN_RATE_WINDOW_MS);
      if (recentTimestamps.length >= MAX_SPAWNS_PER_WINDOW) {
        return json(res, { error: 'SPAWN_RATE_LIMITED', message: `Max ${MAX_SPAWNS_PER_WINDOW} spawns per ${SPAWN_RATE_WINDOW_MS / 1000}s` }, 429);
      }

      // --- Parent eligibility ---
      const parentEntry = agentProcesses.get(parentSessionId);
      if (parentEntry?.parentSessionId) {
        return json(res, { error: 'NESTED_CHILD_SPAWN_NOT_SUPPORTED', message: 'Children cannot spawn further children' }, 400);
      }
      try {
        const db = getDb();
        const parentRow = db.prepare('SELECT parent_session_id, session_type FROM sessions WHERE id = ?').get(parentSessionId);
        if (parentRow?.parent_session_id) {
          return json(res, { error: 'NESTED_CHILD_SPAWN_NOT_SUPPORTED', message: 'Children cannot spawn further children' }, 400);
        }
        if (parentRow && parentRow.session_type && parentRow.session_type !== 'main') {
          return json(res, { error: 'SPAWN_NOT_ALLOWED', message: `Only main sessions can spawn children (this session is '${parentRow.session_type}')` }, 403);
        }
      } catch {
        // DB check is best-effort
      }

      // --- Per-parent child limit ---
      let childCount = 0;
      for (const [, entry] of agentProcesses) {
        if (entry.parentSessionId === parentSessionId && entry.proc && !entry.proc.killed) {
          childCount++;
        }
      }
      if (childCount >= MAX_CHILDREN_PER_PARENT) {
        return json(res, { error: 'CHILD_LIMIT_REACHED', message: `Max ${MAX_CHILDREN_PER_PARENT} children per parent`, max: MAX_CHILDREN_PER_PARENT }, 429);
      }

      // --- Global concurrency ---
      const aliveCount = countAlive(agentProcesses);
      if (aliveCount >= maxConcurrent) {
        return json(res, { error: 'MAX_CONCURRENT_REACHED', message: `Too many active agent processes (${aliveCount}/${maxConcurrent})` }, 429);
      }

      // --- Resolve parent context ---
      let parentCwd = null;
      let parentRepoRoot = null;
      let parentModel = null;
      let parentBaseBranch = null;

      if (parentEntry) {
        parentCwd = parentEntry.cwd;
        parentRepoRoot = parentEntry.repoRoot || null;
        parentModel = parentEntry._turnModel || null;
        parentBaseBranch = parentEntry.baseBranch || null;
      }

      // DB fallback
      if (!parentCwd || !parentRepoRoot) {
        try {
          const db = getDb();
          const runtimeRow = db.prepare(`
            SELECT cwd, project_root, base_branch FROM session_runtime_state WHERE session_id = ?
          `).get(parentSessionId);
          if (runtimeRow) {
            if (!parentCwd) parentCwd = runtimeRow.cwd;
            if (!parentRepoRoot) parentRepoRoot = runtimeRow.project_root;
            if (!parentBaseBranch) parentBaseBranch = runtimeRow.base_branch;
          }
        } catch {
          // best effort
        }
      }

      if (!parentCwd) {
        return json(res, { error: 'PARENT_CONTEXT_UNAVAILABLE', message: 'Parent session has ended and required runtime context is missing.' }, 409);
      }

      // Re-resolve repo root
      try {
        const resolvedRoot = getRepoRoot(parentCwd);
        if (!parentRepoRoot || parentRepoRoot !== resolvedRoot) {
          parentRepoRoot = resolvedRoot;
        }
      } catch {
        if (!parentRepoRoot) {
          return json(res, { error: 'NOT_A_GIT_REPO', message: 'Parent cwd is not inside a git repository' }, 400);
        }
      }

      // Resolve baseRef
      let resolvedBaseRef = baseRef || null;
      if (!resolvedBaseRef) {
        try {
          resolvedBaseRef = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: parentCwd, stdio: 'pipe' }).toString().trim();
        } catch {
          resolvedBaseRef = 'HEAD';
        }
      }
      if (resolvedBaseRef.startsWith('-') || resolvedBaseRef === '--') {
        return json(res, { error: 'INVALID_BASE_REF', message: 'baseRef must not start with -' }, 400);
      }
      if (!/^[a-zA-Z0-9_.\/\-~^{}@]+$/.test(resolvedBaseRef)) {
        return json(res, { error: 'INVALID_BASE_REF', message: 'baseRef contains invalid characters' }, 400);
      }
      try {
        execFileSync('git', ['rev-parse', '--verify', `${resolvedBaseRef}^{commit}`], { cwd: parentRepoRoot, stdio: 'pipe' });
      } catch {
        return json(res, { error: 'INVALID_BASE_REF', message: `baseRef '${resolvedBaseRef}' does not resolve to a valid commit` }, 400);
      }

      // --- Sanitize description ---
      const rawDesc = description || childPrompt.trim().split(/\s+/).slice(0, 5).join(' ');
      const sanitizedDesc = rawDesc
        .toLowerCase()
        .replace(/[^a-z0-9-]/g, '-')
        .replace(/-+/g, '-')
        .replace(/^-|-$/g, '')
        .slice(0, 32) || 'child';

      // --- Binary ---
      const binaryPath = resolveProviderBinary(providerConfig);
      if (!binaryPath) {
        return error(res, `${providerConfig.name} CLI not found. Run: rudi install agent:${provider}`, 500);
      }

      const childSessionId = crypto.randomUUID();
      const shortId = childSessionId.slice(0, 8);

      // --- Worktree creation ---
      let worktreeBranch = null;
      let worktreePath = null;
      try {
        const wt = createChildWorktree({ parentRepoRoot, sanitizedDesc, resolvedBaseRef, shortId, log });
        worktreeBranch = wt.worktreeBranch;
        worktreePath = wt.worktreePath;
      } catch (wtErr) {
        return json(res, { error: 'WORKTREE_BRANCH_COLLISION', message: 'Could not create worktree after 5 attempts' }, 500);
      }

      // --- Insert session row ---
      const nowIso = new Date().toISOString();
      log('agent', 'info', `spawn-child request`, { origin, provider, parentSessionId: parentSessionId.slice(0, 8) });
      dbWrite((db) => {
        db.prepare(`
          INSERT INTO sessions
            (id, provider, origin, cwd, model, status, session_type, parent_session_id,
             title_override, started_at, created_at, last_active_at)
          VALUES (?, ?, 'rudi', ?, ?, 'active', 'child', ?, ?, ?, ?, ?)
        `).run(childSessionId, provider, worktreePath, childModel || parentModel, parentSessionId, sanitizedDesc, nowIso, nowIso, nowIso);
      });

      // --- Insert runtime state ---
      dbWrite((db) => {
        db.prepare(`
          INSERT INTO session_runtime_state
            (session_id, status, provider, cwd, started_at, updated_at,
             worktree_path, worktree_branch, project_root, base_branch, use_worktree)
          VALUES (?, 'starting', ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(childSessionId, provider, worktreePath, nowIso, nowIso,
               worktreePath, worktreeBranch, parentRepoRoot, parentBaseBranch, 1);
      });

      // --- Build args from provider config ---
      const childSystemPrompt = buildSystemPrompt(null, { canSpawnChildren: false });
      const argOptions = { prompt: childPrompt, model: childModel || undefined };
      if (hasCapability(providerConfig, 'systemPrompt') && childSystemPrompt) {
        argOptions.systemPrompt = childSystemPrompt;
      }

      const childArgs = buildArgs(providerConfig, argOptions);

      // Permission: children run fully autonomous
      const modes = providerConfig.headless.permissionModes;
      const autoKey = modes.agent ? 'agent' : Object.keys(modes)[0];
      if (autoKey) childArgs.push(...getPermissionArgs(providerConfig, autoKey));

      // Isolate MCP: no servers for children (only for providers that support MCP)
      if (hasCapability(providerConfig, 'mcpConfig')) {
        const emptyMcpPath = path.join(os.tmpdir(), 'rudi-empty-mcp.json');
        if (!fs.existsSync(emptyMcpPath)) {
          fs.writeFileSync(emptyMcpPath, '{"mcpServers":{}}', { mode: 0o600 });
        }
        childArgs.push(
          ...expandConditional(providerConfig, 'mcpConfig', emptyMcpPath),
          ...expandConditional(providerConfig, 'strictMcpConfig', true),
        );
      }

      // --- Build env from provider config ---
      const configEnv = buildEnv(providerConfig, process.env);
      const childEnv = {
        ...process.env,
        ...configEnv,
      };
      const port = getSidecarPort();
      if (port > 0) {
        childEnv.RUDI_SIDECAR_URL = `http://127.0.0.1:${port}`;
        childEnv.RUDI_SIDECAR_TOKEN = getSidecarToken();
        childEnv.RUDI_SESSION_ID = childSessionId;
        childEnv.RUDI_CAN_SPAWN_CHILDREN = '0';
      }

      // --- Spawn ---
      try {
        const proc = spawn(binaryPath, childArgs, {
          cwd: worktreePath,
          env: childEnv,
          stdio: ['pipe', 'pipe', 'pipe'],
        });

        // Close stdin based on provider config
        const stdinMode = providerConfig.headless.stdin;
        if (stdinMode === 'close' || !hasCapability(providerConfig, 'inputStreaming')) {
          proc.stdin.end();
        }

        const entry = {
          proc,
          provider,
          providerConfig,
          providerSessionId: null,
          resumeSessionId: null,
          parentSessionId,
          stdoutBuffer: '',
          turnActive: true,
          startedAt: Date.now(),
          lastActivityAt: Date.now(),
          cwd: worktreePath,
          repoRoot: parentRepoRoot,
          worktreePath,
          worktreeBranch,
          baseBranch: parentBaseBranch,
          _terminationReason: null,
          _turnPrompt: childPrompt,
          _turnNumber: 1,
          _turnInputTokens: 0,
          _turnOutputTokens: 0,
          _turnCacheReadTokens: 0,
          _turnCacheCreationTokens: 0,
          _turnModel: childModel || parentModel || null,
          _turnToolsUsed: [],
          _isChild: true,
          _description: sanitizedDesc,
        };
        agentProcesses.set(childSessionId, entry);

        // Mark running
        dbWrite((db) => {
          db.prepare(`
            UPDATE session_runtime_state SET status = 'running', updated_at = ? WHERE session_id = ?
          `).run(new Date().toISOString(), childSessionId);
          db.prepare(`
            UPDATE sessions SET started_at = ? WHERE id = ?
          `).run(new Date().toISOString(), childSessionId);
        });

        log('agent', 'info', `child process spawned pid=${proc.pid}`, {
          sessionId: shortId,
          parentSessionId: parentSessionId.slice(0, 8),
          worktreeBranch,
          cwd: worktreePath,
          binary: binaryPath,
          origin,
          provider,
          argsCount: childArgs.length,
          promptLen: childPrompt.length,
          args: childArgs.filter(a => a !== childPrompt && (a.length < 60 || a.startsWith('--'))).join(' '),
        });

        // --- Timers ---
        const killWithFallback = (p) => {
          try { p.kill('SIGTERM'); } catch {}
          setTimeout(() => { try { if (!p.killed) p.kill('SIGKILL'); } catch {} }, 5000);
        };

        const STARTUP_TIMEOUT_MS = 120_000;
        let startupTimer = setTimeout(() => {
          if (entry.turnActive && entry.lastActivityAt === entry.startedAt) {
            log('agent', 'error', `child startup stall — no output in ${STARTUP_TIMEOUT_MS / 1000}s`, { sessionId: shortId });
            entry._terminationReason = 'startup_stall';
            killWithFallback(proc);
          }
        }, STARTUP_TIMEOUT_MS);

        const RUNTIME_TIMEOUT_MS = 15 * 60 * 1000;
        const runtimeTimer = setTimeout(() => {
          if (entry.proc && !entry.proc.killed) {
            log('agent', 'warn', `child runtime timeout (${RUNTIME_TIMEOUT_MS / 1000}s)`, { sessionId: shortId });
            entry._terminationReason = 'timeout';
            killWithFallback(proc);
          }
        }, RUNTIME_TIMEOUT_MS);

        // --- stdout handler (uses shared process-io) ---
        const clearStartupTimer = () => {
          if (startupTimer) { clearTimeout(startupTimer); startupTimer = null; }
        };

        attachStdoutHandler(ctx, childSessionId, entry, {
          setRunningOnCapture: false, // already set to 'running' above
          onFirstData: (chunk, totalBytes) => {
            clearStartupTimer();
            if (totalBytes <= 2000) {
              log('agent', 'debug', `child stdout (${chunk.length}b, total=${totalBytes}): ${chunk.toString().slice(0, 200)}`, { sessionId: shortId });
            }
          },
          onResult: (event) => {
            entry.turnActive = false;
            const costUsd =
              typeof event.costUsd === 'number'
                ? event.costUsd
                : (typeof event.total_cost_usd === 'number' ? event.total_cost_usd : null);
            const turnTokens = Math.max(
              0,
              Number(entry._turnInputTokens || 0)
                + Number(entry._turnOutputTokens || 0)
                + Number(entry._turnCacheReadTokens || 0)
                + Number(entry._turnCacheCreationTokens || 0)
            );
            const providerSid = entry.providerSessionId;
            dbWrite((db) => {
              const now = new Date().toISOString();
              if (costUsd !== null) {
                db.prepare(`
                  UPDATE session_runtime_state
                  SET turn_count = turn_count + 1, cost_total = ?, tokens_total = tokens_total + ?, updated_at = ?
                  WHERE session_id = ?
                `).run(costUsd, turnTokens, now, childSessionId);
              } else {
                db.prepare(`
                  UPDATE session_runtime_state
                  SET turn_count = turn_count + 1, tokens_total = tokens_total + ?, updated_at = ?
                  WHERE session_id = ?
                `).run(turnTokens, now, childSessionId);
              }
              if (providerSid) {
                db.prepare(`
                  UPDATE sessions SET provider_session_id = ?, last_active_at = ?, total_cost = ? WHERE id = ?
                `).run(providerSid, now, costUsd || 0, childSessionId);
              }
            });
            broadcast('agent:done', { sessionId: childSessionId, exitCode: 0, providerSessionId: entry.providerSessionId });
            queueSessionsUpdated({ source: 'agent', event: 'child-result', sessionId: entry.providerSessionId || null });
          },
        });

        // --- stderr handler ---
        attachStderrHandler(ctx, childSessionId, entry, {
          logSlice: 500,
          onFirstData: (chunk, totalBytes) => {
            clearStartupTimer();
          },
        });

        // --- Shared cleanup ---
        let _childCleanedUp = false;
        const cleanupChild = (exitCode, source) => {
          if (_childCleanedUp) return;
          _childCleanedUp = true;
          clearStartupTimer();
          clearTimeout(runtimeTimer);
          try {
            log('agent', 'info', `child process exited code=${exitCode} (${source})`, { sessionId: shortId });
            const finalStatus = entry._terminationReason || (exitCode === 0 ? 'completed' : 'error');
            dbWrite((db) => {
              const now = new Date().toISOString();
              db.prepare(`
                UPDATE session_runtime_state SET status = ?, completed_at = ?, updated_at = ? WHERE session_id = ?
              `).run(finalStatus, now, now, childSessionId);
              db.prepare(`
                UPDATE sessions SET ended_at = ?, exit_code = ? WHERE id = ?
              `).run(now, exitCode, childSessionId);
            });
            if (entry.turnActive) {
              broadcast('agent:done', { sessionId: childSessionId, exitCode, providerSessionId: entry.providerSessionId });
            }
            broadcast('sessions:updated', { source: 'agent', event: 'child-completed', sessionId: childSessionId });
          } catch (cleanupErr) {
            log('agent', 'error', `child cleanup error: ${cleanupErr.message}`, { sessionId: shortId });
          }
          agentProcesses.delete(childSessionId);
          broadcastProcessCount(ctx);
        };

        proc.on('close', (exitCode) => cleanupChild(exitCode, 'close'));
        proc.on('exit', (exitCode) => cleanupChild(exitCode, 'exit'));

        proc.on('error', (err) => {
          log('agent', 'error', `child spawn error: ${err.message}`, { sessionId: shortId });
          clearStartupTimer();
          clearTimeout(runtimeTimer);
          try {
            dbWrite((db) => {
              const now = new Date().toISOString();
              db.prepare(`
                UPDATE session_runtime_state SET status = 'error', last_error = ?, updated_at = ? WHERE session_id = ?
              `).run(err.message, now, childSessionId);
              db.prepare(`
                UPDATE sessions SET error_code = 'SPAWN_ERROR', error_message = ?, ended_at = ? WHERE id = ?
              `).run(err.message, now, childSessionId);
            });
          } catch (dbErr) {
            log('agent', 'error', `child error handler DB write failed: ${dbErr.message}`, { sessionId: shortId });
          }
          broadcast('agent:error', { sessionId: childSessionId, error: err.message });
          agentProcesses.delete(childSessionId);
        });

        // Track rate limit
        recentTimestamps.push(now);
        spawnRateMap.set(parentSessionId, recentTimestamps);

        broadcastProcessCount(ctx);
        broadcast('sessions:updated', { source: 'agent', event: 'child-spawned', sessionId: childSessionId });

        json(res, {
          sessionId: childSessionId,
          worktreeBranch,
          worktreePath,
          status: 'spawned',
        });
      } catch (spawnErr) {
        // Compensating transaction: clean up worktree on spawn failure
        log('agent', 'error', `child spawn failed: ${spawnErr.message}`, { sessionId: shortId });
        try {
          execFileSync('git', ['worktree', 'remove', '--force', worktreePath], { cwd: parentRepoRoot, stdio: 'pipe' });
          try { execFileSync('git', ['branch', '-D', '--', worktreeBranch], { cwd: parentRepoRoot, stdio: 'pipe' }); } catch {}
        } catch {}
        dbWrite((db) => {
          const now = new Date().toISOString();
          db.prepare(`
            UPDATE session_runtime_state SET status = 'error', last_error = ?, updated_at = ? WHERE session_id = ?
          `).run(spawnErr.message, now, childSessionId);
          db.prepare(`
            UPDATE sessions SET error_code = 'SPAWN_FAILED', error_message = ?, ended_at = ? WHERE id = ?
          `).run(spawnErr.message, now, childSessionId);
        });
        return error(res, `Failed to spawn child: ${spawnErr.message}`, 500);
      }
      return true;
    }

    // GET /agent/children/:parentSessionId — list child sessions
    const childrenMatch = url.pathname.match(/^\/agent\/children\/([^/]+)$/);
    if (req.method === 'GET' && childrenMatch) {
      const parentId = decodeURIComponent(childrenMatch[1]);

      const callerSession = normalizeHeader(req.headers['x-rudi-caller-session']);
      if (!callerSession || callerSession !== parentId) {
        return json(res, { error: 'CALLER_SESSION_MISMATCH', message: 'X-Rudi-Caller-Session header required and must match parentSessionId' }, 403);
      }

      const children = [];

      try {
        const db = getDb();
        const rows = db.prepare(`
          SELECT s.id, s.status, s.model, s.started_at, s.ended_at, s.exit_code, s.title_override,
                 srs.worktree_branch, srs.worktree_path, srs.status as runtime_status
          FROM sessions s
          LEFT JOIN session_runtime_state srs ON srs.session_id = s.id
          WHERE s.parent_session_id = ?
          ORDER BY s.created_at DESC
        `).all(parentId);

        for (const row of rows) {
          const liveEntry = agentProcesses.get(row.id);
          const alive = !!(liveEntry?.proc && !liveEntry.proc.killed);
          children.push({
            sessionId: row.id,
            status: alive ? 'running' : (row.runtime_status || row.status || 'unknown'),
            alive,
            worktreeBranch: row.worktree_branch || liveEntry?.worktreeBranch || null,
            description: liveEntry?._description || row.title_override || null,
            turnActive: liveEntry?.turnActive || false,
            model: row.model,
            startedAt: row.started_at,
            endedAt: row.ended_at,
            exitCode: row.exit_code,
          });
        }
      } catch (dbErr) {
        // Fall back to memory only
        for (const [sessionId, entry] of agentProcesses) {
          if (entry.parentSessionId === parentId) {
            children.push({
              sessionId,
              status: entry.proc && !entry.proc.killed ? 'running' : 'completed',
              alive: !!(entry.proc && !entry.proc.killed),
              worktreeBranch: entry.worktreeBranch || null,
              description: entry._description || null,
              turnActive: entry.turnActive || false,
            });
          }
        }
      }

      json(res, { children });
      return true;
    }

    return false;
  };
}
