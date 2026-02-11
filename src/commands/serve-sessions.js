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
  const messages = parseSessionMessagesFromJsonl(content);
  const byteOffset = Buffer.byteLength(content, 'utf-8');

  // Extract usage stats from raw JSONL lines
  const usage = extractUsageFromJsonl(content);

  return { messages, byteOffset, usage, filePath };
}

/**
 * Read session messages with pagination support.
 * Returns a tail window of parsed messages plus a cursor for loading older pages.
 * If no pagination params are given, falls back to full load.
 */
async function readSessionMessagesPaginated(sessionId, { tail, before } = {}) {
  const filePath = await findSessionFile(sessionId);
  if (!filePath) {
    throw new Error(`Session not found: ${sessionId}`);
  }

  const content = await fsp.readFile(filePath, 'utf-8');
  const rawLines = content.split('\n').filter(Boolean);
  const totalCount = rawLines.length;
  const byteOffset = Buffer.byteLength(content, 'utf-8');

  // If no pagination requested, return full result (backward compat)
  if (!tail && before === undefined) {
    const messages = parseSessionMessagesFromJsonl(content);
    const usage = extractUsageFromJsonl(content);
    return { messages, byteOffset, usage, filePath, totalCount };
  }

  // Determine line range: we want `tail` lines ending at `before` (exclusive)
  const endLine = before !== undefined ? Math.min(before, totalCount) : totalCount;
  const pageSize = tail || 50;
  const startLine = Math.max(0, endLine - pageSize);

  // Extract the subset of lines
  const subset = rawLines.slice(startLine, endLine);
  const subsetContent = subset.join('\n');
  const messages = parseSessionMessagesFromJsonl(subsetContent);

  // Build cursor and hasMore
  const hasMore = startLine > 0;
  const beforeCursor = startLine;

  // Extract usage only on full load (first page from bottom)
  const usage = before === undefined ? extractUsageFromJsonl(content) : null;

  return {
    messages,
    byteOffset,
    usage,
    filePath,
    before: beforeCursor,
    hasMore,
    totalCount,
  };
}

/**
 * Walk raw JSONL lines and sum token usage from message.usage fields.
 * Also counts turns (user→assistant transitions).
 */
