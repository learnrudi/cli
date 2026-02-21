/**
 * Sessions route handler + JSONL parsing — extracted from serve.js
 *
 * Pure functions (parsing, diff stats, path decoding) are module-level exports.
 * The route handler + stateful caching/watcher are created via createSessionsModule().
 */

import fs from 'fs';
import fsp from 'fs/promises';
import path from 'path';
import os from 'os';
import { execSync, execFile } from 'child_process';

import {
  extractContent,
  extractToolResultText,
  getSessionEntryRole,
  isToolResultOnly,
  safeParseJsonObject,
  stripSystemXml,
} from '../sessions/providers/common.js';
import { parseSessionMessagesFromJsonl as parseSessionMessagesFromProviderRegistry } from '../sessions/providers/registry.js';

// Phase 2 extracted modules
import {
  CLAUDE_ROOT_DIR,
  CLAUDE_PROJECTS_DIR,
  CODEX_ROOT_DIR,
  CODEX_SESSIONS_DIR,
} from '../sessions/constants.js';
import { cacheSessionFileHint } from '../sessions/file-hints.js';
import {
  deriveCodexSessionIdFromFilename,
  readCodexSessionMeta,
} from '../sessions/providers/codex/discovery.js';
import {
  collectJsonlFiles,
  extractSessionCwdFromJsonlChunk,
  inferProjectPathFromSessionFile,
  decodeProjectDirFromFilesystem,
  readSessionSnippet,
  findSessionFileEntry,
} from '../sessions/discovery.js';
import { createSessionsDbModule } from '../sessions/db.js';
import { createSessionsTailModule } from '../sessions/tail.js';
import { readByteRange } from '../sessions/turn-index.js';
import { createSessionsIngesterModule } from '../sessions/ingester.js';
import { createTitleBackfillModule } from '../sessions/title-backfill.js';
import { createMetadataBackfillModule } from '../sessions/metadata-backfill.js';

// ---------------------------------------------------------------------------
// Constants (local — not extracted)
// ---------------------------------------------------------------------------

const SESSIONS_UPDATE_DEBOUNCE_MS = 350;
const SESSIONS_WATCH_RETRY_MS = 10000;
const SESSIONS_PROJECTS_CACHE_TTL_MS = 8000;
const MAX_SESSION_SEARCH_LIMIT = 50;

function prepareSessionSearchFtsQuery(query) {
  const cleaned = String(query || '')
    .replace(/['"]/g, '')
    .replace(/[()]/g, '')
    .replace(/[-]/g, ' ')
    .replace(/[*]/g, '')
    .trim();
  const words = cleaned.split(/\s+/).filter(Boolean);
  if (words.length === 0) return '""';
  if (words.length === 1) return `"${words[0]}"*`;
  return words.map((w) => `"${w}"*`).join(' ');
}

function mergeSessionSearchRows(db, titleRows, turnRows, limit) {
  const scoreBySession = new Map();
  const titleBySession = new Map();
  const turnsBySession = new Map();

  titleRows.forEach((row, idx) => {
    const base = scoreBySession.get(row.sessionId) || 0;
    scoreBySession.set(row.sessionId, base + (10_000 - idx));
    titleBySession.set(row.sessionId, {
      titleMatch: row.titleMatch || undefined,
      snippetMatch: row.snippetMatch || undefined,
    });
  });

  turnRows.forEach((row, idx) => {
    const base = scoreBySession.get(row.sessionId) || 0;
    scoreBySession.set(row.sessionId, base + (1_000 - idx));
    const existing = turnsBySession.get(row.sessionId) || [];
    if (existing.length < 3) {
      existing.push({
        turnNumber: row.turnNumber,
        userHighlighted: row.userHighlighted || undefined,
        assistantHighlighted: row.assistantHighlighted || undefined,
      });
      turnsBySession.set(row.sessionId, existing);
    }
  });

  const sessionIds = [...scoreBySession.keys()];
  if (sessionIds.length === 0) return [];
  const placeholders = sessionIds.map(() => '?').join(', ');
  const rows = db.prepare(`
    SELECT
      id as sessionId,
      title,
      provider,
      cwd,
      project_path as projectPath,
      last_active_at as lastActiveAt,
      COALESCE(turn_count, 0) as turnCount
    FROM sessions
    WHERE id IN (${placeholders}) AND status != 'deleted'
  `).all(...sessionIds);
  const rowById = new Map(rows.map((r) => [r.sessionId, r]));

  const sortedIds = sessionIds
    .filter((id) => rowById.has(id))
    .sort((a, b) => {
      const scoreDiff = (scoreBySession.get(b) || 0) - (scoreBySession.get(a) || 0);
      if (scoreDiff !== 0) return scoreDiff;
      const aTs = new Date(rowById.get(a)?.lastActiveAt || 0).getTime();
      const bTs = new Date(rowById.get(b)?.lastActiveAt || 0).getTime();
      return bTs - aTs;
    })
    .slice(0, limit);

  return sortedIds.map((id) => {
    const meta = rowById.get(id) || {};
    const title = titleBySession.get(id) || {};
    return {
      sessionId: id,
      title: meta.title || null,
      provider: meta.provider || 'claude',
      cwd: meta.cwd || null,
      projectPath: meta.projectPath || null,
      lastActiveAt: meta.lastActiveAt || null,
      turnCount: meta.turnCount || 0,
      titleMatch: title.titleMatch,
      snippetMatch: title.snippetMatch,
      turnMatches: turnsBySession.get(id) || [],
    };
  });
}

function searchSessionsInDb(db, query, { limit = 20, provider } = {}) {
  const normalizedLimit = Math.min(Math.max(Number(limit) || 20, 1), MAX_SESSION_SEARCH_LIMIT);
  const ftsQuery = prepareSessionSearchFtsQuery(query);
  const providerClause = provider ? ' AND s.provider = ?' : '';

  try {
    const titleParams = provider ? [ftsQuery, provider, normalizedLimit * 4] : [ftsQuery, normalizedLimit * 4];
    const turnParams = provider ? [ftsQuery, provider, normalizedLimit * 20] : [ftsQuery, normalizedLimit * 20];
    const titleRows = db.prepare(`
      SELECT
        s.id as sessionId,
        highlight(sessions_fts, 1, '<mark>', '</mark>') as titleMatch,
        highlight(sessions_fts, 2, '<mark>', '</mark>') as snippetMatch,
        bm25(sessions_fts) as rank
      FROM sessions_fts
      JOIN sessions s ON sessions_fts.session_id = s.id
      WHERE sessions_fts MATCH ?
        AND s.status != 'deleted'
        ${providerClause}
      ORDER BY rank
      LIMIT ?
    `).all(...titleParams);

    const turnRows = db.prepare(`
      SELECT
        t.session_id as sessionId,
        t.turn_number as turnNumber,
        highlight(turns_fts, 0, '<mark>', '</mark>') as userHighlighted,
        highlight(turns_fts, 1, '<mark>', '</mark>') as assistantHighlighted,
        bm25(turns_fts) as rank
      FROM turns_fts
      JOIN turns t ON turns_fts.rowid = t.rowid
      JOIN sessions s ON t.session_id = s.id
      WHERE turns_fts MATCH ?
        AND s.status != 'deleted'
        ${providerClause}
      ORDER BY rank
      LIMIT ?
    `).all(...turnParams);

    return mergeSessionSearchRows(db, titleRows, turnRows, normalizedLimit);
  } catch {
    // Fallback: LIKE-based search if FTS query parsing fails
    const like = `%${query}%`;
    const titleParams = provider ? [like, like, provider, normalizedLimit * 4] : [like, like, normalizedLimit * 4];
    const turnParams = provider ? [like, like, provider, normalizedLimit * 20] : [like, like, normalizedLimit * 20];
    const titleRows = db.prepare(`
      SELECT
        s.id as sessionId,
        s.title as titleMatch,
        s.snippet as snippetMatch,
        0 as rank
      FROM sessions s
      WHERE s.status != 'deleted'
        AND (s.title LIKE ? OR s.snippet LIKE ?)
        ${providerClause}
      ORDER BY s.last_active_at DESC
      LIMIT ?
    `).all(...titleParams);
    const turnRows = db.prepare(`
      SELECT
        t.session_id as sessionId,
        t.turn_number as turnNumber,
        t.user_message as userHighlighted,
        t.assistant_response as assistantHighlighted,
        0 as rank
      FROM turns t
      JOIN sessions s ON t.session_id = s.id
      WHERE s.status != 'deleted'
        AND (t.user_message LIKE ? OR t.assistant_response LIKE ?)
        ${providerClause}
      ORDER BY t.ts DESC
      LIMIT ?
    `).all(...turnParams);
    return mergeSessionSearchRows(db, titleRows, turnRows, normalizedLimit);
  }
}

// ---------------------------------------------------------------------------
// Pure functions — parsing, diff stats, path decoding
// ---------------------------------------------------------------------------

export {
  extractContent,
  extractToolResultText,
  getSessionEntryRole,
  isToolResultOnly,
  stripSystemXml,
};

// Re-exports from Phase 2 extracted modules (backward compatibility)
export { extractSessionCwdFromJsonlChunk } from '../sessions/discovery.js';
export { cacheSessionFileHint } from '../sessions/file-hints.js';

/**
 * Count lines in a string, handling empty string correctly.
 */
export function countLines(str) {
  if (!str || str === '') return 0;
  return str.split('\n').length;
}

/**
 * Compute line-level diff stats using simple LCS-based algorithm.
 * Returns { insertions, deletions } for the change from oldStr to newStr.
 */
export function diffLines(oldStr, newStr) {
  const oldLines = oldStr === '' ? [] : oldStr.split('\n');
  const newLines = newStr === '' ? [] : newStr.split('\n');

  const m = oldLines.length;
  const n = newLines.length;

  if (m === 0) return { insertions: n, deletions: 0 };
  if (n === 0) return { insertions: 0, deletions: m };

  const dp = Array(m + 1).fill(null).map(() => Array(n + 1).fill(0));

  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      if (oldLines[i - 1] === newLines[j - 1]) {
        dp[i][j] = dp[i - 1][j - 1] + 1;
      } else {
        dp[i][j] = Math.max(dp[i - 1][j], dp[i][j - 1]);
      }
    }
  }

  const lcsLength = dp[m][n];
  return {
    deletions: m - lcsLength,
    insertions: n - lcsLength,
  };
}

