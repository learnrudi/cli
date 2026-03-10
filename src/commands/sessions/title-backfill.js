/**
 * Session enrichment: title + description + tags via LLM.
 *
 * Spawns Haiku to generate structured metadata for sessions.
 * Concurrency-limited with delay between calls to avoid rate limits.
 *
 * Invariants:
 *   - enriched_at IS NULL guard prevents double-enrichment (idempotent re-runs)
 *   - Each worker failure is isolated — does not block other workers
 *   - LLM output is untrusted external input — validated before DB write
 *   - Tags are normalized (lowercase, trimmed, max 5, max 30 chars each)
 *
 * Factory pattern matching ingester.js:
 *   createTitleBackfillModule({ log, resolveDb, broadcast }) → { backfillTitles, getStats }
 */

import path from 'path';
import { spawn } from 'child_process';
import { resolveClaudeBinary } from '../agent/auth.js';

const DEFAULT_MAX_LLM_CONCURRENCY = 5;
const DEFAULT_LLM_TIMEOUT_MS = 45_000;
const DEFAULT_LLM_DELAY_MS = 500;
const DEFAULT_MAX_ATTEMPTS = 2;
const DEFAULT_RETRY_BASE_DELAY_MS = 1_500;
const MAX_ATTEMPT_TIMEOUT_MS = 90_000;
const RETRYABLE_FAILURE_TYPES = new Set(['timeout', 'nonzero_exit', 'empty_output', 'parse_error', 'spawn_error']);

function clampInteger(value, fallback, { min = 0, max = Number.MAX_SAFE_INTEGER } = {}) {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(Math.max(parsed, min), max);
}

export function resolveEnrichmentRuntimeConfig(overrides = {}) {
  return {
    maxConcurrency: clampInteger(
      overrides.maxConcurrency ?? process.env.RUDI_ENRICHMENT_MAX_CONCURRENCY ?? process.env.RUDI_TITLE_BACKFILL_MAX_CONCURRENCY,
      DEFAULT_MAX_LLM_CONCURRENCY,
      { min: 1, max: 20 },
    ),
    timeoutMs: clampInteger(
      overrides.timeoutMs ?? process.env.RUDI_ENRICHMENT_TIMEOUT_MS ?? process.env.RUDI_TITLE_BACKFILL_TIMEOUT_MS,
      DEFAULT_LLM_TIMEOUT_MS,
      { min: 5_000, max: MAX_ATTEMPT_TIMEOUT_MS },
    ),
    delayMs: clampInteger(
      overrides.delayMs ?? process.env.RUDI_ENRICHMENT_DELAY_MS ?? process.env.RUDI_TITLE_BACKFILL_DELAY_MS,
      DEFAULT_LLM_DELAY_MS,
      { min: 0, max: 60_000 },
    ),
    maxAttempts: clampInteger(
      overrides.maxAttempts ?? process.env.RUDI_ENRICHMENT_MAX_ATTEMPTS ?? process.env.RUDI_TITLE_BACKFILL_MAX_ATTEMPTS,
      DEFAULT_MAX_ATTEMPTS,
      { min: 1, max: 5 },
    ),
    retryBaseDelayMs: clampInteger(
      overrides.retryBaseDelayMs ?? process.env.RUDI_ENRICHMENT_RETRY_BASE_DELAY_MS ?? process.env.RUDI_TITLE_BACKFILL_RETRY_BASE_DELAY_MS,
      DEFAULT_RETRY_BASE_DELAY_MS,
      { min: 0, max: 60_000 },
    ),
  };
}

export function getAttemptTimeoutMs(baseTimeoutMs, attempt) {
  return Math.min(baseTimeoutMs + ((Math.max(1, attempt) - 1) * 15_000), MAX_ATTEMPT_TIMEOUT_MS);
}

export function getRetryDelayMs(attempt, retryBaseDelayMs) {
  return retryBaseDelayMs * Math.max(1, 2 ** (Math.max(1, attempt) - 1));
}

export function shouldRetryEnrichmentFailure(failureType, attempt, maxAttempts) {
  return attempt < maxAttempts && RETRYABLE_FAILURE_TYPES.has(failureType);
}

function createFailureCounts() {
  return {
    timeout: 0,
    nonzero_exit: 0,
    empty_output: 0,
    parse_error: 0,
    spawn_error: 0,
    missing_binary: 0,
    write_error: 0,
    unknown: 0,
  };
}

function incrementFailureCount(failureCounts, failureType) {
  const key = Object.prototype.hasOwnProperty.call(failureCounts, failureType) ? failureType : 'unknown';
  failureCounts[key] += 1;
}