function extractUsageFromJsonl(content) {
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

    const role = getSessionEntryRole(entry);
    const usage = entry?.message?.usage;

    // Capture metadata from first entries
    if (!createdAt && entry.timestamp) createdAt = entry.timestamp;
    if (entry.timestamp) lastActiveAt = entry.timestamp;
    if (!model && entry.message?.model) model = entry.message.model;
    if (!cwd && entry.cwd) cwd = entry.cwd;

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

  if (totalInputTokens === 0 && totalOutputTokens === 0) return null;
  return {
    totalInputTokens, totalOutputTokens, totalCacheReadTokens, turnCount,
    totalCostUsd: totalCostUsd || undefined,
    model, createdAt, lastActiveAt, cwd,
  };
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
    if (currentAssistant.contentBlocks.length > 0) {
      msg.contentBlocks = currentAssistant.contentBlocks;
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
          contentBlocks: [],
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
              // Merge consecutive text blocks
              const lastBlock = currentAssistant.contentBlocks[currentAssistant.contentBlocks.length - 1];
              if (lastBlock && lastBlock.type === 'text') {
                lastBlock.text += '\n' + text;
              } else {
                currentAssistant.contentBlocks.push({ type: 'text', text });
              }
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
            const idx = currentAssistant.toolCalls.length;
            currentAssistant.pendingToolIds.set(block.id, idx);
            currentAssistant.toolCalls.push(toolCall);
            currentAssistant.contentBlocks.push({ type: 'tool', toolIndex: idx });
          }
        }
      } else {
        const text = extractContent(entry);
        if (text) {
          if (currentAssistant.content) currentAssistant.content += '\n';
          currentAssistant.content += text;
          const lastBlock = currentAssistant.contentBlocks[currentAssistant.contentBlocks.length - 1];
          if (lastBlock && lastBlock.type === 'text') {
            lastBlock.text += '\n' + text;
          } else {
            currentAssistant.contentBlocks.push({ type: 'text', text });
          }
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

export function createSessionsModule({ log, broadcast, json, error, readBody, getProjectGitStatus, resolveDb }) {
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
  /** @type {Set<string>|null} Accumulated sessionIds across watcher events within debounce window */
  let pendingSessionIds = null;
  let sessionsWatcher = null;

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

        // Parse sessionId and projectDir from JSONL file paths
        // relPath is relative to watchRoot. When watchRoot === CLAUDE_PROJECTS_DIR,
        // relPath looks like "<projectDir>/<sessionId>.jsonl"
        const updateData = {
          source: 'watcher',
          event: eventType,
          path: path.join(watchRoot, relPath),
        };
        const normalized = relPath.replace(/\\/g, '/');
        if (normalized.endsWith('.jsonl')) {
          const parts = normalized.split('/');
          // When watching CLAUDE_PROJECTS_DIR: parts = [projectDir, sessionId.jsonl]
          // When watching CLAUDE_ROOT_DIR: parts = [projects, projectDir, sessionId.jsonl]
          const inProjects = watchRoot === CLAUDE_PROJECTS_DIR;
          const projIdx = inProjects ? 0 : 1; // skip 'projects/' prefix
          if (parts.length > projIdx + 1) {
            updateData.projectDir = parts[projIdx] || null;
            const fname = parts[projIdx + 1];
            if (fname && fname.endsWith('.jsonl')) {
              updateData.sessionId = fname.slice(0, -6); // strip '.jsonl'
            }
          }
        }
        queueSessionsUpdated(updateData);
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
            const STALE_THRESHOLD_MS = 2 * 60 * 1000; // 2 minutes
            const now = Date.now();
            sessions = await Promise.all(index.entries.map(async (entry) => {
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
                  // File may have been deleted
                }
              }
              return {
                sessionId: entry.sessionId,
                summary: entry.summary || '',
                firstPrompt: entry.firstPrompt || '',
                messageCount: entry.messageCount || 0,
                modified,
                created: entry.created || '',
                gitBranch: entry.gitBranch || '',
                fullPath,
                diffStats: null,
              };
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
          // Batch query in chunks of 500 to avoid SQLite variable limit
          const dbMap = new Map();
          for (let i = 0; i < allSessionIds.length; i += 500) {
            const chunk = allSessionIds.slice(i, i + 500);
            const placeholders = chunk.map(() => '?').join(',');
            const rows = db.prepare(`
              SELECT id, title, title_override, total_cost, total_input_tokens, total_output_tokens, turn_count,
                     parent_session_id, is_sidechain, session_type
              FROM sessions WHERE id IN (${placeholders}) AND provider = 'claude'
            `).all(...chunk);
            for (const row of rows) {
              dbMap.set(row.id, row);
            }
          }
          // Attach DB fields to each session entry
          for (const proj of projects) {
            for (const s of proj.sessions) {
              const row = dbMap.get(s.sessionId);
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
          // Prefer the real project's metadata
          existing.path = proj.path;
          existing.gitStatus = proj.gitStatus;
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

    // GET /sessions/:id/messages?tail=N&before=lineIndex
    const msgMatch = url.pathname.match(/^\/sessions\/([^/]+)\/messages$/);
    if (req.method === 'GET' && msgMatch) {
      const sessionId = decodeURIComponent(msgMatch[1]);
      const tailParam = url.searchParams.get('tail');
      const beforeParam = url.searchParams.get('before');
      const paginationOpts = {};
      if (tailParam) paginationOpts.tail = parseInt(tailParam, 10);
      if (beforeParam) paginationOpts.before = parseInt(beforeParam, 10);
      try {
        const result = await readSessionMessagesPaginated(sessionId, paginationOpts);
        const { messages, byteOffset, filePath } = result;
        const usage = result.usage;

        // Calculate cost from model pricing if no result-event cost
        if (usage && !usage.totalCostUsd && usage.model) {
          try {
            const db = resolveDb ? resolveDb() : null;
            if (db) {
              const pricing = db.prepare(`
                SELECT input_cost_per_mtok, output_cost_per_mtok, cache_read_cost_per_mtok
                FROM model_pricing
                WHERE provider = 'claude'
                  AND (model_pattern = ? OR ? LIKE model_pattern)
                  AND (effective_until IS NULL OR effective_until > datetime('now'))
                ORDER BY CASE WHEN model_pattern = ? THEN 0 ELSE 1 END,
                  LENGTH(model_pattern) DESC LIMIT 1
              `).get(usage.model, usage.model, usage.model);
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

        json(res, {
          messages,
          byteOffset,
          usage,
          before: result.before,
          hasMore: result.hasMore,
          totalCount: result.totalCount,
        });

        // Lazy DB backfill: if we extracted usage and no DB row exists, create one
        if (usage) {
          try {
            const db = resolveDb ? resolveDb() : null;
            if (db) {
              const existing = db.prepare(
                'SELECT id FROM sessions WHERE provider_session_id = ?'
              ).get(sessionId);
              if (!existing) {
                const now = new Date().toISOString();
                db.prepare(`
                  INSERT OR IGNORE INTO sessions
                    (id, provider, provider_session_id, origin, origin_native_file,
                     model, cwd, status, created_at, last_active_at,
                     turn_count, total_cost, total_input_tokens, total_output_tokens)
                  VALUES (?, 'claude', ?, 'provider-import', ?,
                     ?, ?, 'active', ?, ?,
                     ?, ?, ?, ?)
                `).run(
                  sessionId, sessionId, filePath,
                  usage.model, usage.cwd,
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
        // Ensure session row exists (may be a terminal-originated session with no DB row)
        db.prepare(`
          INSERT OR IGNORE INTO sessions
            (id, provider, provider_session_id, origin, status, created_at, last_active_at)
          VALUES (?, 'claude', ?, 'provider-import', 'active', ?, ?)
        `).run(sessionId, sessionId, now, now);

        db.prepare(`
          UPDATE sessions SET title_override = ? WHERE id = ?
        `).run(title, sessionId);

        json(res, { ok: true, title });
      } catch (err) {
        log('sessions', 'warn', `title update failed: ${err.message}`);
        json(res, { ok: true, title }); // degrade gracefully
      }
      return true;
    }

    return false;
  }

  // -------------------------------------------------------------------------
  // Live tail — follow/unfollow infrastructure
  // -------------------------------------------------------------------------

  const MAX_FOLLOWED_SESSIONS = 10;
  const TAIL_FALLBACK_INTERVAL_MS = 5000;
  const TAIL_IDLE_TIMEOUT_MS = 5 * 60 * 1000; // 5 minutes no growth → auto-cleanup

  // sessionId → { filePath, byteOffset, partialLine, parserState, subscriberCount, watcher, lastGrowth, tailQueued }
  const followedSessions = new Map();
  // ws → Set<sessionId>
  const clientFollows = new WeakMap();
  let tailFallbackTimer = null;

  function createParserState() {
    return {
      lastAssistantMsg: null,    // for merging consecutive assistant blocks
      pendingToolUses: new Map(), // toolUseId → index in toolCalls array
      // After flushing, we keep a reference to the emitted toolCalls array
      // so tool_results arriving in the next chunk can still update statuses.
      flushedToolCalls: null,
    };
  }

  /**
   * Parse JSONL lines using per-session stateful parser.
   * Mirrors parseSessionMessagesFromJsonl logic but uses persistent state
   * for cross-line assistant merging and tool_result linking.
   */
  function parseJsonlLinesStateful(lines, state) {
    const messages = [];
    const toolUpdates = []; // tool_results that updated already-flushed messages

    function flushAssistant() {
      if (!state.lastAssistantMsg) return;
      const msg = {
        role: 'assistant',
        content: state.lastAssistantMsg.content.trim(),
        timestamp: state.lastAssistantMsg.timestamp,
      };
      if (state.lastAssistantMsg.thinking) {
        msg.thinking = state.lastAssistantMsg.thinking.trim();
      }
      if (state.lastAssistantMsg.toolCalls.length > 0) {
        msg.toolCalls = state.lastAssistantMsg.toolCalls;
        // Keep reference so tool_results in the next chunk can update statuses
        state.flushedToolCalls = state.lastAssistantMsg.toolCalls;
      } else {
        state.flushedToolCalls = null;
      }
      if (state.lastAssistantMsg.contentBlocks && state.lastAssistantMsg.contentBlocks.length > 0) {
        msg.contentBlocks = state.lastAssistantMsg.contentBlocks;
      }
      if (msg.content || msg.thinking || (msg.toolCalls && msg.toolCalls.length > 0)) {
        messages.push(msg);
      }
      state.lastAssistantMsg = null;
      // Don't clear pendingToolUses — tool_results may arrive in the next chunk
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
        if (!state.lastAssistantMsg) {
          state.lastAssistantMsg = {
            content: '',
            thinking: '',
            toolCalls: [],
            contentBlocks: [],
            timestamp: entry.timestamp,
          };
        }

        if (Array.isArray(contentBlocks)) {
          for (const block of contentBlocks) {
            if (!block || typeof block !== 'object') continue;

            if (block.type === 'text' && typeof block.text === 'string') {
              const text = stripSystemXml(block.text);
              if (text) {
                if (state.lastAssistantMsg.content) state.lastAssistantMsg.content += '\n';
                state.lastAssistantMsg.content += text;
                const lastCB = state.lastAssistantMsg.contentBlocks[state.lastAssistantMsg.contentBlocks.length - 1];
                if (lastCB && lastCB.type === 'text') {
                  lastCB.text += '\n' + text;
                } else {
                  state.lastAssistantMsg.contentBlocks.push({ type: 'text', text });
                }
              }
            } else if (block.type === 'thinking' && typeof block.thinking === 'string') {
              const thinking = block.thinking.trim();
              if (thinking) {
                if (state.lastAssistantMsg.thinking) state.lastAssistantMsg.thinking += '\n\n';
                state.lastAssistantMsg.thinking += thinking;
              }
            } else if (block.type === 'tool_use' && block.id && block.name) {
              const toolCall = {
                id: block.id,
                name: block.name,
                input: block.input || {},
                status: 'pending',
              };
              const idx = state.lastAssistantMsg.toolCalls.length;
              state.pendingToolUses.set(block.id, idx);
              state.lastAssistantMsg.toolCalls.push(toolCall);
              state.lastAssistantMsg.contentBlocks.push({ type: 'tool', toolIndex: idx });
            }
          }
        } else {
          const text = extractContent(entry);
          if (text) {
            if (state.lastAssistantMsg.content) state.lastAssistantMsg.content += '\n';
            state.lastAssistantMsg.content += text;
            const lastCB = state.lastAssistantMsg.contentBlocks[state.lastAssistantMsg.contentBlocks.length - 1];
            if (lastCB && lastCB.type === 'text') {
              lastCB.text += '\n' + text;
            } else {
              state.lastAssistantMsg.contentBlocks.push({ type: 'text', text });
            }
          }
        }
      } else if (role === 'user') {
        if (Array.isArray(contentBlocks) && isToolResultOnly(contentBlocks)) {
          // Update tool call statuses — either on the current assistant message
          // or on an already-flushed one (tool_result arrived in a later chunk).
          const isFlushed = !state.lastAssistantMsg && !!state.flushedToolCalls;
          const toolCalls = state.lastAssistantMsg?.toolCalls || state.flushedToolCalls;
          if (toolCalls) {
            for (const block of contentBlocks) {
              const idx = state.pendingToolUses.get(block.tool_use_id);
              if (idx !== undefined) {
                const result = extractToolResultText(block.content);
                const status = block.is_error ? 'error' : 'complete';
                toolCalls[idx].result = result;
                toolCalls[idx].status = status;
                state.pendingToolUses.delete(block.tool_use_id);
                // If updating an already-broadcast message, track the update
                if (isFlushed) {
                  toolUpdates.push({
                    toolUseId: block.tool_use_id,
                    status,
                    result,
                  });
                }
              }
            }
          }
          continue;
        }

        flushAssistant();
        // Real user message — no more tool_results for previous assistant
        state.flushedToolCalls = null;
        state.pendingToolUses.clear();

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

    // Flush remaining assistant message
    flushAssistant();

    return { messages, toolUpdates };
  }

  async function tailSession(entry) {
    if (entry.tailQueued) return;
    entry.tailQueued = true;

    try {
      let stat;
      try {
        stat = await fsp.stat(entry.filePath);
      } catch {
        return;
      }
      if (stat.size <= entry.byteOffset) return;

      const fd = await fsp.open(entry.filePath, 'r');
      try {
        const readLen = stat.size - entry.byteOffset;
        const buf = Buffer.alloc(readLen);
        await fd.read(buf, 0, buf.length, entry.byteOffset);

        const text = entry.partialLine + buf.toString('utf-8');
        const lines = text.split('\n');
        entry.partialLine = lines.pop() || '';
        entry.byteOffset = stat.size - Buffer.byteLength(entry.partialLine, 'utf-8');
        entry.lastGrowth = Date.now();

        const validLines = lines.filter(l => l.trim());
        if (validLines.length > 0) {
          const { messages: newMessages, toolUpdates } = parseJsonlLinesStateful(validLines, entry.parserState);
          if (newMessages.length > 0) {
            broadcast('session:lines-added', {
              sessionId: entry.sessionId,
              messages: newMessages,
            });
          }
          if (toolUpdates.length > 0) {
            broadcast('session:tool-updated', {
              sessionId: entry.sessionId,
              updates: toolUpdates,
            });
          }
        }
      } finally {
        await fd.close();
      }
    } catch (err) {
      log('sessions', 'warn', `tail error for ${entry.sessionId}: ${err.message}`);
    } finally {
      entry.tailQueued = false;
    }
  }

  function startFileWatcher(entry) {
    try {
      entry.watcher = fs.watch(entry.filePath, () => {
        setImmediate(() => tailSession(entry));
      });
      entry.watcher.on('error', () => {
        // File may have been deleted
        if (entry.watcher) {
          try { entry.watcher.close(); } catch {}
          entry.watcher = null;
        }
      });
    } catch (err) {
      log('sessions', 'warn', `failed to watch ${entry.filePath}: ${err.message}`);
    }
  }

  function stopFollowEntry(sessionId) {
    const entry = followedSessions.get(sessionId);
    if (!entry) return;
    if (entry.watcher) {
      try { entry.watcher.close(); } catch {}
    }
    followedSessions.delete(sessionId);
  }

  async function handleSessionFollow(ws, data) {
    const { sessionId, fromOffset } = data || {};
    if (!sessionId || typeof sessionId !== 'string') return;

    // Enforce limit
    if (!followedSessions.has(sessionId) && followedSessions.size >= MAX_FOLLOWED_SESSIONS) {
      log('sessions', 'warn', `follow limit reached (${MAX_FOLLOWED_SESSIONS}), rejecting ${sessionId}`);
      try {
        ws.send(JSON.stringify({
          type: 'session:follow-error',
          data: { sessionId, error: 'max_followed_sessions' },
        }));
      } catch {}
      return;
    }

    // Track client's follows
    if (!clientFollows.has(ws)) {
      clientFollows.set(ws, new Set());
    }
    const clientSet = clientFollows.get(ws);

    if (followedSessions.has(sessionId)) {
      // Already followed — increment subscriber count
      const entry = followedSessions.get(sessionId);
      if (!clientSet.has(sessionId)) {
        entry.subscriberCount++;
        clientSet.add(sessionId);
      }
      log('sessions', 'debug', `follow: existing ${sessionId} (subscribers: ${entry.subscriberCount})`);
      return;
    }

    // New follow — find the JSONL file
    const filePath = await findSessionFile(sessionId);
    if (!filePath) {
      log('sessions', 'warn', `follow: session file not found for ${sessionId}`);
      try {
        ws.send(JSON.stringify({
          type: 'session:follow-error',
          data: { sessionId, error: 'not_found' },
        }));
      } catch {}
      return;
    }

    const entry = {
      sessionId,
      filePath,
      byteOffset: typeof fromOffset === 'number' && fromOffset > 0 ? fromOffset : 0,
      partialLine: '',
      parserState: createParserState(),
      subscriberCount: 1,
      watcher: null,
      lastGrowth: Date.now(),
      tailQueued: false,
    };

    followedSessions.set(sessionId, entry);
    clientSet.add(sessionId);

    // Start file watcher
    startFileWatcher(entry);

    // Ensure fallback timer is running
    if (!tailFallbackTimer) {
      tailFallbackTimer = setInterval(tailFallbackTick, TAIL_FALLBACK_INTERVAL_MS);
    }

    // Initial tail to catch anything between history load and follow
    setImmediate(() => tailSession(entry));

    log('sessions', 'info', `follow: started ${sessionId} from offset ${entry.byteOffset}`);
  }

  function handleSessionUnfollow(ws, data) {
    const { sessionId } = data || {};
    if (!sessionId || typeof sessionId !== 'string') return;

    const clientSet = clientFollows.get(ws);
    if (!clientSet || !clientSet.has(sessionId)) return;
    clientSet.delete(sessionId);

    const entry = followedSessions.get(sessionId);
    if (!entry) return;

    entry.subscriberCount--;
    if (entry.subscriberCount <= 0) {
      stopFollowEntry(sessionId);
      log('sessions', 'info', `unfollow: stopped ${sessionId} (no subscribers)`);
    } else {
      log('sessions', 'debug', `unfollow: ${sessionId} (subscribers: ${entry.subscriberCount})`);
    }

    // Stop fallback timer if no more followed sessions
    if (followedSessions.size === 0 && tailFallbackTimer) {
      clearInterval(tailFallbackTimer);
      tailFallbackTimer = null;
    }
  }

  function handleWsDisconnect(ws) {
    const clientSet = clientFollows.get(ws);
    if (!clientSet) return;

    for (const sessionId of clientSet) {
      const entry = followedSessions.get(sessionId);
      if (!entry) continue;
      entry.subscriberCount--;
      if (entry.subscriberCount <= 0) {
        stopFollowEntry(sessionId);
        log('sessions', 'debug', `ws disconnect: stopped following ${sessionId}`);
      }
    }
    // WeakMap will GC the entry when ws is GC'd

    if (followedSessions.size === 0 && tailFallbackTimer) {
      clearInterval(tailFallbackTimer);
      tailFallbackTimer = null;
    }
  }

  function tailFallbackTick() {
    const now = Date.now();
    for (const [sessionId, entry] of followedSessions) {
      // Auto-cleanup idle sessions
      if (now - entry.lastGrowth > TAIL_IDLE_TIMEOUT_MS) {
        log('sessions', 'info', `idle cleanup: ${sessionId} (no growth for ${TAIL_IDLE_TIMEOUT_MS / 1000}s)`);
        broadcast('session:follow-ended', { sessionId, reason: 'idle' });
        stopFollowEntry(sessionId);
        continue;
      }
      // Fallback tail for missed fs.watch events
      setImmediate(() => tailSession(entry));
    }

    if (followedSessions.size === 0 && tailFallbackTimer) {
      clearInterval(tailFallbackTimer);
      tailFallbackTimer = null;
    }
  }

  /**
   * Handle incoming WS messages for session follow/unfollow.
   * Called from the WS connection handler in serve.js.
   */
  function handleWsMessage(ws, msg) {
    if (!msg || typeof msg !== 'object') return false;
    if (msg.type === 'session:follow') {
      handleSessionFollow(ws, msg);
      return true;
    }
    if (msg.type === 'session:unfollow') {
      handleSessionUnfollow(ws, msg);
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
    // Clean up tail infrastructure
    for (const [, entry] of followedSessions) {
      if (entry.watcher) {
        try { entry.watcher.close(); } catch {}
      }
    }
    followedSessions.clear();
    if (tailFallbackTimer) {
      clearInterval(tailFallbackTimer);
      tailFallbackTimer = null;
    }
  }

  return {
    handleSessions,
    getProjectsWithSessionsCached,
    startSessionsWatcher,
    queueSessionsUpdated,
    invalidateSessionsProjectsCache,
    handleWsMessage,
    handleWsDisconnect,
    cleanup,
  };
}
