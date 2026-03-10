/**
 * Shared stdout/stderr event parsing for agent processes.
 * Provider-agnostic: uses normalizers to map events to canonical format.
 */

import { dbWrite, transitionSessionStatus } from './db.js';
import { normalizeEvent, createNormalizer } from './normalizers/index.js';

function _safeStringify(value) {
  try {
    return JSON.stringify(value);
  } catch {
    return '{}';
  }
}

function _toNumber(value, fallback = 0) {
  return (typeof value === 'number' && Number.isFinite(value)) ? value : fallback;
}

function _normalizeCompaction(compaction) {
  if (!compaction || typeof compaction !== 'object') return null;
  const normalized = {
    trigger: typeof compaction.trigger === 'string' ? compaction.trigger : 'unknown',
    preTokens: _toNumber(compaction.preTokens ?? compaction.pre_tokens),
    tokensSaved: _toNumber(compaction.tokensSaved ?? compaction.tokens_saved),
  };
  const compactedToolIds = compaction.compactedToolIds ?? compaction.compacted_tool_ids;
  if (Array.isArray(compactedToolIds)) {
    normalized.compactedToolIds = compactedToolIds.filter((id) => typeof id === 'string');
  }
  return normalized;
}

function _isRuntimeMilestone(event) {
  if (!event || typeof event !== 'object') return false;
  if (event.type === 'result' || event.type === 'error') return true;
  if (event.type === 'system' && event.compaction && typeof event.compaction === 'object') return true;
  return false;
}

function _persistRuntimeMilestone(sessionId, entry, event, rawEvent) {
  if (!_isRuntimeMilestone(event)) return;

  dbWrite((db) => {
    const now = new Date().toISOString();
    if (!Number.isFinite(entry._runtimeSeq)) {
      const row = db.prepare('SELECT last_seq FROM session_runtime_state WHERE session_id = ?').get(sessionId);
      entry._runtimeSeq = Number(row?.last_seq || 0);
    }
    const seq = entry._runtimeSeq + 1;
    entry._runtimeSeq = seq;

    const payload = {
      ...event,
      provider: entry.provider || null,
      providerSessionId: entry.providerSessionId || event.providerSessionId || null,
      rawEventType: rawEvent?.type || null,
    };
    db.prepare(`
      INSERT OR REPLACE INTO session_runtime_events (session_id, seq, type, payload_json, ts)
      VALUES (?, ?, ?, ?, ?)
    `).run(sessionId, seq, event.type, _safeStringify(payload), now);

    const compaction = _normalizeCompaction(event.compaction);
    if (compaction) {
      db.prepare(`
        UPDATE session_runtime_state
        SET updated_at = ?, last_seq = ?,
            compaction_count = compaction_count + 1,
            tokens_saved_total = tokens_saved_total + ?,
            last_compaction_at = ?,
            last_compaction_json = ?
        WHERE session_id = ?
      `).run(
        now,
        seq,
        compaction.tokensSaved,
        now,
        _safeStringify(compaction),
        sessionId,
      );
      return;
    }

    db.prepare(`
      UPDATE session_runtime_state
      SET updated_at = ?, last_seq = ?
      WHERE session_id = ?
    `).run(now, seq, sessionId);
  });
}

/**
 * Attach a stdout handler to an agent process.
 *
 * Common logic: buffer management, JSON line splitting, provider session capture,
 * token accumulation, tool tracking, and broadcasting.
 *
 * @param {object} ctx       - Route context (broadcast, log, resumeSessionIndex)
 * @param {string} sessionId - RUDI session ID
 * @param {object} entry     - agentProcesses entry
 * @param {object} options
 * @param {function} options.onResult            - Called with (event) when a 'result' event arrives
 * @param {function} [options.onFirstData]       - Called with (chunk, totalBytes) on each chunk (for startup tracking)
 * @param {boolean}  [options.setRunningOnCapture=true] - Whether to set status='running' when provider session ID is captured
 */