// ---------------------------------------------------------------------------
// DB queries
// ---------------------------------------------------------------------------

/**
 * Find sessions that need enrichment.
 * A session needs enrichment if enriched_at IS NULL and it has content to analyze.
 * Falls back to finding untitled sessions if enriched_at column doesn't exist yet
 * (backward compatibility during migration rollout).
 */
function _findUnenrichedSessions(db, { minTurns = 1 } = {}) {
  return db.prepare(`
    SELECT s.id, s.snippet, s.cwd, s.project_path, s.model, s.turn_count,
           s.session_type, s.parent_session_id
    FROM sessions s
    WHERE s.status != 'deleted'
      AND s.enriched_at IS NULL
      AND COALESCE(s.turn_count, 0) >= ?
      AND (
        s.snippet IS NOT NULL AND TRIM(s.snippet) != ''
        OR EXISTS (SELECT 1 FROM turns t WHERE t.session_id = s.id LIMIT 1)
      )
    ORDER BY s.last_active_at DESC
  `).all(minTurns);
}

function _getFirstMessage(db, sessionId, snippet) {
  const turn = db.prepare(`
    SELECT user_message FROM turns
    WHERE session_id = ? AND turn_number = 1 AND user_message IS NOT NULL AND TRIM(user_message) != ''
    LIMIT 1
  `).get(sessionId);
  if (turn?.user_message) return turn.user_message;
  return snippet || null;
}

/**
 * Get first 3 turns for richer context in the LLM prompt.
 * Truncates each message to limit token usage.
 */
function _getSampleTurns(db, sessionId) {
  const turns = db.prepare(`
    SELECT turn_number, user_message, assistant_response
    FROM turns WHERE session_id = ? ORDER BY turn_number LIMIT 3
  `).all(sessionId);

  return turns.map(t => {
    const user = (t.user_message || '').slice(0, 300);
    const asst = (t.assistant_response || '').slice(0, 300);
    return `Turn ${t.turn_number}:\n  User: ${user}\n  Assistant: ${asst}`;
  }).join('\n');
}

/**
 * Write enrichment results to DB.
 * Uses enriched_at IS NULL as an idempotency guard — safe for concurrent re-runs.
 */
export function writeEnrichment(db, sessionId, { title, description, tags }) {
  const now = new Date().toISOString();
  const normalizedTags = Array.isArray(tags) ? tags : [];

  const tx = db.transaction(() => {
    const update = db.prepare(`
      UPDATE sessions
      SET title = COALESCE(title_override, title, ?),
          description = ?,
          title_source = COALESCE(title_source, 'llm'),
          title_generated_at = COALESCE(title_generated_at, ?),
          enriched_at = ?
      WHERE id = ? AND enriched_at IS NULL
    `).run(title, description, now, now, sessionId);

    if (update.changes === 0) return false;
    if (normalizedTags.length === 0) return true;

    const insertTag = db.prepare('INSERT OR IGNORE INTO tags (name) VALUES (?)');
    const getTag = db.prepare('SELECT id FROM tags WHERE name = ?');
    const linkTag = db.prepare('INSERT OR IGNORE INTO session_tags (session_id, tag_id) VALUES (?, ?)');

    for (const tag of normalizedTags) {
      insertTag.run(tag);
      const tagRow = getTag.get(tag);
      if (!tagRow?.id) {
        throw new Error(`tag lookup failed for ${tag}`);
      }
      linkTag.run(sessionId, tagRow.id);
    }

    return true;
  });

  return tx();
}

// ---------------------------------------------------------------------------
// LLM enrichment (structured JSON response)
// ---------------------------------------------------------------------------

/**
 * Parse and validate LLM JSON response.
 * LLM output is untrusted (§4 Boundary Discipline) — validate shape, types, and lengths.
 * Returns null if parsing fails (caller handles the error).
 */