/**
 * Accumulate diff stats from an Edit operation.
 */
export function accumulateEditStats(stats, oldStr, newStr) {
  const diff = diffLines(oldStr || '', newStr || '');
  stats.insertions += diff.insertions;
  stats.deletions += diff.deletions;
}

/**
 * Compute git diff stats for a session's time window (fallback).
 * Returns { insertions, deletions } or null if not computable.
 */
export function computeGitDiffStats(projectPath, created, modified) {
  if (!projectPath || !created || !modified) return null;

  try {
    const gitDir = path.join(projectPath, '.git');
    if (!fs.existsSync(gitDir)) return null;

    const result = execSync(
      `git log --after="${created}" --before="${modified}" --shortstat --pretty="" 2>/dev/null`,
      { cwd: projectPath, encoding: 'utf-8', timeout: 5000 }
    );

    if (!result.trim()) return null;

    let insertions = 0;
    let deletions = 0;

    for (const line of result.split('\n')) {
      const insMatch = line.match(/(\d+) insertion/);
      const delMatch = line.match(/(\d+) deletion/);
      if (insMatch) insertions += parseInt(insMatch[1], 10);
      if (delMatch) deletions += parseInt(delMatch[1], 10);
    }

    if (insertions === 0 && deletions === 0) return null;
    return { insertions, deletions };
  } catch {
    return null;
  }
}

/**
 * Compute diff stats from Claude's actual Edit/MultiEdit/Write tool calls in a session JSONL.
 * Returns { insertions, deletions } or null if not computable.
 */
export function computeSessionDiffStats(sessionJsonlPath) {
  if (!sessionJsonlPath) return null;

  try {
    if (!fs.existsSync(sessionJsonlPath)) return null;

    const content = fs.readFileSync(sessionJsonlPath, 'utf-8');
    const lines = content.trim().split('\n').filter(Boolean);

    const stats = { insertions: 0, deletions: 0 };

    for (const line of lines) {
      try {
        const entry = JSON.parse(line);

        const contentBlocks = entry?.message?.content;
        if (!Array.isArray(contentBlocks)) continue;

        for (const block of contentBlocks) {
          if (block.type !== 'tool_use') continue;

          if (block.name === 'Edit' && block.input) {
            accumulateEditStats(stats, block.input.old_string, block.input.new_string);
          } else if (block.name === 'MultiEdit' && block.input?.edits) {
            for (const edit of block.input.edits) {
              accumulateEditStats(stats, edit.old_string, edit.new_string);
            }
          } else if (block.name === 'Write' && block.input) {
            stats.insertions += countLines(block.input.content);
          }
        }
      } catch {
        // Skip malformed lines
      }
    }

    if (stats.insertions === 0 && stats.deletions === 0) return null;
    return stats;
  } catch {
    return null;
  }
}

async function readSessionMessages(sessionId, lookup = {}) {
  const found = await findSessionFileEntry(sessionId, lookup);
  if (!found?.filePath) {
    throw new Error(`Session not found: ${sessionId}`);
  }
  const { provider, filePath } = found;

  const content = await fsp.readFile(filePath, 'utf-8');
  const messages = parseSessionMessagesFromJsonl(content, provider);
  const byteOffset = Buffer.byteLength(content, 'utf-8');

  // Extract usage stats from raw JSONL lines
  const usage = extractUsageFromJsonl(content, provider);

  return { messages, byteOffset, usage, filePath, provider };
}

/**
 * Legacy JSONL pagination path (kept behind RUDI_DB_MESSAGES=0).
 * Uses the unified count/cursor contract for compatibility.
 */
async function readSessionMessagesPaginated(sessionId, { tail, before, count, cursor } = {}, lookup = {}) {
  if (before !== undefined && count === undefined && cursor === undefined) {
    throw new Error("The 'before' parameter is no longer supported. Use count/cursor pagination instead.");
  }

  // Legacy translation: tail -> count
  let normalizedCount = count;
  if (tail !== undefined && count === undefined) {
    const tailNum = Number(tail);
    normalizedCount = Number.isFinite(tailNum) ? Math.min(Math.max(Math.trunc(tailNum), 1), 200) : undefined;
  }

  const result = await readSessionMessages(sessionId, lookup);
  const totalTurns = result.messages.length;
  const pageSize = (Number.isFinite(normalizedCount) && normalizedCount > 0)
    ? normalizedCount
    : totalTurns;

  let endTurn = totalTurns;
  if (cursor) {
    endTurn = Math.min(decodeCursor(cursor), totalTurns);
  }
  const startTurn = Math.max(0, endTurn - pageSize);

  return {
    ...result,
    messages: result.messages.slice(startTurn, endTurn),
    hasMore: startTurn > 0,
    nextCursor: startTurn > 0 ? encodeCursor(startTurn) : null,
    totalTurns,
  };
}

/** Local alias for readByteRange — used by computeSessionDiffStatsAsync */
const _readByteRange = readByteRange;

// ---------------------------------------------------------------------------
// Opaque cursor encoding for turn-based pagination
// ---------------------------------------------------------------------------

function encodeCursor(turnNumber) {
  return Buffer.from(JSON.stringify({ t: turnNumber, v: 1 })).toString('base64url');
}

function decodeCursor(token) {
  try {
    const obj = JSON.parse(Buffer.from(token, 'base64url').toString());
    if (obj.v !== 1) throw new Error('Unknown cursor version');
    if (!Number.isInteger(obj.t) || obj.t < 0) throw new Error('Invalid cursor position');
    return obj.t;
  } catch {
    throw new Error('Invalid cursor');
  }
}

// ---------------------------------------------------------------------------
// DB-backed messages read (primary path)
// ---------------------------------------------------------------------------

/**
 * Map a DB turn row into the same two-message format as the JSONL parser.
 * 1 turn → [userMessage, assistantMessage]
 */
function _toNumberOrUndefined(value) {
  return Number.isFinite(value) ? Number(value) : undefined;
}

function _parseJsonObjectOrUndefined(raw) {
  if (typeof raw !== 'string' || !raw) return undefined;
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? parsed : undefined;
  } catch {
    return undefined;
  }
}

function _turnToMessages(turn) {
  const msgs = [];
  const baseMeta = {
    turnNumber: Number.isInteger(turn.turn_number) ? turn.turn_number : undefined,
    providerTurnId: typeof turn.provider_turn_id === 'string' ? turn.provider_turn_id : undefined,
    uuid: typeof turn.uuid === 'string' ? turn.uuid : undefined,
    permissionMode: typeof turn.permission_mode === 'string' ? turn.permission_mode : undefined,
  };

  if (turn.user_message) {
    msgs.push({
      role: 'user',
      content: turn.user_message,
      timestamp: turn.ts || undefined,
      ...baseMeta,
    });
  }

  if (turn.assistant_response || turn.thinking || turn.tool_results) {
    const assistantMsg = {
      role: 'assistant',
      content: turn.assistant_response || '',
      timestamp: turn.ts || undefined,
      ...baseMeta,
      model: typeof turn.model === 'string' ? turn.model : undefined,
      inputTokens: _toNumberOrUndefined(turn.input_tokens),
      outputTokens: _toNumberOrUndefined(turn.output_tokens),
      cacheReadTokens: _toNumberOrUndefined(turn.cache_read_tokens),
      cacheCreationTokens: _toNumberOrUndefined(turn.cache_creation_tokens),
      contextTokens: _toNumberOrUndefined(turn.context_tokens),
      costUsd: _toNumberOrUndefined(turn.cost),
      durationMs: _toNumberOrUndefined(turn.duration_ms),
      finishReason: typeof turn.finish_reason === 'string' ? turn.finish_reason : undefined,
      compactMetadata: _parseJsonObjectOrUndefined(turn.compact_metadata),
    };
    if (turn.thinking) {
      assistantMsg.thinking = turn.thinking;
    }
    if (turn.tool_results) {
      try {
        assistantMsg.toolCalls = JSON.parse(turn.tool_results);
      } catch {
        // leave toolCalls absent
      }
    }
    msgs.push(assistantMsg);
  }

  return msgs;
}

