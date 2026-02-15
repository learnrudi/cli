/**
 * Session file discovery — shared lookup, snippet readers, scanners.
 * Orchestrates provider-specific finders and the DB path cache.
 */

import fsp from 'fs/promises';
import path from 'path';
import {
  SESSION_CWD_SCAN_BYTES,
  SESSION_CWD_SCAN_LINES,
  MAX_SESSION_INDEX_SCAN_BYTES,
} from './constants.js';
import { SESSION_FILE_HINTS, cacheSessionFileHint } from './file-hints.js';
import { findClaudeSessionFile } from './providers/claude/discovery.js';
import {
  findCodexSessionFile,
  deriveCodexSessionIdFromFilename,
} from './providers/codex/discovery.js';
import { extractCodexTextBlocks } from './providers/codex/parser.js';

// -------------------------------------------------------------------------
// Shared helpers
// -------------------------------------------------------------------------

/**
 * Recursively scan a directory tree looking for a matching session JSONL.
 * Depth is capped to avoid pathological traversals.
 */
export async function scanDirForSessionFile(baseDir, sessionIdOrMatcher, maxDepth = 4) {
  if (!baseDir || !sessionIdOrMatcher) return null;
  const matcher = typeof sessionIdOrMatcher === 'function'
    ? sessionIdOrMatcher
    : (name) => name === `${sessionIdOrMatcher}.jsonl`;
  const queue = [{ dir: baseDir, depth: 0 }];
  while (queue.length > 0) {
    const { dir, depth } = queue.shift();
    try {
      const entries = await fsp.readdir(dir, { withFileTypes: true });
      for (const entry of entries) {
        const fullPath = path.join(dir, entry.name);
        if (entry.isFile() && matcher(entry.name, fullPath)) return fullPath;
        if (entry.isDirectory() && depth < maxDepth) {
          queue.push({ dir: fullPath, depth: depth + 1 });
        }
      }
    } catch {
      // continue
    }
  }
  return null;
}

/**
 * Collect all .jsonl files under a directory (BFS).
 */
export async function collectJsonlFiles(baseDir, maxDepth = 6) {
  const files = [];
  if (!baseDir) return files;
  const queue = [{ dir: baseDir, depth: 0 }];
  while (queue.length > 0) {
    const { dir, depth } = queue.shift();
    let entries;
    try {
      entries = await fsp.readdir(dir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isFile() && entry.name.endsWith('.jsonl')) {
        files.push(fullPath);
      } else if (entry.isDirectory() && depth < maxDepth) {
        queue.push({ dir: fullPath, depth: depth + 1 });
      }
    }
  }
  return files;
}

// -------------------------------------------------------------------------
// CWD / project path inference
// -------------------------------------------------------------------------

/**
 * Extract the first absolute cwd value from Claude JSONL content.
 * Exported for unit tests.
 */
export function extractSessionCwdFromJsonlChunk(content) {
  if (!content || typeof content !== 'string') return null;

  const lines = content.split('\n').filter(Boolean).slice(0, SESSION_CWD_SCAN_LINES);
  for (const line of lines) {
    try {
      const entry = JSON.parse(line);
      if (typeof entry?.cwd === 'string' && path.isAbsolute(entry.cwd)) {
        return entry.cwd;
      }
      if (typeof entry?.payload?.cwd === 'string' && path.isAbsolute(entry.payload.cwd)) {
        return entry.payload.cwd;
      }
      if (entry?.type === 'session_meta' && typeof entry?.payload?.cwd === 'string' && path.isAbsolute(entry.payload.cwd)) {
        return entry.payload.cwd;
      }
      if (entry?.type === 'turn_context' && typeof entry?.payload?.cwd === 'string' && path.isAbsolute(entry.payload.cwd)) {
        return entry.payload.cwd;
      }
    } catch {
      // Skip malformed lines
    }
  }

  return null;
}

/**
 * Infer project path from session JSONL metadata when sessions-index.json
 * is missing or incomplete.
 */