export function parseEnrichmentResponse(responseText, log) {
  // Try to extract JSON from the response (LLM may wrap in markdown code blocks)
  let jsonStr = responseText.trim();

  // Strip markdown code fences if present
  const fenceMatch = jsonStr.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fenceMatch) {
    jsonStr = fenceMatch[1].trim();
  }

  let parsed;
  try {
    parsed = JSON.parse(jsonStr);
  } catch {
    log?.('sessions', 'debug', `[enrichment] JSON parse failed: ${jsonStr.slice(0, 200)}`);
    return null;
  }

  // Validate shape — all fields optional but must be correct types if present
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    log?.('sessions', 'debug', '[enrichment] response is not an object');
    return null;
  }

  const title = typeof parsed.title === 'string'
    ? parsed.title.trim().replace(/['"]+$/g, '').replace(/^['"]+/g, '').slice(0, 100)
    : null;

  const description = typeof parsed.description === 'string'
    ? parsed.description.trim().slice(0, 500)
    : null;

  const tags = Array.isArray(parsed.tags)
    ? parsed.tags
        .filter(t => typeof t === 'string' && t.trim().length > 0)
        .slice(0, 5)
        .map(t => t.trim().toLowerCase().replace(/[^a-z0-9-_/ ]/g, '').slice(0, 30))
        .filter(t => t.length > 0)
    : [];

  if (!title && !description) {
    log?.('sessions', 'debug', '[enrichment] no title or description in response');
    return null;
  }

  return { title, description, tags };
}

export function buildEnrichmentPrompt(
  firstMessage,
  sampleTurns,
  { cwd, model, sessionType, parentSessionId },
  { compact = false } = {},
) {
  const projectName = path.basename(cwd || '');
  const isSubagent = sessionType === 'task' || !!parentSessionId;
  const contextHint = isSubagent
    ? 'This is a subagent/task spawned by a parent session. Describe what subtask it performed.'
    : '';
  const normalizedFirstMessage = compact
    ? (firstMessage || '').slice(0, 400)
    : (firstMessage || '').slice(0, 800);
  const normalizedSampleTurns = compact ? '' : sampleTurns;

  return [
    'Analyze this coding session. Return ONLY valid JSON with no markdown fences:',
    '{"title": "3-7 word title", "description": "1-2 sentence summary of what was done", "tags": ["tag1", "tag2", "tag3"]}',
    '',
    'Rules:',
    '- title: 3-7 words, imperative or descriptive, no quotes',
    '- description: 1-2 sentences, past tense, what was accomplished',
    '- tags: 1-5 lowercase tags categorizing the work (e.g. "bug-fix", "refactor", "ui", "api", "testing")',
    compact ? '- keep the response concise and infer from the request if needed' : '',
    '',
    contextHint,
    `Project: ${projectName}`,
    `Working directory: ${cwd || 'unknown'}`,
    `Model: ${model || 'unknown'}`,
    `User request: ${normalizedFirstMessage}`,
    normalizedSampleTurns ? `\nSample turns:\n${normalizedSampleTurns}` : '',
  ].filter(Boolean).join('\n');
}

async function _runClaudeEnrichment(prompt, { timeoutMs }, log) {
  const binaryPath = resolveClaudeBinary();
  if (!binaryPath) {
    log?.('sessions', 'warn', '[enrichment] no claude binary');
    return { enrichment: null, failureType: 'missing_binary' };
  }

  return new Promise((resolve) => {
    const child = spawn(binaryPath, [
      '-p', prompt,
      '--model', 'haiku',
      '--no-session-persistence',
      '--max-turns', '1',
      '--output-format', 'json',
    ], { stdio: ['ignore', 'pipe', 'pipe'] });

    let stdout = '';
    let stderr = '';
    let timedOut = false;
    let hardKillTimer = null;

    child.stdout.on('data', (chunk) => { stdout += chunk; });
    child.stderr.on('data', (chunk) => { stderr += chunk; });

    const timer = setTimeout(() => {
      timedOut = true;
      log?.('sessions', 'warn', `[enrichment] LLM timeout after ${timeoutMs}ms`);
      try { child.kill('SIGTERM'); } catch {}
      hardKillTimer = setTimeout(() => {
        try { child.kill('SIGKILL'); } catch {}
      }, 1_000);
      hardKillTimer.unref?.();
    }, timeoutMs);

    child.on('close', (code, signal) => {
      clearTimeout(timer);
      if (hardKillTimer) clearTimeout(hardKillTimer);

      if (timedOut) {
        log?.('sessions', 'debug', `[enrichment] haiku timeout exit=${code} signal=${signal || 'none'} stderr=${stderr.slice(0, 200)}`);
        resolve({ enrichment: null, failureType: 'timeout', exitCode: code, signal, stderr });
        return;
      }

      if (code !== 0) {
        log?.('sessions', 'debug', `[enrichment] haiku exit=${code} signal=${signal || 'none'} stderr=${stderr.slice(0, 200)}`);
        resolve({ enrichment: null, failureType: 'nonzero_exit', exitCode: code, signal, stderr });
        return;
      }

      if (!stdout.trim()) {
        log?.('sessions', 'debug', `[enrichment] empty stdout stderr=${stderr.slice(0, 200)}`);
        resolve({ enrichment: null, failureType: 'empty_output', exitCode: code, signal, stderr });
        return;
      }

      try {
        const cliOutput = JSON.parse(stdout);
        const resultText = (cliOutput.result || '').trim();
        const enrichment = parseEnrichmentResponse(resultText, log);
        if (enrichment) {
          resolve({ enrichment, failureType: null, exitCode: code, signal: signal || null });
          return;
        }
      } catch {
        // Fall through to direct parse
      }

      const enrichment = parseEnrichmentResponse(stdout, log);
      if (enrichment) {
        resolve({ enrichment, failureType: null, exitCode: code, signal: signal || null });
        return;
      }

      resolve({
        enrichment: null,
        failureType: 'parse_error',
        exitCode: code,
        signal: signal || null,
        stderr,
      });
    });

    child.on('error', (err) => {
      clearTimeout(timer);
      if (hardKillTimer) clearTimeout(hardKillTimer);
      log?.('sessions', 'warn', `[enrichment] spawn error: ${err.message}`);
      resolve({ enrichment: null, failureType: 'spawn_error', errorMessage: err.message });
    });
  });
}

async function _generateEnrichment(firstMessage, sampleTurns, context, runtimeConfig, log) {
  let lastFailureType = 'unknown';
  let attempts = 0;

  for (let attempt = 1; attempt <= runtimeConfig.maxAttempts; attempt++) {
    attempts = attempt;
    const compact = attempt > 1;
    const prompt = buildEnrichmentPrompt(firstMessage, sampleTurns, context, { compact });
    const timeoutMs = getAttemptTimeoutMs(runtimeConfig.timeoutMs, attempt);
    const result = await _runClaudeEnrichment(prompt, { timeoutMs }, log);

    if (result.enrichment) {
      return {
        enrichment: result.enrichment,
        failureType: null,
        attempts,
        retries: attempts - 1,
      };
    }

    lastFailureType = result.failureType || 'unknown';
    if (!shouldRetryEnrichmentFailure(lastFailureType, attempt, runtimeConfig.maxAttempts)) {
      break;
    }

    const delayMs = getRetryDelayMs(attempt, runtimeConfig.retryBaseDelayMs);
    log?.('sessions', 'warn',
      `[enrichment] retrying after ${lastFailureType} (attempt ${attempt}/${runtimeConfig.maxAttempts}, delay=${delayMs}ms)`
    );
    await _sleep(delayMs);
  }

  return {
    enrichment: null,
    failureType: lastFailureType,
    attempts,
    retries: Math.max(0, attempts - 1),
  };
}

function _sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

export function createTitleBackfillModule({ log, resolveDb, broadcast }) {
  const state = {
    backfillInFlight: null,
    lastRunAt: null,
    lastResult: null,
    enriched: 0,
    errors: 0,
    total: 0,
    retries: 0,
    succeededAfterRetry: 0,
    processed: 0,
    failureCounts: createFailureCounts(),
    lastConfig: resolveEnrichmentRuntimeConfig(),
  };

  async function backfillTitles({ llm = true, minTurns = 1, ...runtimeOverrides } = {}) {
    if (state.backfillInFlight) return state.backfillInFlight;

    const p = _run({ llm, minTurns, runtimeOverrides });
    state.backfillInFlight = p;
    return p.finally(() => { state.backfillInFlight = null; });
  }

  async function _run({ llm, minTurns, runtimeOverrides }) {
    const db = resolveDb ? resolveDb() : null;
    if (!db) return { skipped: true, reason: 'db_unavailable' };
    const runtimeConfig = resolveEnrichmentRuntimeConfig(runtimeOverrides);
    state.lastConfig = runtimeConfig;

    const t0 = Date.now();
    const unenriched = _findUnenrichedSessions(db, { minTurns });
    if (unenriched.length === 0) {
      const result = {
        total: 0,
        enriched: 0,
        errors: 0,
        skipped: 0,
        retries: 0,
        succeededAfterRetry: 0,
        failureCounts: createFailureCounts(),
        durationMs: 0,
        config: runtimeConfig,
      };
      state.lastRunAt = new Date().toISOString();
      state.lastResult = result;
      log?.('sessions', 'info', `[enrichment] no unenriched sessions (minTurns=${minTurns})`);
      return result;
    }

    state.total = unenriched.length;
    state.enriched = 0;
    state.errors = 0;
    state.retries = 0;
    state.succeededAfterRetry = 0;
    state.processed = 0;
    state.failureCounts = createFailureCounts();

    log?.('sessions', 'info',
      `[enrichment] starting: ${unenriched.length} sessions (minTurns=${minTurns}, workers=${runtimeConfig.maxConcurrency}, timeout=${runtimeConfig.timeoutMs}ms, attempts=${runtimeConfig.maxAttempts})`
    );

    // Gather first messages and sample turns
    const sessions = [];
    let noMessage = 0;
    for (const sess of unenriched) {
      const firstMessage = _getFirstMessage(db, sess.id, sess.snippet);
      if (firstMessage) {
        const sampleTurns = _getSampleTurns(db, sess.id);
        sessions.push({ ...sess, _firstMessage: firstMessage, _sampleTurns: sampleTurns });
      } else {
        noMessage++;
      }
    }
    state.total = sessions.length;

    if (!llm || sessions.length === 0) {
      const result = {
        total: unenriched.length,
        enriched: 0,
        errors: 0,
        skipped: noMessage,
        retries: 0,
        succeededAfterRetry: 0,
        failureCounts: createFailureCounts(),
        durationMs: Date.now() - t0,
        config: runtimeConfig,
      };
      state.lastRunAt = new Date().toISOString();
      state.lastResult = result;
      log?.('sessions', 'info', `[enrichment] llm disabled or no messages, skipped ${noMessage}`);
      return result;
    }

    log?.('sessions', 'info', `[enrichment] generating enrichments for ${sessions.length} sessions (${noMessage} skipped, no message)`);

    // Concurrency-limited LLM calls with delay
    // Worker cursor is the only shared mutable state — single-threaded JS makes this safe.
    let cursor = 0;
    const next = () => cursor < sessions.length ? sessions[cursor++] : null;

    const worker = async (workerId) => {
      let sess;
      while ((sess = next()) !== null) {
        try {
          const cwd = sess.cwd || sess.project_path || '';
          const result = await _generateEnrichment(
            sess._firstMessage,
            sess._sampleTurns,
            { cwd, model: sess.model, sessionType: sess.session_type, parentSessionId: sess.parent_session_id },
            runtimeConfig,
            log,
          );
          state.retries += result.retries;

          if (result.enrichment) {
            const wrote = writeEnrichment(db, sess.id, result.enrichment);
            if (wrote) {
              state.enriched++;
              if (result.retries > 0) state.succeededAfterRetry++;
              broadcast?.('session:enriched', {
                sessionId: sess.id,
                title: result.enrichment.title,
                description: result.enrichment.description,
                tags: result.enrichment.tags,
                refreshProjects: false,
              });
            }
          } else {
            state.errors++;
            incrementFailureCount(state.failureCounts, result.failureType);
            log?.('sessions', 'warn',
              `[enrichment] worker ${workerId} failed on ${sess.id} after ${result.attempts} attempt(s): ${result.failureType || 'unknown'}`
            );
          }
        } catch (err) {
          state.errors++;
          incrementFailureCount(state.failureCounts, 'write_error');
          log?.('sessions', 'warn', `[enrichment] worker ${workerId} error on ${sess.id}: ${err.message}`);
        } finally {
          state.processed++;
          if (state.processed % 25 === 0 || state.processed === sessions.length) {
            log?.('sessions', 'info',
              `[enrichment] progress: ${state.processed}/${sessions.length} processed, ${state.enriched} enriched, ${state.errors} errors, ${state.retries} retries`
            );
          }
        }
        // Throttle to avoid rate limits (backpressure)
        await _sleep(runtimeConfig.delayMs);
      }
    };

    const workerCount = Math.min(runtimeConfig.maxConcurrency, sessions.length);
    const workers = [];
    for (let i = 0; i < workerCount; i++) {
      workers.push(worker(i));
    }
    await Promise.all(workers);

    const result = {
      total: unenriched.length,
      enriched: state.enriched,
      errors: state.errors,
      skipped: noMessage,
      retries: state.retries,
      succeededAfterRetry: state.succeededAfterRetry,
      failureCounts: { ...state.failureCounts },
      durationMs: Date.now() - t0,
      config: runtimeConfig,
    };

    state.lastRunAt = new Date().toISOString();
    state.lastResult = result;

    log?.('sessions', 'info',
      `[enrichment] done: ${state.enriched} enriched, ${state.errors} errors, ${noMessage} skipped, ${state.retries} retries (${result.durationMs}ms)`
    );

    return result;
  }

  function getStats() {
    return {
      running: !!state.backfillInFlight,
      lastRunAt: state.lastRunAt,
      lastResult: state.lastResult,
      config: state.lastConfig,
      progress: state.backfillInFlight ? {
        enriched: state.enriched,
        errors: state.errors,
        total: state.total,
        processed: state.processed,
        retries: state.retries,
        succeededAfterRetry: state.succeededAfterRetry,
        failureCounts: { ...state.failureCounts },
      } : null,
    };
  }

  return { backfillTitles, getStats };
}