/**
 * Read session messages from DB turns table with cursor pagination.
 *
 * Response shape:
 *   { messages, byteOffset, usage, hasMore, nextCursor, totalTurns, filePath, provider }
 */
async function readSessionMessagesFromDb(sessionId, { count, cursor } = {}, lookup = {}) {
  const db = lookup.resolveDb ? lookup.resolveDb() : null;
  if (!db) {
    throw new Error('Database not available');
  }

  // Resolve session to get provider + filePath for byteOffset compat
  const found = await findSessionFileEntry(sessionId, lookup);
  const filePath = found?.filePath || null;
  const provider = found?.provider || 'claude';

  const pageSize = (Number.isFinite(count) && count > 0) ? count : 30;
  let beforeTurnNumber;
  if (cursor) {
    beforeTurnNumber = decodeCursor(cursor);
  }

  // Paginated query — turns come back in ASC order
  const limit = pageSize + 1; // one extra to detect hasMore
  let rows;
  if (beforeTurnNumber !== undefined) {
    rows = db.prepare(`
      SELECT * FROM turns
      WHERE session_id = ? AND turn_number < ?
      ORDER BY turn_number DESC
      LIMIT ?
    `).all(sessionId, beforeTurnNumber, limit);
  } else {
    rows = db.prepare(`
      SELECT * FROM turns
      WHERE session_id = ?
      ORDER BY turn_number DESC
      LIMIT ?
    `).all(sessionId, limit);
  }

  const hasMore = rows.length > pageSize;
  if (hasMore) rows = rows.slice(0, pageSize);
  rows.reverse(); // ASC order

  // Map turns → messages (1 turn = 2 messages)
  const messages = [];
  for (const row of rows) {
    const turnMsgs = _turnToMessages(row);
    messages.push(...turnMsgs);
  }

  // Build cursor from oldest turn in this page
  const nextCursor = hasMore && rows.length > 0
    ? encodeCursor(rows[0].turn_number)
    : null;

  // Total turns from session aggregate (fast, no COUNT(*))
  const sessionRow = db.prepare('SELECT turn_count FROM sessions WHERE id = ?').get(sessionId);
  const totalTurns = sessionRow?.turn_count || 0;

  // Usage from session aggregates
  const aggRow = db.prepare(`
    SELECT total_input_tokens, total_output_tokens, total_cost, turn_count
    FROM sessions WHERE id = ?
  `).get(sessionId);
  const usage = aggRow ? {
    totalInputTokens: aggRow.total_input_tokens || 0,
    totalOutputTokens: aggRow.total_output_tokens || 0,
    totalCacheReadTokens: 0,
    turnCount: aggRow.turn_count || 0,
    totalCostUsd: aggRow.total_cost || undefined,
  } : null;

  // byteOffset from file_positions for live-tail handoff
  let byteOffset = 0;
  if (filePath) {
    const fp = db.prepare('SELECT byte_offset FROM file_positions WHERE file_path = ?').get(filePath);
    byteOffset = fp?.byte_offset || 0;
  }

  return {
    messages,
    byteOffset,
    usage,
    filePath,
    provider,
    nextCursor,
    hasMore,
    totalTurns,
  };
}

/**
 * Walk raw JSONL lines and sum token usage from message.usage fields.
 * Also counts turns (user→assistant transitions).
 */
function extractUsageFromJsonl(content, provider = 'claude') {
  if (!content || typeof content !== 'string') return null;
  const lines = content.trim().split('\n').filter(Boolean);
  let totalInputTokens = 0;
  let totalOutputTokens = 0;
  let totalCacheReadTokens = 0;
  let totalCostUsd = 0;
  let turnCount = 0;
  let lastRole = null;
  let model = null;
  let createdAt = null;
  let lastActiveAt = null;
  let cwd = null;

  for (const line of lines) {
    let entry;
    try { entry = JSON.parse(line); } catch { continue; }

    // Capture metadata from first entries
    if (!createdAt && entry.timestamp) createdAt = entry.timestamp;
    if (entry.timestamp) lastActiveAt = entry.timestamp;
    if (!cwd && entry.cwd) cwd = entry.cwd;
    if (!cwd && typeof entry?.payload?.cwd === 'string') cwd = entry.payload.cwd;

    if (provider === 'codex') {
      if (!model && typeof entry?.payload?.model === 'string') model = entry.payload.model;
      if (entry?.type === 'event_msg' && entry?.payload?.type === 'token_count' && entry?.payload?.info) {
        const usage = entry.payload.info.last_token_usage || entry.payload.info.total_token_usage || null;
        if (usage) {
          const output = (usage.output_tokens || 0) + (usage.reasoning_output_tokens || 0);
          const input = (usage.input_tokens || 0) + (usage.cached_input_tokens || 0);
          totalOutputTokens += output;
          totalInputTokens += input;
          totalCacheReadTokens += usage.cached_input_tokens || 0;
        }
      }
      const role = getSessionEntryRole(entry, provider);
      if (role === 'assistant' && lastRole === 'user') {
        turnCount++;
      }
      if (role) lastRole = role;
      continue;
    }

    const role = getSessionEntryRole(entry, provider);
    const usage = entry?.message?.usage;

    if (!model && entry.message?.model) model = entry.message.model;

    if (usage) {
      totalOutputTokens += usage.output_tokens || 0;
      totalInputTokens += (usage.input_tokens || 0)
        + (usage.cache_read_input_tokens || 0)
        + (usage.cache_creation_input_tokens || 0);
      totalCacheReadTokens += usage.cache_read_input_tokens || 0;
    }

    // Extract cost from result events
    if (entry?.type === 'result' && typeof entry.total_cost_usd === 'number') {
      totalCostUsd = entry.total_cost_usd; // result event has cumulative cost
    }

    if (role === 'assistant' && lastRole === 'user') {
      turnCount++;
    }
    if (role) lastRole = role;
  }

  if (totalInputTokens === 0 && totalOutputTokens === 0 && !cwd && !model) return null;
  return {
    totalInputTokens, totalOutputTokens, totalCacheReadTokens, turnCount,
    totalCostUsd: totalCostUsd || undefined,
    model, createdAt, lastActiveAt, cwd,
  };
}

/**
 * Parse session JSONL content into chat messages.
 * Exported for unit tests.
 */
export function parseSessionMessagesFromJsonl(content, provider = 'claude') {
  return parseSessionMessagesFromProviderRegistry(content, provider);
}

/**
 * Read file diffs from a session's Edit/Write/MultiEdit tool calls.
 * Returns array of { filePath, type, oldContent, newContent }
 */
async function readSessionDiffs(sessionId, lookup = {}) {
  const found = await findSessionFileEntry(sessionId, lookup);
  if (!found?.filePath) {
    throw new Error(`Session not found: ${sessionId}`);
  }
  const { provider, filePath } = found;

  if (provider !== 'claude') {
    return [];
  }

  const content = await fsp.readFile(filePath, 'utf-8');
  const lines = content.trim().split('\n').filter(Boolean);
  const diffs = [];

  for (const line of lines) {
    try {
      const entry = JSON.parse(line);
      const contentBlocks = entry?.message?.content;
      if (!Array.isArray(contentBlocks)) continue;

      for (const block of contentBlocks) {
        if (block.type !== 'tool_use') continue;

        if (block.name === 'Edit' && block.input) {
          diffs.push({
            filePath: block.input.file_path || 'unknown',
            type: 'edit',
            oldContent: block.input.old_string || '',
            newContent: block.input.new_string || '',
          });
        } else if (block.name === 'MultiEdit' && block.input?.edits) {
          for (const edit of block.input.edits) {
            diffs.push({
              filePath: block.input.file_path || 'unknown',
              type: 'edit',
              oldContent: edit.old_string || '',
              newContent: edit.new_string || '',
            });
          }
        } else if (block.name === 'Write' && block.input) {
          diffs.push({
            filePath: block.input.file_path || 'unknown',
            type: 'write',
            oldContent: '',
            newContent: block.input.content || '',
          });
        }
      }
    } catch {
      // Skip malformed lines
    }
  }

  return diffs;
}

