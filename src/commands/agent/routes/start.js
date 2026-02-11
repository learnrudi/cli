/**
 * POST /agent/start — spawn a persistent Claude agent process with streaming stdin/stdout.
 */

import os from 'os';
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { spawn, execSync } from 'child_process';
import { PATHS } from '@learnrudi/env';
import { resolveClaudeBinary } from '../auth.js';
import { buildSystemPrompt } from '../prompts.js';
import { dbWrite } from '../db.js';
import { autoNameSession } from '../db.js';
import { resolveReusableEntry, countAlive, broadcastProcessCount, dropResumeMappingsForSession, buildUserContent } from '../helpers.js';
import { getRepoRoot, createSessionWorktree, restoreSessionWorktree } from '../worktree.js';
import { attachStdoutHandler, attachStderrHandler, flushStdoutBuffer } from '../process-io.js';

export function buildStartRoute(ctx) {
  const {
    json, error, readBody, log, broadcast,
    agentProcesses, queueSessionsUpdated, resumeSessionIndex,
    maxConcurrent, getSidecarPort, getSidecarToken,
    pendingPermissions, sessionAlwaysAllowed,
  } = ctx;

  return async (req, res, url) => {
    if (req.method !== 'POST' || url.pathname !== '/agent/start') return false;

    const body = await readBody(req);
    log('agent', 'info', 'received /agent/start request', { bodyKeys: Object.keys(body), resumeSessionId: body.resumeSessionId || null });
    const {
      prompt,
      model,
      systemPrompt,
      resumeSessionId,
      cwd,
      permissionMode,
      planMode,
      images,
      useWorktree,
      parentSessionId,
    } = body;
    const isChildSession = Boolean(parentSessionId);
    let shouldUseWorktree = useWorktree !== false;
    // Belt-and-suspenders: child sessions are always isolated.
    if (isChildSession) shouldUseWorktree = true;

    if (!prompt && (!images || images.length === 0)) return error(res, 'prompt required');

    // If resuming a session that already has a running process, reuse it
    if (resumeSessionId) {
      const reusable = resolveReusableEntry(resumeSessionId, { agentProcesses, resumeSessionIndex });
      if (reusable) {
        const { sessionId: existingId, entry } = reusable;
        log('agent', 'info', `reusing existing process for resume ${resumeSessionId.slice(0, 8)}`, {
          existingSessionId: existingId.slice(0, 8),
        });
        entry.turnActive = true;
        entry.lastActivityAt = Date.now();
        // Reset per-turn accumulators for the new turn
        entry._turnPrompt = prompt;
        entry._turnInputTokens = 0;
        entry._turnOutputTokens = 0;
        entry._turnCacheReadTokens = 0;
        entry._turnCacheCreationTokens = 0;
        entry._turnToolsUsed = [];
        // 4j. Reuse — touch updated_at
        dbWrite((db) => {
          db.prepare(`
            UPDATE session_runtime_state SET updated_at = ? WHERE session_id = ?
          `).run(new Date().toISOString(), existingId);
        });
        const inputMsg = JSON.stringify({ type: 'user', message: { role: 'user', content: buildUserContent(prompt, images, entry.cwd, log) } }) + '\n';
        entry.proc.stdin.write(inputMsg);
        broadcast('agent:event', {
          sessionId: existingId,
          event: { type: 'system', message: 'Resumed existing process' },
        });
        return json(res, {
          sessionId: existingId,
          provider: entry.provider,
          reused: true,
          cwd: entry.cwd,
          useWorktree: Boolean(entry.worktreePath),
        });
      }
    }

    // Enforce max concurrent process limit
    const aliveCount = countAlive(agentProcesses);
    if (aliveCount >= maxConcurrent) {
      log('agent', 'warn', `max concurrent limit reached (${aliveCount}/${maxConcurrent})`);
      json(res, {
        error: `Too many active agent processes (${aliveCount}/${maxConcurrent}). Stop an existing session or wait for one to finish.`,
      }, 429);
      return true;
    }

    const binaryPath = resolveClaudeBinary();
    if (!binaryPath) {
      log('agent', 'error', 'Claude CLI not found');
      return error(res, 'Claude CLI not found. Run: rudi install agent:claude', 500);
    }

    const sessionId = crypto.randomUUID();
    const shortId = sessionId.slice(0, 8);
    if (resumeSessionId) {
      resumeSessionIndex.set(resumeSessionId, sessionId);
    }

    const args = [
      '--print',
      '--output-format', 'stream-json',
      '--input-format', 'stream-json',
      '--verbose',
    ];
    if (model) args.push('--model', model);

    // Build system prompt
    const canSpawnChildren = getSidecarPort() > 0;
    const fullSystemPrompt = buildSystemPrompt(systemPrompt, { canSpawnChildren });
    if (fullSystemPrompt) args.push('--append-system-prompt', fullSystemPrompt);
    if (resumeSessionId) args.push('--resume', resumeSessionId);
    if (planMode) {
      args.push('--permission-mode', 'plan');
    } else if (permissionMode === 'dangerouslySkipPermissions') {
      args.push('--dangerously-skip-permissions');
    } else {
      args.push('--permission-mode', permissionMode || 'bypassPermissions');
    }

    // Pre-allow spawn tools for headless sessions
    if (canSpawnChildren) {
      args.push(
        '--allowed-tools',
        'mcp__rudi-spawn__spawn_child,mcp__rudi-spawn__list_children'
      );
    }

    // MCP config injection
    let mcpConfigPath = null;
    if (canSpawnChildren) {
      const spawnShimPath = path.join(PATHS.home, 'bins', 'rudi-spawn');
      if (fs.existsSync(spawnShimPath)) {
        try {
          let existingMcpServers = {};
          const claudeJsonPath = path.join(os.homedir(), '.claude.json');
          try {
            const claudeJson = JSON.parse(fs.readFileSync(claudeJsonPath, 'utf-8'));
            existingMcpServers = claudeJson.mcpServers || {};
          } catch {
            // No ~/.claude.json or malformed
          }

          const mergedConfig = {
            mcpServers: {
              ...existingMcpServers,
              'rudi-spawn': { command: spawnShimPath, args: [] },
            },
          };

          const tmpDir = path.join(PATHS.home, 'tmp');
          fs.mkdirSync(tmpDir, { recursive: true });
          mcpConfigPath = path.join(tmpDir, `spawn-mcp-${shortId}.json`);
          fs.writeFileSync(mcpConfigPath, JSON.stringify(mergedConfig, null, 2), { mode: 0o600 });

          args.push('--mcp-config', mcpConfigPath, '--strict-mcp-config');

          log('agent', 'info', `injected spawn MCP config: ${mcpConfigPath}`, { sessionId: shortId, serverCount: Object.keys(mergedConfig.mcpServers).length });
        } catch (mcpErr) {
          log('agent', 'warn', `MCP config injection failed: ${mcpErr.message}`, { sessionId: shortId });
        }
      }
    }

    const env = {
      ...process.env,
      TERM: 'xterm-256color',
      CLAUDE_NO_UPDATE_CHECK: 'true',
      DISABLE_AUTOUPDATE: '1',
      NO_COLOR: '1',
    };
    if (permissionMode && permissionMode !== 'default') {
      env.CI = 'true';
    }
    const port = getSidecarPort();
    if (port > 0) {
      env.RUDI_SIDECAR_URL = `http://127.0.0.1:${port}`;
      env.RUDI_SIDECAR_TOKEN = getSidecarToken();
      env.RUDI_SESSION_ID = sessionId;
      env.RUDI_CAN_SPAWN_CHILDREN = '1';
    }

    const workingDir = cwd || process.env.HOME || os.homedir();

    // Detect git repo + branch
    let currentBranch = null;
    let repoRoot = null;
    let isGitRepo = false;
    try {
      execSync('git rev-parse --is-inside-work-tree', { cwd: workingDir, stdio: 'pipe' });
      repoRoot = getRepoRoot(workingDir);
      currentBranch = execSync('git rev-parse --abbrev-ref HEAD', { cwd: workingDir, stdio: 'pipe' }).toString().trim();
      isGitRepo = true;
    } catch {
      isGitRepo = false;
      repoRoot = null;
      currentBranch = null;
    }

    // Worktree isolation
    let worktreePath = null;
    let worktreeBranch = null;
    let baseBranch = currentBranch;
    let gitignoreWarning = false;
    let effectiveCwd = workingDir;

    if (isGitRepo && repoRoot && currentBranch) {
      if (!resumeSessionId) {
        if (shouldUseWorktree) {
          const wt = createSessionWorktree({ repoRoot, currentBranch, shortId, log });
          if (wt.worktreePath) {
            worktreePath = wt.worktreePath;
            worktreeBranch = wt.worktreeBranch;
            effectiveCwd = wt.worktreePath;
            gitignoreWarning = wt.gitignoreWarning;
          }
        }
      } else {
        const restored = restoreSessionWorktree({ resumeSessionId, repoRoot, currentBranch, shortId, log });
        if (restored.worktreePath) {
          worktreePath = restored.worktreePath;
          worktreeBranch = restored.worktreeBranch;
          baseBranch = restored.baseBranch;
          effectiveCwd = restored.worktreePath;
        }
      }
    }

    const resolvedUseWorktree = Boolean(worktreePath);

    // Validate spawn cwd
    let spawnCwd = effectiveCwd;
    try {
      const st = fs.statSync(spawnCwd);
      if (!st.isDirectory()) throw new Error('not_a_directory');
    } catch {
      const cwdFallbacks = [workingDir, repoRoot, process.env.HOME, os.homedir()]
        .filter((p) => typeof p === 'string' && p.length > 0);
      const fallback = cwdFallbacks.find((p) => {
        try {
          return fs.statSync(p).isDirectory();
        } catch {
          return false;
        }
      });
      if (fallback) {
        log('agent', 'warn', `spawn cwd missing, falling back to: ${fallback}`, {
          sessionId: shortId,
          missingCwd: effectiveCwd,
        });
        spawnCwd = fallback;
        effectiveCwd = fallback;
      }
    }

    log('agent', 'info', 'spawning persistent agent', {
      sessionId: shortId,
      binary: binaryPath,
      cwd: spawnCwd,
      worktreeBranch,
      prompt: (prompt || '').slice(0, 80),
      resumeSessionId: resumeSessionId || null,
    });

    // 4a. Session start — insert runtime state row before spawn
    dbWrite((db) => {
      const now = new Date().toISOString();
      db.prepare(`
        INSERT INTO session_runtime_state
          (session_id, status, provider, resume_session_id, cwd, started_at, updated_at,
           worktree_path, worktree_branch, project_root, base_branch, use_worktree)
        VALUES (?, 'starting', 'claude', ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(sessionId, resumeSessionId || null, effectiveCwd, now, now,
             worktreePath, worktreeBranch, repoRoot, baseBranch, resolvedUseWorktree ? 1 : 0);
    });

    try {
      const proc = spawn(binaryPath, args, {
        cwd: spawnCwd,
        env,
        stdio: ['pipe', 'pipe', 'pipe'],
      });

      const entry = {
        proc,
        provider: 'claude',
        providerSessionId: null,
        resumeSessionId: resumeSessionId || null,
        parentSessionId: null,
        stdoutBuffer: '',
        turnActive: true,
        startedAt: Date.now(),
        lastActivityAt: Date.now(),
        cwd: effectiveCwd,
        repoRoot,
        worktreePath,
        worktreeBranch,
        baseBranch,
        _terminationReason: null,
        _turnPrompt: prompt,
        _turnNumber: 1,
        _turnInputTokens: 0,
        _turnOutputTokens: 0,
        _turnCacheReadTokens: 0,
        _turnCacheCreationTokens: 0,
        _turnModel: model || null,
        _turnToolsUsed: [],
      };
      agentProcesses.set(sessionId, entry);

      log('agent', 'info', `process spawned pid=${proc.pid}`, { sessionId: shortId });

      const inputMsg = JSON.stringify({ type: 'user', message: { role: 'user', content: buildUserContent(prompt, images, effectiveCwd, log) } }) + '\n';
      proc.stdin.write(inputMsg);
      log('agent', 'debug', 'wrote first prompt to stdin', { sessionId: shortId });

      // --- stdout handler (uses shared process-io) ---
      attachStdoutHandler(ctx, sessionId, entry, {
        setRunningOnCapture: true,
        onResult: (event) => {
          entry.turnActive = false;
          const costUsd = typeof event.total_cost_usd === 'number' ? event.total_cost_usd : null;
          const turnNumber = entry._turnNumber;
          const turnPrompt = entry._turnPrompt || '';
          const turnModel = entry._turnModel || null;
          const turnInputTokens = entry._turnInputTokens;
          const turnOutputTokens = entry._turnOutputTokens;
          const turnCacheRead = entry._turnCacheReadTokens;
          const turnCacheCreation = entry._turnCacheCreationTokens;
          const turnToolsUsed = entry._turnToolsUsed.length > 0
            ? JSON.stringify([...new Set(entry._turnToolsUsed)])
            : null;
          const providerSid = entry.providerSessionId;

          // 4c. Turn complete — runtime state + sessions/turns DB write
          dbWrite((db) => {
            const now = new Date().toISOString();
            const nowMs = Date.now();

            if (costUsd !== null) {
              db.prepare(`
                UPDATE session_runtime_state
                SET turn_count = turn_count + 1, cost_total = ?, updated_at = ?
                WHERE session_id = ?
              `).run(costUsd, now, sessionId);
            } else {
              db.prepare(`
                UPDATE session_runtime_state
                SET turn_count = turn_count + 1, updated_at = ?
                WHERE session_id = ?
              `).run(now, sessionId);
            }

            if (!providerSid) return;

            db.prepare(`
              INSERT OR IGNORE INTO sessions
                (id, provider, provider_session_id, origin, cwd, model, status, created_at, last_active_at,
                 turn_count, total_cost, total_input_tokens, total_output_tokens)
              VALUES (?, 'claude', ?, 'rudi', ?, ?, 'active', ?, ?, 0, 0, 0, 0)
            `).run(providerSid, providerSid, workingDir, turnModel, now, now);

            const turnId = crypto.randomUUID();
            db.prepare(`
              INSERT INTO turns
                (id, session_id, provider, provider_session_id, turn_number,
                 user_message, model, cost, input_tokens, output_tokens,
                 cache_read_tokens, cache_creation_tokens, tools_used, ts, ts_ms)
              VALUES (?, ?, 'claude', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            `).run(
              turnId, providerSid, providerSid, turnNumber,
              turnPrompt, turnModel, costUsd,
              turnInputTokens, turnOutputTokens,
              turnCacheRead, turnCacheCreation,
              turnToolsUsed, now, nowMs,
            );

            const turnCost = costUsd !== null ? costUsd : 0;
            db.prepare(`
              UPDATE sessions
              SET turn_count = turn_count + 1,
                  total_cost = total_cost + ?,
                  total_input_tokens = total_input_tokens + ?,
                  total_output_tokens = total_output_tokens + ?,
                  last_active_at = ?
              WHERE id = ?
            `).run(turnCost, turnInputTokens, turnOutputTokens, now, providerSid);
          });

          // Auto-name after first turn completes
          if (turnNumber === 1 && providerSid) {
            autoNameSession(entry, providerSid, turnPrompt, workingDir, broadcast, log);
          }

          // Advance turn counter & reset accumulators
          entry._turnNumber++;
          entry._turnPrompt = '';
          entry._turnInputTokens = 0;
          entry._turnOutputTokens = 0;
          entry._turnCacheReadTokens = 0;
          entry._turnCacheCreationTokens = 0;
          entry._turnToolsUsed = [];

          broadcast('agent:done', { sessionId, exitCode: 0, providerSessionId: entry.providerSessionId });
          queueSessionsUpdated({
            source: 'agent',
            event: 'result',
            sessionId: entry.providerSessionId || null,
          });
        },
      });

      // --- stderr handler ---
      attachStderrHandler(ctx, sessionId, entry);

      // --- process close ---
      proc.on('close', (exitCode) => {
        log('agent', 'info', `process exited code=${exitCode}`, { sessionId: shortId });
        flushStdoutBuffer(ctx, sessionId, entry);
        // 4d. Process close — finalize status
        dbWrite((db) => {
          const now = new Date().toISOString();
          const finalStatus = entry._terminationReason || (exitCode === 0 ? 'completed' : 'error');
          db.prepare(`
            UPDATE session_runtime_state
            SET status = ?, completed_at = ?, updated_at = ?
            WHERE session_id = ?
          `).run(finalStatus, now, now, sessionId);
        });
        if (entry.turnActive) {
          broadcast('agent:done', { sessionId, exitCode, providerSessionId: entry.providerSessionId });
          queueSessionsUpdated({
            source: 'agent',
            event: 'process-close',
            sessionId: entry.providerSessionId || null,
          });
        }
        dropResumeMappingsForSession(sessionId, resumeSessionIndex);
        // Resolve any pending permission requests for this session with deny
        for (const [reqId, pending] of pendingPermissions) {
          if (pending.rudiSessionId === sessionId) {
            const denyDecision = { permissionDecision: 'deny', reason: 'Session ended' };
            if (pending.resolve) pending.resolve(denyDecision);
            else pending.decision = denyDecision;
            if (pending.timer) clearTimeout(pending.timer);
            pendingPermissions.delete(reqId);
          }
        }
        sessionAlwaysAllowed.delete(sessionId);
        agentProcesses.delete(sessionId);
        broadcastProcessCount(ctx);
        if (mcpConfigPath) { try { fs.unlinkSync(mcpConfigPath); } catch {} }
      });

      proc.on('exit', () => {
        if (mcpConfigPath) { try { fs.unlinkSync(mcpConfigPath); } catch {} }
      });

      proc.on('error', (err) => {
        log('agent', 'error', `spawn error: ${err.message}`, { sessionId: shortId });
        broadcast('agent:error', { sessionId, error: err.message });
        // 4e. Spawn error
        dbWrite((db) => {
          db.prepare(`
            UPDATE session_runtime_state
            SET status = 'error', last_error = ?, updated_at = ?
            WHERE session_id = ?
          `).run(err.message, new Date().toISOString(), sessionId);
        });
        dropResumeMappingsForSession(sessionId, resumeSessionIndex);
        agentProcesses.delete(sessionId);
        if (mcpConfigPath) { try { fs.unlinkSync(mcpConfigPath); } catch {} }
      });

      json(res, {
        sessionId,
        provider: 'claude',
        cwd: effectiveCwd,
        currentBranch,
        repoRoot,
        worktreeBranch: worktreeBranch || undefined,
        projectCwd: worktreePath ? workingDir : undefined,
        baseBranch: baseBranch || undefined,
        gitignoreWarning: gitignoreWarning || undefined,
        useWorktree: resolvedUseWorktree,
      });
      broadcastProcessCount(ctx);
    } catch (err) {
      dropResumeMappingsForSession(sessionId, resumeSessionIndex);
      // 4f. Spawn catch
      dbWrite((db) => {
        db.prepare(`
          UPDATE session_runtime_state
          SET status = 'error', last_error = ?, updated_at = ?
          WHERE session_id = ?
        `).run(err.message, new Date().toISOString(), sessionId);
      });
      log('agent', 'error', `Failed to spawn: ${err.message}`);
      error(res, `Failed to spawn agent: ${err.message}`, 500);
    }
    return true;
  };
}
