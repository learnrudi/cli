/**
 * JSONL -> DB ingester for session turns.
 *
 * Source of truth remains provider JSONL files (WAL). This module tails files,
 * checkpoints byte offsets in `file_positions`, and upserts parsed turns.
 */

import fs from 'fs';
import fsp from 'fs/promises';
import path from 'path';
import crypto from 'crypto';
import {
  CLAUDE_PROJECTS_DIR,
  CODEX_SESSIONS_DIR,
} from './constants.js';
import { collectJsonlFiles, decodeProjectDirFromFilesystem } from './discovery.js';
import { deriveCodexSessionIdFromFilename } from './providers/codex/discovery.js';
import {
  classifyEntry,
  extractContent,
} from './providers/common.js';
import { extractCodexTextBlocks } from './providers/codex/parser.js';
import { parseSessionMessagesFromJsonl } from './providers/registry.js';

const REWIND_BYTES = 256 * 1024;
const DEFAULT_RECONCILE_INTERVAL_MS = 60_000;
const MAX_ERROR_HISTORY = 100;

// ---------------------------------------------------------------------------
// Cost computation from tokens + model_pricing table
// ---------------------------------------------------------------------------

let _pricingCache = null;
let _pricingCacheAge = 0;
const PRICING_CACHE_TTL_MS = 5 * 60_000; // refresh every 5 min

function _getPricingMap(db) {
  const now = Date.now();
  if (_pricingCache && now - _pricingCacheAge < PRICING_CACHE_TTL_MS) return _pricingCache;
  try {
    _pricingCache = db.prepare(`
      SELECT
        provider,
        model_pattern,
        COALESCE(input_cost_per_mtok, 0) as input_cost,
        COALESCE(output_cost_per_mtok, 0) as output_cost,
        COALESCE(cache_read_cost_per_mtok, 0) as cache_read_cost,
        COALESCE(cache_write_cost_per_mtok, 0) as cache_write_cost
      FROM model_pricing
      ORDER BY (provider IS NOT NULL) DESC, LENGTH(model_pattern) DESC, effective_from DESC
    `).all();
    _pricingCacheAge = now;
  } catch {
    _pricingCache = _pricingCache || [];
  }
  return _pricingCache;
}

function _computeCost(pricing, provider, model, inputTokens, outputTokens, cacheReadTokens, cacheCreationTokens) {
  if (!model || (!inputTokens && !outputTokens && !cacheReadTokens && !cacheCreationTokens)) return null;
  const entry = pricing.find(p => {
    if (p.provider !== null && p.provider !== provider) return false;
    const re = new RegExp('^' + p.model_pattern.replace(/%/g, '.*').replace(/_/g, '.') + '$');
    return re.test(model);
  });
  if (!entry) return null;
  // inputTokens already includes cacheReadTokens + cacheCreationTokens (accumulated in _extractRawMetadata)
  // Subtract cache tokens to get base input, then price each component at its own rate
  const baseInput = Math.max((inputTokens || 0) - (cacheReadTokens || 0) - (cacheCreationTokens || 0), 0);
  return (
    baseInput * entry.input_cost / 1_000_000 +
    (outputTokens || 0) * entry.output_cost / 1_000_000 +
    (cacheReadTokens || 0) * entry.cache_read_cost / 1_000_000 +
    (cacheCreationTokens || 0) * entry.cache_write_cost / 1_000_000
  );
}

// ---------------------------------------------------------------------------
// Tool call normalization: native name → canonical name + file_path extraction
// ---------------------------------------------------------------------------

const CANONICAL_TOOL_NAMES = {
  claude: {
    Read: 'file_read', Edit: 'file_edit', Write: 'file_write', NotebookEdit: 'notebook_edit',
    Grep: 'search_content', Glob: 'search_files',
    Bash: 'shell',
    WebFetch: 'web_fetch', WebSearch: 'web_search',
    LSP: 'lsp',
    Task: 'agent_spawn', AskUserQuestion: 'ask_user',
  },
  codex: {
    file_read: 'file_read', file_edit: 'file_edit', file_write: 'file_write',
    apply_patch: 'file_edit',
    shell: 'shell', exec_command: 'shell', shell_command: 'shell', write_stdin: 'shell',
    grep: 'search_content', glob: 'search_files',
  },
  gemini: {
    read_file: 'file_read', edit_file: 'file_edit', create_file: 'file_write',
    run_terminal_command: 'shell', search_files: 'search_content', list_files: 'search_files',
  },
};

// Keys in tool input that hold a file path, per provider
const FILE_PATH_KEYS = {
  claude: { Read: 'file_path', Edit: 'file_path', Write: 'file_path', NotebookEdit: 'notebook_path', Grep: 'path', LSP: 'filePath' },
  codex: { file_read: 'path', file_edit: 'path', file_write: 'path' },
  gemini: { read_file: 'target_file', edit_file: 'target_file', create_file: 'target_file' },
};

function _resolveCanonical(provider, toolName) {
  return CANONICAL_TOOL_NAMES[provider]?.[toolName] || 'mcp';
}

function _extractFilePath(provider, toolName, input) {
  const key = FILE_PATH_KEYS[provider]?.[toolName];
  let filePath = null;
  let inputPreview = null;

  if (key && input) {
    const v = input[key];
    if (typeof v === 'string') filePath = v;
  }

  if (input) {
    if (toolName === 'Bash' && typeof input.command === 'string') {
      inputPreview = input.command.slice(0, 300);
    } else if (toolName === 'Grep' && typeof input.pattern === 'string') {
      inputPreview = input.pattern.slice(0, 300);
    } else if (toolName === 'Glob' && typeof input.pattern === 'string') {
      inputPreview = input.pattern.slice(0, 300);
    }
  }

  return { filePath, inputPreview };
}

function _toIso(v) {
  if (!v) return new Date().toISOString();
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? new Date().toISOString() : d.toISOString();
}

