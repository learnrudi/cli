/**
 * Shared agent process spawn lifecycle.
 *
 * Reused by /agent/start and /agent/run-group to avoid duplicated
 * spawn/stdout/stderr/close/error plumbing.
 */

import fs from 'fs';
import { spawn } from 'child_process';
import { hasCapability } from './providers/index.js';
import { dbWrite, flushDbWrites, autoNameSession } from './db.js';
import { buildUserContent, broadcastProcessCount, dropResumeMappingsForSession } from './helpers.js';
import { attachStdoutHandler, attachStderrHandler, flushStdoutBuffer } from './process-io.js';

function unlinkQuiet(filePath) {
  if (!filePath) return;
  try { fs.unlinkSync(filePath); } catch {}
}

function deriveCostUsd(event) {
  if (typeof event?.costUsd === 'number') return event.costUsd;
  if (typeof event?.total_cost_usd === 'number') return event.total_cost_usd;
  return null;
}

function deriveTurnTokens(entry) {
  return Math.max(
    0,
    Number(entry._turnInputTokens || 0)
      + Number(entry._turnOutputTokens || 0)
      + Number(entry._turnCacheReadTokens || 0)
      + Number(entry._turnCacheCreationTokens || 0)
  );
}

function resetTurnAccumulators(entry) {
  entry._turnPrompt = '';
  entry._turnInputTokens = 0;
  entry._turnOutputTokens = 0;
  entry._turnCacheReadTokens = 0;
  entry._turnCacheCreationTokens = 0;
  entry._turnToolsUsed = [];
  if (entry._normalizer) entry._normalizer.reset();
}

