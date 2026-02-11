/**
 * Shared stdout/stderr event parsing for Claude agent processes.
 * Consolidates the duplicated ~200-line parsing logic from /agent/start and /agent/spawn-child.
 */

import { dbWrite } from './db.js';

/**
 * Attach a stdout handler to a Claude agent process.
 *
 * Common logic: buffer management, JSON line splitting, session_id capture,
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
  let totalBytes = 0;

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
        const event = JSON.parse(line);

        // Session ID capture
        if (event.session_id && entry.providerSessionId !== event.session_id) {
          entry.providerSessionId = event.session_id;
          ctx.resumeSessionIndex.set(event.session_id, sessionId);
          dbWrite((db) => {
            const now = new Date().toISOString();
            if (setRunningOnCapture) {
              db.prepare(`
                UPDATE session_runtime_state
                SET status = 'running', provider_session_id = ?, updated_at = ?
                WHERE session_id = ?
              `).run(event.session_id, now, sessionId);
            } else {
              db.prepare(`
                UPDATE session_runtime_state
                SET provider_session_id = ?, updated_at = ?
                WHERE session_id = ?
              `).run(event.session_id, now, sessionId);
            }
          });
        }

        // Token accumulation
        if (event.type === 'assistant' && event.message?.usage) {
          const u = event.message.usage;
          entry._turnInputTokens += u.input_tokens || 0;
          entry._turnOutputTokens += u.output_tokens || 0;
          entry._turnCacheReadTokens += u.cache_read_input_tokens || 0;
          entry._turnCacheCreationTokens += u.cache_creation_input_tokens || 0;
          if (event.message.model) entry._turnModel = event.message.model;
        }

        // Tool tracking
        if (event.type === 'assistant' && Array.isArray(event.message?.content)) {
          for (const block of event.message.content) {
            if (block.type === 'tool_use' && block.name) {
              entry._turnToolsUsed.push(block.name);
            }
          }
        }

        ctx.log('agent', 'debug', `stdout event: ${event.type}`, { sessionId: sessionId.slice(0, 8) });
        ctx.broadcast('agent:event', { sessionId, event });

        if (event.type === 'result' && onResult) {
          onResult(event);
        }
      } catch {
        ctx.log('agent', 'debug', `stdout non-json: ${line.slice(0, 120)}`, { sessionId: sessionId.slice(0, 8) });
        ctx.broadcast('agent:event', {
          sessionId,
          event: { type: 'system', message: line },
        });
      }
    }
  });
}

/**
 * Attach a stderr handler to a Claude agent process.
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

  entry.proc.stderr.on('data', (chunk) => {
    totalBytes += chunk.length;
    entry.lastActivityAt = Date.now();
    if (onFirstData) onFirstData(chunk, totalBytes);

    const text = chunk.toString().trim();
    if (text) {
      ctx.log('agent', 'warn', `stderr: ${text.slice(0, logSlice)}`, { sessionId: sessionId.slice(0, 8) });
      if (entry.turnActive) {
        ctx.broadcast('agent:error', { sessionId, error: text });
      }
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
    const event = JSON.parse(entry.stdoutBuffer);
    if (event.session_id && entry.providerSessionId !== event.session_id) {
      entry.providerSessionId = event.session_id;
      ctx.resumeSessionIndex.set(event.session_id, sessionId);
      dbWrite((db) => {
        db.prepare(`
          UPDATE session_runtime_state
          SET provider_session_id = ?, updated_at = ?
          WHERE session_id = ?
        `).run(event.session_id, new Date().toISOString(), sessionId);
      });
    }
    ctx.broadcast('agent:event', { sessionId, event });
  } catch {
    // ignore
  }
}