function _shortSid(sessionId) {
  return typeof sessionId === 'string' ? sessionId.slice(0, 8) : 'unknown';
}

function _inferProvider(filePath, providerHint) {
  if (providerHint === 'codex' || providerHint === 'claude') return providerHint;
  const normalized = String(filePath || '').replace(/\\/g, '/').toLowerCase();
  if (normalized.includes('/.codex/sessions/')) return 'codex';
  return 'claude';
}

function _deriveSessionId(filePath, provider, sessionIdHint) {
  if (sessionIdHint && typeof sessionIdHint === 'string') return sessionIdHint;
  const filename = path.basename(filePath || '');
  if (!filename.endsWith('.jsonl')) return null;
  if (provider === 'codex') {
    return deriveCodexSessionIdFromFilename(filename) || filename.slice(0, -6);
  }
  return filename.slice(0, -6);
}

function _hashTurnId(sessionId, provider, userText, userTimestamp = '') {
  const h = crypto.createHash('sha256');
  h.update(`${sessionId}\x1f${provider}\x1f${userTimestamp || ''}\x1f${userText || ''}`);
  return `${provider}-h-${h.digest('hex').slice(0, 40)}`;
}

function _extractUserTurnKey(entry, provider = 'claude') {
  let text = '';
  if (provider === 'codex') {
    if (entry?.type === 'event_msg' && entry?.payload?.type === 'user_message') {
      text = typeof entry.payload.message === 'string' ? entry.payload.message.trim() : '';
    } else if (entry?.type === 'response_item' && entry?.payload?.type === 'message' && entry?.payload?.role === 'user') {
      text = extractCodexTextBlocks(entry?.payload?.content);
    }
  } else {
    text = extractContent(entry);
  }
  const ts = typeof entry?.timestamp === 'string' ? entry.timestamp : '';
  return `${ts}\x1f${text}`;
}

function _normalizeCompactionMetadata(compaction) {
  if (!compaction || typeof compaction !== 'object') return null;
  const normalized = {
    trigger: typeof compaction.trigger === 'string' ? compaction.trigger : 'unknown',
    preTokens: Number.isFinite(compaction.preTokens ?? compaction.pre_tokens)
      ? Number(compaction.preTokens ?? compaction.pre_tokens)
      : 0,
    tokensSaved: Number.isFinite(compaction.tokensSaved ?? compaction.tokens_saved)
      ? Number(compaction.tokensSaved ?? compaction.tokens_saved)
      : 0,
  };
  const compactedToolIds = compaction.compactedToolIds ?? compaction.compacted_tool_ids;
  if (Array.isArray(compactedToolIds)) {
    normalized.compactedToolIds = compactedToolIds.filter((id) => typeof id === 'string');
  }
  return normalized;
}

function _extractCompactionMetadataFromEntry(entry) {
  const normalized = _normalizeCompactionMetadata(
    entry?.compaction || entry?.microcompactMetadata || entry?.compactMetadata
  );
  if (normalized) return normalized;

  // Claude also emits synthetic compact-summary user entries when context
  // overflows and the session is continued. Preserve that signal.
  if (entry?.isCompactSummary === true) {
    return {
      trigger: 'auto',
      source: 'claude_compact_summary',
      isCompactSummary: true,
    };
  }

  return null;
}

/**
 * Single pass over raw JSONL lines to extract per-turn metadata and optional
 * provider turn IDs keyed by user-turn identity.
 */
function _extractRawMetadata(content, provider) {
  const turnIdByKey = new Map();
  const turnMeta = [];
  if (!content) return { turnIdByKey, turnMeta };

  const lines = content.split('\n');
  let currentMeta = null;
  let codexSessionModel = null;

  const flushCurrent = () => {
    if (currentMeta) turnMeta.push(currentMeta);
    currentMeta = null;
  };

  for (const line of lines) {
    if (!line) continue;
    let entry;
    try {
      entry = JSON.parse(line);
    } catch {
      continue;
    }

    if (provider === 'codex' && (entry?.type === 'turn_context' || entry?.type === 'session_meta')) {
      if (typeof entry?.payload?.model === 'string' && entry.payload.model) {
        codexSessionModel = entry.payload.model;
        if (currentMeta && !currentMeta.model) currentMeta.model = entry.payload.model;
      }
    }

    const cls = classifyEntry(entry, provider);
    if (cls === 'user-turn') {
      flushCurrent();
      const compactMeta = provider === 'claude'
        ? _extractCompactionMetadataFromEntry(entry)
        : null;
      currentMeta = {
        model: provider === 'codex' ? codexSessionModel : null,
        permissionMode: null,
        inputTokens: 0,
        outputTokens: 0,
        cacheReadTokens: 0,
        cacheCreationTokens: 0,
        contextTokens: null,
        serviceTier: null,
        durationMs: null,
        finishReason: null,
        cost: null,
        compactMetadata: compactMeta ? JSON.stringify(compactMeta) : null,
      };

      const key = _extractUserTurnKey(entry, provider);
      let providerTurnId = null;
      if (provider === 'claude') {
        if (typeof entry?.uuid === 'string') providerTurnId = entry.uuid;
        if (typeof entry?.permissionMode === 'string') currentMeta.permissionMode = entry.permissionMode;
      } else {
        providerTurnId = entry?.uuid || entry?.id || entry?.payload?.id || null;
      }
      if (providerTurnId) {
        turnIdByKey.set(key, providerTurnId);
      }
      continue;
    }

    if (!currentMeta) continue;

    if (provider === 'codex') {
      if (!currentMeta.model && typeof entry?.payload?.model === 'string') {
        currentMeta.model = entry.payload.model;
      }
      if (entry?.type === 'event_msg' && entry?.payload?.type === 'token_count' && entry?.payload?.info) {
        const usage = entry.payload.info.last_token_usage || entry.payload.info.total_token_usage || null;
        if (usage) {
          currentMeta.outputTokens += (usage.output_tokens || 0) + (usage.reasoning_output_tokens || 0);
          currentMeta.inputTokens += usage.input_tokens || 0;
          currentMeta.cacheReadTokens += usage.cached_input_tokens || 0;
          const ctxTotal = (usage.input_tokens || 0) + (usage.cached_input_tokens || 0);
          currentMeta.contextTokens = Math.max(currentMeta.contextTokens || 0, ctxTotal);
        }
      }
      if (entry?.type === 'event_msg' && entry?.payload?.type === 'turn_aborted') {
        currentMeta.finishReason = 'aborted';
      }
    } else {
      if (!currentMeta.model && entry?.message?.model) {
        currentMeta.model = entry.message.model;
      }
      const usage = entry?.message?.usage;
      if (usage) {
        currentMeta.outputTokens += usage.output_tokens || 0;
        const cacheRead = usage.cache_read_input_tokens || 0;
        const cacheCreation = usage.cache_creation_input_tokens || 0;
        currentMeta.inputTokens += (usage.input_tokens || 0) + cacheRead + cacheCreation;
        currentMeta.cacheReadTokens += cacheRead;
        currentMeta.cacheCreationTokens += cacheCreation;
        const contextTotal = (usage.input_tokens || 0) + cacheRead + cacheCreation;
        currentMeta.contextTokens = Math.max(currentMeta.contextTokens || 0, contextTotal);
        if (typeof usage.service_tier === 'string') currentMeta.serviceTier = usage.service_tier;
      }
      if (entry?.type === 'system' && entry?.subtype === 'turn_duration' && Number.isFinite(entry?.durationMs)) {
        currentMeta.durationMs = entry.durationMs;
      }
      if (entry?.type === 'result' && typeof entry?.stop_reason === 'string') {
        currentMeta.finishReason = entry.stop_reason;
      }
      if (entry?.type === 'result' && typeof entry?.cost_usd === 'number') {
        currentMeta.cost = entry.cost_usd;
      }
      const compaction = _extractCompactionMetadataFromEntry(entry);
      if (compaction) {
        currentMeta.compactMetadata = JSON.stringify(compaction);
      }
    }
  }

  flushCurrent();
  return { turnIdByKey, turnMeta };
}

