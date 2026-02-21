/**
 * Metadata backfill for subagent sessions.
 *
 * Enriches existing task/agent sessions with metadata extracted from JSONL headers:
 * cwd, project_path, git_branch, parent_session_id, agent_id, is_sidechain, session_type, model.
 *
 * Factory pattern matching title-backfill.js:
 *   createMetadataBackfillModule({ log, resolveDb, broadcast }) → { backfillMetadata, getStats }
 */

import fsp from 'fs/promises';
import path from 'path';
import { CLAUDE_PROJECTS_DIR } from './constants.js';
import { decodeProjectDirFromFilesystem } from './discovery.js';

// Read first ~8KB of a file to extract JSONL header
const HEADER_SCAN_BYTES = 8192;

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function _findSessionsNeedingMetadata(db) {
  return db.prepare(`
    SELECT id, origin_native_file
    FROM sessions
    WHERE status != 'deleted'
      AND (id LIKE 'agent-%' OR session_type = 'task')
      AND (
        cwd IS NULL
        OR parent_session_id IS NULL
        OR model IS NULL
        OR project_path IS NULL
      )
    ORDER BY last_active_at DESC
  `).all();
}

async function _walkAgentFiles() {
  const results = [];
  const claudeProjectsDir = CLAUDE_PROJECTS_DIR;

  let projDirs;
  try { projDirs = await fsp.readdir(claudeProjectsDir); } catch { return results; }

  for (const projDir of projDirs) {
    const projPath = path.join(claudeProjectsDir, projDir);
    let stat;
    try { stat = await fsp.stat(projPath); } catch { continue; }
    if (!stat.isDirectory()) continue;

    let entries;
    try { entries = await fsp.readdir(projPath); } catch { continue; }

    for (const entry of entries) {
      // Root-level agent-*.jsonl files (older format)
      if (entry.startsWith('agent-') && entry.endsWith('.jsonl')) {
        results.push({
          filePath: path.join(projPath, entry),
          sessionId: entry.slice(0, -6),
          parentSessionId: null,         // will be read from JSONL header
          agentId: entry.slice(6, -6),
          projDir,
        });
        continue;
      }

      // UUID session dirs with subagents/ subdirectory
      if (!entry.match(/^[0-9a-f]{8}-/)) continue;
      const subagentsDir = path.join(projPath, entry, 'subagents');
      let subFiles;
      try { subFiles = await fsp.readdir(subagentsDir); } catch { continue; }

      for (const subFile of subFiles) {
        if (!subFile.startsWith('agent-') || !subFile.endsWith('.jsonl')) continue;
        results.push({
          filePath: path.join(subagentsDir, subFile),
          sessionId: subFile.slice(0, -6), // "agent-a3a6f79"
          parentSessionId: entry,           // UUID dir name
          agentId: subFile.slice(6, -6),    // "a3a6f79"
          projDir,
        });
      }
    }
  }

  return results;
}

async function _enrichFromFile(filePath) {
  let fd;
  try {
    fd = await fsp.open(filePath, 'r');
    const buffer = Buffer.alloc(HEADER_SCAN_BYTES);
    const { bytesRead } = await fd.read(buffer, 0, buffer.length, 0);
    await fd.close();
    fd = null;
    if (!bytesRead) return null;

    const text = buffer.toString('utf-8', 0, bytesRead);
    const lines = text.split('\n').filter(Boolean);

    let cwd = null;
    let gitBranch = null;
    let isSidechain = null;
    let model = null;
    let parentSessionId = null;
    let agentId = null;

    // Parse first line (user entry with header fields)
    if (lines.length > 0) {
      try {
        const first = JSON.parse(lines[0]);
        if (typeof first.cwd === 'string') cwd = first.cwd;
        if (typeof first.gitBranch === 'string') gitBranch = first.gitBranch;
        if (typeof first.isSidechain === 'boolean') isSidechain = first.isSidechain ? 1 : 0;
        if (typeof first.sessionId === 'string') parentSessionId = first.sessionId;
        if (typeof first.agentId === 'string') agentId = first.agentId;
      } catch {
        // malformed first line
      }
    }

    // Parse second line for model
    if (lines.length > 1) {
      try {
        const second = JSON.parse(lines[1]);
        if (typeof second?.message?.model === 'string') model = second.message.model;
      } catch {
        // malformed second line
      }
    }

    // Scan more lines for model if not found yet
    if (!model) {
      for (let i = 2; i < Math.min(lines.length, 10); i++) {
        try {
          const entry = JSON.parse(lines[i]);
          if (typeof entry?.message?.model === 'string') { model = entry.message.model; break; }
        } catch { /* skip */ }
      }
    }

    return { cwd, gitBranch, isSidechain, model, parentSessionId, agentId };
  } catch {
    return null;
  } finally {
    try { await fd?.close(); } catch { /* ignore */ }
  }
}

