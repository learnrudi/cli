/**
 * DB-as-spine: reconciliation, periodic sync, watcher upsert, sidebar query.
 * Factory: createSessionsDbModule({ log, resolveDb, caches, onProjectsReady })
 */

import fsp from 'fs/promises';
import path from 'path';
import os from 'os';
import { CLAUDE_PROJECTS_DIR, CODEX_SESSIONS_DIR } from './constants.js';
import { cacheSessionFileHint } from './file-hints.js';
import {
  readSessionSnippet,
  decodeProjectDirFromFilesystem,
  inferProjectPathFromSessionFile,
  collectJsonlFiles,
} from './discovery.js';
import {
  readCodexSessionMeta,
  deriveCodexSessionIdFromFilename,
} from './providers/codex/discovery.js';

const WATCHER_DB_DEBOUNCE_MS = 10_000;
const RECONCILE_INTERVAL_MS = 60_000;

/**
 * @param {{ log, resolveDb, caches: { diffStatsCache, gitStatusCache, sessionPathMap, GIT_STATUS_TTL_MS }, onProjectsReady }} deps
 */
export function createSessionsDbModule({ log, resolveDb, caches, onProjectsReady }) {
  const { diffStatsCache, gitStatusCache, sessionPathMap, GIT_STATUS_TTL_MS } = caches;

  let useDbSpine = false;
  let _reconcileInterval = null;
  let _lastReconcileIndexMtimes = new Map();
  /** @type {Map<string, number>} sessionId -> last DB upsert timestamp */
  const _watcherDbDebounce = new Map();

  /**
   * Full reconciliation: walk ~/.claude/projects/, collect all sessions,
   * upsert into DB with project_path. Runs at boot.
   */
  async function reconcileSessionsToDb() {
    const db = resolveDb ? resolveDb() : null;
    if (!db) return;

    const start = Date.now();
    const claudeDir = path.join(os.homedir(), '.claude', 'projects');
    let added = 0, updated = 0, pruned = 0, fsCount = 0;

    const fsSessionIds = new Set();
    const claudeFsIds = new Set();
    const codexFsIds = new Set();

    // Batch-fetch existing snippets from DB to avoid redundant disk reads on subsequent boots
    const existingSnippets = new Map();
    try {
      const rows = db.prepare('SELECT id, snippet, git_branch FROM sessions WHERE snippet IS NOT NULL').all();
      for (const row of rows) existingSnippets.set(row.id, row);
    } catch {
      // non-fatal — fall back to disk reads
    }

    try {
      const projectDirs = await fsp.readdir(claudeDir);

      for (const projDir of projectDirs) {
        const projPath = path.join(claudeDir, projDir);
        let stat;
        try { stat = await fsp.stat(projPath); } catch (err) {
          log('sessions', 'warn', `[reconcile] stat failed for ${projPath}: ${err.message}`);
          continue;
        }
        if (!stat.isDirectory()) continue;

        // Determine project_path
        let projectPath = null;
        const indexPath = path.join(projPath, 'sessions-index.json');
        let indexEntries = null;
        try {
          const indexContent = await fsp.readFile(indexPath, 'utf-8');
          const index = JSON.parse(indexContent);
          if (index.originalPath) projectPath = index.originalPath;
          if (Array.isArray(index.entries)) indexEntries = index.entries;
          const istat = await fsp.stat(indexPath);
          _lastReconcileIndexMtimes.set(projDir, istat.mtimeMs);
        } catch {
          // No index or malformed
        }

        if (!projectPath) {
          projectPath = await decodeProjectDirFromFilesystem(projDir);
        }
        if (!projectPath) {
          projectPath = '/' + projDir.replace(/-/g, '/').replace(/^\//, '');
        }

        // Build session map from index
        const indexMap = new Map();
        if (indexEntries) {
          for (const e of indexEntries) {
            indexMap.set(e.sessionId, e);
          }
        }

        // Walk JSONL files
        let files;
        try { files = await fsp.readdir(projPath); } catch (err) {
          log('sessions', 'warn', `[reconcile] readdir failed for ${projPath}: ${err.message}`);
          continue;
        }

        for (const file of files) {
          if (!file.endsWith('.jsonl')) continue;
          const sessionId = file.slice(0, -6);
          fsSessionIds.add(sessionId);
          claudeFsIds.add(sessionId);
          fsCount++;

          const fullPath = path.join(projPath, file);
          let fstat;
          try { fstat = await fsp.stat(fullPath); } catch { continue; }

          const indexEntry = indexMap.get(sessionId);
          const title = indexEntry?.summary || null;
          const firstPrompt = indexEntry?.firstPrompt || null;
          const gitBranch = indexEntry?.gitBranch || null;
          const messageCount = indexEntry?.messageCount || 0;
          const created = indexEntry?.created || fstat.birthtime.toISOString();
          const modified = indexEntry?.modified || fstat.mtime.toISOString();
          const fileMtime = fstat.mtime.toISOString();
          const lastActive = new Date(modified) > new Date(fileMtime) ? modified : fileMtime;

          let snippet = firstPrompt;
          let snippetBranch = gitBranch;
          if (!snippet) {
            // Use cached DB snippet to avoid disk read on subsequent boots
            const cached = existingSnippets.get(sessionId);
            if (cached?.snippet) {
              snippet = cached.snippet;
              if (!snippetBranch) snippetBranch = cached.git_branch || null;
            } else {
              try {
                const s = await readSessionSnippet(fullPath);
                snippet = s.firstPrompt || null;
                if (!snippetBranch) snippetBranch = s.gitBranch || null;
              } catch {
                // ignore
              }
            }
          }

          const existed = db.prepare('SELECT 1 FROM sessions WHERE id = ?').get(sessionId);

          db.prepare(`
            INSERT INTO sessions
              (id, provider, provider_session_id, origin, origin_native_file,
               title, snippet, cwd, project_path, git_branch,
               status, created_at, last_active_at, turn_count)
            VALUES (?, 'claude', ?, 'provider-import', ?,
                    ?, ?, ?, ?, ?,
                    'active', ?, ?, ?)
            ON CONFLICT(id) DO UPDATE SET
              project_path = COALESCE(excluded.project_path, sessions.project_path),
              title = COALESCE(sessions.title, excluded.title),
              snippet = COALESCE(sessions.snippet, excluded.snippet),
              git_branch = COALESCE(excluded.git_branch, sessions.git_branch),
              origin_native_file = COALESCE(excluded.origin_native_file, sessions.origin_native_file),
              last_active_at = MAX(sessions.last_active_at, excluded.last_active_at),
              status = 'active',
              deleted_at = NULL
          `).run(
            sessionId, sessionId, fullPath,
            title, snippet, projectPath, projectPath, snippetBranch,
            created, lastActive, messageCount,
          );

          if (existed) updated++;
          else added++;
        }

        // Pick up cross-directory refs from sessions-index.json.
        for (const [sessionId, entry] of indexMap) {
          if (fsSessionIds.has(sessionId)) continue;
          const extPath = entry.fullPath;
          if (!extPath) continue;
          let fstat;
          try { fstat = await fsp.stat(extPath); } catch { continue; }

          fsSessionIds.add(sessionId);
          claudeFsIds.add(sessionId);
          fsCount++;

          const title = entry.summary || null;
          const firstPrompt = entry.firstPrompt || null;
          const gitBranch = entry.gitBranch || null;
          const messageCount = entry.messageCount || 0;
          const created = entry.created || fstat.birthtime.toISOString();
          const modified = entry.modified || fstat.mtime.toISOString();
          const fileMtime = fstat.mtime.toISOString();
          const lastActive = new Date(modified) > new Date(fileMtime) ? modified : fileMtime;

          let snippet = firstPrompt;
          let snippetBranch = gitBranch;
          if (!snippet) {
            // Use cached DB snippet to avoid disk read on subsequent boots
            const cached = existingSnippets.get(sessionId);
            if (cached?.snippet) {
              snippet = cached.snippet;
              if (!snippetBranch) snippetBranch = cached.git_branch || null;
            } else {
              try {
                const s = await readSessionSnippet(extPath);
                snippet = s.firstPrompt || null;
                if (!snippetBranch) snippetBranch = s.gitBranch || null;
              } catch {
                // ignore
              }
            }
          }

          const existed = db.prepare('SELECT 1 FROM sessions WHERE id = ?').get(sessionId);

          db.prepare(`
            INSERT INTO sessions
              (id, provider, provider_session_id, origin, origin_native_file,
               title, snippet, cwd, project_path, git_branch,
               status, created_at, last_active_at, turn_count)
            VALUES (?, 'claude', ?, 'provider-import', ?,
                    ?, ?, ?, ?, ?,
                    'active', ?, ?, ?)
            ON CONFLICT(id) DO UPDATE SET
              project_path = COALESCE(excluded.project_path, sessions.project_path),
              title = COALESCE(sessions.title, excluded.title),
              snippet = COALESCE(sessions.snippet, excluded.snippet),
              git_branch = COALESCE(excluded.git_branch, sessions.git_branch),
              origin_native_file = COALESCE(excluded.origin_native_file, sessions.origin_native_file),
              last_active_at = MAX(sessions.last_active_at, excluded.last_active_at),
              status = 'active',
              deleted_at = NULL
          `).run(
            sessionId, sessionId, extPath,
            title, snippet, projectPath, projectPath, snippetBranch,
            created, lastActive, messageCount,
          );

          if (existed) updated++;
          else added++;
        }
      }
    } catch {
      // ~/.claude/projects/ may not exist
    }

    // Subagent sessions: walk subagents/ dirs inside session UUID dirs
    try {
      const projDirs2 = await fsp.readdir(path.join(os.homedir(), '.claude', 'projects'));
      for (const projDir of projDirs2) {
        const projPath = path.join(os.homedir(), '.claude', 'projects', projDir);
        let stat2;
        try { stat2 = await fsp.stat(projPath); } catch { continue; }
        if (!stat2.isDirectory()) continue;

        let projectPath = await decodeProjectDirFromFilesystem(projDir);
        if (!projectPath) {
          projectPath = '/' + projDir.replace(/-/g, '/').replace(/^\//, '');
        }

        let entries;
        try { entries = await fsp.readdir(projPath); } catch { continue; }

        for (const entry of entries) {
          // Look for UUID directories (session dirs)
          if (!entry.match(/^[0-9a-f]{8}-/)) continue;
          const subagentsDir = path.join(projPath, entry, 'subagents');
          let subFiles;
          try { subFiles = await fsp.readdir(subagentsDir); } catch { continue; }

          for (const subFile of subFiles) {
            if (!subFile.startsWith('agent-') || !subFile.endsWith('.jsonl')) continue;
            const agentSessionId = subFile.slice(0, -6); // e.g., "agent-a3a6f79"
            const fullPath = path.join(subagentsDir, subFile);

            // Skip if already in DB with metadata populated
            const existing = db.prepare(
              'SELECT parent_session_id, cwd FROM sessions WHERE id = ?'
            ).get(agentSessionId);
            if (existing?.parent_session_id && existing?.cwd) {
              fsSessionIds.add(agentSessionId);
              claudeFsIds.add(agentSessionId);
              continue;
            }

            let fstat;
            try { fstat = await fsp.stat(fullPath); } catch { continue; }

            // Read snippet data
            let snippet = null;
            let snippetCwd = null;
            let snippetModel = null;
            let snippetBranch = null;
            try {
              const s = await readSessionSnippet(fullPath);
              snippet = s.firstPrompt || null;
              snippetCwd = s.cwd || null;
              snippetModel = s.model || null;
              snippetBranch = s.gitBranch || null;
            } catch {
              // ignore
            }

            fsSessionIds.add(agentSessionId);
            claudeFsIds.add(agentSessionId);
            fsCount++;

            db.prepare(`
              INSERT INTO sessions
                (id, provider, provider_session_id, origin, origin_native_file,
                 snippet, cwd, project_path, git_branch, model,
                 parent_session_id, agent_id, is_sidechain, session_type,
                 status, created_at, last_active_at)
              VALUES (?, 'claude', ?, 'provider-import', ?,
                      ?, ?, ?, ?, ?,
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
                snippet = COALESCE(sessions.snippet, excluded.snippet),
                origin_native_file = COALESCE(excluded.origin_native_file, sessions.origin_native_file),
                last_active_at = MAX(sessions.last_active_at, excluded.last_active_at),
                status = 'active',
                deleted_at = NULL
            `).run(
              agentSessionId, agentSessionId, fullPath,
              snippet, snippetCwd || null, projectPath, snippetBranch || null, snippetModel || null,
              entry, // parent session UUID = the directory name
              subFile.slice(6, -6), // agent ID = strip "agent-" prefix and ".jsonl" suffix
              fstat.birthtime.toISOString(), fstat.mtime.toISOString(),
            );

            if (existing) updated++;
            else { added++; }
          }
        }
      }
    } catch {
      // subagent walk is best-effort
    }

    // Codex sessions: walk ~/.codex/sessions/ recursively
    try {
      const codexFiles = await collectJsonlFiles(CODEX_SESSIONS_DIR, 6);
      for (const filePath of codexFiles) {
        const meta = await readCodexSessionMeta(filePath, 60);
        const sessionId = meta.sessionId || deriveCodexSessionIdFromFilename(filePath);
        if (!sessionId) continue;
        fsSessionIds.add(sessionId);
        codexFsIds.add(sessionId);
        fsCount++;

        let fstat;
        try { fstat = await fsp.stat(filePath); } catch { continue; }

        let snippet = null;
        let cwd = meta.cwd || null;
        // Use cached DB snippet for codex sessions too
        const cachedCodex = existingSnippets.get(sessionId);
        if (cachedCodex?.snippet) {
          snippet = cachedCodex.snippet;
        } else {
          try {
            const s = await readSessionSnippet(filePath, 'codex');
            snippet = s.firstPrompt || null;
            if (!cwd) cwd = s.cwd || null;
          } catch {
            // ignore
          }
        }
        const projectPath = cwd || await inferProjectPathFromSessionFile(filePath) || os.homedir();

        cacheSessionFileHint(sessionId, 'codex', filePath);

        const existed = db.prepare(
          'SELECT 1 FROM sessions WHERE provider = ? AND (id = ? OR provider_session_id = ?)'
        ).get('codex', sessionId, sessionId);

        db.prepare(`
          INSERT INTO sessions
            (id, provider, provider_session_id, origin, origin_native_file,
             snippet, cwd, project_path,
             status, created_at, last_active_at)
          VALUES (?, 'codex', ?, 'provider-import', ?,
                  ?, ?, ?,
                  'active', ?, ?)
          ON CONFLICT(id) DO UPDATE SET
            project_path = COALESCE(excluded.project_path, sessions.project_path),
            snippet = COALESCE(sessions.snippet, excluded.snippet),
            origin_native_file = COALESCE(excluded.origin_native_file, sessions.origin_native_file),
            last_active_at = MAX(sessions.last_active_at, excluded.last_active_at),
            status = 'active',
            deleted_at = NULL
        `).run(
          sessionId, sessionId, filePath,
          snippet, cwd || projectPath, projectPath,
          fstat.birthtime.toISOString(), fstat.mtime.toISOString(),
        );

        if (existed) updated++;
        else added++;
      }
    } catch {
      // ~/.codex/sessions/ may not exist
    }

    // Prune: for DB rows not confirmed by the walk, stat the file before deleting.
    // The walk can be partial (readdir failures are silently caught), so set-difference
    // alone would over-delete. Only mark deleted when the file is truly gone (ENOENT).
    const deleteStmt = db.prepare(
      `UPDATE sessions SET status = 'deleted', deleted_at = ? WHERE id = ?`
    );
    const deleteTurnsStmt = db.prepare(`DELETE FROM turns WHERE session_id = ?`);
    const deleteFilePosStmt = db.prepare(`DELETE FROM file_positions WHERE file_path = ?`);
    const pruneNow = new Date().toISOString();
    const providerPrunes = [
      { provider: 'claude', fsIds: claudeFsIds },
      { provider: 'codex', fsIds: codexFsIds },
    ];
    for (const { provider: prov, fsIds } of providerPrunes) {
      if (fsIds.size === 0) continue;
      try {
        const dbRows = db.prepare(
          `SELECT id, origin_native_file FROM sessions WHERE provider = ? AND status != 'deleted'`
        ).all(prov);
        const unconfirmed = dbRows.filter(r => !fsIds.has(r.id));
        for (const row of unconfirmed) {
          if (!row.origin_native_file) continue; // no file path — can't verify, leave alone
          try {
            await fsp.access(row.origin_native_file);
            // File still exists — walk missed it (partial readdir), don't prune
          } catch (err) {
            if (err.code === 'ENOENT') {
              deleteStmt.run(pruneNow, row.id);
              deleteTurnsStmt.run(row.id);
              if (row.origin_native_file) {
                deleteFilePosStmt.run(row.origin_native_file);
              }
              pruned++;
            }
            // Other errors (EPERM, EIO, etc.) — leave the row alone
          }
        }
      } catch {
        // non-fatal
      }
    }

    // One-time catch-up cleanup for previously deleted sessions that still have
    // residual turn rows from older versions.
    const purgedDeletedTurns = db.prepare(`
      DELETE FROM turns
      WHERE session_id IN (SELECT id FROM sessions WHERE status = 'deleted')
    `).run().changes;
    if (purgedDeletedTurns > 0) {
      log('sessions', 'info', `[reconcile] purged ${purgedDeletedTurns} turns from deleted sessions`);
    }

    const duration = Date.now() - start;
    const dbCount = db.prepare(
      `SELECT COUNT(*) as c FROM sessions WHERE status != 'deleted'`
    ).get().c;
    log('sessions', 'info',
      `[reconcile] DB=${dbCount} fs=${fsCount} added=${added} pruned=${pruned} updated=${updated} duration=${duration}ms`);
  }

  /**
   * Lightweight periodic reconciliation (every 60s).
   */
  async function periodicReconcile() {
    const db = resolveDb ? resolveDb() : null;
    if (!db) return;

    const claudeDir = path.join(os.homedir(), '.claude', 'projects');

    try {
      const projectDirs = await fsp.readdir(claudeDir);
      const dbIds = new Set(
        db.prepare(`SELECT id FROM sessions WHERE provider = 'claude' AND status != 'deleted'`)
          .all().map(r => r.id)
      );

      for (const projDir of projectDirs) {
        const projPath = path.join(claudeDir, projDir);
        let stat;
        try { stat = await fsp.stat(projPath); } catch { continue; }
        if (!stat.isDirectory()) continue;

        let files;
        try { files = await fsp.readdir(projPath); } catch { continue; }

        let projectPath = null;
        const indexPath = path.join(projPath, 'sessions-index.json');
        let indexEntries = null;
        let indexChanged = false;
        try {
          const istat = await fsp.stat(indexPath);
          const prevMtime = _lastReconcileIndexMtimes.get(projDir);
          if (!prevMtime || istat.mtimeMs > prevMtime) {
            indexChanged = true;
            _lastReconcileIndexMtimes.set(projDir, istat.mtimeMs);
          }
          if (indexChanged || !projectPath) {
            const indexContent = await fsp.readFile(indexPath, 'utf-8');
            const index = JSON.parse(indexContent);
            if (index.originalPath) projectPath = index.originalPath;
            if (Array.isArray(index.entries)) indexEntries = index.entries;
          }
        } catch {
          // No index
        }

        if (!projectPath) {
          projectPath = '/' + projDir.replace(/-/g, '/').replace(/^\//, '');
        }

        if (indexChanged && indexEntries) {
          const titleGeneratedAt = new Date().toISOString();
          const titleStmt = db.prepare(
            `UPDATE sessions SET title = ?, title_source = COALESCE(title_source, 'cli'),
             title_generated_at = COALESCE(title_generated_at, ?),
             project_path = COALESCE(project_path, ?)
             WHERE id = ? AND title_override IS NULL`
          );
          for (const e of indexEntries) {
            if (e.summary && e.sessionId) {
              titleStmt.run(e.summary, titleGeneratedAt, projectPath, e.sessionId);
            }
          }
        }

        for (const file of files) {
          if (!file.endsWith('.jsonl')) continue;
          const sessionId = file.slice(0, -6);
          if (dbIds.has(sessionId)) continue;

          const fullPath = path.join(projPath, file);
          let fstat;
          try { fstat = await fsp.stat(fullPath); } catch { continue; }

          let snippet = null, gitBranch = null;
          try {
            const s = await readSessionSnippet(fullPath);
            snippet = s.firstPrompt || null;
            gitBranch = s.gitBranch || null;
          } catch {
            // ignore
          }

          db.prepare(`
            INSERT OR IGNORE INTO sessions
              (id, provider, provider_session_id, origin, origin_native_file,
               snippet, cwd, project_path, git_branch,
               status, created_at, last_active_at)
            VALUES (?, 'claude', ?, 'provider-import', ?,
                    ?, ?, ?, ?,
                    'active', ?, ?)
          `).run(
            sessionId, sessionId, fullPath,
            snippet, projectPath, projectPath, gitBranch,
            fstat.birthtime.toISOString(), fstat.mtime.toISOString(),
          );
          dbIds.add(sessionId);
        }

        if (indexEntries) {
          for (const entry of indexEntries) {
            const sessionId = entry.sessionId;
            if (!sessionId || dbIds.has(sessionId)) continue;
            const extPath = entry.fullPath;
            if (!extPath) continue;
            let fstat;
            try { fstat = await fsp.stat(extPath); } catch { continue; }

            let snippet = entry.firstPrompt || null;
            let gitBranch = entry.gitBranch || null;
            if (!snippet) {
              try {
                const s = await readSessionSnippet(extPath);
                snippet = s.firstPrompt || null;
                if (!gitBranch) gitBranch = s.gitBranch || null;
              } catch { /* ignore */ }
            }

            db.prepare(`
              INSERT OR IGNORE INTO sessions
                (id, provider, provider_session_id, origin, origin_native_file,
                 title, title_source, title_generated_at, snippet, cwd, project_path, git_branch,
                 status, created_at, last_active_at)
              VALUES (?, 'claude', ?, 'provider-import', ?,
                      ?, ?, ?, ?, ?, ?, ?,
                      'active', ?, ?)
            `).run(
              sessionId, sessionId, extPath,
              entry.summary || null,
              entry.summary ? 'cli' : null,
              entry.summary ? (entry.created || fstat.birthtime.toISOString()) : null,
              snippet, projectPath, projectPath, gitBranch,
              entry.created || fstat.birthtime.toISOString(), fstat.mtime.toISOString(),
            );
            dbIds.add(sessionId);
          }
        }
      }
    } catch {
      // ~/.claude/projects/ may not exist
    }

    // Codex: detect new JSONL files
    try {
      const codexDbRows = db.prepare(
        `SELECT id, provider_session_id FROM sessions WHERE provider = 'codex' AND status != 'deleted'`
      ).all();
      const codexDbIds = new Set();
      for (const row of codexDbRows) {
        if (row.id) codexDbIds.add(row.id);
        if (row.provider_session_id) codexDbIds.add(row.provider_session_id);
      }
      const codexFiles = await collectJsonlFiles(CODEX_SESSIONS_DIR, 6);
      for (const filePath of codexFiles) {
        const meta = await readCodexSessionMeta(filePath, 60);
        const sessionId = meta.sessionId || deriveCodexSessionIdFromFilename(filePath);
        if (!sessionId) continue;
        if (codexDbIds.has(sessionId)) continue;

        let fstat;
        try { fstat = await fsp.stat(filePath); } catch { continue; }

        let snippet = null;
        let cwd = meta.cwd || null;
        try {
          const s = await readSessionSnippet(filePath, 'codex');
          snippet = s.firstPrompt || null;
          if (!cwd) cwd = s.cwd || null;
        } catch {
          // ignore
        }
        const projectPath = cwd || await inferProjectPathFromSessionFile(filePath) || os.homedir();
        cacheSessionFileHint(sessionId, 'codex', filePath);

        db.prepare(`
          INSERT OR IGNORE INTO sessions
            (id, provider, provider_session_id, origin, origin_native_file,
             snippet, cwd, project_path,
             status, created_at, last_active_at)
          VALUES (?, 'codex', ?, 'provider-import', ?,
                  ?, ?, ?,
                  'active', ?, ?)
        `).run(
          sessionId, sessionId, filePath,
          snippet, cwd || projectPath, projectPath,
          fstat.birthtime.toISOString(), fstat.mtime.toISOString(),
        );
        codexDbIds.add(sessionId);
      }
    } catch {
      // ~/.codex/sessions/ may not exist
    }
  }

  /**
   * DB-backed sidebar query: single query replaces filesystem walk.
   */
  async function getProjectsFromDb(enumerateProjectsWithSessions) {
    const db = resolveDb ? resolveDb() : null;
    if (!db) return enumerateProjectsWithSessions();

    const rows = db.prepare(`
      SELECT id, provider, provider_session_id, title, title_override, snippet, cwd, project_path, origin_native_file,
             total_cost, total_input_tokens, total_output_tokens,
             turn_count, model, git_branch, last_active_at, created_at,
             parent_session_id, is_sidechain, session_type, origin, status
      FROM sessions
      WHERE status != 'deleted'
      ORDER BY last_active_at DESC
    `).all();

    // Build parent session lookup so child sessions inherit their parent's project
    const parentProjectPaths = new Map();
    for (const row of rows) {
      if (!row.parent_session_id) {
        parentProjectPaths.set(row.id, row.project_path || row.cwd || 'unknown');
      }
    }

    const projectMap = new Map();
    for (const row of rows) {
      let pp;
      if (row.parent_session_id) {
        pp = parentProjectPaths.get(row.parent_session_id) || row.project_path || row.cwd || null;
      } else {
        pp = row.project_path || row.cwd || null;
      }
      // Derive project path from file location when DB fields are missing
      if (!pp && row.origin_native_file) {
        const projMatch = row.origin_native_file.match(/\.claude\/projects\/([^/]+)\//);
        if (projMatch) {
          pp = '/' + projMatch[1].replace(/-/g, '/').replace(/^\//, '');
        }
      }
      if (!pp) pp = 'unknown';
      const sessionId = row.provider_session_id || row.id;
      if (!projectMap.has(pp)) {
        projectMap.set(pp, {
          path: pp.replace(/\//g, '-').replace(/^-/, ''),
          name: path.basename(pp),
          originalPath: pp,
          sessions: [],
          gitStatus: null,
        });
      }
      const proj = projectMap.get(pp);
      const display = row.title_override || row.title;
      const session = {
        sessionId,
        provider: row.provider,
        summary: display || '',
        firstPrompt: row.snippet || '',
        messageCount: 0,
        modified: row.last_active_at || '',
        created: row.created_at || '',
        gitBranch: row.git_branch || '',
        originNativeFile: row.origin_native_file || undefined,
        diffStats: null,
      };
      if (display) session.dbTitle = display;
      if (row.total_cost > 0) session.totalCost = row.total_cost;
      if (row.total_input_tokens > 0) session.totalInputTokens = row.total_input_tokens;
      if (row.total_output_tokens > 0) session.totalOutputTokens = row.total_output_tokens;
      if (row.turn_count > 0) session.turnCount = row.turn_count;
      if (row.parent_session_id) session.parentSessionId = row.parent_session_id;
      if (row.is_sidechain) session.isSidechain = true;
      if (row.session_type && row.session_type !== 'main') session.sessionType = row.session_type;

      const cached = diffStatsCache.get(sessionId) || diffStatsCache.get(row.id);
      if (cached) session.diffStats = cached.diffStats;
      if (row.origin_native_file) {
        sessionPathMap.set(sessionId, row.origin_native_file);
        sessionPathMap.set(row.id, row.origin_native_file);
        cacheSessionFileHint(sessionId, row.provider || 'claude', row.origin_native_file);
        cacheSessionFileHint(row.id, row.provider || 'claude', row.origin_native_file);
        if (row.provider_session_id) {
          sessionPathMap.set(row.provider_session_id, row.origin_native_file);
          cacheSessionFileHint(row.provider_session_id, row.provider || 'claude', row.origin_native_file);
        }
      }

      proj.sessions.push(session);
    }

    let projects = [...projectMap.values()];

    // Merge worktree projects into their parent
    // Matches /.rudi/worktrees/, //rudi/worktrees/, .claude-worktrees/, .claude/worktrees/, .codex/worktrees/
    const worktreeRe = /[/.](?:rudi|claude(?:-worktrees)?|codex)\/worktrees?\//;
    const mergedProjects = [];
    const parentMap = new Map();

    for (const proj of projects) {
      const op = proj.originalPath || '';
      const wtMatch = op.match(worktreeRe);
      if (wtMatch) {
        const realRoot = op.slice(0, wtMatch.index).replace(/\/+$/, '');
        if (parentMap.has(realRoot)) {
          mergedProjects[parentMap.get(realRoot)].sessions.push(...proj.sessions);
        } else {
          parentMap.set(realRoot, mergedProjects.length);
          mergedProjects.push({
            ...proj,
            name: path.basename(realRoot),
            originalPath: realRoot,
          });
        }
      } else {
        if (parentMap.has(op)) {
          const existing = mergedProjects[parentMap.get(op)];
          existing.sessions.push(...proj.sessions);
          if (!existing.path) existing.path = proj.path;
          if (!existing.gitStatus && proj.gitStatus) existing.gitStatus = proj.gitStatus;
        } else {
          parentMap.set(op, mergedProjects.length);
          mergedProjects.push(proj);
        }
      }
    }

    for (const proj of mergedProjects) {
      proj.sessions.sort((a, b) =>
        new Date(b.modified).getTime() - new Date(a.modified).getTime()
      );
    }

    for (const proj of mergedProjects) {
      const cachedGit = gitStatusCache.get(proj.originalPath);
      if (cachedGit && (Date.now() - cachedGit.fetchedAt) < GIT_STATUS_TTL_MS) {
        proj.gitStatus = cachedGit.gitStatus;
      }
    }

    mergedProjects.sort((a, b) => {
      const aTime = a.sessions[0]?.modified || '';
      const bTime = b.sessions[0]?.modified || '';
      return new Date(bTime).getTime() - new Date(aTime).getTime();
    });

    if (typeof onProjectsReady === 'function') {
      onProjectsReady(mergedProjects);
    }

    return mergedProjects;
  }

  /**
   * Upsert a session to DB from watcher event (new or changed JSONL).
   */
  async function watcherDbUpsert(sessionId, fullPath, { provider = 'claude', projectDir = null } = {}) {
    const db = resolveDb ? resolveDb() : null;
    if (!db) return;

    let resolvedSessionId = sessionId;
    let codexMeta = null;
    if (provider === 'codex') {
      codexMeta = await readCodexSessionMeta(fullPath, 40);
      resolvedSessionId = codexMeta.sessionId || deriveCodexSessionIdFromFilename(fullPath) || sessionId;
      if (!resolvedSessionId) return;
      cacheSessionFileHint(resolvedSessionId, 'codex', fullPath);
    }

    const now = Date.now();
    const debounceKey = `${provider}:${resolvedSessionId}`;
    const lastWrite = _watcherDbDebounce.get(debounceKey);
    if (lastWrite && (now - lastWrite) < WATCHER_DB_DEBOUNCE_MS) return;
    _watcherDbDebounce.set(debounceKey, now);

    try {
      const existing = db.prepare(
        'SELECT id FROM sessions WHERE provider = ? AND (id = ? OR provider_session_id = ?)'
      ).get(provider, resolvedSessionId, resolvedSessionId);

      if (!existing) {
        let fstat;
        try { fstat = await fsp.stat(fullPath); } catch { return; }

        let projectPath = null;
        if (provider === 'claude' && projectDir) {
          const indexPath = path.join(CLAUDE_PROJECTS_DIR, projectDir, 'sessions-index.json');
          try {
            const indexContent = await fsp.readFile(indexPath, 'utf-8');
            const index = JSON.parse(indexContent);
            if (index.originalPath) projectPath = index.originalPath;
          } catch {
            // no index
          }
          if (!projectPath) {
            projectPath = '/' + projectDir.replace(/-/g, '/').replace(/^\//, '');
          }
        }

        let snippet = null;
        let gitBranch = null;
        let cwd = codexMeta?.cwd || null;
        try {
          const s = await readSessionSnippet(fullPath, provider);
          snippet = s.firstPrompt || null;
          gitBranch = s.gitBranch || null;
          if (!cwd) cwd = s.cwd || null;
          if (!projectPath && cwd) projectPath = cwd;
        } catch {
          // ignore
        }
        if (!projectPath) {
          projectPath = await inferProjectPathFromSessionFile(fullPath);
        }
        if (!projectPath) projectPath = cwd || null;

        db.prepare(`
          INSERT OR IGNORE INTO sessions
            (id, provider, provider_session_id, origin, origin_native_file,
             snippet, cwd, project_path, git_branch,
             status, created_at, last_active_at)
          VALUES (?, ?, ?, 'provider-import', ?,
                  ?, ?, ?, ?,
                  'active', ?, ?)
        `).run(
          resolvedSessionId, provider, resolvedSessionId, fullPath,
          snippet, cwd || projectPath, projectPath, gitBranch,
          fstat.birthtime.toISOString(), fstat.mtime.toISOString(),
        );

        return {
          isNew: true,
          sessionId: resolvedSessionId,
          provider,
          snippet,
          gitBranch,
          projectPath,
          modified: fstat.mtime.toISOString(),
          created: fstat.birthtime.toISOString(),
        };
      } else {
        const nowIso = new Date().toISOString();
        db.prepare(`
          UPDATE sessions SET last_active_at = MAX(last_active_at, ?) WHERE provider = ? AND id = ?
        `).run(nowIso, provider, existing.id);
      }
    } catch (err) {
      log('sessions', 'warn', `watcher DB upsert failed for ${resolvedSessionId}: ${err.message}`);
    }
  }

  function startPeriodicReconcile() {
    if (_reconcileInterval) return;
    _reconcileInterval = setInterval(() => {
      periodicReconcile().catch(err => {
        log('sessions', 'warn', `periodic reconcile failed: ${err.message}`);
      });
    }, RECONCILE_INTERVAL_MS);
  }

  function enableDbSpine() {
    useDbSpine = true;
    log('sessions', 'info', 'DB-as-spine enabled for sidebar queries');
  }

  function isDbSpineEnabled() {
    return useDbSpine;
  }

  function cleanup() {
    if (_reconcileInterval) {
      clearInterval(_reconcileInterval);
      _reconcileInterval = null;
    }
  }

  return {
    reconcileSessionsToDb,
    getProjectsFromDb,
    watcherDbUpsert,
    startPeriodicReconcile,
    enableDbSpine,
    isDbSpineEnabled,
    cleanup,
  };
}
