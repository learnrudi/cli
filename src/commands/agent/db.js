/**
 * Database helpers for agent sessions — queued writes, auto-naming.
 */

import path from 'path';
import { spawn } from 'child_process';
import { getDb } from '@learnrudi/db';
import { resolveClaudeBinary } from './auth.js';

let _db = null;
let _dbReadyChecked = false;
const _dbWriteQueue = [];
let _dbWriteFlushScheduled = false;
let _dbWriteQueueWarned = false;

const DB_WRITE_QUEUE_WARN_THRESHOLD = 5_000;
const DB_WRITE_QUEUE_MAX = 10_000;
const DB_WRITE_QUEUE_DROP_COUNT = Math.ceil(DB_WRITE_QUEUE_MAX * 0.1);

const TERMINAL_RUNTIME_STATES = new Set(['completed', 'error', 'stopped', 'crashed']);
const RUNTIME_STATE_TRANSITIONS = Object.freeze({
  starting: new Set(['running', 'retrying', 'error', 'stopped', 'crashed']),
  running: new Set(['retrying', 'completed', 'error', 'stopped', 'crashed']),
  retrying: new Set(['running', 'error', 'stopped', 'crashed']),
  completed: new Set(),
  error: new Set(),
  stopped: new Set(),
  crashed: new Set(),
});

function resolveValidFromStates(toStatus, { allowTerminalUpdate = false } = {}) {
  const validFromStates = [];
  for (const [fromStatus, nextStates] of Object.entries(RUNTIME_STATE_TRANSITIONS)) {
    if (nextStates.has(toStatus)) validFromStates.push(fromStatus);
  }
  if (allowTerminalUpdate && TERMINAL_RUNTIME_STATES.has(toStatus)) {
    for (const terminalState of TERMINAL_RUNTIME_STATES) {
      if (!validFromStates.includes(terminalState)) validFromStates.push(terminalState);
    }
  }
  return validFromStates;
}

function warnRejectedTransition(sessionId, toStatus, validFromStates, currentStatus) {
  const fromStatus = currentStatus || 'missing';
  console.warn(
    '[agent-db] rejected runtime status transition:',
    `${sessionId} ${fromStatus} -> ${toStatus} (allowed from: ${validFromStates.join(', ') || 'none'})`,
  );
}

export function resolveDb() {
  if (_db) return _db;
  if (_dbReadyChecked) return null;
  _dbReadyChecked = true;
  try {
    _db = getDb();
  } catch (err) {
    console.warn('[agent-db] unavailable:', err.message);
    _db = null;
  }
  return _db;
}

export function flushDbWrites() {
  _dbWriteFlushScheduled = false;
  const db = resolveDb();
  if (!db) {
    _dbWriteQueue.length = 0;
    _dbWriteQueueWarned = false;
    return;
  }
  while (_dbWriteQueue.length > 0) {
    const fn = _dbWriteQueue.shift();
    try {
      fn(db);
    } catch (err) {
      console.error('[agent-db] write failed:', err.message);
    }
  }
  _dbWriteQueueWarned = false;
}

export function dbWrite(fn) {
  if (_dbWriteQueue.length >= DB_WRITE_QUEUE_MAX) {
    _dbWriteQueue.splice(0, DB_WRITE_QUEUE_DROP_COUNT);
    console.warn(
      '[agent-db] write queue overflow: dropped oldest writes',
      { dropped: DB_WRITE_QUEUE_DROP_COUNT, depth: _dbWriteQueue.length },
    );
    _dbWriteQueueWarned = false;
  }
  _dbWriteQueue.push(fn);
  if (!_dbWriteQueueWarned && _dbWriteQueue.length >= DB_WRITE_QUEUE_WARN_THRESHOLD) {
    _dbWriteQueueWarned = true;
    console.warn('[agent-db] write queue depth warning', {
      depth: _dbWriteQueue.length,
      warnThreshold: DB_WRITE_QUEUE_WARN_THRESHOLD,
      maxDepth: DB_WRITE_QUEUE_MAX,
    });
  }
  if (_dbWriteFlushScheduled) return;
  _dbWriteFlushScheduled = true;
  setImmediate(flushDbWrites);
}

