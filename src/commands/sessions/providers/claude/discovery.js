/**
 * Claude session file discovery — find Claude JSONL files.
 */

import fsp from 'fs/promises';
import path from 'path';
import { CLAUDE_PROJECTS_DIR } from '../../constants.js';
import { SESSION_FILE_HINTS, cacheSessionFileHint } from '../../file-hints.js';

export async function findClaudeSessionFile(sessionId) {
  const hint = SESSION_FILE_HINTS.get(sessionId);
  if (hint?.provider === 'claude' && hint?.filePath) {
    try {
      await fsp.access(hint.filePath);
      return hint.filePath;
    } catch {
      SESSION_FILE_HINTS.delete(sessionId);
    }
  }

  let projectDirs = [];
  try {
    projectDirs = await fsp.readdir(CLAUDE_PROJECTS_DIR);
  } catch {
    return null;
  }

  for (const projDir of projectDirs) {
    const indexPath = path.join(CLAUDE_PROJECTS_DIR, projDir, 'sessions-index.json');
    try {
      const indexContent = await fsp.readFile(indexPath, 'utf-8');
      const index = JSON.parse(indexContent);
      if (Array.isArray(index.entries)) {
        const entry = index.entries.find(e => e.sessionId === sessionId);
        if (entry?.fullPath) {
          await fsp.access(entry.fullPath);
          cacheSessionFileHint(sessionId, 'claude', entry.fullPath);
          return entry.fullPath;
        }
      }
    } catch {
      // continue
    }
  }

  for (const projDir of projectDirs) {
    const filePath = path.join(CLAUDE_PROJECTS_DIR, projDir, `${sessionId}.jsonl`);
    try {
      await fsp.access(filePath);
      cacheSessionFileHint(sessionId, 'claude', filePath);
      return filePath;
    } catch {
      // continue
    }
  }

  return null;
}
