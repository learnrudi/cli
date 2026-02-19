/**
 * Title backfill for sessions without titles.
 *
 * Spawns Haiku to generate short titles for untitled sessions.
 * Concurrency-limited with delay between calls to avoid rate limits.
 *
 * Factory pattern matching ingester.js:
 *   createTitleBackfillModule({ log, resolveDb, broadcast }) → { backfillTitles, getStats }
 */

import path from 'path';
import { spawn } from 'child_process';
import { resolveClaudeBinary } from '../agent/auth.js';

const MAX_LLM_CONCURRENCY = 3;
const LLM_TIMEOUT_MS = 15_000;
const LLM_DELAY_MS = 500; // delay between calls per worker to avoid rate limits

// ---------------------------------------------------------------------------
// DB queries
// ---------------------------------------------------------------------------

function _findUntitledSessions(db, { minTurns = 1 } = {}) {
  return db.prepare(`
    SELECT s.id, s.snippet, s.cwd, s.project_path, s.turn_count
    FROM sessions s
    WHERE s.title IS NULL
      AND s.title_override IS NULL
      AND s.status != 'deleted'
      AND COALESCE(s.turn_count, 0) >= ?
      AND (
        s.snippet IS NOT NULL AND TRIM(s.snippet) != ''
        OR EXISTS (SELECT 1 FROM turns t WHERE t.session_id = s.id AND t.turn_number = 1)
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

function _writeTitle(db, sessionId, title, source) {
  const now = new Date().toISOString();
  return db.prepare(`
    UPDATE sessions
    SET title = ?, title_source = ?, title_generated_at = ?
    WHERE id = ? AND title IS NULL AND title_override IS NULL
  `).run(title, source, now, sessionId);
}

// ---------------------------------------------------------------------------
// LLM title generation (mirrors autoNameSession in agent/db.js)
// ---------------------------------------------------------------------------

function _generateLlmTitle(firstMessage, cwd, log) {
  return new Promise((resolve) => {
    const binaryPath = resolveClaudeBinary();
    if (!binaryPath) { log?.('sessions', 'warn', '[title-backfill] no claude binary'); resolve(null); return; }

    const projectName = path.basename(cwd || '');
    const prompt = `Generate a short title (3-7 words) for this coding session based on the user's request. The title should describe what work is being done. Return ONLY the title text, no quotes, no punctuation at the end.\n\nProject: ${projectName}\nUser request: ${(firstMessage || '').slice(0, 1000)}`;

    const child = spawn(binaryPath, [
      '-p', prompt,
      '--model', 'haiku',
      '--no-session-persistence',
      '--max-turns', '1',
      '--output-format', 'json',
    ], { stdio: ['ignore', 'pipe', 'pipe'], timeout: LLM_TIMEOUT_MS });

    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => { stdout += chunk; });
    child.stderr.on('data', (chunk) => { stderr += chunk; });

    const timer = setTimeout(() => {
      log?.('sessions', 'warn', '[title-backfill] LLM timeout');
      try { child.kill(); } catch {}
    }, LLM_TIMEOUT_MS);

    child.on('close', (code) => {
      clearTimeout(timer);
      if (code !== 0 || !stdout) {
        if (stderr || code !== 0) {
          log?.('sessions', 'debug', `[title-backfill] haiku exit=${code} stderr=${stderr.slice(0, 200)}`);
        }
        resolve(null);
        return;
      }
      try {
        const parsed = JSON.parse(stdout);
        let title = (parsed.result || '').trim();
        // Reject multi-line or excessively long responses (Haiku went off the rails)
        if (title.includes('\n') || title.length > 100) {
          title = title.split('\n')[0].trim().slice(0, 100);
        }
        resolve(title || null);
      } catch {
        log?.('sessions', 'debug', `[title-backfill] bad json: ${stdout.slice(0, 200)}`);
        resolve(null);
      }
    });

    child.on('error', (err) => {
      clearTimeout(timer);
      log?.('sessions', 'warn', `[title-backfill] spawn error: ${err.message}`);
      resolve(null);
    });
  });
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
    titled: 0,
    errors: 0,
    total: 0,
  };

  async function backfillTitles({ llm = true, minTurns = 1 } = {}) {
    if (state.backfillInFlight) return state.backfillInFlight;

    const p = _run({ llm, minTurns });
    state.backfillInFlight = p;
    return p.finally(() => { state.backfillInFlight = null; });
  }

  async function _run({ llm, minTurns }) {
    const db = resolveDb ? resolveDb() : null;
    if (!db) return { skipped: true, reason: 'db_unavailable' };

    const t0 = Date.now();
    const untitled = _findUntitledSessions(db, { minTurns });
    if (untitled.length === 0) {
      const result = { total: 0, titled: 0, errors: 0, skipped: 0, durationMs: 0 };
      state.lastRunAt = new Date().toISOString();
      state.lastResult = result;
      log?.('sessions', 'info', `[title-backfill] no untitled sessions (minTurns=${minTurns})`);
      return result;
    }

    state.total = untitled.length;
    state.titled = 0;
    state.errors = 0;

    log?.('sessions', 'info', `[title-backfill] starting: ${untitled.length} untitled sessions (minTurns=${minTurns})`);

    // Gather first messages
    const sessions = [];
    let noMessage = 0;
    for (const sess of untitled) {
      const firstMessage = _getFirstMessage(db, sess.id, sess.snippet);
      if (firstMessage) {
        sessions.push({ ...sess, _firstMessage: firstMessage });
      } else {
        noMessage++;
      }
    }

    if (!llm || sessions.length === 0) {
      const result = { total: untitled.length, titled: 0, errors: 0, skipped: noMessage, durationMs: Date.now() - t0 };
      state.lastRunAt = new Date().toISOString();
      state.lastResult = result;
      log?.('sessions', 'info', `[title-backfill] llm disabled or no messages, skipped ${noMessage}`);
      return result;
    }

    log?.('sessions', 'info', `[title-backfill] generating titles for ${sessions.length} sessions (${noMessage} skipped, no message)`);

    // Concurrency-limited LLM calls with delay
    let cursor = 0;
    const next = () => cursor < sessions.length ? sessions[cursor++] : null;

    const worker = async () => {
      let sess;
      while ((sess = next()) !== null) {
        try {
          const cwd = sess.cwd || sess.project_path || '';
          const title = await _generateLlmTitle(sess._firstMessage, cwd, log);
          if (title) {
            _writeTitle(db, sess.id, title, 'llm');
            state.titled++;
            broadcast?.('session:titled', { sessionId: sess.id, title });
          } else {
            state.errors++;
          }
        } catch {
          state.errors++;
        }
        // Throttle to avoid rate limits
        await _sleep(LLM_DELAY_MS);
      }
    };

    const workers = [];
    for (let i = 0; i < Math.min(MAX_LLM_CONCURRENCY, sessions.length); i++) {
      workers.push(worker());
    }
    await Promise.all(workers);

    const result = {
      total: untitled.length,
      titled: state.titled,
      errors: state.errors,
      skipped: noMessage,
      durationMs: Date.now() - t0,
    };

    state.lastRunAt = new Date().toISOString();
    state.lastResult = result;

    log?.('sessions', 'info',
      `[title-backfill] done: ${state.titled} titled, ${state.errors} errors, ${noMessage} skipped (${result.durationMs}ms)`
    );

    return result;
  }

  function getStats() {
    return {
      running: !!state.backfillInFlight,
      lastRunAt: state.lastRunAt,
      lastResult: state.lastResult,
      progress: state.backfillInFlight ? { titled: state.titled, errors: state.errors, total: state.total } : null,
    };
  }

  return { backfillTitles, getStats };
}
