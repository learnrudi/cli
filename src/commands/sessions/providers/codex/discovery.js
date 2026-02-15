/**
 * Codex session file discovery — find and identify Codex JSONL files.
 */

import fs from 'fs';
import fsp from 'fs/promises';
import path from 'path';
import { createInterface } from 'readline';
import { CODEX_SESSIONS_DIR, UUID_SUFFIX_RE, CODEX_META_SCAN_LINES } from '../../constants.js';
import { SESSION_FILE_HINTS, cacheSessionFileHint } from '../../file-hints.js';

export function deriveCodexSessionIdFromFilename(filePathOrName) {
  const fileName = path.basename(String(filePathOrName || ''));
  if (!fileName) return '';
  const base = fileName.endsWith('.jsonl') ? fileName.slice(0, -6) : fileName;
  const match = base.match(UUID_SUFFIX_RE);
  return match ? match[1] : base;
}

export function isCodexFilenameMatch(fileName, sessionId) {
  if (!fileName || !sessionId || !fileName.endsWith('.jsonl')) return false;
  const base = fileName.slice(0, -6);
  if (base === sessionId) return true;
  if (base.includes(sessionId)) return true;
  return deriveCodexSessionIdFromFilename(fileName) === sessionId;
}

/**
 * Read Codex session metadata from JSONL headers.
 * Uses line-based parsing to avoid truncated JSON when the first line is large.
 */
export async function readCodexSessionMeta(filePath, maxLines = CODEX_META_SCAN_LINES) {
  const meta = {
    sessionId: '',
    cwd: '',
    model: '',
  };
  if (!filePath) return meta;

  let stream = null;
  let rl = null;
  let linesRead = 0;

  try {
    stream = fs.createReadStream(filePath, { encoding: 'utf-8' });
    rl = createInterface({ input: stream, crlfDelay: Infinity });

    for await (const line of rl) {
      linesRead += 1;
      if (!line.trim()) {
        if (linesRead >= maxLines) break;
        continue;
      }

      let obj;
      try {
        obj = JSON.parse(line);
      } catch {
        if (linesRead >= maxLines) break;
        continue;
      }

      if (obj?.type === 'session_meta' && obj?.payload && typeof obj.payload === 'object') {
        if (!meta.sessionId && typeof obj.payload.id === 'string') {
          meta.sessionId = obj.payload.id;
        }
        if (!meta.cwd && typeof obj.payload.cwd === 'string' && path.isAbsolute(obj.payload.cwd)) {
          meta.cwd = obj.payload.cwd;
        }
        if (!meta.model && typeof obj.payload.model === 'string') {
          meta.model = obj.payload.model;
        }
        if (!meta.model && typeof obj.payload.model_provider === 'string') {
          meta.model = obj.payload.model_provider === 'openai' ? 'codex' : obj.payload.model_provider;
        }
      }

      if (obj?.type === 'turn_context' && obj?.payload && typeof obj.payload === 'object') {
        if (!meta.cwd && typeof obj.payload.cwd === 'string' && path.isAbsolute(obj.payload.cwd)) {
          meta.cwd = obj.payload.cwd;
        }
        if (!meta.model && typeof obj.payload.model === 'string') {
          meta.model = obj.payload.model;
        }
      }

      if (meta.sessionId && meta.cwd && meta.model) break;
      if (linesRead >= maxLines) break;
    }
  } catch {
    // Ignore read errors
  } finally {
    try { rl?.close(); } catch {}
    try { stream?.destroy(); } catch {}
  }

  if (!meta.sessionId) {
    meta.sessionId = deriveCodexSessionIdFromFilename(filePath);
  }

  return meta;
}

/**
 * Find a Codex session JSONL file by session ID.
 * Accepts `helpers` to avoid circular dependency with discovery.js.
 */
export async function findCodexSessionFile(sessionId, { scanDirForSessionFile, collectJsonlFiles }) {
  const hint = SESSION_FILE_HINTS.get(sessionId);
  if (hint?.provider === 'codex' && hint?.filePath) {
    try {
      await fsp.access(hint.filePath);
      return hint.filePath;
    } catch {
      SESSION_FILE_HINTS.delete(sessionId);
    }
  }

  const filePath = await scanDirForSessionFile(
    CODEX_SESSIONS_DIR,
    (name) => isCodexFilenameMatch(name, sessionId),
    5,
  );
  if (filePath) {
    cacheSessionFileHint(sessionId, 'codex', filePath);
    return filePath;
  }

  // Slow fallback for cases where the filename doesn't contain the canonical session ID.
  // Match against session_meta.payload.id from file headers.
  try {
    const codexFiles = await collectJsonlFiles(CODEX_SESSIONS_DIR, 5);
    for (const candidate of codexFiles) {
      const meta = await readCodexSessionMeta(candidate, 40);
      if (meta.sessionId === sessionId) {
        cacheSessionFileHint(sessionId, 'codex', candidate);
        return candidate;
      }
    }
  } catch {
    // ignore
  }

  return null;
}