export async function inferProjectPathFromSessionFile(filePath) {
  if (!filePath) return null;

  let fileHandle;
  try {
    fileHandle = await fsp.open(filePath, 'r');
    const buffer = Buffer.alloc(SESSION_CWD_SCAN_BYTES);
    const { bytesRead } = await fileHandle.read(buffer, 0, buffer.length, 0);
    if (!bytesRead) return null;

    const chunk = buffer.toString('utf-8', 0, bytesRead);
    return extractSessionCwdFromJsonlChunk(chunk);
  } catch {
    return null;
  } finally {
    try {
      await fileHandle?.close();
    } catch {
      // ignore close errors
    }
  }
}

export async function isExistingDirectory(dirPath) {
  if (!dirPath || typeof dirPath !== 'string') return false;
  try {
    const stat = await fsp.stat(dirPath);
    return stat.isDirectory();
  } catch {
    return false;
  }
}

/**
 * Best-effort decode of Claude's encoded project directory name (hyphen-delimited)
 * using the live filesystem. This preserves real folder names containing dashes.
 */
export async function decodeProjectDirFromFilesystem(projDir) {
  if (!projDir || typeof projDir !== 'string') return null;
  const tokens = projDir.split('-').filter(Boolean);
  if (tokens.length < 2) return null;

  const dirEntriesCache = new Map();
  async function getEntries(dirPath) {
    if (dirEntriesCache.has(dirPath)) return dirEntriesCache.get(dirPath);
    try {
      const names = await fsp.readdir(dirPath);
      const set = new Set(names);
      dirEntriesCache.set(dirPath, set);
      return set;
    } catch {
      return null;
    }
  }

  let cursor = path.join(path.sep, tokens[0]);
  if (!await isExistingDirectory(cursor)) {
    if (/^[A-Za-z]:$/.test(tokens[0])) {
      cursor = `${tokens[0]}\\`;
      if (!await isExistingDirectory(cursor)) return null;
    } else {
      return null;
    }
  }

  let index = 1;
  while (index < tokens.length) {
    const entries = await getEntries(cursor);
    if (!entries) return null;

    let matchedName = null;
    let matchedEnd = -1;
    for (let end = tokens.length; end > index; end -= 1) {
      const candidate = tokens.slice(index, end).join('-');
      if (entries.has(candidate)) {
        matchedName = candidate;
        matchedEnd = end;
        break;
      }
    }

    if (!matchedName) {
      const single = tokens[index];
      if (!entries.has(single)) return null;
      matchedName = single;
      matchedEnd = index + 1;
    }

    cursor = path.join(cursor, matchedName);
    index = matchedEnd;

    if (index < tokens.length && !await isExistingDirectory(cursor)) {
      return null;
    }
  }

  return cursor;
}

// -------------------------------------------------------------------------
// Snippet / metadata reader
// -------------------------------------------------------------------------

/**
 * Read first prompt + lightweight metadata from a session JSONL file.
 * Reads only the first ~64KB to stay fast.
 */
