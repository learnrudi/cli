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
import { execSync } from 'child_process';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const CLAUDE_ROOT_DIR = path.join(os.homedir(), '.claude');
const CLAUDE_PROJECTS_DIR = path.join(CLAUDE_ROOT_DIR, 'projects');
const SESSIONS_UPDATE_DEBOUNCE_MS = 350;
const SESSIONS_WATCH_RETRY_MS = 10000;
const SESSIONS_PROJECTS_CACHE_TTL_MS = 8000;
const SESSION_CWD_SCAN_BYTES = 2 * 1024 * 1024;
const SESSION_CWD_SCAN_LINES = 400;

// ---------------------------------------------------------------------------
// Pure functions — parsing, diff stats, path decoding
// ---------------------------------------------------------------------------

/**
 * Strip known system XML tags injected by Claude CLI from text content.
 * Removes <system-reminder>, <task-notification>, <bash-notification>, etc.
 */
export function stripSystemXml(text) {
  if (!text || typeof text !== 'string') return text;
  return text
    .replace(/<system-reminder>[\s\S]*?<\/system-reminder>/g, '')
    .replace(/<task-notification>[\s\S]*?<\/task-notification>/g, '')
    .replace(/<bash-notification>[\s\S]*?<\/bash-notification>/g, '')
    .trim();
}

export function extractContent(entry) {
  if (typeof entry.message === 'string') return stripSystemXml(entry.message);

  const content = entry?.message?.content;
  if (typeof content === 'string') return stripSystemXml(content);

  if (Array.isArray(content)) {
    const parts = [];
    for (const block of content) {
      if (!block || typeof block !== 'object') continue;

      if ((block.type === 'text' || block.type === 'input_text') && typeof block.text === 'string') {
        const text = block.text.trim();
        if (text) parts.push(text);
        continue;
      }

      if (block.type === 'document') {
        const label = typeof block.title === 'string'
          ? block.title
          : (typeof block.filename === 'string' ? block.filename : '');
        parts.push(label ? `[Document: ${label}]` : '[Document attached]');
        continue;
      }

      if (block.type === 'image') {
        parts.push('[Image attached]');
      }
    }
    return parts.join('\n').trim();
  }

  return '';
}

export function getSessionEntryRole(entry) {
  const messageRole = entry?.message?.role;
  if (messageRole === 'user' || messageRole === 'assistant') {
    return messageRole;
  }

  const type = String(entry?.type || '').toLowerCase();
  if (type === 'user' || type === 'user_turn' || type === 'human' || type === 'human_turn') {
    return 'user';
  }
  if (type === 'assistant' || type === 'assistant_turn') {
    return 'assistant';
  }
  return null;
}

/**
 * Returns true if a user entry's content array contains ONLY tool_result blocks.
 */
export function isToolResultOnly(content) {
  if (!Array.isArray(content)) return false;
  if (content.length === 0) return false;
  return content.every(
    (block) => block && typeof block === 'object' && block.type === 'tool_result'
  );
}

/**
 * Extract text from a tool_result content field.
 * Handles both string content and [{type:"text",text:"..."}] arrays.
 */
