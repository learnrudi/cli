/**
 * Worktree management endpoints: cleanup-worktree, delete-worktree-branch,
 * worktrees/status, worktrees/diff.
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

    // GET /git/worktrees/status — enriched worktree list with status details
    if (req.method === 'GET' && url.pathname === '/git/worktrees/status') {
      const repoPath = url.searchParams.get('path');
      if (!repoPath) return error(res, 'path query param required', 400);

      try {
        // Parse worktree list
        const rawList = execFileSync('git', ['worktree', 'list', '--porcelain'], {
          cwd: repoPath,
          stdio: 'pipe',
        }).toString();

        const worktrees = [];
        let current = {};

        for (const line of rawList.split('\n')) {
          if (line.startsWith('worktree ')) {
            if (current.path) worktrees.push(current);
            current = { path: line.slice(9).trim() };
          } else if (line.startsWith('HEAD ')) {
            current.head = line.slice(5).trim();
          } else if (line.startsWith('branch ')) {
            current.branch = line.slice(7).trim().replace('refs/heads/', '');
          } else if (line === 'bare') {
            current.bare = true;
          } else if (line === 'detached') {
            current.detached = true;
          }
        }
        if (current.path) worktrees.push(current);

        // Enrich each worktree
        const enriched = [];
        const db = getDb();

        for (const wt of worktrees) {
          const entry = {
            path: wt.path,
            head: wt.head || null,
            branch: wt.branch || null,
            bare: Boolean(wt.bare),
            detached: Boolean(wt.detached),
            dirty: false,
            changedFiles: [],
            ahead: 0,
            behind: 0,
            linkedSessionId: null,
            linkedSessionStatus: null,
          };

          if (wt.bare) {
            enriched.push(entry);
            continue;
          }

          // Get dirty/clean status + changed files
          try {
            const status = execFileSync('git', ['status', '--porcelain'], {
              cwd: wt.path,
              stdio: 'pipe',
            }).toString().trim();

            if (status) {
              entry.dirty = true;
              entry.changedFiles = status.split('\n').map((line) => ({
                status: line.slice(0, 2).trim(),
                path: line.slice(3).trim(),
              })).slice(0, 20); // Cap at 20 files
            }
          } catch {
            // May fail if worktree dir is gone
          }

          // Get ahead/behind relative to main tracking branch
          if (wt.branch) {
            try {
              const revList = execFileSync(
                'git',
                ['rev-list', '--left-right', '--count', `${wt.branch}...origin/${wt.branch}`],
                { cwd: wt.path, stdio: 'pipe' },
              ).toString().trim();
              const parts = revList.split('\t');
              if (parts.length === 2) {
                entry.ahead = parseInt(parts[0], 10) || 0;
                entry.behind = parseInt(parts[1], 10) || 0;
              }
            } catch {
              // No remote tracking branch — try against base branch
              try {
                // Find the base branch from session_runtime_state if available
                const srs = db.prepare(
                  'SELECT base_branch FROM session_runtime_state WHERE worktree_branch = ? LIMIT 1'
                ).get(wt.branch);
                const base = srs?.base_branch || 'main';
                const revList = execFileSync(
                  'git',
                  ['rev-list', '--left-right', '--count', `${wt.branch}...${base}`],
                  { cwd: repoPath, stdio: 'pipe' },
                ).toString().trim();
                const parts = revList.split('\t');
                if (parts.length === 2) {
                  entry.ahead = parseInt(parts[0], 10) || 0;
                  entry.behind = parseInt(parts[1], 10) || 0;
                }
              } catch {
                // Ignore
              }
            }
          }

          // Link to session if any
          try {
            const srs = db.prepare(
              'SELECT session_id, status FROM session_runtime_state WHERE worktree_path = ? OR worktree_branch = ?'
            ).get(wt.path, wt.branch);
            if (srs) {
              entry.linkedSessionId = srs.session_id;
              entry.linkedSessionStatus = srs.status;
            }
          } catch {
            // DB may not have this table in some setups
          }

          enriched.push(entry);
        }

        json(res, { worktrees: enriched });
      } catch (err) {
        error(res, `Failed to list worktrees: ${err.message}`, 500);
      }
      return true;
    }

    // GET /git/worktrees/diff/:branch — unified diff against base
    const diffBranchMatch = url.pathname.match(/^\/git\/worktrees\/diff\/(.+)$/);
    if (req.method === 'GET' && diffBranchMatch) {
      const branch = decodeURIComponent(diffBranchMatch[1]);
      const repoPath = url.searchParams.get('path');
      const base = url.searchParams.get('base') || 'main';

      if (!repoPath) return error(res, 'path query param required', 400);

      try {
        const diff = execFileSync(
          'git',
          ['diff', `${base}...${branch}`],
          { cwd: repoPath, stdio: 'pipe', maxBuffer: 5 * 1024 * 1024 },
        ).toString();

        // Also get stat summary
        let stat = '';
        try {
          stat = execFileSync(
            'git',
            ['diff', '--stat', `${base}...${branch}`],
            { cwd: repoPath, stdio: 'pipe' },
          ).toString().trim();
        } catch {}

        json(res, { branch, base, diff, stat });
      } catch (err) {
        error(res, `Failed to get diff: ${err.message}`, 500);
      }
      return true;
    }

    return false;
  };
}