export async function readSessionSnippet(filePath, provider = 'claude') {
  let firstPrompt = '';
  let gitBranch = '';
  let cwd = '';
  let model = '';
  let providerSessionId = '';
  try {
    const fd = await fsp.open(filePath, 'r');
    const stream = fd.createReadStream({ encoding: 'utf-8', start: 0, end: MAX_SESSION_INDEX_SCAN_BYTES });
    let buf = '';
    for await (const chunk of stream) {
      buf += chunk;
    }
    await fd.close();
    const lines = buf.split('\n');
    for (const line of lines) {
      if (!line.trim()) continue;
      let obj;
      try { obj = JSON.parse(line); } catch { continue; }

      if (!cwd && typeof obj?.cwd === 'string' && path.isAbsolute(obj.cwd)) cwd = obj.cwd;
      if (!cwd && typeof obj?.payload?.cwd === 'string' && path.isAbsolute(obj.payload.cwd)) cwd = obj.payload.cwd;
      if (!model && typeof obj?.message?.model === 'string') model = obj.message.model;
      if (!model && typeof obj?.model === 'string') model = obj.model;
      if (!model && typeof obj?.payload?.model === 'string') model = obj.payload.model;
      if (
        provider === 'codex'
        && !providerSessionId
        && obj?.type === 'session_meta'
        && typeof obj?.payload?.id === 'string'
      ) {
        providerSessionId = obj.payload.id;
      }

      if (provider === 'claude') {
        if (obj.gitBranch && !gitBranch) {
          gitBranch = obj.gitBranch;
        }
        if (obj.type === 'user' && !firstPrompt) {
          const msg = obj.message;
          let text = '';
          if (typeof msg === 'string') {
            text = msg;
          } else if (msg && typeof msg === 'object') {
            const content = msg.content;
            if (typeof content === 'string') {
              text = content;
            } else if (Array.isArray(content)) {
              for (const block of content) {
                if (block && block.type === 'text' && block.text) {
                  text = block.text;
                  break;
                }
              }
            }
          }
          if (text && !text.startsWith('[Request interrupted') && text.trim().length > 0) {
            firstPrompt = text.slice(0, 200);
          }
        }
      } else if (provider === 'codex' && !firstPrompt) {
        if (obj?.type === 'event_msg' && obj?.payload?.type === 'user_message' && typeof obj?.payload?.message === 'string') {
          firstPrompt = obj.payload.message.trim().slice(0, 200);
        } else if (
          obj?.type === 'response_item'
          && obj?.payload?.type === 'message'
          && obj?.payload?.role === 'user'
        ) {
          const text = extractCodexTextBlocks(obj.payload.content);
          if (text) firstPrompt = text.slice(0, 200);
        }
      }

      if (firstPrompt && (provider !== 'claude' || gitBranch) && cwd && model) {
        break;
      }
    }
  } catch {
    // Ignore read errors
  }
  if (provider === 'codex' && !providerSessionId) {
    providerSessionId = deriveCodexSessionIdFromFilename(filePath);
  }
  return { firstPrompt, gitBranch, cwd, model, providerSessionId };
}

// -------------------------------------------------------------------------
// DB-assisted file lookup
// -------------------------------------------------------------------------

export function resolveLookupDb(lookup = {}) {
  if (lookup?.db) return lookup.db;
  if (typeof lookup?.resolveDb !== 'function') return null;
  try {
    return lookup.resolveDb();
  } catch {
    return null;
  }
}

export async function findSessionFileFromDb(sessionId, lookup = {}) {
  const db = resolveLookupDb(lookup);
  if (!db || !sessionId) return null;

  let row;
  try {
    row = db.prepare(`
      SELECT id, provider, provider_session_id, origin_native_file
      FROM sessions
      WHERE status != 'deleted'
        AND origin_native_file IS NOT NULL
        AND (id = ? OR provider_session_id = ?)
      ORDER BY CASE WHEN id = ? THEN 0 ELSE 1 END,
               datetime(last_active_at) DESC
      LIMIT 1
    `).get(sessionId, sessionId, sessionId);
  } catch {
    return null;
  }

  if (!row?.origin_native_file) return null;
  try {
    await fsp.access(row.origin_native_file);
  } catch {
    return null;
  }

  const provider = row.provider || 'claude';
  cacheSessionFileHint(sessionId, provider, row.origin_native_file);
  if (row.id && row.id !== sessionId) {
    cacheSessionFileHint(row.id, provider, row.origin_native_file);
  }
  if (row.provider_session_id && row.provider_session_id !== sessionId) {
    cacheSessionFileHint(row.provider_session_id, provider, row.origin_native_file);
  }

  return { provider, filePath: row.origin_native_file };
}

// -------------------------------------------------------------------------
// Master orchestrator: hint → DB → Claude → Codex
// -------------------------------------------------------------------------

/**
 * Find native session file + provider.
 */
export async function findSessionFileEntry(sessionId, lookup = {}) {
  if (!sessionId) return null;

  const hint = SESSION_FILE_HINTS.get(sessionId);
  if (hint?.filePath) {
    try {
      await fsp.access(hint.filePath);
      return { provider: hint.provider, filePath: hint.filePath };
    } catch {
      SESSION_FILE_HINTS.delete(sessionId);
    }
  }

  const dbHit = await findSessionFileFromDb(sessionId, lookup);
  if (dbHit) return dbHit;

  const claudePath = await findClaudeSessionFile(sessionId);
  if (claudePath) return { provider: 'claude', filePath: claudePath };

  const codexPath = await findCodexSessionFile(sessionId, { scanDirForSessionFile, collectJsonlFiles });
  if (codexPath) return { provider: 'codex', filePath: codexPath };

  return null;
}