async function _deriveProjectPath(projDir) {
  const decoded = await decodeProjectDirFromFilesystem(projDir);
  if (decoded) return decoded;
  return '/' + projDir.replace(/-/g, '/').replace(/^\//, '');
}

function _updateSessionMetadata(db, sessionId, meta) {
  return db.prepare(`
    UPDATE sessions SET
      cwd = COALESCE(?, cwd),
      project_path = COALESCE(?, project_path),
      git_branch = COALESCE(?, git_branch),
      parent_session_id = COALESCE(?, parent_session_id),
      agent_id = COALESCE(?, agent_id),
      is_sidechain = COALESCE(?, is_sidechain),
      session_type = COALESCE(?, session_type),
      model = COALESCE(?, model)
    WHERE id = ?
  `).run(
    meta.cwd || null,
    meta.projectPath || null,
    meta.gitBranch || null,
    meta.parentSessionId || null,
    meta.agentId || null,
    meta.isSidechain ?? null,
    meta.sessionType || null,
    meta.model || null,
    sessionId,
  );
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

export function createMetadataBackfillModule({ log, resolveDb, broadcast }) {
  const state = {
    backfillInFlight: null,
    lastRunAt: null,
    lastResult: null,
    enriched: 0,
    errors: 0,
    total: 0,
  };

  async function backfillMetadata() {
    if (state.backfillInFlight) return state.backfillInFlight;

    const p = _run();
    state.backfillInFlight = p;
    return p.finally(() => { state.backfillInFlight = null; });
  }

  async function _run() {
    const db = resolveDb ? resolveDb() : null;
    if (!db) return { skipped: true, reason: 'db_unavailable' };

    const t0 = Date.now();
    state.enriched = 0;
    state.errors = 0;

    // Step 1: Find all agent files on disk
    const agentFiles = await _walkAgentFiles();
    log?.('sessions', 'info', `[metadata-backfill] found ${agentFiles.length} agent files on disk`);

    // Step 2: Build lookup of files by session ID
    const fileMap = new Map();
    for (const af of agentFiles) {
      fileMap.set(af.sessionId, af);
    }

    // Step 3: Find sessions needing metadata
    const needsMeta = _findSessionsNeedingMetadata(db);

    // Also find agent files not yet in DB
    const dbIds = new Set(
      db.prepare(`SELECT id FROM sessions WHERE id LIKE 'agent-%'`).all().map(r => r.id)
    );
    const orphans = agentFiles.filter(af => !dbIds.has(af.sessionId));

    state.total = needsMeta.length + orphans.length;
    log?.('sessions', 'info',
      `[metadata-backfill] ${needsMeta.length} sessions need enrichment, ${orphans.length} orphan agent files`);

    // Step 4: Enrich existing sessions
    for (const sess of needsMeta) {
      try {
        const af = fileMap.get(sess.id);
        const filePath = af?.filePath || sess.origin_native_file;
        if (!filePath) { state.errors++; continue; }

        const enriched = await _enrichFromFile(filePath);
        if (!enriched) { state.errors++; continue; }

        const projectPath = af ? await _deriveProjectPath(af.projDir) : null;

        _updateSessionMetadata(db, sess.id, {
          cwd: enriched.cwd,
          projectPath,
          gitBranch: enriched.gitBranch,
          parentSessionId: af?.parentSessionId || enriched.parentSessionId || null,
          agentId: af?.agentId || enriched.agentId || null,
          isSidechain: enriched.isSidechain,
          sessionType: 'task',
          model: enriched.model,
        });

        state.enriched++;
      } catch (err) {
        state.errors++;
        log?.('sessions', 'debug', `[metadata-backfill] error enriching ${sess.id}: ${err.message}`);
      }
    }

    // Step 5: Insert orphan agent files (not yet in DB)
    for (const af of orphans) {
      try {
        const enriched = await _enrichFromFile(af.filePath);
        const projectPath = await _deriveProjectPath(af.projDir);
        let fstat;
        try { fstat = await fsp.stat(af.filePath); } catch { continue; }

        db.prepare(`
          INSERT INTO sessions
            (id, provider, provider_session_id, origin, origin_native_file,
             cwd, project_path, git_branch, model,
             parent_session_id, agent_id, is_sidechain, session_type,
             status, created_at, last_active_at)
          VALUES (?, 'claude', ?, 'provider-import', ?,
                  ?, ?, ?, ?,
                  ?, ?, 1, 'task',
                  'active', ?, ?)
          ON CONFLICT(id) DO UPDATE SET
            cwd = COALESCE(excluded.cwd, sessions.cwd),
            project_path = COALESCE(excluded.project_path, sessions.project_path),
            git_branch = COALESCE(excluded.git_branch, sessions.git_branch),
            model = COALESCE(excluded.model, sessions.model),
            parent_session_id = COALESCE(excluded.parent_session_id, sessions.parent_session_id),
            agent_id = COALESCE(excluded.agent_id, sessions.agent_id),
            is_sidechain = COALESCE(excluded.is_sidechain, sessions.is_sidechain),
            session_type = COALESCE(excluded.session_type, sessions.session_type),
            status = 'active',
            deleted_at = NULL
        `).run(
          af.sessionId, af.sessionId, af.filePath,
          enriched?.cwd || null, projectPath, enriched?.gitBranch || null, enriched?.model || null,
          af.parentSessionId, af.agentId,
          fstat.birthtime.toISOString(), fstat.mtime.toISOString(),
        );

        state.enriched++;
      } catch (err) {
        state.errors++;
        log?.('sessions', 'debug', `[metadata-backfill] error inserting orphan ${af.sessionId}: ${err.message}`);
      }
    }

    const result = {
      total: state.total,
      enriched: state.enriched,
      errors: state.errors,
      skipped: state.total - state.enriched - state.errors,
      durationMs: Date.now() - t0,
    };

    state.lastRunAt = new Date().toISOString();
    state.lastResult = result;

    log?.('sessions', 'info',
      `[metadata-backfill] done: ${state.enriched} enriched, ${state.errors} errors (${result.durationMs}ms)`);

    broadcast?.('session:metadata-backfill', result);

    return result;
  }

  function getStats() {
    return {
      running: !!state.backfillInFlight,
      lastRunAt: state.lastRunAt,
      lastResult: state.lastResult,
      progress: state.backfillInFlight ? { enriched: state.enriched, errors: state.errors, total: state.total } : null,
    };
  }

  return { backfillMetadata, getStats };
}
