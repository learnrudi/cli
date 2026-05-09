/**
 * Shared agent process spawn lifecycle.
 *
 * Reused by /agent/start and /agent/run-group to avoid duplicated
 * spawn/stdout/stderr/close/error plumbing.
 */

import fs from 'fs';
import { spawn } from 'child_process';
import { hasCapability } from './providers/index.js';
import { dbWrite, flushDbWrites, autoNameSession, transitionSessionStatus } from './db.js';
import { buildUserContent, broadcastProcessCount, dropResumeMappingsForSession } from './helpers.js';
import { attachStdoutHandler, attachStderrHandler, flushStdoutBuffer } from './process-io.js';
import { classifyError, isRetryable } from './error-classifier.js';
import { createRetryState, canRetry, getNextDelay, incrementRetry } from './retry-logic.js';
import { createRunGroupSessionActivityEvent } from './run-group-domain.js';

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

function clearRetryTimer(entry) {
  if (!entry?._retryTimer) return;
  clearTimeout(entry._retryTimer);
  entry._retryTimer = null;
}

function reserveRetryDelay(entry) {
  const delay = getNextDelay(entry._retryState);
  incrementRetry(entry._retryState);
  return delay;
}

function respawnFromRetryContext(ctx, sessionId, entry) {
  const { log, broadcast, agentProcesses } = ctx;
  const rc = entry._retryContext;
  const shortId = sessionId.slice(0, 8);

  clearRetryTimer(entry);
  if (entry._terminationReason === 'stopped' || !agentProcesses.has(sessionId)) {
    return;
  }

  log('agent', 'info', 'retry respawn started', {
    sessionId: shortId,
    attempt: entry._retryState.count + 1,
  });

  try {
    // Clear accumulated error context from previous attempt
    entry._stderrText = '';
    entry._lastErrorContext = null;
    entry.stdoutBuffer = '';

    const proc = spawn(rc.binaryPath, rc.spawnArgs, {
      cwd: rc.spawnCwd,
      env: rc.spawnEnv,
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    // Replace the process reference on the entry
    entry.proc = proc;
    entry.lastActivityAt = Date.now();
    entry.turnActive = true;
    entry._terminationReason = null;

    dbWrite((db) => {
      transitionSessionStatus(db, sessionId, 'running');
    });

    // Re-attach stdout/stderr handlers
    attachStdoutHandler(ctx, sessionId, entry, {
      onResult: rc.onTurnResult,
      setRunningOnCapture: false,
    });
    attachStderrHandler(ctx, sessionId, entry, {
      logSlice: rc.stderrLogSlice || 200,
    });

    // Re-attach close/error handlers with a new finalized flag for this process instance
    let retryFinalized = false;

    proc.on('close', (exitCode) => {
      if (retryFinalized) return;

      // Check for transient retry again
      if (exitCode !== 0) {
        const errorText = [
          entry._lastErrorContext?.error,
          entry._lastErrorContext?.message,
          entry._stderrText,
        ].filter(Boolean).join(' ');

        const classification = classifyError(errorText, exitCode);
        log('agent', 'info', 'error classified', {
          sessionId: shortId,
          code: classification.code,
          category: classification.category,
          retryable: classification.retryable,
          source: 'retry-close',
        });

        if (isRetryable(classification) && canRetry(entry._retryState)) {
          const delay = reserveRetryDelay(entry);

          log('agent', 'info', 'retry scheduled', {
            sessionId: shortId,
            retryCount: entry._retryState.count,
            maxRetries: entry._retryState.maxRetries,
            nextDelayMs: delay,
          });

          dbWrite((db) => {
            transitionSessionStatus(db, sessionId, 'retrying', {
              lastError: `${classification.code}: ${errorText.slice(0, 200)}`,
            });
          });

          broadcast('agent:error', {
            sessionId,
            error: errorText.slice(0, 500),
            code: classification.code,
            category: classification.category,
            retryable: true,
            retryCount: entry._retryState.count,
            maxRetries: entry._retryState.maxRetries,
            nextRetryMs: delay,
          });

          entry._retryTimer = setTimeout(() => {
            entry._retryTimer = null;
            if (!agentProcesses.has(sessionId) || entry._terminationReason === 'stopped') return;
            respawnFromRetryContext(ctx, sessionId, entry);
          }, delay);
          return;
        }
      }

      retryFinalized = true;

      // Terminal: flush and clean up
      log('agent', 'info', `retry process exited code=${exitCode}`, { sessionId: shortId });
      flushStdoutBuffer(ctx, sessionId, entry);

      const finalStatus = entry._terminationReason || (exitCode === 0 ? 'completed' : 'error');
      dbWrite((db) => {
        const now = new Date().toISOString();
        transitionSessionStatus(db, sessionId, finalStatus, {
          completedAt: now,
          lastError: finalStatus === 'error'
            ? `Process exited with code ${exitCode} after ${entry._retryState.count} retries`
            : undefined,
        });

        if (rc.sessionRowMode === 'existingSession') {
          const sessionRowId = rc.existingSessionId || sessionId;
          db.prepare(`
            UPDATE sessions
            SET ended_at = ?, exit_code = ?, error_code = ?, error_message = ?
            WHERE id = ?
          `).run(
            now,
            exitCode,
            exitCode === 0 ? null : (entry._terminationReason || 'PROCESS_EXIT'),
            exitCode === 0 ? null : `Process exited with code ${exitCode} after ${entry._retryState.count} retries`,
            sessionRowId,
          );
        }
      });

      if (finalStatus === 'error') {
        log('agent', 'warn', 'retry exhausted', {
          sessionId: shortId,
          finalErrorCode: 'PROCESS_EXIT',
          totalAttempts: entry._retryState.count + 1,
        });
      }

      if (entry.turnActive) {
        broadcast('agent:done', { sessionId, exitCode, providerSessionId: entry.providerSessionId });
        if (rc.queueSessionsUpdated) {
          const queuedSessionId = entry.providerSessionId
            || (rc.sessionRowMode === 'existingSession' ? (rc.existingSessionId || sessionId) : null);
          rc.queueSessionsUpdated({
            source: 'agent',
            event: rc.queueCloseEvent,
            sessionId: queuedSessionId,
          });
        }
      }

      // Full cleanup
      clearRetryTimer(entry);
      dropResumeMappingsForSession(sessionId, ctx.resumeSessionIndex);
      if (ctx.sessionAlwaysAllowed) ctx.sessionAlwaysAllowed.delete(sessionId);
      agentProcesses.delete(sessionId);
      broadcastProcessCount(ctx);

      if (typeof rc.onProcessClose === 'function') {
        flushDbWrites();
        Promise.resolve(rc.onProcessClose({
          sessionId,
          entry,
          exitCode,
          finalStatus,
          providerSessionId: entry.providerSessionId || null,
          runGroupId: rc.runGroupId,
        })).catch((err) => {
          log('agent', 'warn', `retry close handler failed: ${err.message}`, { sessionId: shortId });
        });
      }
    });

    proc.on('error', (err) => {
      if (retryFinalized) return;
      log('agent', 'error', `retry spawn error: ${err.message}`, { sessionId: shortId });

      // Same retry classification
      const errorText = err.message + ' ' + (entry._stderrText || '');
      const classification = classifyError(errorText, null);

      if (isRetryable(classification) && canRetry(entry._retryState)) {
        const delay = reserveRetryDelay(entry);

        dbWrite((db) => {
          transitionSessionStatus(db, sessionId, 'retrying', {
            lastError: `${classification.code}: ${err.message.slice(0, 200)}`,
          });
        });

        broadcast('agent:error', {
          sessionId,
          error: err.message,
          code: classification.code,
          category: classification.category,
          retryable: true,
          retryCount: entry._retryState.count,
          maxRetries: entry._retryState.maxRetries,
          nextRetryMs: delay,
        });

        entry._retryTimer = setTimeout(() => {
          entry._retryTimer = null;
          if (!agentProcesses.has(sessionId) || entry._terminationReason === 'stopped') return;
          respawnFromRetryContext(ctx, sessionId, entry);
        }, delay);
        return;
      }

      retryFinalized = true;

      // Terminal error
      broadcast('agent:error', { sessionId, error: err.message });
      dbWrite((db) => {
        const now = new Date().toISOString();
        transitionSessionStatus(db, sessionId, 'error', {
          lastError: err.message,
          completedAt: now,
        });
        if (rc.sessionRowMode === 'existingSession') {
          const sessionRowId = rc.existingSessionId || sessionId;
          db.prepare(`
            UPDATE sessions
            SET error_code = 'SPAWN_ERROR', error_message = ?, ended_at = ?
            WHERE id = ?
          `).run(err.message, now, sessionRowId);
        }
      });

      agentProcesses.delete(sessionId);
      broadcastProcessCount(ctx);

      if (typeof rc.onProcessError === 'function') {
        rc.onProcessError({ sessionId, entry, error: err, runGroupId: rc.runGroupId });
      }
    });

    // Handle stdin: write the prompt
    if (rc.prompt) {
      const inputMsg = JSON.stringify({
        type: 'user',
        message: {
          role: 'user',
          content: buildUserContent(rc.prompt, rc.images, entry.cwd, log),
        },
      }) + '\n';
      proc.stdin.write(inputMsg);
    }

    // Handle stdinMode
    if (rc.stdinModeOverride === 'close') {
      proc.stdin.end();
    }

    proc.stdin.on('error', (err) => {
      log('agent', 'warn', `retry stdin error (EPIPE/destroyed): ${err.message}`, { sessionId: shortId });
    });

  } catch (err) {
    log('agent', 'error', `retry respawn failed: ${err.message}`, { sessionId: shortId });

    // Terminal cleanup on respawn failure
    dbWrite((db) => {
      const now = new Date().toISOString();
      transitionSessionStatus(db, sessionId, 'error', {
        lastError: `Retry respawn failed: ${err.message}`,
        completedAt: now,
      });
    });
    broadcast('agent:error', { sessionId, error: `Retry respawn failed: ${err.message}` });
    clearRetryTimer(entry);
    agentProcesses.delete(sessionId);
    broadcastProcessCount(ctx);
  }
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
    taskSpec = null,
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
    _taskSpec: taskSpec || null,
    _retryState: createRetryState(),
    _retryContext: null, // populated below
  };

  agentProcesses.set(sessionId, entry);

  // Populate retry context with everything needed to respawn this process
  entry._retryContext = {
    binaryPath,
    spawnArgs: args,
    spawnEnv: env,
    spawnCwd,
    prompt,
    images,
    model,
    sessionId,
    provider,
    providerConfig,
    permissionMode,
    systemPrompt,
    sessionRowMode,
    existingSessionId,
    parentSessionId,
    runGroupId,
    worktreePath,
    worktreeBranch,
    baseBranch,
    repoRoot,
    mcpConfigPath,
    taskSpec,
    onProcessClose,
    onProcessError,
    onTurnResult,
    queueSessionsUpdated,
    queueCloseEvent,
    stdinModeOverride,
    stderrLogSlice,
    setRunningOnCapture,
    autoNameOnFirstTurn,
    workingDir,
    effectiveCwd,
  };

  log('agent', 'info', `process spawned pid=${proc.pid}`, { sessionId: shortId, provider });

  const stdinMode = stdinModeOverride || providerConfig?.headless?.stdin;
  if (stdinMode === 'pipe' && !stdinModeOverride && hasCapability(providerConfig, 'inputStreaming')) {
    const inputMsg = JSON.stringify({
      type: 'user',
      message: { role: 'user', content: buildUserContent(prompt, images, effectiveCwd, log) },
    }) + '\n';
    if (proc.stdin.writable) {
      proc.stdin.write(inputMsg);
      log('agent', 'debug', 'wrote first prompt to stdin (stream-json)', { sessionId: shortId });
    } else {
      log('agent', 'warn', 'stdin not writable, skipping initial prompt write', { sessionId: shortId });
    }
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
        broadcast('run-group:session-activity', createRunGroupSessionActivityEvent({
          groupId: runGroupId,
          sessionId,
          turnCount: entry._turnNumber,
          costTotal: costUsd,
          lastSnippet: null, // Snippet extracted by live endpoint
        }));
      }

      if (queueSessionsUpdated) {
        const queuedSessionId = entry.providerSessionId
          || (sessionRowMode === 'existingSession' ? (existingSessionId || sessionId) : null);
        queueSessionsUpdated({
          source: 'agent',
          event: queueEvent,
          sessionId: queuedSessionId,
          refreshProjects: false,
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

    // --- Transient retry check (BEFORE setting finalized=true) ---
    if (exitCode !== 0) {
      const errorText = [
        entry._lastErrorContext?.error,
        entry._lastErrorContext?.message,
        entry._stderrText,
      ].filter(Boolean).join(' ');

      const classification = classifyError(errorText, exitCode);
      log('agent', 'info', 'error classified', {
        sessionId: shortId,
        code: classification.code,
        category: classification.category,
        retryable: classification.retryable,
        source,
      });

      if (isRetryable(classification) && canRetry(entry._retryState)) {
        const delay = reserveRetryDelay(entry);

        log('agent', 'info', 'retry scheduled', {
          sessionId: shortId,
          retryCount: entry._retryState.count,
          maxRetries: entry._retryState.maxRetries,
          nextDelayMs: delay,
        });

        // Transition to retrying (NOT terminal)
        dbWrite((db) => {
          transitionSessionStatus(db, sessionId, 'retrying', {
            lastError: `${classification.code}: ${errorText.slice(0, 200)}`,
          });
        });

        // Broadcast enriched error event
        broadcast('agent:error', {
          sessionId,
          error: errorText.slice(0, 500),
          code: classification.code,
          category: classification.category,
          retryable: true,
          retryCount: entry._retryState.count,
          maxRetries: entry._retryState.maxRetries,
          nextRetryMs: delay,
        });

        // Schedule respawn
        entry._retryTimer = setTimeout(() => {
          entry._retryTimer = null;
          if (!agentProcesses.has(sessionId) || entry._terminationReason === 'stopped') return;
          respawnFromRetryContext(ctx, sessionId, entry);
        }, delay);

        // DO NOT set finalized=true, DO NOT delete agentProcesses entry
        return; // short-circuit, no terminal cleanup
      }
    }

    finalized = true;
    log('agent', 'info', `process exited code=${exitCode}`, { sessionId: shortId, provider, source });
    flushStdoutBuffer(ctx, sessionId, entry);

    const finalStatus = entry._terminationReason || (exitCode === 0 ? 'completed' : 'error');
    dbWrite((db) => {
      const now = new Date().toISOString();
      transitionSessionStatus(db, sessionId, finalStatus, {
        completedAt: now,
        lastError: finalStatus === 'error' ? `Process exited with code ${exitCode}` : undefined,
      });

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
    clearRetryTimer(entry);
    agentProcesses.delete(sessionId);
    broadcastProcessCount(ctx);
    maybeCleanupMcpConfig();

    if (typeof onProcessClose === 'function') {
      // Flush queued DB writes so status is committed before consumers read it
      // (e.g. run-group aggregate refresh reads session_runtime_state.status)
      flushDbWrites();
      Promise.resolve(onProcessClose({
        sessionId,
        entry,
        exitCode,
        finalStatus,
        providerSessionId: entry.providerSessionId || null,
        runGroupId,
      })).catch((err) => {
        log('agent', 'warn', `process close handler failed: ${err.message}`, { sessionId: shortId, provider });
      });
    }
  };

  proc.on('close', (exitCode) => finalizeClose(exitCode, 'close'));
  proc.on('exit', () => maybeCleanupMcpConfig());

  proc.stdin.on('error', (err) => {
    log('agent', 'warn', `stdin error (EPIPE/destroyed): ${err.message}`, { sessionId: shortId });
  });

  proc.on('error', (err) => {
    if (finalized) return;

    // --- Transient retry check ---
    const errorText = err.message + ' ' + (entry._stderrText || '');
    const classification = classifyError(errorText, null);
    log('agent', 'info', 'error classified', {
      sessionId: shortId,
      code: classification.code,
      category: classification.category,
      retryable: classification.retryable,
      source: 'spawn-error',
    });

    if (isRetryable(classification) && canRetry(entry._retryState)) {
      const delay = reserveRetryDelay(entry);

      log('agent', 'info', 'retry scheduled', {
        sessionId: shortId,
        retryCount: entry._retryState.count,
        maxRetries: entry._retryState.maxRetries,
        nextDelayMs: delay,
      });

      dbWrite((db) => {
        transitionSessionStatus(db, sessionId, 'retrying', {
          lastError: `${classification.code}: ${err.message.slice(0, 200)}`,
        });
      });

      broadcast('agent:error', {
        sessionId,
        error: err.message,
        code: classification.code,
        category: classification.category,
        retryable: true,
        retryCount: entry._retryState.count,
        maxRetries: entry._retryState.maxRetries,
        nextRetryMs: delay,
      });

      entry._retryTimer = setTimeout(() => {
        entry._retryTimer = null;
        if (!agentProcesses.has(sessionId) || entry._terminationReason === 'stopped') return;
        respawnFromRetryContext(ctx, sessionId, entry);
      }, delay);

      return; // short-circuit
    }

    finalized = true;
    log('agent', 'error', `spawn error: ${err.message}`, { sessionId: shortId, provider });
    broadcast('agent:error', { sessionId, error: err.message });
    dbWrite((db) => {
      const now = new Date().toISOString();
      transitionSessionStatus(db, sessionId, 'error', {
        lastError: err.message,
        completedAt: now,
      });

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
    clearRetryTimer(entry);
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