function _normalizeToolData(toolCalls, provider) {
  if (!Array.isArray(toolCalls) || toolCalls.length === 0) {
    return { toolsUsed: null, toolResults: null, toolCallRows: [] };
  }
  const toolsUsed = [];
  const toolResults = [];
  const toolCallRows = [];
  for (const tc of toolCalls) {
    if (tc?.name) toolsUsed.push(tc.name);
    if (!tc?.id) continue;
    toolResults.push({
      id: tc.id,
      name: tc.name || null,
      input: tc.input || null,
      status: tc.status || null,
      result: tc.result || null,
    });
    const success = tc.status === 'error' ? 0 : 1;
    const resultStr = typeof tc.result === 'string' ? tc.result : null;
    const inputStr = tc.input ? JSON.stringify(tc.input) : null;
    const extracted = _extractFilePath(provider, tc.name, tc.input);
    toolCallRows.push({
      id: tc.id,
      toolName: tc.name,
      canonicalName: _resolveCanonical(provider, tc.name),
      filePath: extracted.filePath,
      success,
      errorMessage: !success && resultStr ? resultStr.slice(0, 500) : null,
      inputPreview: extracted.inputPreview || (inputStr ? inputStr.slice(0, 300) : null),
      outputPreview: success && resultStr ? resultStr.slice(0, 300) : null,
    });
  }
  return {
    toolsUsed: toolsUsed.length > 0 ? JSON.stringify([...new Set(toolsUsed)]) : null,
    toolResults: toolResults.length > 0 ? JSON.stringify(toolResults) : null,
    toolCallRows,
  };
}

function _pairMessagesIntoTurns(messages, { sessionId, provider, turnIdByKey, turnMeta }) {
  const turns = [];
  let pendingUser = null;
  let turnIdx = 0; // index into turnMeta array

  for (const msg of messages) {
    if (!msg || typeof msg !== 'object') continue;
    if (msg.role === 'user') {
      pendingUser = msg;
      continue;
    }
    if (msg.role !== 'assistant') continue;
    if (!pendingUser) continue;

    const userContent = typeof pendingUser.content === 'string'
      ? pendingUser.content.trim()
      : String(pendingUser.content || '').trim();
    const assistantContent = typeof msg.content === 'string'
      ? msg.content.trim()
      : String(msg.content || '').trim();
    const thinking = typeof msg.thinking === 'string' ? msg.thinking.trim() : null;
    if (!userContent && !assistantContent && !thinking) {
      pendingUser = null;
      turnIdx++;
      continue;
    }

    const key = `${pendingUser.timestamp || ''}\x1f${userContent}`;
    const storedId = turnIdByKey.get(key) || null;
    const providerTurnId = storedId || _hashTurnId(sessionId, provider, userContent, pendingUser.timestamp);
    const toolData = _normalizeToolData(msg.toolCalls, provider);
    const meta = turnMeta[turnIdx] || {};

    turns.push({
      providerTurnId,
      uuid: storedId || null,
      userMessage: userContent || null,
      assistantResponse: assistantContent || null,
      thinking: thinking || null,
      toolsUsed: toolData.toolsUsed,
      toolResults: toolData.toolResults,
      toolCallRows: toolData.toolCallRows,
      ts: _toIso(pendingUser.timestamp || msg.timestamp),
      tsMs: new Date(_toIso(pendingUser.timestamp || msg.timestamp)).getTime(),
      model: meta.model ?? null,
      permissionMode: meta.permissionMode ?? null,
      inputTokens: meta.inputTokens ?? null,
      outputTokens: meta.outputTokens ?? null,
      cacheReadTokens: meta.cacheReadTokens ?? null,
      cacheCreationTokens: meta.cacheCreationTokens ?? null,
      contextTokens: meta.contextTokens ?? null,
      cost: meta.cost ?? null,
      durationMs: meta.durationMs ?? null,
      finishReason: meta.finishReason ?? null,
      compactMetadata: meta.compactMetadata ?? null,
    });

    pendingUser = null;
    turnIdx++;
  }

  return turns;
}

