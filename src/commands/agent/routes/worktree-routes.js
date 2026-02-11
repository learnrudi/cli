/**
 * Worktree management endpoints: cleanup-worktree, delete-worktree-branch.
 */

import fs from 'fs';
import { execFileSync } from 'child_process';
import path from 'path';
import { getDb } from '@learnrudi/db';

export function buildWorktreeRoutes(ctx) {
  const { json, error, readBody, log } = ctx;

  return async (req, res, url) => {
    // POST /agent/cleanup-worktree — safely remove a session's worktree
    if (req.method === 'POST' && url.pathname === '/agent/cleanup-worktree') {
      const body = await readBody(req);
      if (!body.sessionId) return error(res, 'sessionId required');

      try {
        const db = getDb();
        const row = db.prepare(
          'SELECT worktree_path, worktree_branch, base_branch, project_root FROM session_runtime_state WHERE session_id = ?'
        ).get(body.sessionId);

        if (!row?.worktree_path) {
          return json(res, { ok: false, reason: 'no_worktree', details: 'No worktree associated with this session' });
        }

        if (!fs.existsSync(row.worktree_path)) {
          // Worktree dir already gone — clean up DB
          db.prepare('UPDATE session_runtime_state SET worktree_path = NULL WHERE session_id = ?').run(body.sessionId);
          return json(res, { ok: true });
        }

        const repoDir = row.project_root || path.dirname(path.dirname(path.dirname(row.worktree_path)));

        // Check for uncommitted changes
        let uncommitted = '';
        try {
          uncommitted = execFileSync('git', ['status', '--porcelain'], { cwd: row.worktree_path, stdio: 'pipe' }).toString().trim();
        } catch {}

        // Check for unmerged commits
        let unmerged = '';
        if (row.worktree_branch && row.base_branch) {
          try {
            unmerged = execFileSync(
              'git', ['log', `${row.base_branch}..${row.worktree_branch}`, '--oneline'],
              { cwd: repoDir, stdio: 'pipe' }
            ).toString().trim();
          } catch {}
        }

        if ((uncommitted || unmerged) && !body.force) {
          const reason = uncommitted ? 'uncommitted_changes' : 'unmerged_commits';
          const details = uncommitted
            ? `Uncommitted changes:\n${uncommitted}`
            : `Unmerged commits:\n${unmerged}`;
          return json(res, { ok: false, reason, details });
        }

        // Remove worktree
        try {
          const removeArgs = body.force
            ? ['worktree', 'remove', '--force', row.worktree_path]
            : ['worktree', 'remove', row.worktree_path];
          execFileSync('git', removeArgs, { cwd: repoDir, stdio: 'pipe' });
        } catch (wtErr) {
          return json(res, { ok: false, reason: 'remove_failed', details: wtErr.message });
        }

        // Try to delete the branch (only with -d, fails if unmerged)
        let branchRetained = false;
        if (row.worktree_branch && !row.worktree_branch.startsWith('-') && !body.force) {
          try {
            execFileSync('git', ['branch', '-d', '--', row.worktree_branch], { cwd: repoDir, stdio: 'pipe' });
          } catch {
            branchRetained = true; // Branch has unmerged commits, keep it
          }
        } else if (row.worktree_branch && body.force) {
          // Force mode: worktree removed but branch always retained
          branchRetained = true;
        }

        // Update DB
        db.prepare('UPDATE session_runtime_state SET worktree_path = NULL WHERE session_id = ?').run(body.sessionId);

        json(res, { ok: true, branchRetained, branch: branchRetained ? row.worktree_branch : null });
        log('agent', 'info', `worktree cleaned up for session ${body.sessionId.slice(0, 8)}`, { branchRetained });
      } catch (err) {
        error(res, `Cleanup failed: ${err.message}`, 500);
      }
      return true;
    }

    // POST /agent/delete-worktree-branch — explicitly delete a retained worktree branch
    if (req.method === 'POST' && url.pathname === '/agent/delete-worktree-branch') {
      const body = await readBody(req);
      if (!body.sessionId) return error(res, 'sessionId required');

      try {
        const db = getDb();
        const row = db.prepare(
          'SELECT worktree_branch, project_root FROM session_runtime_state WHERE session_id = ?'
        ).get(body.sessionId);

        if (!row?.worktree_branch) {
          return json(res, { ok: false, reason: 'no_branch', details: 'No worktree branch for this session' });
        }

        const repoDir = row.project_root;
        if (!repoDir) {
          return json(res, { ok: false, reason: 'no_repo', details: 'No project root recorded' });
        }

        try {
          // Use -d (lowercase) — fails safely if unmerged
          if (row.worktree_branch.startsWith('-')) {
            return json(res, { ok: false, reason: 'invalid_branch', details: 'Branch name starts with dash' });
          }
          execFileSync('git', ['branch', '-d', '--', row.worktree_branch], { cwd: repoDir, stdio: 'pipe' });
        } catch (brErr) {
          return json(res, { ok: false, reason: 'branch_unmerged', details: brErr.message });
        }

        db.prepare('UPDATE session_runtime_state SET worktree_branch = NULL WHERE session_id = ?').run(body.sessionId);
        json(res, { ok: true });
        log('agent', 'info', `worktree branch deleted for session ${body.sessionId.slice(0, 8)}`, { branch: row.worktree_branch });
      } catch (err) {
        error(res, `Branch delete failed: ${err.message}`, 500);
      }
      return true;
    }

    return false;
  };
}
