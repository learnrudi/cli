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
}

export function dbWrite(fn) {
  _dbWriteQueue.push(fn);
  if (_dbWriteFlushScheduled) return;
  _dbWriteFlushScheduled = true;
  setImmediate(flushDbWrites);
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
          UPDATE sessions SET title = ? WHERE id = ? AND title_override IS NULL
        `).run(title, providerSessionId);
      });

      // Broadcast so frontends can refresh
      broadcast('session:titled', { sessionId: providerSessionId, title });
      log('agent', 'info', `auto-named session ${providerSessionId.slice(0, 8)}: "${title}"`);
    } catch (err) {
      log('agent', 'warn', `auto-name failed: ${err.message}`);
    }
  });
}