async function _readBufferRange(filePath, startByte, endByte) {
  const len = Math.max(0, endByte - startByte);
  if (len <= 0) return Buffer.alloc(0);
  const fd = await fsp.open(filePath, 'r');
  try {
    const buf = Buffer.alloc(len);
    await fd.read(buf, 0, len, startByte);
    return buf;
  } finally {
    await fd.close();
  }
}

function _extractCompleteChunk(buf) {
  if (!buf || buf.length === 0) {
    return { consumedBytes: 0, text: '' };
  }
  const newlineIdx = buf.lastIndexOf(0x0a);
  if (newlineIdx < 0) {
    return { consumedBytes: 0, text: '' };
  }
  const consumedBytes = newlineIdx + 1;
  const text = buf.subarray(0, consumedBytes).toString('utf-8');
  return { consumedBytes, text };
}

function _getFilePosition(db, filePath) {
  return db.prepare(`
    SELECT file_path, byte_offset, file_size, mtime_ms, inode, provider
    FROM file_positions
    WHERE file_path = ?
  `).get(filePath) || null;
}

function _upsertFilePosition(db, {
  filePath,
  byteOffset,
  fileSize,
  mtimeMs,
  inode,
  provider,
}) {
  const now = new Date().toISOString();
  db.prepare(`
    INSERT INTO file_positions (
      file_path, byte_offset, file_size, mtime_ms, inode, provider, last_synced_at, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(file_path) DO UPDATE SET
      byte_offset = excluded.byte_offset,
      file_size = excluded.file_size,
      mtime_ms = excluded.mtime_ms,
      inode = excluded.inode,
      provider = excluded.provider,
      last_synced_at = excluded.last_synced_at
  `).run(
    filePath,
    byteOffset,
    fileSize,
    mtimeMs,
    inode || null,
    provider,
    now,
    now,
  );
}