async function enumerateSessions() {
  const sessions = [];

  try {
    const projectDirs = await fsp.readdir(CLAUDE_PROJECTS_DIR);
    for (const projDir of projectDirs) {
      const projPath = path.join(CLAUDE_PROJECTS_DIR, projDir);
      const stat = await fsp.stat(projPath);
      if (!stat.isDirectory()) continue;

      const files = await fsp.readdir(projPath);
      for (const file of files) {
        if (!file.endsWith('.jsonl')) continue;
        const sessionId = file.replace('.jsonl', '');
        const filePath = path.join(projPath, file);
        const fstat = await fsp.stat(filePath);
        cacheSessionFileHint(sessionId, 'claude', filePath);

        sessions.push({
          id: sessionId,
          provider: 'claude',
          projectPath: projDir,
          messageCount: 0,
          createdAt: fstat.birthtime.toISOString(),
          updatedAt: fstat.mtime.toISOString(),
        });
      }
    }
  } catch {
    // ~/.claude/projects/ may not exist
  }

  try {
    const codexFiles = await collectJsonlFiles(CODEX_SESSIONS_DIR, 6);
    for (const filePath of codexFiles) {
      const meta = await readCodexSessionMeta(filePath, 60);
      const sessionId = meta.sessionId || deriveCodexSessionIdFromFilename(filePath);
      if (!sessionId) continue;
      let fstat;
      try {
        fstat = await fsp.stat(filePath);
      } catch {
        continue;
      }
      cacheSessionFileHint(sessionId, 'codex', filePath);
      sessions.push({
        id: sessionId,
        provider: 'codex',
        projectPath: meta.cwd || path.dirname(filePath),
        messageCount: 0,
        createdAt: fstat.birthtime.toISOString(),
        updatedAt: fstat.mtime.toISOString(),
      });
    }
  } catch {
    // ~/.codex/sessions/ may not exist
  }

  sessions.sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());
  return sessions;
}

export function shouldBroadcastSessionUpdate(watchRoot, relPath) {
  const normalized = String(relPath || '').replace(/\\/g, '/');
  if (!normalized) return false;

  const root = String(watchRoot || '').replace(/\\/g, '/');
  const isClaudeProjectsRoot = root === CLAUDE_PROJECTS_DIR.replace(/\\/g, '/');
  const isClaudeRoot = root === CLAUDE_ROOT_DIR.replace(/\\/g, '/');
  const isCodexSessionsRoot = root === CODEX_SESSIONS_DIR.replace(/\\/g, '/');
  const isCodexRoot = root === CODEX_ROOT_DIR.replace(/\\/g, '/');

  if (isCodexSessionsRoot) {
    return normalized.endsWith('.jsonl') || normalized === '.' || normalized.includes('/');
  }
  if (isCodexRoot) {
    return normalized === 'sessions' || normalized.startsWith('sessions/');
  }

  const inProjects = isClaudeProjectsRoot
    ? true
    : (isClaudeRoot && (normalized === 'projects' || normalized.startsWith('projects/')));

  if (!inProjects) return false;

  return (
    normalized.endsWith('.jsonl')
    || normalized.endsWith('sessions-index.json')
    || normalized === 'projects'
    || normalized.startsWith('projects/')
  );
}

// ---------------------------------------------------------------------------
// Factory — stateful session module with caching and watcher
// ---------------------------------------------------------------------------