export function attachStdoutHandler(ctx, sessionId, entry, options = {}) {
  const { onResult, onFirstData, setRunningOnCapture = true } = options;
  const provider = entry.provider || 'claude';
  let totalBytes = 0;

  // Initialize per-session stateful normalizer (null for Claude = stateless)
  if (!entry._normalizer) {
    entry._normalizer = createNormalizer(provider);
  }

  entry.proc.stdout.on('data', (chunk) => {
    totalBytes += chunk.length;
    entry.lastActivityAt = Date.now();
    if (onFirstData) onFirstData(chunk, totalBytes);

    entry.stdoutBuffer += chunk.toString();
    const lines = entry.stdoutBuffer.split('\n');
    entry.stdoutBuffer = lines.pop() || '';

    for (const line of lines) {
      if (!line.trim()) continue;
      try {
        const rawEvent = JSON.parse(line);

        // Session ID capture from raw event (before normalization buffers it)
        const rawSid = rawEvent.session_id || rawEvent.thread_id;
        if (rawSid && entry.providerSessionId !== rawSid) {
          entry.providerSessionId = rawSid;
          ctx.resumeSessionIndex.set(rawSid, sessionId);
          dbWrite((db) => {
            const now = new Date().toISOString();
            if (setRunningOnCapture) {
              transitionSessionStatus(db, sessionId, 'running');
            }
            db.prepare(`
              UPDATE session_runtime_state
              SET provider_session_id = ?, updated_at = ?
              WHERE session_id = ?
            `).run(rawSid, now, sessionId);
          });
        }

        // Normalize event — returns array (0+ results for stateful, 1 for stateless)
        const results = normalizeEvent(provider, rawEvent, entry._normalizer);

        for (const { normalized, raw } of results) {
          if (!normalized) continue;
          const event = normalized;

          // Token accumulation (normalized events have usage at top level)
          if (event.type === 'assistant' && event.usage) {
            const u = event.usage;
            entry._turnInputTokens += u.inputTokens || 0;
            entry._turnOutputTokens += u.outputTokens || 0;
            entry._turnCacheReadTokens += u.cacheReadTokens || 0;
            entry._turnCacheCreationTokens += u.cacheCreationTokens || 0;
            if (event.model) entry._turnModel = event.model;
          }

          // Also capture usage from result events (Codex puts usage on turn.completed)
          if (event.type === 'result' && event.usage) {
            const u = event.usage;
            entry._turnInputTokens += u.inputTokens || 0;
            entry._turnOutputTokens += u.outputTokens || 0;
            entry._turnCacheReadTokens += u.cacheReadTokens || 0;
            entry._turnCacheCreationTokens += u.cacheCreationTokens || 0;
            if (event.model) entry._turnModel = event.model;
          }

          // Tool tracking (normalized events have tool_use blocks)
          if (event.type === 'assistant' && Array.isArray(event.content)) {
            for (const block of event.content) {
              if (block.type === 'tool_use' && block.name) {
                entry._turnToolsUsed.push(block.name);
              }
            }
          }

          // Capture error context for retry classification
          if (event.type === 'assistant' && event.error) {
            entry._lastErrorContext = {
              error: event.error,
              message: Array.isArray(event.content)
                ? event.content.filter(b => b.type === 'text').map(b => b.text).join(' ')
                : '',
              isError: false,
            };
          }
          if (event.type === 'result' && event.isError) {
            entry._lastErrorContext = {
              ...(entry._lastErrorContext || {}),
              isError: true,
            };
          }

          ctx.log('agent', 'debug', `stdout event: ${event.type}`, { sessionId: sessionId.slice(0, 8), provider });

          // Broadcast A+ hybrid: normalized (for UI) + raw (for fidelity)
          ctx.broadcast('agent:event', {
            sessionId,
            provider,
            event,           // normalized (RudiEvent, Lite consumes this)
            rawEvent: raw,   // provider-native (for debugging + future upgrades)
          });

          _persistRuntimeMilestone(sessionId, entry, event, raw);

          if (event.type === 'result' && onResult) {
            onResult(event);
          }
        }
      } catch {
        ctx.log('agent', 'debug', `stdout non-json: ${line.slice(0, 120)}`, { sessionId: sessionId.slice(0, 8) });
        ctx.broadcast('agent:event', {
          sessionId,
          provider,
          event: { type: 'system', message: line },
        });
      }
    }
  });
}

/**
 * Attach a stderr handler to an agent process.
 *
 * @param {object} ctx       - Route context (log, broadcast)
 * @param {string} sessionId - RUDI session ID
 * @param {object} entry     - agentProcesses entry
 * @param {object} [options]
 * @param {function} [options.onFirstData] - Called with (chunk, totalBytes) on each chunk
 * @param {number}   [options.logSlice=200] - Max chars to log from stderr
 */
export function attachStderrHandler(ctx, sessionId, entry, options = {}) {
  const { onFirstData, logSlice = 200 } = options;
  let totalBytes = 0;

  // Initialize stderr accumulator
  entry._stderrText = '';

  entry.proc.stderr.on('data', (chunk) => {
    totalBytes += chunk.length;
    entry.lastActivityAt = Date.now();
    if (onFirstData) onFirstData(chunk, totalBytes);

    const text = chunk.toString().trim();
    if (text) {
      // Accumulate stderr text for error classification
      entry._stderrText = (entry._stderrText || '') + text + '\n';

      // Keep stderr bounded (last 4096 chars)
      if (entry._stderrText.length > 4096) {
        entry._stderrText = entry._stderrText.slice(-4096);
      }

      // Log stderr server-side for debugging but don't broadcast to frontend.
      // Most CLI stderr is informational noise (e.g. Codex "state db missing
      // rollout path"). Real failures are signaled by process exit code — the
      // close handler emits the appropriate error/done events.
      ctx.log('agent', 'warn', `stderr: ${text.slice(0, logSlice)}`, { sessionId: sessionId.slice(0, 8) });
    }
  });
}

/**
 * Flush any remaining stdout buffer content on process close.
 * Handles the edge case where the last line doesn't end with \n.
 */
export function flushStdoutBuffer(ctx, sessionId, entry) {
  if (!entry.stdoutBuffer.trim()) return;
  try {
    const rawEvent = JSON.parse(entry.stdoutBuffer);
    const rawSid = rawEvent.providerSessionId || rawEvent.session_id || rawEvent.thread_id;
    if (rawSid && entry.providerSessionId !== rawSid) {
      entry.providerSessionId = rawSid;
      ctx.resumeSessionIndex.set(rawSid, sessionId);
      dbWrite((db) => {
        db.prepare(`
          UPDATE session_runtime_state
          SET provider_session_id = ?, updated_at = ?
          WHERE session_id = ?
        `).run(rawSid, new Date().toISOString(), sessionId);
      });
    }

    const provider = entry.provider || 'claude';
    const results = [...normalizeEvent(provider, rawEvent, entry._normalizer)];
    if (entry._normalizer && typeof entry._normalizer.flush === 'function') {
      results.push(...entry._normalizer.flush());
    }
    for (const { normalized, raw } of results) {
      if (!normalized) continue;
      _persistRuntimeMilestone(sessionId, entry, normalized, raw);
      ctx.broadcast('agent:event', {
        sessionId,
        provider,
        event: normalized,
        rawEvent: raw,
      });
    }
  } catch {
    // ignore
  }
}