export function extractToolResultText(resultContent) {
  let text;
  if (typeof resultContent === 'string') {
    text = resultContent;
  } else if (Array.isArray(resultContent)) {
    text = resultContent
      .filter((b) => b && b.type === 'text' && typeof b.text === 'string')
      .map((b) => b.text)
      .join('\n');
  } else {
    return '';
  }
  return stripSystemXml(text);
}

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
async function inferProjectPathFromSessionFile(filePath) {
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

async function isExistingDirectory(dirPath) {
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
async function decodeProjectDirFromFilesystem(projDir) {
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

/**
 * Read the first real user prompt and git branch from a session JSONL file.
 * Reads only the first ~64KB to stay fast.
 */
async function readSessionSnippet(filePath) {
  let firstPrompt = '';
  let gitBranch = '';
  try {
    const fd = await fsp.open(filePath, 'r');
    const stream = fd.createReadStream({ encoding: 'utf-8', start: 0, end: 65536 });
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
      if (firstPrompt && gitBranch) break;
    }
  } catch {
    // Ignore read errors
  }
  return { firstPrompt, gitBranch };
}

/**
 * Find the JSONL file path for a session ID.
 * First checks sessions-index.json for fullPath, then falls back to direct file lookup.
 */
async function findSessionFile(sessionId) {
  const claudeDir = path.join(os.homedir(), '.claude', 'projects');
  const projectDirs = await fsp.readdir(claudeDir);

  for (const projDir of projectDirs) {
    const indexPath = path.join(claudeDir, projDir, 'sessions-index.json');
    try {
      const indexContent = await fsp.readFile(indexPath, 'utf-8');
      const index = JSON.parse(indexContent);
      if (Array.isArray(index.entries)) {
        const entry = index.entries.find(e => e.sessionId === sessionId);
        if (entry?.fullPath) {
          await fsp.access(entry.fullPath);
          return entry.fullPath;
        }
      }
    } catch {
      // Index doesn't exist or is malformed, continue
    }
  }

  for (const projDir of projectDirs) {
    const filePath = path.join(claudeDir, projDir, `${sessionId}.jsonl`);
    try {
      await fsp.access(filePath);
      return filePath;
    } catch {
      continue;
    }
  }

  return null;
}

async function readSessionMessages(sessionId) {
  const filePath = await findSessionFile(sessionId);
  if (!filePath) {
    throw new Error(`Session not found: ${sessionId}`);
  }

  const content = await fsp.readFile(filePath, 'utf-8');
  return parseSessionMessagesFromJsonl(content);
}

/**
 * Parse Claude JSONL session content into chat messages with full fidelity.
 * Merges consecutive assistant entries into a single turn, attaches tool
 * results from intervening user tool_result entries, and preserves thinking.
 * Exported for unit tests.
 */
export function parseSessionMessagesFromJsonl(content) {
  if (!content || typeof content !== 'string') return [];

  const lines = content.trim().split('\n').filter(Boolean);
  const messages = [];

  let currentAssistant = null;

  function flushAssistant() {
    if (!currentAssistant) return;
    const msg = {
      role: 'assistant',
      content: currentAssistant.content.trim(),
      timestamp: currentAssistant.timestamp,
    };
    if (currentAssistant.thinking) {
      msg.thinking = currentAssistant.thinking.trim();
    }
    if (currentAssistant.toolCalls.length > 0) {
      msg.toolCalls = currentAssistant.toolCalls;
    }
    if (msg.content || msg.thinking || (msg.toolCalls && msg.toolCalls.length > 0)) {
      messages.push(msg);
    }
    currentAssistant = null;
  }

  for (const line of lines) {
    let entry;
    try {
      entry = JSON.parse(line);
    } catch {
      continue;
    }

    const role = getSessionEntryRole(entry);
    if (!role) continue;

    const contentBlocks = entry?.message?.content;

    if (role === 'assistant') {
      if (!currentAssistant) {
        currentAssistant = {
          content: '',
          thinking: '',
          toolCalls: [],
          pendingToolIds: new Map(),
          timestamp: entry.timestamp,
        };
      }

      if (Array.isArray(contentBlocks)) {
        for (const block of contentBlocks) {
          if (!block || typeof block !== 'object') continue;

          if (block.type === 'text' && typeof block.text === 'string') {
            const text = stripSystemXml(block.text);
            if (text) {
              if (currentAssistant.content) currentAssistant.content += '\n';
              currentAssistant.content += text;
            }
          } else if (block.type === 'thinking' && typeof block.thinking === 'string') {
            const thinking = block.thinking.trim();
            if (thinking) {
              if (currentAssistant.thinking) currentAssistant.thinking += '\n\n';
              currentAssistant.thinking += thinking;
            }
          } else if (block.type === 'tool_use' && block.id && block.name) {
            const toolCall = {
              id: block.id,
              name: block.name,
              input: block.input || {},
              status: 'pending',
            };
            currentAssistant.pendingToolIds.set(
              block.id,
              currentAssistant.toolCalls.length
            );
            currentAssistant.toolCalls.push(toolCall);
          }
        }
      } else {
        const text = extractContent(entry);
        if (text) {
          if (currentAssistant.content) currentAssistant.content += '\n';
          currentAssistant.content += text;
        }
      }
    } else if (role === 'user') {
      if (Array.isArray(contentBlocks) && isToolResultOnly(contentBlocks)) {
        if (currentAssistant) {
          for (const block of contentBlocks) {
            const idx = currentAssistant.pendingToolIds.get(block.tool_use_id);
            if (idx !== undefined) {
              currentAssistant.toolCalls[idx].result = extractToolResultText(block.content);
              currentAssistant.toolCalls[idx].status = block.is_error ? 'error' : 'complete';
              currentAssistant.pendingToolIds.delete(block.tool_use_id);
            }
          }
        }
        continue;
      }

      flushAssistant();

      const extracted = extractContent(entry);
      if (extracted) {
        messages.push({
          role: 'user',
          content: extracted,
          timestamp: entry.timestamp,
        });
      }
    }
  }

  flushAssistant();

  return messages;
}

/**
 * Read file diffs from a session's Edit/Write/MultiEdit tool calls.
 * Returns array of { filePath, type, oldContent, newContent }
 */
async function readSessionDiffs(sessionId) {
  const filePath = await findSessionFile(sessionId);
  if (!filePath) {
    throw new Error(`Session not found: ${sessionId}`);
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
  const claudeDir = path.join(os.homedir(), '.claude', 'projects');
  const sessions = [];

  try {
    const projectDirs = await fsp.readdir(claudeDir);
    for (const projDir of projectDirs) {
      const projPath = path.join(claudeDir, projDir);
      const stat = await fsp.stat(projPath);
      if (!stat.isDirectory()) continue;

      const files = await fsp.readdir(projPath);
      for (const file of files) {
        if (!file.endsWith('.jsonl')) continue;
        const sessionId = file.replace('.jsonl', '');
        const filePath = path.join(projPath, file);
        const fstat = await fsp.stat(filePath);

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

  sessions.sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());
  return sessions;
}

export function shouldBroadcastSessionUpdate(watchRoot, relPath) {
  const normalized = String(relPath || '').replace(/\\/g, '/');
  if (!normalized) return false;

  const inProjects = watchRoot === CLAUDE_PROJECTS_DIR
    ? true
    : normalized === 'projects' || normalized.startsWith('projects/');

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

export function createSessionsModule({ log, broadcast, json, error, readBody, getProjectGitStatus }) {
  // Stateful caching
  const sessionsProjectsCache = {
    value: null,
    fetchedAt: 0,
    inFlight: null,
  };
  let sessionsProjectsCacheGeneration = 0;
  let sessionsUpdateDebounceTimer = null;
  let sessionsWatcherRetryTimer = null;
  let pendingSessionsUpdate = null;
  let sessionsWatcher = null;

  function invalidateSessionsProjectsCache() {
    sessionsProjectsCacheGeneration += 1;
    sessionsProjectsCache.value = null;
    sessionsProjectsCache.fetchedAt = 0;
    sessionsProjectsCache.inFlight = null;
  }

  function queueSessionsUpdated(data = {}) {
    invalidateSessionsProjectsCache();
    pendingSessionsUpdate = {
      ...pendingSessionsUpdate,
      ...data,
      ts: new Date().toISOString(),
    };

    clearTimeout(sessionsUpdateDebounceTimer);
    sessionsUpdateDebounceTimer = setTimeout(() => {
      const payload = pendingSessionsUpdate || { source: 'unknown', ts: new Date().toISOString() };
      pendingSessionsUpdate = null;
      sessionsUpdateDebounceTimer = null;
      broadcast('sessions:updated', payload);
    }, SESSIONS_UPDATE_DEBOUNCE_MS);
  }

  function startSessionsWatcher() {
    if (sessionsWatcher) return;

    const watchRoot = fs.existsSync(CLAUDE_PROJECTS_DIR)
      ? CLAUDE_PROJECTS_DIR
      : (fs.existsSync(CLAUDE_ROOT_DIR) ? CLAUDE_ROOT_DIR : null);

    if (!watchRoot) {
      log('sessions', 'debug', 'sessions watcher skipped (Claude directory not found)');
      if (!sessionsWatcherRetryTimer) {
        sessionsWatcherRetryTimer = setTimeout(() => {
          sessionsWatcherRetryTimer = null;
          startSessionsWatcher();
        }, SESSIONS_WATCH_RETRY_MS);
      }
      return;
    }

    try {
      const watcher = fs.watch(watchRoot, { recursive: true }, (eventType, filename) => {
        const relPath = typeof filename === 'string' ? filename : '';
        if (!relPath) {
          queueSessionsUpdated({
            source: 'watcher',
            event: eventType,
            path: watchRoot,
            missingFilename: true,
          });
          return;
        }
        if (!shouldBroadcastSessionUpdate(watchRoot, relPath)) return;
        queueSessionsUpdated({
          source: 'watcher',
          event: eventType,
          path: path.join(watchRoot, relPath),
        });
      });

      sessionsWatcher = { watcher, rootPath: watchRoot };
      log('sessions', 'info', `watching ${watchRoot} for session updates`);
    } catch (err) {
      log('sessions', 'warn', `failed to watch sessions path: ${err.message}`, { watchRoot });
      if (!sessionsWatcherRetryTimer) {
        sessionsWatcherRetryTimer = setTimeout(() => {
          sessionsWatcherRetryTimer = null;
          startSessionsWatcher();
        }, SESSIONS_WATCH_RETRY_MS);
      }
    }
  }

  /**
   * Enumerate projects with their sessions, using sessions-index.json for rich metadata.
   * Falls back to scanning .jsonl files if index is missing/malformed.
   */
  async function enumerateProjectsWithSessions() {
    const claudeDir = path.join(os.homedir(), '.claude', 'projects');
    const projects = [];

    try {
      const projectDirs = await fsp.readdir(claudeDir);

      for (const projDir of projectDirs) {
        const projPath = path.join(claudeDir, projDir);
        const stat = await fsp.stat(projPath);
        if (!stat.isDirectory()) continue;

        let sessions = [];
        let originalPath = null;

        const indexPath = path.join(projPath, 'sessions-index.json');
        try {
          const indexContent = await fsp.readFile(indexPath, 'utf-8');
          const index = JSON.parse(indexContent);
          originalPath = index.originalPath || null;

          if (Array.isArray(index.entries)) {
            sessions = index.entries.map((entry) => ({
              sessionId: entry.sessionId,
              summary: entry.summary || '',
              firstPrompt: entry.firstPrompt || '',
              messageCount: entry.messageCount || 0,
              modified: entry.modified || '',
              created: entry.created || '',
              gitBranch: entry.gitBranch || '',
              fullPath: entry.fullPath || path.join(projPath, `${entry.sessionId}.jsonl`),
              diffStats: null,
            }));
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
                summary: '',
                firstPrompt: snippet.firstPrompt,
                messageCount: 0,
                modified: fstat.mtime.toISOString(),
                created: fstat.birthtime.toISOString(),
                gitBranch: snippet.gitBranch,
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
                summary: '',
                firstPrompt: snippet.firstPrompt,
                messageCount: 0,
                modified: fstat.mtime.toISOString(),
                created: fstat.birthtime.toISOString(),
                gitBranch: snippet.gitBranch,
                fullPath: filePath,
                diffStats: null,
              });
            } catch {
              // Skip files we can't stat
            }
          }
        }

        if (sessions.length === 0) continue;

        sessions.sort((a, b) => new Date(b.modified).getTime() - new Date(a.modified).getTime());

        if (originalPath && !await isExistingDirectory(originalPath)) {
          originalPath = null;
        }

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

        let decodedPath = null;
        if (!originalPath) {
          decodedPath = await decodeProjectDirFromFilesystem(projDir);
        }
        if (!decodedPath) {
          decodedPath = '/' + projDir.replace(/-/g, '/').replace(/^\//, '');
        }

        const displayPath = originalPath || decodedPath;
        const name = path.basename(displayPath);

        const recentCount = Math.min(5, sessions.length);
        for (let i = 0; i < recentCount; i++) {
          const session = sessions[i];
          session.diffStats = computeSessionDiffStats(session.fullPath);
          if (!session.diffStats) {
            session.diffStats = computeGitDiffStats(displayPath, session.created, session.modified);
          }
        }

        const cleanedSessions = sessions.map(({ fullPath, ...rest }) => rest);

        const gitStatus = getProjectGitStatus(displayPath);

        projects.push({
          path: projDir,
          name,
          originalPath: displayPath,
          sessions: cleanedSessions,
          gitStatus,
        });
      }
    } catch {
      // ~/.claude/projects/ may not exist
    }

    projects.sort((a, b) => {
      const aTime = a.sessions[0]?.modified || '';
      const bTime = b.sessions[0]?.modified || '';
      return new Date(bTime).getTime() - new Date(aTime).getTime();
    });

    return projects;
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
        }
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
        const projects = await getProjectsWithSessionsCached();
        json(res, { projects });
      } catch (err) {
        json(res, { projects: [], error: err.message });
      }
      return true;
    }

    // GET /sessions/:id/messages
    const msgMatch = url.pathname.match(/^\/sessions\/([^/]+)\/messages$/);
    if (req.method === 'GET' && msgMatch) {
      const sessionId = decodeURIComponent(msgMatch[1]);
      try {
        const messages = await readSessionMessages(sessionId);
        json(res, { messages });
      } catch (err) {
        error(res, err.message, 404);
      }
      return true;
    }

    // GET /sessions/:id/diffs
    const diffMatch = url.pathname.match(/^\/sessions\/([^/]+)\/diffs$/);
    if (req.method === 'GET' && diffMatch) {
      const sessionId = decodeURIComponent(diffMatch[1]);
      try {
        const diffs = await readSessionDiffs(sessionId);
        json(res, { diffs });
      } catch (err) {
        error(res, err.message, 404);
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
        sessionsWatcher.watcher.close();
      } catch {}
      sessionsWatcher = null;
    }
  }

  return {
    handleSessions,
    getProjectsWithSessionsCached,
    startSessionsWatcher,
    queueSessionsUpdated,
    invalidateSessionsProjectsCache,
    cleanup,
  };
}