export function getDbWriteQueueDepth() {
  return _dbWriteQueue.length;
}

export function setResolvedDbForTests(db) {
  _db = db;
  _dbReadyChecked = db != null;
}

export function transitionSessionStatus(db, sessionId, toStatus, options = {}) {
  const { lastError, completedAt, allowTerminalUpdate = false } = options;
  const validFromStates = resolveValidFromStates(toStatus, { allowTerminalUpdate });
  if (validFromStates.length === 0) {
    warnRejectedTransition(sessionId, toStatus, validFromStates, null);
    return false;
  }

  const updates = ['status = ?', 'updated_at = ?'];
  const params = [toStatus, new Date().toISOString()];

  if (lastError !== undefined) {
    updates.push('last_error = ?');
    params.push(lastError);
  }
  if (completedAt !== undefined) {
    updates.push('completed_at = ?');
    params.push(completedAt);
  }

  const placeholders = validFromStates.map(() => '?').join(', ');
  params.push(sessionId, ...validFromStates);

  const result = db.prepare(`
    UPDATE session_runtime_state
    SET ${updates.join(', ')}
    WHERE session_id = ?
      AND status IN (${placeholders})
  `).run(...params);

  if (result.changes > 0) {
    return true;
  }

  const row = db.prepare('SELECT status FROM session_runtime_state WHERE session_id = ?').get(sessionId);
  warnRejectedTransition(sessionId, toStatus, validFromStates, row?.status || null);
  return false;
}

export function resetAgentDbStateForTests() {
  _db = null;
  _dbReadyChecked = false;
  _dbWriteQueue.length = 0;
  _dbWriteFlushScheduled = false;
  _dbWriteQueueWarned = false;
}

/**
 * Auto-name a session after its first turn completes (fire-and-forget Haiku call).
 */
export function autoNameSession(entry, providerSessionId, firstMessage, cwd, broadcast, log) {
  setImmediate(async () => {
    try {
      const binaryPath = resolveClaudeBinary();
      if (!binaryPath) return;

      const projectName = path.basename(cwd || '');
      const prompt = `Generate a short title (3-7 words) for this coding session based on the user's request. The title should describe what work is being done. Return ONLY the title text, no quotes, no punctuation at the end.\n\nProject: ${projectName}\nUser request: ${(firstMessage || '').slice(0, 1000)}`;

      const child = spawn(binaryPath, [
        '-p', prompt,
        '--model', 'haiku',
        '--no-session-persistence',
        '--max-turns', '1',
        '--output-format', 'json',
      ], { stdio: ['ignore', 'pipe', 'pipe'], timeout: 15000 });

      let stdout = '';
      child.stdout.on('data', (chunk) => { stdout += chunk; });

      const exitCode = await new Promise((resolve) => {
        const timer = setTimeout(() => { try { child.kill(); } catch {} }, 15000);
        child.on('close', (code) => { clearTimeout(timer); resolve(code); });
        child.on('error', () => { clearTimeout(timer); resolve(1); });
      });

      if (exitCode !== 0 || !stdout) return;

      const parsed = JSON.parse(stdout);
      const title = (parsed.result || '').trim();
      if (!title) return;

      // Write to DB: sessions.title (not title_override — that's for user renames)
      dbWrite((db) => {
        db.prepare(`
          UPDATE sessions SET title = ?, title_source = 'llm', title_generated_at = ?
          WHERE id = ? AND title_override IS NULL
        `).run(title, new Date().toISOString(), providerSessionId);
      });

      // Broadcast so frontends can refresh
      broadcast('session:titled', { sessionId: providerSessionId, title });
      log('agent', 'info', `auto-named session ${providerSessionId.slice(0, 8)}: "${title}"`);
    } catch (err) {
      log('agent', 'warn', `auto-name failed: ${err.message}`);
    }
  });
}