async function _extractAgentMeta(text, filePath, provider) {
  if (provider !== 'claude') return null;
  const basename = path.basename(filePath);
  if (!basename.startsWith('agent-')) return null;

  try {
    const lines = text.split('\n');
    const firstLine = lines[0];
    if (!firstLine) return null;
    const header = JSON.parse(firstLine);

    // Extract model from second line (assistant message)
    let model = null;
    for (let i = 1; i < Math.min(lines.length, 5); i++) {
      if (!lines[i]) continue;
      try {
        const entry = JSON.parse(lines[i]);
        if (entry?.message?.model) { model = entry.message.model; break; }
      } catch { /* skip */ }
    }

    // Derive projectPath from filePath
    // Path pattern: ~/.claude/projects/<projDir>/<UUID>/subagents/agent-xxx.jsonl
    let projectPath = null;
    const projMatch = filePath.match(/\.claude\/projects\/([^/]+)\//);
    if (projMatch) {
      projectPath = await decodeProjectDirFromFilesystem(projMatch[1]);
      if (!projectPath) {
        projectPath = '/' + projMatch[1].replace(/-/g, '/').replace(/^\//, '');
      }
    }

    return {
      cwd: header.cwd || null,
      projectPath,
      gitBranch: header.gitBranch || null,
      parentSessionId: header.sessionId || null,
      agentId: header.agentId || null,
      isSidechain: header.isSidechain ? 1 : 0,
      sessionType: 'task',
      model,
    };
  } catch {
    return null;
  }
}

function _ensureSessionRow(db, { sessionId, provider, filePath, agentMeta }) {
  const now = new Date().toISOString();
  if (agentMeta) {
    db.prepare(`
      INSERT INTO sessions
        (id, provider, provider_session_id, origin, origin_native_file,
         cwd, project_path, git_branch, parent_session_id, agent_id,
         is_sidechain, session_type, model, status, created_at, last_active_at)
      VALUES (?, ?, ?, 'provider-import', ?,
              ?, ?, ?, ?, ?,
              ?, ?, ?, 'active', ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        cwd = COALESCE(excluded.cwd, sessions.cwd),
        project_path = COALESCE(excluded.project_path, sessions.project_path),
        git_branch = COALESCE(excluded.git_branch, sessions.git_branch),
        parent_session_id = COALESCE(excluded.parent_session_id, sessions.parent_session_id),
        agent_id = COALESCE(excluded.agent_id, sessions.agent_id),
        is_sidechain = COALESCE(excluded.is_sidechain, sessions.is_sidechain),
        session_type = COALESCE(excluded.session_type, sessions.session_type),
        model = COALESCE(excluded.model, sessions.model),
        origin_native_file = COALESCE(excluded.origin_native_file, sessions.origin_native_file),
        status = 'active'
    `).run(
      sessionId, provider, sessionId, filePath,
      agentMeta.cwd || null, agentMeta.projectPath || null, agentMeta.gitBranch || null,
      agentMeta.parentSessionId || null, agentMeta.agentId || null,
      agentMeta.isSidechain ?? null, agentMeta.sessionType || null, agentMeta.model || null,
      now, now,
    );
  } else {
    db.prepare(`
      INSERT OR IGNORE INTO sessions
        (id, provider, provider_session_id, origin, origin_native_file, status, created_at, last_active_at)
      VALUES (?, ?, ?, 'provider-import', ?, 'active', ?, ?)
    `).run(sessionId, provider, sessionId, filePath, now, now);
  }
}

function _recomputeSessionAggregates(db, sessionId) {
  const agg = db.prepare(`
    SELECT
      COUNT(*) as turn_count,
      COALESCE(SUM(cost), 0) as total_cost,
      COALESCE(SUM(duration_ms), 0) as total_duration_ms,
      COALESCE(SUM(input_tokens), 0) as total_input_tokens,
      COALESCE(SUM(output_tokens), 0) as total_output_tokens,
      MAX(ts) as last_active_at,
      MIN(ts) as first_ts
    FROM turns
    WHERE session_id = ?
  `).get(sessionId);

  db.prepare(`
    UPDATE sessions SET
      turn_count = ?,
      total_cost = ?,
      total_duration_ms = ?,
      total_input_tokens = ?,
      total_output_tokens = ?,
      last_active_at = COALESCE(?, last_active_at),
      started_at = COALESCE(started_at, ?),
      model = COALESCE(model, (SELECT model FROM turns WHERE session_id = ? AND model IS NOT NULL ORDER BY turn_number DESC LIMIT 1))
    WHERE id = ?
  `).run(
    agg?.turn_count || 0,
    agg?.total_cost || 0,
    agg?.total_duration_ms || 0,
    agg?.total_input_tokens || 0,
    agg?.total_output_tokens || 0,
    agg?.last_active_at || null,
    agg?.first_ts || null,
    sessionId,
    sessionId,
  );
}

function _recordError(state, errData) {
  state.errors.push(errData);
  if (state.errors.length > MAX_ERROR_HISTORY) {
    state.errors.splice(0, state.errors.length - MAX_ERROR_HISTORY);
  }
}

export function createSessionsIngesterModule({
  log,
  resolveDb,
  paths = {},
  reconcileIntervalMs = DEFAULT_RECONCILE_INTERVAL_MS,
} = {}) {
  const dirs = {
    claudeProjectsDir: paths.claudeProjectsDir || CLAUDE_PROJECTS_DIR,
    codexSessionsDir: paths.codexSessionsDir || CODEX_SESSIONS_DIR,
  };

  const state = {
    inFlight: new Map(),
    reconcileTimer: null,
    backfillInFlight: null,
    repairInFlight: null,
    totalTurnsAdded: 0,
    totalTurnsUpdated: 0,
    totalFilesIngested: 0,
    lastReconcileAt: null,
    lastBackfillAt: null,
    lastRepairAt: null,
    backfillRuns: 0,
    backfillFilesTotal: 0,
    backfillFilesDone: 0,
    repairRuns: 0,
    repairSessionsTotal: 0,
    repairSessionsDone: 0,
    errors: [],
  };

  async function _collectFiles() {
    const files = [];
    if (fs.existsSync(dirs.claudeProjectsDir)) {
      const claudeFiles = await collectJsonlFiles(dirs.claudeProjectsDir, 4);
      for (const filePath of claudeFiles) {
        files.push({
          filePath,
          provider: 'claude',
          sessionId: path.basename(filePath, '.jsonl'),
        });
      }
    }
    if (fs.existsSync(dirs.codexSessionsDir)) {
      const codexFiles = await collectJsonlFiles(dirs.codexSessionsDir, 6);
      for (const filePath of codexFiles) {
        const fname = path.basename(filePath);
        files.push({
          filePath,
          provider: 'codex',
          sessionId: deriveCodexSessionIdFromFilename(fname) || path.basename(filePath, '.jsonl'),
        });
      }
    }
    return files;
  }

  async function _ingestFile(filePath, options = {}) {
    const db = resolveDb ? resolveDb() : null;
    if (!db) return { skipped: true, reason: 'db_unavailable' };
    if (!filePath || typeof filePath !== 'string' || !filePath.endsWith('.jsonl')) {
      return { skipped: true, reason: 'invalid_file' };
    }

    const provider = _inferProvider(filePath, options.provider);
    const sessionId = _deriveSessionId(filePath, provider, options.sessionId);
    if (!sessionId) return { skipped: true, reason: 'missing_session_id' };
    const forceRebuild = options.forceRebuild === true;

    let stat;
    try {
      stat = await fsp.stat(filePath);
    } catch {
      return { skipped: true, reason: 'stat_failed' };
    }
    if (!stat.isFile()) return { skipped: true, reason: 'not_file' };

    const inode = typeof stat.ino === 'number' ? String(stat.ino) : null;
    const checkpoint = _getFilePosition(db, filePath);
    let startOffset = checkpoint?.byte_offset || 0;
    let reset = false;

    if (forceRebuild) {
      startOffset = 0;
      reset = true;
    } else if (checkpoint) {
      const inodeChanged = !!(checkpoint.inode && inode && checkpoint.inode !== inode);
      const truncated = stat.size < startOffset;
      if (inodeChanged || truncated) {
        startOffset = 0;
        reset = true;
      }
    }

    if (stat.size === 0) {
      const tx = db.transaction(() => {
        _ensureSessionRow(db, { sessionId, provider, filePath });
        if (reset) {
          db.prepare('DELETE FROM turns WHERE session_id = ?').run(sessionId);
          _recomputeSessionAggregates(db, sessionId);
        }
        _upsertFilePosition(db, {
          filePath,
          byteOffset: 0,
          fileSize: 0,
          mtimeMs: stat.mtimeMs,
          inode,
          provider,
        });
      });
      tx();
      return {
        skipped: false,
        filePath,
        sessionId,
        provider,
        turnsAdded: 0,
        turnsUpdated: 0,
        newOffset: 0,
        reset,
      };
    }

    if (!forceRebuild && !reset && checkpoint && stat.size === startOffset) {
      _upsertFilePosition(db, {
        filePath,
        byteOffset: startOffset,
        fileSize: stat.size,
        mtimeMs: stat.mtimeMs,
        inode,
        provider,
      });
      return {
        skipped: true,
        reason: 'no_new_bytes',
        filePath,
        sessionId,
        provider,
      };
    }

    const readStart = startOffset > 0 ? Math.max(0, startOffset - REWIND_BYTES) : 0;
    const rangeBuf = await _readBufferRange(filePath, readStart, stat.size);
    const { consumedBytes, text } = _extractCompleteChunk(rangeBuf);
    const newOffset = readStart + consumedBytes;

    if (!text) {
      _upsertFilePosition(db, {
        filePath,
        byteOffset: startOffset,
        fileSize: stat.size,
        mtimeMs: stat.mtimeMs,
        inode,
        provider,
      });
      return {
        skipped: true,
        reason: 'no_complete_lines',
        filePath,
        sessionId,
        provider,
      };
    }

    const messages = parseSessionMessagesFromJsonl(text, provider);
    const { turnIdByKey, turnMeta } = _extractRawMetadata(text, provider);
    const turns = _pairMessagesIntoTurns(messages, {
      sessionId,
      provider,
      turnIdByKey,
      turnMeta,
    });

    // Extract agent metadata from JSONL header (must happen before transaction)
    const agentMeta = await _extractAgentMeta(text, filePath, provider);

    // Compute cost from tokens + model pricing when not already set
    const pricing = _getPricingMap(db);
    for (const turn of turns) {
      if (turn.cost == null && turn.model && (turn.inputTokens || turn.outputTokens)) {
        turn.cost = _computeCost(
          pricing, provider, turn.model,
          turn.inputTokens, turn.outputTokens,
          turn.cacheReadTokens, turn.cacheCreationTokens,
        );
      }
    }

    let turnsAdded = 0;
    let turnsUpdated = 0;

    const tx = db.transaction(() => {
      _ensureSessionRow(db, { sessionId, provider, filePath, agentMeta });
      if (reset) {
        db.prepare('DELETE FROM tool_calls WHERE session_id = ?').run(sessionId);
        db.prepare('DELETE FROM turns WHERE session_id = ?').run(sessionId);
      }

      const selectExisting = db.prepare(`
        SELECT id, turn_number
        FROM turns
        WHERE session_id = ? AND provider_turn_id = ?
      `);
      const getMaxTurn = db.prepare(`
        SELECT COALESCE(MAX(turn_number), 0) as max_turn
        FROM turns
        WHERE session_id = ?
      `);
      const insertTurn = db.prepare(`
        INSERT INTO turns (
          id, session_id, provider, provider_session_id, provider_turn_id, uuid, turn_number,
          user_message, assistant_response, thinking, model, permission_mode,
          input_tokens, output_tokens, cache_read_tokens, cache_creation_tokens, context_tokens,
          cost, duration_ms, finish_reason,
          tools_used, tool_results, compact_metadata, kind, ts, ts_ms
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'message', ?, ?)
      `);
      const updateTurn = db.prepare(`
        UPDATE turns SET
          user_message = ?,
          assistant_response = ?,
          thinking = ?,
          model = ?,
          permission_mode = ?,
          input_tokens = ?,
          output_tokens = ?,
          cache_read_tokens = ?,
          cache_creation_tokens = ?,
          context_tokens = ?,
          cost = ?,
          duration_ms = ?,
          finish_reason = ?,
          tools_used = ?,
          tool_results = ?,
          compact_metadata = ?,
          uuid = COALESCE(?, uuid),
          ts = ?,
          ts_ms = ?
        WHERE id = ?
      `);

      const insertToolCall = db.prepare(`
        INSERT OR IGNORE INTO tool_calls (id, session_id, turn_id, provider, tool_name, canonical_name, file_path, success, error_message, input_preview, output_preview, ts_ms)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);
      const deleteToolCallsForTurn = db.prepare('DELETE FROM tool_calls WHERE turn_id = ?');

      let nextTurnNumber = Number(getMaxTurn.get(sessionId)?.max_turn || 0) + 1;
      for (const turn of turns) {
        const existing = selectExisting.get(sessionId, turn.providerTurnId);
        let turnId;
        if (existing?.id) {
          turnId = existing.id;
          updateTurn.run(
            turn.userMessage,
            turn.assistantResponse,
            turn.thinking,
            turn.model,
            turn.permissionMode,
            turn.inputTokens,
            turn.outputTokens,
            turn.cacheReadTokens,
            turn.cacheCreationTokens,
            turn.contextTokens,
            turn.cost,
            turn.durationMs,
            turn.finishReason,
            turn.toolsUsed,
            turn.toolResults,
            turn.compactMetadata,
            turn.uuid,
            turn.ts,
            turn.tsMs,
            existing.id,
          );
          // Re-insert tool_calls on update (idempotent via OR IGNORE on id)
          deleteToolCallsForTurn.run(turnId);
          turnsUpdated++;
        } else {
          turnId = crypto.randomUUID();
          insertTurn.run(
            turnId,
            sessionId,
            provider,
            sessionId,
            turn.providerTurnId,
            turn.uuid,
            nextTurnNumber++,
            turn.userMessage,
            turn.assistantResponse,
            turn.thinking,
            turn.model,
            turn.permissionMode,
            turn.inputTokens,
            turn.outputTokens,
            turn.cacheReadTokens,
            turn.cacheCreationTokens,
            turn.contextTokens,
            turn.cost,
            turn.durationMs,
            turn.finishReason,
            turn.toolsUsed,
            turn.toolResults,
            turn.compactMetadata,
            turn.ts,
            turn.tsMs,
          );
          turnsAdded++;
        }

        // Fan out tool_calls rows
        for (const tc of turn.toolCallRows) {
          insertToolCall.run(
            tc.id, sessionId, turnId, provider,
            tc.toolName, tc.canonicalName, tc.filePath, tc.success,
            tc.errorMessage, tc.inputPreview, tc.outputPreview,
            turn.tsMs || 0,
          );
        }
      }

      _upsertFilePosition(db, {
        filePath,
        byteOffset: Math.max(startOffset, Math.min(newOffset, stat.size)),
        fileSize: stat.size,
        mtimeMs: stat.mtimeMs,
        inode,
        provider,
      });
      if (options.recomputeAggregates !== false) {
        _recomputeSessionAggregates(db, sessionId);
      }
    });

    tx();
    if (turnsAdded > 0 || turnsUpdated > 0) {
      state.totalFilesIngested += 1;
      state.totalTurnsAdded += turnsAdded;
      state.totalTurnsUpdated += turnsUpdated;
      log?.('sessions', 'debug', '[ingester.file] ingested', {
        sessionId: _shortSid(sessionId),
        provider,
        turnsAdded,
        turnsUpdated,
        readStart,
        newOffset: Math.max(startOffset, Math.min(newOffset, stat.size)),
      });
    }

    return {
      skipped: false,
      filePath,
      sessionId,
      provider,
      turnsAdded,
      turnsUpdated,
      reset,
      newOffset: Math.max(startOffset, Math.min(newOffset, stat.size)),
    };
  }

  async function repairNoTextTurns({ limit = 0, onProgress } = {}) {
    if (state.repairInFlight) return state.repairInFlight;

    const p = (async () => {
      const db = resolveDb ? resolveDb() : null;
      if (!db) return { skipped: true, reason: 'db_unavailable' };

      const t0 = Date.now();
      let candidates = db.prepare(`
        SELECT
          s.id as session_id,
          s.provider as provider,
          s.origin_native_file as file_path,
          COUNT(*) as no_text_rows
        FROM turns t
        JOIN sessions s ON s.id = t.session_id
        WHERE s.status != 'deleted'
          AND (t.user_message IS NULL OR TRIM(t.user_message) = '')
          AND (t.assistant_response IS NULL OR TRIM(t.assistant_response) = '')
        GROUP BY s.id, s.provider, s.origin_native_file
        ORDER BY no_text_rows DESC
      `).all();

      const normalizedLimit = Number(limit);
      if (Number.isFinite(normalizedLimit) && normalizedLimit > 0) {
        candidates = candidates.slice(0, normalizedLimit);
      }

      state.repairRuns += 1;
      state.repairSessionsTotal = candidates.length;
      state.repairSessionsDone = 0;

      let rebuilt = 0;
      let skipped = 0;
      let remainingNoTextRows = 0;
      let errors = 0;

      for (let i = 0; i < candidates.length; i++) {
        const c = candidates[i];
        if (!c?.file_path) {
          skipped++;
          state.repairSessionsDone = i + 1;
          onProgress?.({ sessionsTotal: candidates.length, sessionsDone: i + 1, rebuilt, skipped });
          continue;
        }

        try {
          const st = await fsp.stat(c.file_path);
          if (!st.isFile()) {
            skipped++;
            state.repairSessionsDone = i + 1;
            onProgress?.({ sessionsTotal: candidates.length, sessionsDone: i + 1, rebuilt, skipped });
            continue;
          }
        } catch {
          skipped++;
          state.repairSessionsDone = i + 1;
          onProgress?.({ sessionsTotal: candidates.length, sessionsDone: i + 1, rebuilt, skipped });
          continue;
        }

        const result = await ingestFile(c.file_path, {
          provider: c.provider || 'claude',
          sessionId: c.session_id,
          forceRebuild: true,
        });

        if (result?.reason === 'error') errors++;
        if (!result?.skipped) rebuilt++;

        const row = db.prepare(`
          SELECT COUNT(*) as c
          FROM turns
          WHERE session_id = ?
            AND (user_message IS NULL OR TRIM(user_message) = '')
            AND (assistant_response IS NULL OR TRIM(assistant_response) = '')
        `).get(c.session_id);
        remainingNoTextRows += Number(row?.c || 0);

        state.repairSessionsDone = i + 1;
        onProgress?.({
          sessionsTotal: candidates.length,
          sessionsDone: i + 1,
          rebuilt,
          skipped,
          remainingNoTextRows,
        });
        if ((i + 1) % 10 === 0) {
          await new Promise((resolve) => setImmediate(resolve));
        }
      }

      state.lastRepairAt = new Date().toISOString();
      const summary = {
        sessionsTotal: candidates.length,
        sessionsDone: candidates.length,
        rebuilt,
        skipped,
        remainingNoTextRows,
        errors,
        durationMs: Date.now() - t0,
      };
      log?.('sessions', 'info', '[ingester.repair] done', summary);
      return summary;
    })()
      .catch((err) => {
        const errData = {
          error: err instanceof Error ? err.message : String(err),
          at: new Date().toISOString(),
        };
        _recordError(state, errData);
        log?.('sessions', 'warn', `[ingester.repair] failed: ${errData.error}`);
        return { skipped: true, reason: 'error', ...errData };
      })
      .finally(() => {
        state.repairInFlight = null;
      });

    state.repairInFlight = p;
    return p;
  }

  async function ingestFile(filePath, options = {}) {
    const key = String(filePath || '');
    if (!key) return { skipped: true, reason: 'invalid_file' };
    if (state.inFlight.has(key)) return state.inFlight.get(key);

    const p = _ingestFile(filePath, options)
      .catch((err) => {
        const errData = {
          filePath,
          provider: options.provider || null,
          sessionId: options.sessionId || null,
          error: err instanceof Error ? err.message : String(err),
          at: new Date().toISOString(),
        };
        _recordError(state, errData);
        log?.('sessions', 'warn', `[ingester.file] failed: ${errData.error}`, errData);
        return { skipped: true, reason: 'error', ...errData };
      })
      .finally(() => {
        state.inFlight.delete(key);
      });

    state.inFlight.set(key, p);
    return p;
  }

  async function reconcileAll() {
    const t0 = Date.now();
    const files = await _collectFiles();
    let filesIngested = 0;
    let turnsAdded = 0;
    let turnsUpdated = 0;
    let errors = 0;

    for (let i = 0; i < files.length; i++) {
      const f = files[i];
      const result = await ingestFile(f.filePath, {
        provider: f.provider,
        sessionId: f.sessionId,
      });
      if (!result?.skipped) {
        filesIngested++;
        turnsAdded += result.turnsAdded || 0;
        turnsUpdated += result.turnsUpdated || 0;
      }
      if (result?.reason === 'error') errors++;
      if ((i + 1) % 10 === 0) {
        await new Promise((resolve) => setImmediate(resolve));
      }
    }

    state.lastReconcileAt = new Date().toISOString();
    log?.('sessions', 'info', '[ingester.reconcile] done', {
      filesScanned: files.length,
      filesIngested,
      turnsAdded,
      turnsUpdated,
      errors,
      durationMs: Date.now() - t0,
    });

    return {
      filesScanned: files.length,
      filesIngested,
      turnsAdded,
      turnsUpdated,
      errors,
      durationMs: Date.now() - t0,
    };
  }

  async function backfillAll({ onProgress } = {}) {
    if (state.backfillInFlight) return state.backfillInFlight;

    const p = (async () => {
      const db = resolveDb ? resolveDb() : null;
      if (!db) return { skipped: true, reason: 'db_unavailable' };

      const t0 = Date.now();
      const discovered = await _collectFiles();
      const withStat = [];
      for (const f of discovered) {
        try {
          const st = await fsp.stat(f.filePath);
          if (!st.isFile()) continue;
          withStat.push({ ...f, size: st.size, mtimeMs: st.mtimeMs });
        } catch {
          // Skip files that vanished mid-scan.
        }
      }
      withStat.sort((a, b) => a.size - b.size);

      let filesDone = 0;
      let filesIngested = 0;
      let filesSkipped = 0;
      let turnsAdded = 0;
      let turnsUpdated = 0;
      let errors = 0;
      const touchedSessions = new Set();

      state.backfillRuns += 1;
      state.backfillFilesTotal = withStat.length;
      state.backfillFilesDone = 0;

      for (let i = 0; i < withStat.length; i++) {
        const f = withStat[i];
        const checkpoint = _getFilePosition(db, f.filePath);
        const alreadySynced = !!checkpoint && checkpoint.byte_offset >= f.size;
        if (alreadySynced) {
          filesSkipped++;
          filesDone++;
          state.backfillFilesDone = filesDone;
          onProgress?.({
            filesTotal: withStat.length,
            filesDone,
            filesIngested,
            turnsIngested: turnsAdded,
          });
          if ((i + 1) % 10 === 0) await new Promise((resolve) => setImmediate(resolve));
          continue;
        }

        const result = await ingestFile(f.filePath, {
          provider: f.provider,
          sessionId: f.sessionId,
          recomputeAggregates: false,
        });

        if (!result?.skipped) {
          filesIngested++;
          turnsAdded += result.turnsAdded || 0;
          turnsUpdated += result.turnsUpdated || 0;
          if (result.sessionId) touchedSessions.add(result.sessionId);
        } else if (result?.reason === 'error') {
          errors++;
        } else {
          filesSkipped++;
        }

        filesDone++;
        state.backfillFilesDone = filesDone;
        onProgress?.({
          filesTotal: withStat.length,
          filesDone,
          filesIngested,
          turnsIngested: turnsAdded,
        });
        if ((i + 1) % 10 === 0) await new Promise((resolve) => setImmediate(resolve));
      }

      const touched = [...touchedSessions];
      for (let i = 0; i < touched.length; i++) {
        _recomputeSessionAggregates(db, touched[i]);
        if ((i + 1) % 25 === 0) await new Promise((resolve) => setImmediate(resolve));
      }

      state.lastBackfillAt = new Date().toISOString();
      const summary = {
        filesTotal: withStat.length,
        filesDone,
        filesIngested,
        filesSkipped,
        turnsAdded,
        turnsUpdated,
        touchedSessions: touched.length,
        errors,
        durationMs: Date.now() - t0,
      };
      log?.('sessions', 'info', '[ingester.backfill] done', summary);
      return summary;
    })()
      .catch((err) => {
        const errData = {
          error: err instanceof Error ? err.message : String(err),
          at: new Date().toISOString(),
        };
        _recordError(state, errData);
        log?.('sessions', 'warn', `[ingester.backfill] failed: ${errData.error}`);
        return { skipped: true, reason: 'error', ...errData };
      })
      .finally(() => {
        state.backfillInFlight = null;
      });

    state.backfillInFlight = p;
    return p;
  }

  function startPeriodicReconcile() {
    if (state.reconcileTimer) return;
    state.reconcileTimer = setInterval(() => {
      reconcileAll().catch((err) => {
        const errData = {
          error: err instanceof Error ? err.message : String(err),
          at: new Date().toISOString(),
        };
        _recordError(state, errData);
        log?.('sessions', 'warn', `[ingester.reconcile] failed: ${errData.error}`);
      });
    }, reconcileIntervalMs);
  }

  function getStats() {
    return {
      pendingFiles: state.inFlight.size,
      backfillRunning: !!state.backfillInFlight,
      backfillFilesTotal: state.backfillFilesTotal,
      backfillFilesDone: state.backfillFilesDone,
      lastBackfillAt: state.lastBackfillAt,
      repairRunning: !!state.repairInFlight,
      repairSessionsTotal: state.repairSessionsTotal,
      repairSessionsDone: state.repairSessionsDone,
      lastRepairAt: state.lastRepairAt,
      totalFilesIngested: state.totalFilesIngested,
      totalTurnsAdded: state.totalTurnsAdded,
      totalTurnsUpdated: state.totalTurnsUpdated,
      lastReconcileAt: state.lastReconcileAt,
      errors: [...state.errors],
    };
  }

  function cleanup() {
    if (state.reconcileTimer) {
      clearInterval(state.reconcileTimer);
      state.reconcileTimer = null;
    }
  }

  return {
    ingestFile,
    reconcileAll,
    backfillAll,
    repairNoTextTurns,
    startPeriodicReconcile,
    getStats,
    cleanup,
  };
}
