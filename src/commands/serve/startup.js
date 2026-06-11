/**
 * Boot-time tasks — schema init, stale sweep, orphan worktree cleanup.
 *
 * Each task is idempotent and safe to re-run.
 */

import fs from 'fs';
import path from 'path';
import { getDb, initSchema } from '@learnrudi/db';
import { transitionSessionStatus } from '../agent/db.js';
import { refreshRunGroupAggregates, withImmediateTransaction } from '../agent/run-group-domain.js';
import { runCommand, runGit } from '../../utils/subprocess.js';

/**
 * Run synchronous startup tasks. Call before server.listen().
 * Heavy async work (session reconciliation) should be deferred to after listen.
 *
 * @param {object} opts
 * @param {Function} opts.log - log(source, level, message, data)
 */
export function runStartupTasks({ log }) {
  // 1. Schema init
  try {
    initSchema();
  } catch (err) {
    console.warn('[serve] Failed to initialize database schema:', err);
  }

  // 2. Sweep stale runtime states + refresh affected run_group aggregates
  try {
    const db = getDb();

    const { affectedGroups, staleCount, refreshedGroups, stuckGroupsFixed } = withImmediateTransaction(db, () => {
      const affectedGroups = db.prepare(`
        SELECT DISTINCT s.run_group_id
        FROM session_runtime_state srs
        JOIN sessions s ON s.id = srs.session_id
        WHERE srs.status IN ('starting', 'running', 'retrying')
          AND s.run_group_id IS NOT NULL
      `).all().map(r => r.run_group_id);

      const staleRows = db.prepare(`
        SELECT session_id
        FROM session_runtime_state
        WHERE status IN ('starting', 'running', 'retrying')
      `).all();
      let staleCount = 0;
      for (const row of staleRows) {
        if (transitionSessionStatus(db, row.session_id, 'crashed')) {
          staleCount += 1;
        }
      }

      const refreshedGroups = [];
      for (const groupId of affectedGroups) {
        const refreshed = refreshRunGroupAggregates(db, groupId);
        if (refreshed) refreshedGroups.push({ id: groupId, status: refreshed.status });
      }

      const stuckGroups = db.prepare(`
        SELECT rg.id FROM run_groups rg
        WHERE rg.status = 'running'
          AND rg.session_count > 0
          AND NOT EXISTS (
            SELECT 1 FROM sessions s
            LEFT JOIN session_runtime_state srs ON srs.session_id = s.id
            WHERE s.run_group_id = rg.id
              AND COALESCE(srs.status, 'pending') NOT IN ('completed', 'error', 'stopped', 'crashed')
          )
      `).all();
      const stuckGroupsFixed = [];
      for (const { id: groupId } of stuckGroups) {
        const refreshed = refreshRunGroupAggregates(db, groupId);
        if (refreshed) stuckGroupsFixed.push({ id: groupId, status: refreshed.status });
      }

      return { affectedGroups, staleCount, refreshedGroups, stuckGroupsFixed };
    });

    if (staleCount > 0) {
      log('serve', 'info', `Marked ${staleCount} stale session(s) as crashed`);
    }

    for (const group of refreshedGroups) {
      log('serve', 'info', `Refreshed run_group ${group.id.slice(0, 8)} aggregates (status=${group.status})`);
    }

    for (const group of stuckGroupsFixed) {
      log('serve', 'info', `Fixed stuck run_group ${group.id.slice(0, 8)} → ${group.status}`);
    }
  } catch (err) {
    console.warn('[serve] Failed to sweep stale sessions:', err.message);
  }

  // 3. Kill orphaned Claude CLI processes
  try {
    const psOutput = runCommand('ps', ['-axo', 'pid=,ppid=,command='], {
      encoding: 'utf-8',
      timeout: 3000,
    });
    const orphanPids = psOutput
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => {
        const match = line.match(/^(\d+)\s+(\d+)\s+(.*)$/);
        if (!match) return null;
        return {
          pid: parseInt(match[1], 10),
          ppid: parseInt(match[2], 10),
          command: match[3],
        };
      })
      .filter((entry) => (
        entry
        && entry.ppid <= 1
        && entry.command.includes('claude')
        && entry.command.includes('--output-format stream-json')
        && entry.command.includes('--input-format stream-json')
      ))
      .map((entry) => entry.pid);

    if (orphanPids.length > 0) {
      log('serve', 'warn', `Killing ${orphanPids.length} orphaned Claude CLI process(es)`, { pids: orphanPids });
      for (const pid of orphanPids) {
        try { process.kill(pid, 'SIGTERM'); } catch {}
      }
      for (const pid of orphanPids) {
        try {
          const alive = runCommand('ps', ['-p', String(pid), '-o', 'pid='], {
            encoding: 'utf-8',
            timeout: 500,
          }).trim();
          if (alive) {
            try { process.kill(pid, 'SIGKILL'); } catch {}
          }
        } catch {
          // already exited
        }
      }
    }
  } catch {
    // best effort only
  }

  // 4. Conservative orphan worktree cleanup
  try {
    const db = getDb();
    const orphans = db.prepare(`
      SELECT session_id, worktree_path, worktree_branch, base_branch, project_root
      FROM session_runtime_state
      WHERE worktree_path IS NOT NULL
        AND status IN ('completed', 'error', 'stopped', 'crashed')
    `).all();

    for (const row of orphans) {
      if (!row.worktree_path || !fs.existsSync(row.worktree_path)) {
        db.prepare('UPDATE session_runtime_state SET worktree_path = NULL WHERE session_id = ?').run(row.session_id);
        continue;
      }

      try {
        const uncommitted = runGit(row.worktree_path, ['status', '--porcelain'], { stdio: 'pipe' }).toString().trim();
        if (uncommitted) {
          log('serve', 'warn', `orphan worktree has uncommitted changes, skipping: ${row.worktree_path}`);
          continue;
        }

        let unmerged = '';
        if (row.worktree_branch && row.base_branch && row.project_root) {
          try {
            unmerged = runGit(row.project_root, ['log', `${row.base_branch}..${row.worktree_branch}`, '--oneline'], {
              stdio: 'pipe',
            }).toString().trim();
          } catch {}
        }
        if (unmerged) {
          log('serve', 'warn', `orphan worktree has unmerged commits, skipping: ${row.worktree_path}`);
          continue;
        }

        const repoDir = row.project_root || path.dirname(path.dirname(path.dirname(row.worktree_path)));
        runGit(repoDir, ['worktree', 'remove', row.worktree_path], { stdio: 'pipe' });
        if (row.worktree_branch) {
          try { runGit(repoDir, ['branch', '-d', '--', row.worktree_branch], { stdio: 'pipe' }); } catch {}
        }
        db.prepare('UPDATE session_runtime_state SET worktree_path = NULL, worktree_branch = NULL WHERE session_id = ?').run(row.session_id);
        log('serve', 'info', `cleaned up orphan worktree: ${row.worktree_path}`);
      } catch (err) {
        log('serve', 'warn', `orphan worktree cleanup failed for ${row.worktree_path}: ${err.message}`);
      }
    }
  } catch (err) {
    log('serve', 'warn', `orphan worktree cleanup sweep failed: ${err.message}`);
  }
}