export function createSessionsModule({ log, broadcast, json, error, readBody, getProjectGitStatus, resolveDb }) {
  // Stateful caching
  const sessionsProjectsCache = {
    value: null,
    fetchedAt: 0,
    inFlight: null,
  };
  let sessionsProjectsCacheGeneration = 0;
  let _projectsEtag = '';
  let sessionsUpdateDebounceTimer = null;
  let sessionsWatcherRetryTimer = null;
  let pendingSessionsUpdate = null;
  /** @type {Set<string>|null} Accumulated sessionIds across watcher events within debounce window */
  let pendingSessionIds = null;
  let sessionsWatcher = null;

  // -----------------------------------------------------------------------
  // Background enrichment caches (diff stats + git status)
  // -----------------------------------------------------------------------

  const _diffStatsCache = new Map();   // sessionId -> { diffStats, mtimeMs }
  const _gitStatusCache = new Map();   // projectPath -> { gitStatus, fetchedAt }
  const _diffStatsInFlight = new Set(); // sessionIds currently being computed
  const _gitStatusInFlight = new Set(); // projectPaths currently being computed
  const _sessionPathMap = new Map();    // sessionId -> fullPath (for background jobs)
  const GIT_STATUS_TTL_MS = 30_000;
  const ENRICHMENT_DEBOUNCE_MS = 2_000;
  let _enrichmentTimer = null;
  let _lastEnrichmentProjects = null;

  async function runBatched(items, concurrency, fn) {
    for (let i = 0; i < items.length; i += concurrency) {
      await Promise.all(items.slice(i, i + concurrency).map(fn));
    }
  }

  /**
   * Async diff stats from tail of JSONL file.
   * Reads last 256KB and scans for Edit/Write/MultiEdit tool_use blocks.
   */
  async function computeSessionDiffStatsAsync(sessionJsonlPath) {
    if (!sessionJsonlPath) return null;
    try {
      const stat = await fsp.stat(sessionJsonlPath);
      if (stat.size === 0) return null;

      const tailSize = 256 * 1024;
      const startByte = Math.max(0, stat.size - tailSize);
      const chunk = await _readByteRange(sessionJsonlPath, startByte, stat.size);

      const lines = chunk.split('\n').filter(Boolean);
      const stats = { insertions: 0, deletions: 0 };

      for (const line of lines) {
        let entry;
        try { entry = JSON.parse(line); } catch { continue; }

        const contentBlocks = entry?.message?.content;
        if (!Array.isArray(contentBlocks)) continue;

        for (const block of contentBlocks) {
          if (block.type !== 'tool_use') continue;

          if (block.name === 'Edit' && block.input) {
            accumulateEditStats(stats, block.input.old_string, block.input.new_string);
          } else if (block.name === 'MultiEdit' && block.input?.edits) {
            for (const edit of block.input.edits) {
              accumulateEditStats(stats, edit.old_string, edit.new_string);
            }
          } else if (block.name === 'Write' && block.input) {
            stats.insertions += countLines(block.input.content);
          }
        }
      }

      if (stats.insertions === 0 && stats.deletions === 0) return null;
      return stats;
    } catch {
      return null;
    }
  }

  /**
   * Async git status using execFile (non-blocking).
   * Single command: git status --porcelain=v2 --branch
   */
  function getProjectGitStatusAsync(projectPath) {
    return new Promise((resolve) => {
      if (!projectPath) return resolve(null);

      const gitDir = path.join(projectPath, '.git');
      // Quick sync check — .git is almost always a directory, stat is fast
      try { if (!fs.existsSync(gitDir)) return resolve(null); } catch { return resolve(null); }

      execFile('git', ['status', '--porcelain=v2', '--branch'], {
        cwd: projectPath,
        encoding: 'utf-8',
        timeout: 2000,
        env: { ...process.env, GIT_OPTIONAL_LOCKS: '0' },
      }, (err, stdout) => {
        if (err) return resolve(null);
        let branch = '';
        let uncommitted = 0;
        for (const line of stdout.split('\n')) {
          if (line.startsWith('# branch.head ')) {
            branch = line.slice('# branch.head '.length);
          } else if (line && !line.startsWith('#')) {
            uncommitted++;
          }
        }
        resolve({ branch, uncommitted });
      });
    });
  }

  /**
   * Background enrichment: compute missing diff stats + git status.
   * Runs after the initial response is sent. Results available on next poll.
   */
  async function _enrichProjectsInBackground(projects) {
    // Diff stats: top 5 sessions per project that are missing/stale
    const diffJobs = [];
    for (const proj of projects) {
      for (const session of proj.sessions.slice(0, 5)) {
        const sid = session.sessionId;
        if (_diffStatsInFlight.has(sid)) continue;
        if (_diffStatsCache.has(sid)) continue;
        const fullPath = _sessionPathMap.get(sid);
        if (!fullPath) continue;
        diffJobs.push({ sessionId: sid, fullPath });
      }
    }
    await runBatched(diffJobs, 8, async (job) => {
      if (_diffStatsInFlight.has(job.sessionId)) return;
      _diffStatsInFlight.add(job.sessionId);
      try {
        const stats = await computeSessionDiffStatsAsync(job.fullPath);
        _diffStatsCache.set(job.sessionId, { diffStats: stats });
      } finally {
        _diffStatsInFlight.delete(job.sessionId);
      }
    });

    // Git status: per project, skip if fresh or in-flight
    const gitJobs = projects
      .map(p => p.originalPath)
      .filter(p => p && !_gitStatusInFlight.has(p))
      .filter(p => {
        const cached = _gitStatusCache.get(p);
        return !cached || (Date.now() - cached.fetchedAt) > GIT_STATUS_TTL_MS;
      });
    await runBatched(gitJobs, 4, async (projectPath) => {
      if (_gitStatusInFlight.has(projectPath)) return;
      _gitStatusInFlight.add(projectPath);
      try {
        const gitStatus = await getProjectGitStatusAsync(projectPath);
        _gitStatusCache.set(projectPath, { gitStatus, fetchedAt: Date.now() });
      } finally {
        _gitStatusInFlight.delete(projectPath);
      }
    });
  }

  function _scheduleEnrichment(projects) {
    _lastEnrichmentProjects = projects;
    if (_enrichmentTimer) return;
    _enrichmentTimer = setTimeout(() => {
      _enrichmentTimer = null;
      const toEnrich = _lastEnrichmentProjects;
      _lastEnrichmentProjects = null;
      if (toEnrich) {
        _enrichProjectsInBackground(toEnrich).catch(() => {});
      }
    }, ENRICHMENT_DEBOUNCE_MS);
  }

  // -----------------------------------------------------------------------
  // DB-as-spine: delegated to sessions/db.js factory
  // -----------------------------------------------------------------------

  const dbModule = createSessionsDbModule({
    log,
    resolveDb,
    caches: { diffStatsCache: _diffStatsCache, gitStatusCache: _gitStatusCache, sessionPathMap: _sessionPathMap, GIT_STATUS_TTL_MS },
    onProjectsReady: _scheduleEnrichment,
  });

  const {
    reconcileSessionsToDb,
    watcherDbUpsert,
    startPeriodicReconcile,
    enableDbSpine,
    getProjectsFromDb,
    isDbSpineEnabled,
  } = dbModule;

  // -----------------------------------------------------------------------
  // JSONL -> DB ingester (turn-level)
  // -----------------------------------------------------------------------

  const ingesterModule = createSessionsIngesterModule({
    log,
    resolveDb,
  });
  const {
    ingestFile: ingestSessionFile,
    reconcileAll: reconcileSessionTurnsToDb,
    backfillAll: backfillSessionTurnsToDb,
    repairNoTextTurns: repairNoTextSessionTurnsToDb,
    startPeriodicReconcile: startTurnIngestReconcile,
    getStats: getTurnIngestStats,
  } = ingesterModule;

  // -----------------------------------------------------------------------
  // Title backfill (heuristic + LLM)
  // -----------------------------------------------------------------------

  const titleBackfillModule = createTitleBackfillModule({
    log,
    resolveDb,
    broadcast,
  });
  const {
    backfillTitles: backfillSessionTitles,
    getStats: getTitleBackfillStats,
  } = titleBackfillModule;

  // -----------------------------------------------------------------------
  // Metadata backfill (subagent session enrichment)
  // -----------------------------------------------------------------------

  const metadataBackfillModule = createMetadataBackfillModule({
    log,
    resolveDb,
    broadcast,
  });
  const {
    backfillMetadata: backfillSessionMetadata,
    getStats: getMetadataBackfillStats,
  } = metadataBackfillModule;

  // -----------------------------------------------------------------------
  // Live tail: delegated to sessions/tail.js factory
  // -----------------------------------------------------------------------

  const tailModule = createSessionsTailModule({
    log,
    broadcast,
    findSessionFile: (sid) => findSessionFileEntry(sid, { resolveDb }),
  });

  function invalidateSessionsProjectsCache() {
    sessionsProjectsCacheGeneration += 1;
    sessionsProjectsCache.value = null;
    sessionsProjectsCache.fetchedAt = 0;
    sessionsProjectsCache.inFlight = null;
  }

  function queueSessionsUpdated(data = {}) {
    invalidateSessionsProjectsCache();

    // Accumulate sessionIds across multiple watcher events within the debounce window
    if (data.sessionId) {
      if (!pendingSessionIds) pendingSessionIds = new Set();
      pendingSessionIds.add(data.sessionId);
    }

    pendingSessionsUpdate = {
      ...pendingSessionsUpdate,
      ...data,
      ts: new Date().toISOString(),
    };

    clearTimeout(sessionsUpdateDebounceTimer);
    sessionsUpdateDebounceTimer = setTimeout(() => {
      const payload = pendingSessionsUpdate || { source: 'unknown', ts: new Date().toISOString() };
      // Attach coalesced sessionIds (may be from multiple watcher events)
      if (pendingSessionIds && pendingSessionIds.size > 0) {
        payload.sessionIds = [...pendingSessionIds];
        // If exactly one, also set singular for compat
        if (pendingSessionIds.size === 1) {
          payload.sessionId = payload.sessionIds[0];
        } else {
          delete payload.sessionId; // multiple — use sessionIds array
        }
      }
      pendingSessionsUpdate = null;
      pendingSessionIds = null;
      sessionsUpdateDebounceTimer = null;
      broadcast('sessions:updated', payload);
    }, SESSIONS_UPDATE_DEBOUNCE_MS);
  }

  function startSessionsWatcher() {
    if (sessionsWatcher) return;

    const watcherSpecs = [];
    if (fs.existsSync(CLAUDE_PROJECTS_DIR)) {
      watcherSpecs.push({ provider: 'claude', rootPath: CLAUDE_PROJECTS_DIR });
    } else if (fs.existsSync(CLAUDE_ROOT_DIR)) {
      watcherSpecs.push({ provider: 'claude', rootPath: CLAUDE_ROOT_DIR });
    }
    if (fs.existsSync(CODEX_SESSIONS_DIR)) {
      watcherSpecs.push({ provider: 'codex', rootPath: CODEX_SESSIONS_DIR });
    } else if (fs.existsSync(CODEX_ROOT_DIR)) {
      watcherSpecs.push({ provider: 'codex', rootPath: CODEX_ROOT_DIR });
    }

    if (watcherSpecs.length === 0) {
      log('sessions', 'debug', 'sessions watcher skipped (no provider session directories found)');
      if (!sessionsWatcherRetryTimer) {
        sessionsWatcherRetryTimer = setTimeout(() => {
          sessionsWatcherRetryTimer = null;
          startSessionsWatcher();
        }, SESSIONS_WATCH_RETRY_MS);
      }
      return;
    }

    const watchers = [];
    for (const spec of watcherSpecs) {
      const { provider, rootPath } = spec;
      try {
        const watcher = fs.watch(rootPath, { recursive: true }, (eventType, filename) => {
          const relPath = typeof filename === 'string' ? filename : '';
          if (!relPath) {
            queueSessionsUpdated({
              source: 'watcher',
              provider,
              event: eventType,
              path: rootPath,
              missingFilename: true,
            });
            return;
          }
          if (!shouldBroadcastSessionUpdate(rootPath, relPath)) return;

          const fullPath = path.join(rootPath, relPath);
          const updateData = {
            source: 'watcher',
            provider,
            event: eventType,
            path: fullPath,
          };
          const normalized = relPath.replace(/\\/g, '/');
          if (normalized.endsWith('.jsonl')) {
            const parts = normalized.split('/');
            if (provider === 'claude') {
              const inProjects = rootPath === CLAUDE_PROJECTS_DIR;
              const projIdx = inProjects ? 0 : 1; // skip 'projects/' prefix when watching ~/.claude
              if (parts.length > projIdx + 1) {
                updateData.projectDir = parts[projIdx] || null;
                const fname = parts[projIdx + 1];
                if (fname && fname.endsWith('.jsonl')) {
                  updateData.sessionId = fname.slice(0, -6);
                }
              }
            } else {
              const fname = parts[parts.length - 1];
              if (fname && fname.endsWith('.jsonl')) {
                updateData.sessionId = deriveCodexSessionIdFromFilename(fname);
              }
            }
            if (updateData.sessionId) {
              cacheSessionFileHint(updateData.sessionId, provider, fullPath);
              ingestSessionFile(fullPath, {
                provider,
                sessionId: updateData.sessionId,
              }).catch(() => {}); // fire-and-forget
              watcherDbUpsert(updateData.sessionId, fullPath, {
                provider,
                projectDir: updateData.projectDir || null,
              }).then((result) => {
                if (result?.isNew) {
                  // Queue a separate update with new session metadata
                  queueSessionsUpdated({
                    source: 'watcher-new',
                    sessionId: result.sessionId,
                    newSession: {
                      sessionId: result.sessionId,
                      provider: result.provider,
                      firstPrompt: result.snippet,
                      modified: result.modified,
                      created: result.created,
                      projectPath: result.projectPath,
                      gitBranch: result.gitBranch,
                    },
                  });
                }
              }).catch(() => {}); // fire-and-forget
            }
          }
          queueSessionsUpdated(updateData);
        });
        watchers.push({ watcher, rootPath, provider });
        log('sessions', 'info', `watching ${rootPath} for ${provider} session updates`);
      } catch (err) {
        log('sessions', 'warn', `failed to watch sessions path: ${err.message}`, { rootPath, provider });
      }
    }

    if (watchers.length === 0) {
      if (!sessionsWatcherRetryTimer) {
        sessionsWatcherRetryTimer = setTimeout(() => {
          sessionsWatcherRetryTimer = null;
          startSessionsWatcher();
        }, SESSIONS_WATCH_RETRY_MS);
      }
      return;
    }
    sessionsWatcher = { watchers };
  }

  /**
   * Enumerate projects with their sessions, using sessions-index.json for rich metadata.
   * Falls back to scanning .jsonl files if index is missing/malformed.
   *
   * Hot path: no sync file reads, no sync git subprocesses. Diff stats and git status
   * come from caches (populated by background enrichment on previous calls).
   */
  async function enumerateProjectsWithSessions() {
    const claudeDir = path.join(os.homedir(), '.claude', 'projects');
    const projects = [];

    async function processProject(projDir) {
      const projPath = path.join(claudeDir, projDir);
      const stat = await fsp.stat(projPath);
      if (!stat.isDirectory()) return null;

      let sessions = [];
      let originalPath = null;

      const indexPath = path.join(projPath, 'sessions-index.json');
      try {
        const indexContent = await fsp.readFile(indexPath, 'utf-8');
        const index = JSON.parse(indexContent);
        originalPath = index.originalPath || null;

        if (Array.isArray(index.entries)) {
          const STALE_THRESHOLD_MS = 2 * 60 * 1000; // 2 minutes
          const now = Date.now();
          const ENTRY_BATCH = 50;
          for (let ei = 0; ei < index.entries.length; ei += ENTRY_BATCH) {
            const batch = index.entries.slice(ei, ei + ENTRY_BATCH);
            const results = await Promise.all(batch.map(async (entry) => {
              const fullPath = entry.fullPath || path.join(projPath, `${entry.sessionId}.jsonl`);
              let modified = entry.modified || '';
              // Only stat the file if the index entry looks stale (>2min old).
              // Claude CLI only updates sessions-index.json at session boundaries,
              // so active terminal sessions have stale index timestamps.
              const indexAge = modified ? now - new Date(modified).getTime() : Infinity;
              if (indexAge > STALE_THRESHOLD_MS) {
                try {
                  const fstat = await fsp.stat(fullPath);
                  const fileMtime = fstat.mtime.toISOString();
                  if (!modified || new Date(fileMtime) > new Date(modified)) {
                    modified = fileMtime;
                  }
                } catch {
                  return null; // JSONL file deleted — skip phantom index entry
                }
              }
              return {
                sessionId: entry.sessionId,
                provider: 'claude',
                summary: entry.summary || '',
                firstPrompt: entry.firstPrompt || '',
                messageCount: entry.messageCount || 0,
                modified,
                created: entry.created || '',
                gitBranch: entry.gitBranch || '',
                originNativeFile: fullPath,
                fullPath,
                diffStats: null,
              };
            }));
            for (const r of results) {
              if (r) sessions.push(r);
            }
          }
        }

        const indexedIds = new Set(sessions.map((s) => s.sessionId));
        const files = await fsp.readdir(projPath);
        for (const file of files) {
          if (!file.endsWith('.jsonl')) continue;
          const sessionId = file.replace('.jsonl', '');
          if (indexedIds.has(sessionId)) continue;
          const filePath = path.join(projPath, file);
          try {
            const fstat = await fsp.stat(filePath);
            const snippet = await readSessionSnippet(filePath);
            sessions.push({
              sessionId,
              provider: 'claude',
              summary: '',
              firstPrompt: snippet.firstPrompt,
              messageCount: 0,
              modified: fstat.mtime.toISOString(),
              created: fstat.birthtime.toISOString(),
              gitBranch: snippet.gitBranch,
              originNativeFile: filePath,
              fullPath: filePath,
              diffStats: null,
            });
          } catch {
            // Skip files we can't stat
          }
        }
      } catch {
        const files = await fsp.readdir(projPath);
        for (const file of files) {
          if (!file.endsWith('.jsonl')) continue;
          const sessionId = file.replace('.jsonl', '');
          const filePath = path.join(projPath, file);
          try {
            const fstat = await fsp.stat(filePath);
            const snippet = await readSessionSnippet(filePath);
            sessions.push({
              sessionId,
              provider: 'claude',
              summary: '',
              firstPrompt: snippet.firstPrompt,
              messageCount: 0,
              modified: fstat.mtime.toISOString(),
              created: fstat.birthtime.toISOString(),
              gitBranch: snippet.gitBranch,
              originNativeFile: filePath,
              fullPath: filePath,
              diffStats: null,
            });
          } catch {
            // Skip files we can't stat
          }
        }
      }

      if (sessions.length === 0) return null;

      sessions.sort((a, b) => new Date(b.modified).getTime() - new Date(a.modified).getTime());

      // Try to infer a better path from session JSONL files
      let inferredOriginalPath = null;
      for (const session of sessions) {
        if (!session.fullPath) continue;
        const inferredPath = await inferProjectPathFromSessionFile(session.fullPath);
        if (inferredPath) {
          inferredOriginalPath = inferredPath;
          break;
        }
      }
      if (inferredOriginalPath) {
        originalPath = inferredOriginalPath;
      }

      // Keep originalPath from index even if directory no longer exists —
      // a stale-but-correct path is better than a mangled naive decode.
      // Only fall back to decoding if we have no originalPath at all.
      let decodedPath = null;
      if (!originalPath) {
        decodedPath = await decodeProjectDirFromFilesystem(projDir);
      }
      if (!decodedPath) {
        decodedPath = '/' + projDir.replace(/-/g, '/').replace(/^\//, '');
      }

      const displayPath = originalPath || decodedPath;
      const name = path.basename(displayPath);

      // Diff stats: read from cache only (background enrichment fills it)
      for (const session of sessions) {
        // Populate path map for background enrichment
        if (session.fullPath) {
          _sessionPathMap.set(session.sessionId, session.fullPath);
          cacheSessionFileHint(session.sessionId, session.provider || 'claude', session.fullPath);
        }
        const cached = _diffStatsCache.get(session.sessionId);
        if (cached) session.diffStats = cached.diffStats;
      }

      const cleanedSessions = sessions.map(({ fullPath, ...rest }) => rest);

      // Git status: read from cache only (background enrichment fills it)
      const cachedGit = _gitStatusCache.get(displayPath);
      const gitStatus = (cachedGit && (Date.now() - cachedGit.fetchedAt) < GIT_STATUS_TTL_MS)
        ? cachedGit.gitStatus : null;

      return {
        path: projDir,
        name,
        originalPath: displayPath,
        sessions: cleanedSessions,
        gitStatus,
      };
    }

    try {
      const projectDirs = await fsp.readdir(claudeDir);

      // Process projects in parallel batches
      const CONCURRENCY = 8;
      for (let i = 0; i < projectDirs.length; i += CONCURRENCY) {
        const batch = projectDirs.slice(i, i + CONCURRENCY);
        const results = await Promise.all(batch.map(dir => processProject(dir).catch(() => null)));
        for (const r of results) {
          if (r) projects.push(r);
        }
      }
    } catch {
      // ~/.claude/projects/ may not exist
    }

    // Codex sessions: ~/ .codex/sessions/YYYY/MM/DD/*.jsonl, grouped by cwd.
    try {
      const codexFiles = await collectJsonlFiles(CODEX_SESSIONS_DIR, 6);
      const codexSessions = [];
      const CONCURRENCY = 16;
      for (let i = 0; i < codexFiles.length; i += CONCURRENCY) {
        const batch = codexFiles.slice(i, i + CONCURRENCY);
        const batchRows = await Promise.all(batch.map(async (filePath) => {
          let fstat;
          try {
            fstat = await fsp.stat(filePath);
          } catch {
            return null;
          }
          const meta = await readCodexSessionMeta(filePath, 60);
          const sessionId = meta.sessionId || deriveCodexSessionIdFromFilename(filePath);
          if (!sessionId) return null;
          const snippet = await readSessionSnippet(filePath, 'codex');
          const projectPath = meta.cwd || snippet.cwd || await inferProjectPathFromSessionFile(filePath) || os.homedir();
          cacheSessionFileHint(sessionId, 'codex', filePath);
          _sessionPathMap.set(sessionId, filePath);
          return {
            sessionId,
            provider: 'codex',
            summary: '',
            firstPrompt: snippet.firstPrompt || '',
            messageCount: 0,
            modified: fstat.mtime.toISOString(),
            created: fstat.birthtime.toISOString(),
            gitBranch: '',
            originNativeFile: filePath,
            diffStats: null,
            projectPath,
          };
        }));
        codexSessions.push(...batchRows.filter(Boolean));
      }

      const codexProjectMap = new Map();
      for (const session of codexSessions) {
        const projectPath = session.projectPath;
        if (!codexProjectMap.has(projectPath)) {
          const encoded = projectPath.replace(/^\//, '').replace(/\//g, '-') || '-';
          codexProjectMap.set(projectPath, {
            path: encoded,
            name: path.basename(projectPath) || projectPath,
            originalPath: projectPath,
            sessions: [],
            gitStatus: null,
          });
        }
        const { projectPath: _projectPath, ...sessionMeta } = session;
        codexProjectMap.get(projectPath).sessions.push(sessionMeta);
      }

      for (const proj of codexProjectMap.values()) {
        proj.sessions.sort((a, b) => new Date(b.modified).getTime() - new Date(a.modified).getTime());
        const cachedGit = _gitStatusCache.get(proj.originalPath);
        if (cachedGit && (Date.now() - cachedGit.fetchedAt) < GIT_STATUS_TTL_MS) {
          proj.gitStatus = cachedGit.gitStatus;
        }
        projects.push(proj);
      }
    } catch {
      // ~/.codex/sessions/ may not exist
    }

    // Merge DB titles into session entries
    const db = resolveDb ? resolveDb() : null;
    if (db) {
      try {
        // Collect all session IDs across all projects
        const allSessionIds = [];
        for (const proj of projects) {
          for (const s of proj.sessions) {
            allSessionIds.push(s.sessionId);
          }
        }
        if (allSessionIds.length > 0) {
          // Batch query in chunks (x2 placeholders) to avoid SQLite variable limit
          const dbMap = new Map();
          for (let i = 0; i < allSessionIds.length; i += 400) {
            const chunk = allSessionIds.slice(i, i + 400);
            const placeholders = chunk.map(() => '?').join(',');
            const rows = db.prepare(`
              SELECT id, provider, provider_session_id, title, title_override, total_cost, total_input_tokens, total_output_tokens, turn_count,
                     parent_session_id, is_sidechain, session_type, origin_native_file
              FROM sessions
              WHERE status != 'deleted'
                AND (id IN (${placeholders}) OR provider_session_id IN (${placeholders}))
            `).all(...chunk, ...chunk);
            for (const row of rows) {
              dbMap.set(`${row.provider}:${row.id}`, row);
              if (row.provider_session_id) {
                dbMap.set(`${row.provider}:${row.provider_session_id}`, row);
              }
            }
          }
          // Attach DB fields to each session entry
          for (const proj of projects) {
            for (const s of proj.sessions) {
              const row = dbMap.get(`${s.provider || 'claude'}:${s.sessionId}`);
              if (!row) continue;
              const display = row.title_override || row.title;
              if (display) s.dbTitle = display;
              if (row.total_cost > 0) s.totalCost = row.total_cost;
              if (row.total_input_tokens > 0) s.totalInputTokens = row.total_input_tokens;
              if (row.total_output_tokens > 0) s.totalOutputTokens = row.total_output_tokens;
              if (row.turn_count > 0) s.turnCount = row.turn_count;
              if (row.parent_session_id) s.parentSessionId = row.parent_session_id;
              if (row.is_sidechain) s.isSidechain = true;
              if (row.session_type && row.session_type !== 'main') s.sessionType = row.session_type;
              if (!s.originNativeFile && row.origin_native_file) s.originNativeFile = row.origin_native_file;
            }
          }
        }
      } catch (err) {
        log('sessions', 'warn', `DB title merge failed: ${err.message}`);
      }
    }

    // Merge worktree projects into their parent project.
    // Claude CLI records the worktree cwd as the project path, creating separate
    // entries like /repo/.rudi/worktrees/main. Fold those sessions back into /repo.
    const worktreeMarker = '/.rudi/worktrees/';
    const mergedProjects = [];
    const parentMap = new Map(); // realRoot -> index in mergedProjects

    for (const proj of projects) {
      const op = proj.originalPath || '';
      const wtIdx = op.indexOf(worktreeMarker);
      if (wtIdx !== -1) {
        // This is a worktree project — merge into parent
        const realRoot = op.slice(0, wtIdx);
        if (parentMap.has(realRoot)) {
          // Parent already exists — merge sessions
          const parent = mergedProjects[parentMap.get(realRoot)];
          parent.sessions.push(...proj.sessions);
        } else {
          // Parent not seen yet — rewrite this entry as the parent
          const realName = path.basename(realRoot);
          parentMap.set(realRoot, mergedProjects.length);
          mergedProjects.push({
            ...proj,
            name: realName,
            originalPath: realRoot,
          });
        }
      } else {
        // Regular project
        if (parentMap.has(op)) {
          // Already have an entry from a worktree — merge into it
          const existing = mergedProjects[parentMap.get(op)];
          existing.sessions.push(...proj.sessions);
          // Keep the first stable path key; fill missing metadata only.
          if (!existing.path) existing.path = proj.path;
          if (!existing.gitStatus && proj.gitStatus) existing.gitStatus = proj.gitStatus;
        } else {
          parentMap.set(op, mergedProjects.length);
          mergedProjects.push(proj);
        }
      }
    }

    // Re-sort sessions within each project after merging
    for (const proj of mergedProjects) {
      proj.sessions.sort((a, b) =>
        new Date(b.modified).getTime() - new Date(a.modified).getTime()
      );
    }

    mergedProjects.sort((a, b) => {
      const aTime = a.sessions[0]?.modified || '';
      const bTime = b.sessions[0]?.modified || '';
      return new Date(bTime).getTime() - new Date(aTime).getTime();
    });

    return mergedProjects;
  }

  async function getProjectsWithSessionsCached() {
    const now = Date.now();
    if (
      sessionsProjectsCache.value
      && (now - sessionsProjectsCache.fetchedAt) <= SESSIONS_PROJECTS_CACHE_TTL_MS
    ) {
      return sessionsProjectsCache.value;
    }

    if (sessionsProjectsCache.inFlight) {
      return sessionsProjectsCache.inFlight;
    }

    const generationAtStart = sessionsProjectsCacheGeneration;
    sessionsProjectsCache.inFlight = enumerateProjectsWithSessions()
      .then((projects) => {
        if (generationAtStart === sessionsProjectsCacheGeneration) {
          sessionsProjectsCache.value = projects;
          sessionsProjectsCache.fetchedAt = Date.now();
          _projectsEtag = `"${sessionsProjectsCacheGeneration.toString(36)}-${sessionsProjectsCache.fetchedAt.toString(36)}"`;
        }
        // Kick off background enrichment (diff stats + git status)
        _scheduleEnrichment(projects);
        return projects;
      })
      .finally(() => {
        sessionsProjectsCache.inFlight = null;
      });

    return sessionsProjectsCache.inFlight;
  }

  async function handleSessions(req, res, url) {
    // GET /sessions
    if (req.method === 'GET' && url.pathname === '/sessions') {
      try {
        const sessions = await enumerateSessions();
        json(res, { sessions });
      } catch (err) {
        json(res, { sessions: [], error: err.message });
      }
      return true;
    }

    // GET /sessions/projects
    if (req.method === 'GET' && url.pathname === '/sessions/projects') {
      try {
        // Filesystem is the source of truth for live/pre-turn visibility.
        const source = url.searchParams.get('source');
        const useDb = source === 'db' && isDbSpineEnabled();
        const projects = useDb
          ? await getProjectsFromDb(enumerateProjectsWithSessions)
          : await getProjectsWithSessionsCached();
        if (_projectsEtag && req.headers['if-none-match'] === _projectsEtag) {
          res.writeHead(304, { 'Access-Control-Allow-Origin': '*' });
          res.end();
          return true;
        }
        res.writeHead(200, {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*',
          'ETag': _projectsEtag,
        });
        res.end(JSON.stringify({ projects }));
      } catch (err) {
        json(res, { projects: [], error: err.message });
      }
      return true;
    }

    // GET /sessions/search?q=...&limit=20&provider=claude|codex
    if (req.method === 'GET' && url.pathname === '/sessions/search') {
      const q = (url.searchParams.get('q') || '').trim();
      if (!q) {
        json(res, { results: [] });
        return true;
      }

      const limitRaw = Number.parseInt(url.searchParams.get('limit') || '20', 10);
      const limit = Number.isFinite(limitRaw) ? limitRaw : 20;
      const providerRaw = (url.searchParams.get('provider') || '').trim();
      const provider = ['claude', 'codex', 'gemini', 'ollama'].includes(providerRaw) ? providerRaw : undefined;

      const db = resolveDb ? resolveDb() : null;
      if (!db) {
        json(res, { results: [] });
        return true;
      }

      try {
        const results = searchSessionsInDb(db, q, { limit, provider });
        json(res, { results });
      } catch (err) {
        error(res, err?.message || 'Search failed', 500);
      }
      return true;
    }

    // GET /sessions/:id/messages?count=N&cursor=X (turn-based). Legacy tail is translated; before is rejected.
    const msgMatch = url.pathname.match(/^\/sessions\/([^/]+)\/messages$/);
    if (req.method === 'GET' && msgMatch) {
      const sessionId = decodeURIComponent(msgMatch[1]);
      const tailParam = url.searchParams.get('tail');
      const beforeParam = url.searchParams.get('before');
      const countParam = url.searchParams.get('count');
      const cursorParam = url.searchParams.get('cursor');
      const paginationOpts = {};
      if (tailParam) paginationOpts.tail = parseInt(tailParam, 10);
      if (beforeParam) paginationOpts.before = parseInt(beforeParam, 10);
      if (countParam) paginationOpts.count = parseInt(countParam, 10);
      if (cursorParam) paginationOpts.cursor = cursorParam;
      try {
        const useDbMessages = process.env.RUDI_DB_MESSAGES !== '0';
        let result;

        if (useDbMessages) {
          result = await readSessionMessagesFromDb(sessionId, paginationOpts, { resolveDb });

          // If DB has not caught up for this session yet, run an on-demand ingest and retry once.
          const needsWarmup = (!paginationOpts.cursor)
            && ((result.messages?.length || 0) === 0)
            && ((result.totalTurns || 0) === 0);
          if (needsWarmup) {
            const found = await findSessionFileEntry(sessionId, { resolveDb });
            if (found?.filePath) {
              await ingestSessionFile(found.filePath, { provider: found.provider, sessionId });
              result = await readSessionMessagesFromDb(sessionId, paginationOpts, { resolveDb });
            }
          }
          if ((!paginationOpts.cursor)
            && ((result.messages?.length || 0) === 0)
            && ((result.totalTurns || 0) === 0)
          ) {
            log('sessions', 'debug', 'DB messages empty on initial page after warmup', {
              sessionId: sessionId.slice(0, 8),
            });
          }
        } else {
          // Emergency fallback: full-load JSONL + slice pagination
          result = await readSessionMessagesPaginated(sessionId, paginationOpts, { resolveDb });
        }
        const { messages, byteOffset, filePath } = result;
        const provider = result.provider || 'claude';
        const usage = result.usage;

        // Calculate cost from model pricing if no result-event cost
        if (usage && !usage.totalCostUsd && usage.model) {
          try {
            const db = resolveDb ? resolveDb() : null;
            if (db) {
              const pricing = db.prepare(`
                SELECT input_cost_per_mtok, output_cost_per_mtok, cache_read_cost_per_mtok
                FROM model_pricing
                WHERE provider = ?
                  AND (model_pattern = ? OR ? LIKE model_pattern)
                  AND (effective_until IS NULL OR effective_until > datetime('now'))
                ORDER BY CASE WHEN model_pattern = ? THEN 0 ELSE 1 END,
                  LENGTH(model_pattern) DESC LIMIT 1
              `).get(provider, usage.model, usage.model, usage.model);
              if (pricing) {
                const cost =
                  (usage.totalInputTokens * pricing.input_cost_per_mtok +
                   usage.totalOutputTokens * pricing.output_cost_per_mtok +
                   usage.totalCacheReadTokens * (pricing.cache_read_cost_per_mtok || 0)) / 1_000_000;
                if (cost > 0) usage.totalCostUsd = cost;
              }
            }
          } catch {
            // Non-fatal
          }
        }

        // Build response — turn-based pagination fields only
        const response = {
          messages,
          byteOffset,
          usage,
          hasMore: result.hasMore,
        };
        if (result.nextCursor !== undefined) response.nextCursor = result.nextCursor;
        if (result.totalTurns !== undefined) response.totalTurns = result.totalTurns;

        json(res, response);

        // Lazy DB backfill: if we extracted usage and no DB row exists, create one
        if (usage) {
          try {
            const db = resolveDb ? resolveDb() : null;
            if (db) {
              const existing = db.prepare(
                'SELECT id FROM sessions WHERE provider = ? AND (provider_session_id = ? OR id = ?)'
              ).get(provider, sessionId, sessionId);
              if (!existing) {
                const now = new Date().toISOString();
                db.prepare(`
                  INSERT OR IGNORE INTO sessions
                    (id, provider, provider_session_id, origin, origin_native_file,
                     model, cwd, project_path, status, created_at, last_active_at,
                     turn_count, total_cost, total_input_tokens, total_output_tokens)
                  VALUES (?, ?, ?, 'provider-import', ?,
                     ?, ?, ?, 'active', ?, ?,
                     ?, ?, ?, ?)
                `).run(
                  sessionId, provider, sessionId, filePath,
                  usage.model, usage.cwd, usage.cwd,
                  usage.createdAt || now, usage.lastActiveAt || now,
                  usage.turnCount, usage.totalCostUsd || 0,
                  usage.totalInputTokens, usage.totalOutputTokens,
                );
                log('sessions', 'info', 'lazy backfill: created DB row', { sessionId: sessionId.slice(0, 8) });
              }
            }
          } catch (dbErr) {
            // Non-fatal — don't break message loading
            log('sessions', 'warn', 'lazy backfill failed', { error: dbErr.message });
          }
        }
      } catch (err) {
        const message = err?.message || String(err);
        const status = /invalid cursor|no longer supported/i.test(message)
          ? 400
          : (/database not available/i.test(message) ? 503 : 404);
        error(res, message, status);
      }
      return true;
    }

    // GET /sessions/:id/diffs
    const diffMatch = url.pathname.match(/^\/sessions\/([^/]+)\/diffs$/);
    if (req.method === 'GET' && diffMatch) {
      const sessionId = decodeURIComponent(diffMatch[1]);
      try {
        const diffs = await readSessionDiffs(sessionId, { resolveDb });
        json(res, { diffs });
      } catch (err) {
        error(res, err.message, 404);
      }
      return true;
    }

    // POST /sessions/:id/title — set a user-chosen title (title_override)
    const titleMatch = url.pathname.match(/^\/sessions\/([^/]+)\/title$/);
    if (req.method === 'POST' && titleMatch) {
      const sessionId = decodeURIComponent(titleMatch[1]);
      const body = await readBody(req);
      const title = typeof body.title === 'string' ? body.title.trim() : '';
      if (!title) return error(res, 'title required');

      const db = resolveDb ? resolveDb() : null;
      if (!db) {
        // DB not available — still return OK so localStorage write isn't blocked
        json(res, { ok: true, title });
        return true;
      }

      try {
        const now = new Date().toISOString();
        const found = await findSessionFileEntry(sessionId, { resolveDb });
        const provider = found?.provider || 'claude';
        const existing = db.prepare(
          `SELECT id FROM sessions
           WHERE provider = ?
             AND status != 'deleted'
             AND (id = ? OR provider_session_id = ?)
           LIMIT 1`
        ).get(provider, sessionId, sessionId);
        const targetSessionId = existing?.id || sessionId;
        // Ensure session row exists (may be a terminal-originated session with no DB row)
        db.prepare(`
          INSERT OR IGNORE INTO sessions
            (id, provider, provider_session_id, origin, status, created_at, last_active_at)
          VALUES (?, ?, ?, 'provider-import', 'active', ?, ?)
        `).run(targetSessionId, provider, sessionId, now, now);

        db.prepare(`
          UPDATE sessions
          SET title = ?, title_override = ?, title_source = 'user', title_generated_at = ?
          WHERE id = ?
        `).run(title, title, now, targetSessionId);

        json(res, { ok: true, title });
      } catch (err) {
        log('sessions', 'warn', `title update failed: ${err.message}`);
        json(res, { ok: true, title }); // degrade gracefully
      }
      return true;
    }

    return false;
  }

  function cleanup() {
    clearTimeout(sessionsUpdateDebounceTimer);
    clearTimeout(sessionsWatcherRetryTimer);
    sessionsUpdateDebounceTimer = null;
    sessionsWatcherRetryTimer = null;
    pendingSessionsUpdate = null;
    if (sessionsWatcher) {
      try {
        const watcherList = Array.isArray(sessionsWatcher.watchers)
          ? sessionsWatcher.watchers
          : [sessionsWatcher];
        for (const entry of watcherList) {
          try { entry?.watcher?.close(); } catch {}
        }
      } catch {}
      sessionsWatcher = null;
    }
    tailModule.cleanup();
    if (_enrichmentTimer) {
      clearTimeout(_enrichmentTimer);
      _enrichmentTimer = null;
    }
    _lastEnrichmentProjects = null;
    ingesterModule.cleanup();
    dbModule.cleanup();
  }

  return {
    handleSessions,
    getProjectsWithSessionsCached,
    startSessionsWatcher,
    queueSessionsUpdated,
    invalidateSessionsProjectsCache,
    handleWsMessage: tailModule.handleWsMessage,
    handleWsDisconnect: tailModule.handleWsDisconnect,
    cleanup,
    // DB-as-spine
    reconcileSessionsToDb,
    reconcileSessionTurnsToDb,
    backfillSessionTurnsToDb,
    repairNoTextSessionTurnsToDb,
    startPeriodicReconcile,
    startTurnIngestReconcile,
    enableDbSpine,
    isDbSpineEnabled,
    getTurnIngestStats,
    backfillSessionTitles,
    getTitleBackfillStats,
    backfillSessionMetadata,
    getMetadataBackfillStats,
  };
}