export function spawnAgentProcess(ctx, options) {
  const {
    log,
    broadcast,
    agentProcesses,
    queueSessionsUpdated,
    resumeSessionIndex,
    pendingPermissions,
    sessionAlwaysAllowed,
  } = ctx;
  const {
    sessionId,
    prompt,
    provider,
    model,
    permissionMode = null,
    systemPrompt = null,
    providerConfig,
    binaryPath,
    args,
    env,
    spawnCwd,
    effectiveCwd,
    workingDir,
    repoRoot = null,
    worktreePath = null,
    worktreeBranch = null,
    baseBranch = null,
    resumeSessionId = null,
    parentSessionId = null,
    runGroupId = null,
    images = null,
    mcpConfigPath = null,
    sessionRowMode = 'providerSessionId', // 'providerSessionId' | 'existingSession'
    existingSessionId = null,
    queueEvent = 'result',
    queueCloseEvent = 'process-close',
    autoNameOnFirstTurn = false,
    setRunningOnCapture = true,
    stderrLogSlice = 200,
    onFirstStdoutData,
    onFirstStderrData,
    onTurnResult,
    onProcessClose,
    onProcessError,
    stdinModeOverride = null, // 'close' to force-close stdin (e.g. run-group autonomous mode)
  } = options;

  const shortId = sessionId.slice(0, 8);
  let mcpConfigCleaned = false;
  const maybeCleanupMcpConfig = () => {
    if (mcpConfigCleaned) return;
    mcpConfigCleaned = true;
    unlinkQuiet(mcpConfigPath);
  };

  const proc = spawn(binaryPath, args, {
    cwd: spawnCwd,
    env,
    stdio: ['pipe', 'pipe', 'pipe'],
  });

  const entry = {
    proc,
    provider,
    providerConfig,
    providerSessionId: null,
    resumeSessionId: resumeSessionId || null,
    parentSessionId: parentSessionId || null,
    runGroupId: runGroupId || null,
    stdoutBuffer: '',
    turnActive: true,
    startedAt: Date.now(),
    lastActivityAt: Date.now(),
    cwd: effectiveCwd,
    repoRoot,
    worktreePath,
    worktreeBranch,
    baseBranch,
    permissionMode,
    systemPrompt,
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
  log('agent', 'info', `process spawned pid=${proc.pid}`, { sessionId: shortId, provider });

  const stdinMode = stdinModeOverride || providerConfig?.headless?.stdin;
  if (stdinMode === 'pipe' && !stdinModeOverride && hasCapability(providerConfig, 'inputStreaming')) {
    const inputMsg = JSON.stringify({
      type: 'user',
      message: { role: 'user', content: buildUserContent(prompt, images, effectiveCwd, log) },
    }) + '\n';
    proc.stdin.write(inputMsg);
    log('agent', 'debug', 'wrote first prompt to stdin (stream-json)', { sessionId: shortId });
  } else if (stdinMode === 'close') {
    proc.stdin.end();
    log('agent', 'debug', 'closed stdin (prompt delivered via args)', { sessionId: shortId });
  } else if (stdinMode === 'pipe') {
    log('agent', 'debug', 'stdin pipe open (prompt delivered via args)', { sessionId: shortId });
  }

  attachStdoutHandler(ctx, sessionId, entry, {
    setRunningOnCapture,
    onFirstData: onFirstStdoutData,
    onResult: (event) => {
      entry.turnActive = false;
      const costUsd = deriveCostUsd(event);
      const turnTokens = deriveTurnTokens(entry);
      const turnNumber = entry._turnNumber;
      const turnPrompt = entry._turnPrompt || '';
      const turnModel = entry._turnModel || null;
      const providerSid = entry.providerSessionId;

      dbWrite((db) => {
        const now = new Date().toISOString();

        if (costUsd !== null) {
          db.prepare(`
            UPDATE session_runtime_state
            SET turn_count = turn_count + 1, cost_total = ?, tokens_total = tokens_total + ?, updated_at = ?
            WHERE session_id = ?
          `).run(costUsd, turnTokens, now, sessionId);
        } else {
          db.prepare(`
            UPDATE session_runtime_state
            SET turn_count = turn_count + 1, tokens_total = tokens_total + ?, updated_at = ?
            WHERE session_id = ?
          `).run(turnTokens, now, sessionId);
        }

        if (sessionRowMode === 'providerSessionId') {
          if (!providerSid) return;
          db.prepare(`
            INSERT OR IGNORE INTO sessions
              (id, provider, provider_session_id, run_group_id, origin, cwd, project_path, model, status, created_at, last_active_at,
               turn_count, total_cost, total_input_tokens, total_output_tokens)
            VALUES (?, ?, ?, ?, 'rudi', ?, ?, ?, 'active', ?, ?, 0, 0, 0, 0)
          `).run(
            providerSid,
            provider,
            providerSid,
            runGroupId,
            workingDir,
            workingDir,
            turnModel,
            now,
            now,
          );
          db.prepare(`
            UPDATE sessions
            SET last_active_at = ?,
                run_group_id = COALESCE(run_group_id, ?)
            WHERE id = ?
          `).run(now, runGroupId, providerSid);
          return;
        }

        if (sessionRowMode === 'existingSession') {
          const sessionRowId = existingSessionId || sessionId;
          if (providerSid) {
            db.prepare(`
              UPDATE sessions
              SET provider_session_id = COALESCE(provider_session_id, ?),
                  last_active_at = ?,
                  model = COALESCE(?, model),
                  run_group_id = COALESCE(run_group_id, ?)
              WHERE id = ?
            `).run(providerSid, now, turnModel, runGroupId, sessionRowId);
          } else {
            db.prepare(`
              UPDATE sessions
              SET last_active_at = ?,
                  model = COALESCE(?, model),
                  run_group_id = COALESCE(run_group_id, ?)
              WHERE id = ?
            `).run(now, turnModel, runGroupId, sessionRowId);
          }
          if (costUsd !== null) {
            db.prepare('UPDATE sessions SET total_cost = ? WHERE id = ?').run(costUsd, sessionRowId);
          }
        }
      });

      if (autoNameOnFirstTurn && turnNumber === 1 && providerSid) {
        autoNameSession(entry, providerSid, turnPrompt, workingDir, broadcast, log);
      }

      if (typeof onTurnResult === 'function') {
        onTurnResult({
          sessionId,
          entry,
          event,
          turnNumber,
          turnPrompt,
          turnModel,
          providerSessionId: providerSid || null,
          costUsd,
          turnTokens,
          runGroupId,
        });
      }

      entry._turnNumber += 1;
      resetTurnAccumulators(entry);

      broadcast('agent:done', { sessionId, exitCode: 0, providerSessionId: entry.providerSessionId });

      // Broadcast live activity for run-group sessions
      if (runGroupId) {
        broadcast('run-group:session-activity', {
          groupId: runGroupId,
          sessionId,
          turnCount: entry._turnNumber,
          costTotal: costUsd,
          lastSnippet: null, // Snippet extracted by live endpoint
        });
      }

      if (queueSessionsUpdated) {
        const queuedSessionId = entry.providerSessionId
          || (sessionRowMode === 'existingSession' ? (existingSessionId || sessionId) : null);
        queueSessionsUpdated({
          source: 'agent',
          event: queueEvent,
          sessionId: queuedSessionId,
        });
      }
    },
  });

  attachStderrHandler(ctx, sessionId, entry, {
    logSlice: stderrLogSlice,
    onFirstData: onFirstStderrData,
  });

  let finalized = false;
  const finalizeClose = (exitCode, source = 'close') => {
    if (finalized) return;
    finalized = true;
    log('agent', 'info', `process exited code=${exitCode}`, { sessionId: shortId, provider, source });
    flushStdoutBuffer(ctx, sessionId, entry);

    const finalStatus = entry._terminationReason || (exitCode === 0 ? 'completed' : 'error');
    dbWrite((db) => {
      const now = new Date().toISOString();
      db.prepare(`
        UPDATE session_runtime_state
        SET status = ?, completed_at = ?, updated_at = ?
        WHERE session_id = ?
      `).run(finalStatus, now, now, sessionId);

      if (sessionRowMode === 'existingSession') {
        const sessionRowId = existingSessionId || sessionId;
        db.prepare(`
          UPDATE sessions
          SET ended_at = ?, exit_code = ?, error_code = ?, error_message = ?
          WHERE id = ?
        `).run(
          now,
          exitCode,
          exitCode === 0 ? null : (entry._terminationReason || 'PROCESS_EXIT'),
          exitCode === 0 ? null : `Process exited with code ${exitCode}`,
          sessionRowId,
        );
      }
    });

    if (entry.turnActive) {
      broadcast('agent:done', { sessionId, exitCode, providerSessionId: entry.providerSessionId });
      if (queueSessionsUpdated) {
        const queuedSessionId = entry.providerSessionId
          || (sessionRowMode === 'existingSession' ? (existingSessionId || sessionId) : null);
        queueSessionsUpdated({
          source: 'agent',
          event: queueCloseEvent,
          sessionId: queuedSessionId,
        });
      }
    }

    dropResumeMappingsForSession(sessionId, resumeSessionIndex);
    for (const [reqId, pending] of pendingPermissions || []) {
      if (pending.rudiSessionId !== sessionId) continue;
      const denyDecision = { permissionDecision: 'deny', reason: 'Session ended' };
      if (pending.resolve) pending.resolve(denyDecision);
      else pending.decision = denyDecision;
      if (pending.timer) clearTimeout(pending.timer);
      pendingPermissions.delete(reqId);
    }
    if (sessionAlwaysAllowed) sessionAlwaysAllowed.delete(sessionId);
    agentProcesses.delete(sessionId);
    broadcastProcessCount(ctx);
    maybeCleanupMcpConfig();

    if (typeof onProcessClose === 'function') {
      // Flush queued DB writes so status is committed before consumers read it
      // (e.g. run-group aggregate refresh reads session_runtime_state.status)
      flushDbWrites();
      onProcessClose({
        sessionId,
        entry,
        exitCode,
        finalStatus,
        providerSessionId: entry.providerSessionId || null,
        runGroupId,
      });
    }
  };

  proc.on('close', (exitCode) => finalizeClose(exitCode, 'close'));
  proc.on('exit', () => maybeCleanupMcpConfig());

  proc.on('error', (err) => {
    if (finalized) return;
    finalized = true;
    log('agent', 'error', `spawn error: ${err.message}`, { sessionId: shortId, provider });
    broadcast('agent:error', { sessionId, error: err.message });
    dbWrite((db) => {
      const now = new Date().toISOString();
      db.prepare(`
        UPDATE session_runtime_state
        SET status = 'error', last_error = ?, updated_at = ?
        WHERE session_id = ?
      `).run(err.message, now, sessionId);

      if (sessionRowMode === 'existingSession') {
        const sessionRowId = existingSessionId || sessionId;
        db.prepare(`
          UPDATE sessions
          SET error_code = 'SPAWN_ERROR',
              error_message = ?,
              ended_at = ?
          WHERE id = ?
        `).run(err.message, now, sessionRowId);
      }
    });

    dropResumeMappingsForSession(sessionId, resumeSessionIndex);
    if (sessionAlwaysAllowed) sessionAlwaysAllowed.delete(sessionId);
    agentProcesses.delete(sessionId);
    broadcastProcessCount(ctx);
    maybeCleanupMcpConfig();

    if (typeof onProcessError === 'function') {
      onProcessError({
        sessionId,
        entry,
        error: err,
        runGroupId,
      });
    }
  });

  broadcastProcessCount(ctx);
  return entry;
}
