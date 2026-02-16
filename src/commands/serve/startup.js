/**
 * Boot-time tasks — schema init, stale sweep, orphan worktree cleanup.
 *
 * Each task is idempotent and safe to re-run.
 */

import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';
import { getDb, initSchema } from '@learnrudi/db';

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

  // 2. Sweep stale runtime states
  try {
    const db = getDb();
    const stale = db.prepare(`
      UPDATE session_runtime_state
      SET status = 'crashed', updated_at = ?
      WHERE status IN ('starting', 'running')
    `).run(new Date().toISOString());
    if (stale.changes > 0) {
      log('serve', 'info', `Marked ${stale.changes} stale session(s) as crashed`);
    }
  } catch (err) {
    console.warn('[serve] Failed to sweep stale sessions:', err.message);
  }

  // 3. Kill orphaned Claude CLI processes
  try {
    const psOutput = execSync('ps -axo pid=,ppid=,command=', {
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
          const alive = execSync(`ps -p ${pid} -o pid=`, {
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
        const uncommitted = execSync('git status --porcelain', { cwd: row.worktree_path, stdio: 'pipe' }).toString().trim();
        if (uncommitted) {
          log('serve', 'warn', `orphan worktree has uncommitted changes, skipping: ${row.worktree_path}`);
          continue;
        }

        let unmerged = '';
        if (row.worktree_branch && row.base_branch && row.project_root) {
          try {
            unmerged = execSync(
              `git log ${row.base_branch}..${row.worktree_branch} --oneline`,
              { cwd: row.project_root, stdio: 'pipe' }
            ).toString().trim();
          } catch {}
        }
        if (unmerged) {
          log('serve', 'warn', `orphan worktree has unmerged commits, skipping: ${row.worktree_path}`);
          continue;
        }

        const repoDir = row.project_root || path.dirname(path.dirname(path.dirname(row.worktree_path)));
        execSync(`git worktree remove ${JSON.stringify(row.worktree_path)}`, { cwd: repoDir, stdio: 'pipe' });
        if (row.worktree_branch) {
          try { execSync(`git branch -d ${row.worktree_branch}`, { cwd: repoDir, stdio: 'pipe' }); } catch {}
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
