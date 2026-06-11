import fs from 'fs';
import path from 'path';
import { execFileSync } from 'child_process';
import { rejectMissingDestructiveConfirmation } from './validation.js';

function runGit(projectPath, args, options = {}) {
  return execFileSync('git', args, {
    cwd: projectPath,
    encoding: 'utf-8',
    stdio: ['ignore', 'pipe', 'pipe'],
    timeout: options.timeout || 10000,
  });
}

function rejectInvalidGitFiles({ files, res, invalidField, error }) {
  if (files === undefined || files === null) return false;
  if (!Array.isArray(files)) {
    if (typeof invalidField === 'function') {
      return invalidField(res, 'files', 'files must be an array of file paths', {
        reason: 'invalid_type',
      });
    }
    return error(res, 'files must be an array of file paths', 400);
  }

  const invalidIndex = files.findIndex(file => typeof file !== 'string' || file.length === 0);
  if (invalidIndex !== -1) {
    if (typeof invalidField === 'function') {
      return invalidField(res, 'files', 'files must contain only non-empty strings', {
        reason: 'invalid_item',
        details: { index: invalidIndex },
      });
    }
    return error(res, 'files must contain only non-empty strings', 400);
  }

  return false;
}

function gitFileArgs(files) {
  const targets = Array.isArray(files) && files.length > 0 ? files : ['.'];
  return ['--', ...targets];
}

/**
 * Get git status for a project directory.
 * Returns { branch, uncommitted } or null if not a git repo.
 */
export function getProjectGitStatus(projectPath) {
  if (!projectPath) return null;

  try {
    const gitDir = path.join(projectPath, '.git');
    if (!fs.existsSync(gitDir)) return null;

    // Get current branch
    const branch = runGit(projectPath, ['rev-parse', '--abbrev-ref', 'HEAD'], {
      timeout: 3000,
    }).trim();

    // Get count of uncommitted changes (staged + unstaged + untracked)
    const status = runGit(projectPath, ['status', '--porcelain'], {
      timeout: 3000,
    });
    const uncommitted = status.trim() ? status.trim().split('\n').length : 0;

    return { branch, uncommitted };
  } catch {
    return null;
  }
}

/**
 * Parse `git worktree list --porcelain` output into structured objects.
 *
 * Format:
 *   worktree /path/to/dir
 *   HEAD abc123
 *   branch refs/heads/main
 *   <blank line>
 *   worktree /path/to/other
 *   HEAD def456
 *   branch refs/heads/feature
 *   <blank line>
 *
 * Bare worktrees show "bare" instead of branch. Detached HEADs show "detached".
 */
export function parseWorktreeList(output) {
  if (!output || !output.trim()) return [];

  const worktrees = [];
  const blocks = output.trim().split('\n\n');

  for (const block of blocks) {
    if (!block.trim()) continue;
    const lines = block.trim().split('\n');
    const entry = { path: '', head: '', branch: '', bare: false, detached: false };

    for (const line of lines) {
      if (line.startsWith('worktree ')) {
        entry.path = line.slice('worktree '.length);
      } else if (line.startsWith('HEAD ')) {
        entry.head = line.slice('HEAD '.length);
      } else if (line.startsWith('branch ')) {
        // refs/heads/main → main
        entry.branch = line.slice('branch '.length).replace('refs/heads/', '');
      } else if (line === 'bare') {
        entry.bare = true;
      } else if (line === 'detached') {
        entry.detached = true;
      }
    }

    if (entry.path) {
      worktrees.push(entry);
    }
  }

  return worktrees;
}

export function createGitHandler({ readBody, error, json, invalidField }) {
  return async function handleGit(req, res, url) {
    // GET /git/status?path=... — get git status for a directory
    if (req.method === 'GET' && url.pathname === '/git/status') {
      const projectPath = url.searchParams.get('path');
      if (!projectPath) return error(res, 'path required');

      const status = getProjectGitStatus(projectPath);
      if (!status) {
        json(res, { isGitRepo: false });
        return true;
      }

      // Get list of changed files
      try {
        const statusOutput = runGit(projectPath, ['status', '--porcelain'], {
          timeout: 5000,
        });

        const files = statusOutput.trim().split('\n').filter(Boolean).map(line => ({
          status: line.substring(0, 2).trim(),
          path: line.substring(3),
        }));

        json(res, {
          isGitRepo: true,
          branch: status.branch,
          uncommitted: status.uncommitted,
          files,
        });
      } catch {
        json(res, { isGitRepo: true, ...status, files: [] });
      }
      return true;
    }

    // POST /git/stage — stage files
    if (req.method === 'POST' && url.pathname === '/git/stage') {
      const body = await readBody(req);
      const { path: projectPath, files } = body;

      if (!projectPath) return error(res, 'path required');
      if (rejectInvalidGitFiles({ files, res, invalidField, error })) return true;

      try {
        runGit(projectPath, ['add', ...gitFileArgs(files)]);
        json(res, { ok: true });
      } catch (err) {
        error(res, err.message || 'Failed to stage files', 500);
      }
      return true;
    }

    // POST /git/unstage — unstage files
    if (req.method === 'POST' && url.pathname === '/git/unstage') {
      const body = await readBody(req);
      const { path: projectPath, files } = body;

      if (!projectPath) return error(res, 'path required');
      if (rejectInvalidGitFiles({ files, res, invalidField, error })) return true;

      try {
        runGit(projectPath, ['reset', 'HEAD', ...gitFileArgs(files)]);
        json(res, { ok: true });
      } catch (err) {
        error(res, err.message || 'Failed to unstage files', 500);
      }
      return true;
    }

    // POST /git/revert — revert uncommitted changes
    if (req.method === 'POST' && url.pathname === '/git/revert') {
      const body = await readBody(req);
      const { path: projectPath, files } = body;

      if (!projectPath) return error(res, 'path required');
      if (rejectInvalidGitFiles({ files, res, invalidField, error })) return true;
      if (rejectMissingDestructiveConfirmation({ body, res, invalidField, error, operation: 'git revert' })) {
        return true;
      }

      try {
        runGit(projectPath, ['checkout', ...gitFileArgs(files)]);
        json(res, { ok: true });
      } catch (err) {
        error(res, err.message || 'Failed to revert changes', 500);
      }
      return true;
    }

    // POST /git/commit — commit staged (or all) changes
    if (req.method === 'POST' && url.pathname === '/git/commit') {
      const body = await readBody(req);
      const { path: projectPath, message, all, amend } = body;

      if (!projectPath) return error(res, 'path required');
      if (!message && !amend) return error(res, 'message required');

      try {
        // Stage all if requested
        if (all) {
          runGit(projectPath, ['add', '-A']);
        }

        // Build commit command
        const args = ['commit'];
        if (amend) args.push('--amend');
        if (message) args.push('-m', message);
        if (amend && !message) args.push('--no-edit');

        const output = runGit(projectPath, args, {
          timeout: 30000,
        });

        // Extract commit hash from output
        const hashMatch = output.match(/\[[\w/.-]+ ([a-f0-9]+)\]/);
        const commit = hashMatch ? hashMatch[1] : null;

        json(res, { ok: true, commit, summary: output.trim().split('\n')[0] });
      } catch (err) {
        error(res, err.message || 'Failed to commit', 500);
      }
      return true;
    }

    // GET /git/branches?path=... — list local branches
    if (req.method === 'GET' && url.pathname === '/git/branches') {
      const projectPath = url.searchParams.get('path');
      if (!projectPath) return error(res, 'path required');

      try {
        const output = runGit(projectPath, ['branch', '--list', '--no-color'], {
          timeout: 5000,
        });

        const branches = [];
        let current = '';

        for (const rawLine of output.split('\n')) {
          const line = rawLine.trim();
          if (!line) continue;

          // git branch markers:
          //   "* <name>" -> current branch in this worktree
          //   "+ <name>" -> checked out in another worktree (can't be switched to)
          const marker = line[0];
          const hasMarker = (marker === '*' || marker === '+') && line[1] === ' ';
          const name = hasMarker ? line.slice(2).trim() : line;
          if (!name) continue;

          if (marker === '*') {
            current = name;
          }
          // Skip branches locked by other worktrees — git won't allow checkout
          if (marker === '+') continue;
          branches.push(name);
        }

        json(res, { branches, current });
      } catch (err) {
        error(res, err.message || 'Failed to list branches', 500);
      }
      return true;
    }

    // POST /git/branch/create — create and checkout a new branch
    if (req.method === 'POST' && url.pathname === '/git/branch/create') {
      const body = await readBody(req);
      const { path: projectPath, name } = body;

      if (!projectPath) return error(res, 'path required');
      if (!name || typeof name !== 'string') return error(res, 'name required');

      try {
        runGit(projectPath, ['checkout', '-b', name]);
        json(res, { ok: true, branch: name });
      } catch (err) {
        error(res, err.message || 'Failed to create branch', 500);
      }
      return true;
    }

    // POST /git/checkout — switch to an existing branch
    if (req.method === 'POST' && url.pathname === '/git/checkout') {
      const body = await readBody(req);
      const { path: projectPath, branch } = body;

      if (!projectPath) return error(res, 'path required');
      if (!branch || typeof branch !== 'string') return error(res, 'branch required');

      try {
        runGit(projectPath, ['checkout', branch]);
        json(res, { ok: true, branch });
      } catch (err) {
        error(res, err.message || 'Failed to checkout branch', 500);
      }
      return true;
    }

    // GET /git/worktrees?path=... — list worktrees for a repo
    if (req.method === 'GET' && url.pathname === '/git/worktrees') {
      const projectPath = url.searchParams.get('path');
      if (!projectPath) return error(res, 'path required');

      try {
        const output = runGit(projectPath, ['worktree', 'list', '--porcelain'], {
          timeout: 5000,
        });

        const worktrees = parseWorktreeList(output);
        json(res, { worktrees });
      } catch {
        // Not a git repo or git not available
        json(res, { worktrees: [] });
      }
      return true;
    }

    // POST /git/worktree/add — create a new worktree
    if (req.method === 'POST' && url.pathname === '/git/worktree/add') {
      const body = await readBody(req);
      const { path: projectPath, branch, directory, createBranch } = body;

      if (!projectPath) return error(res, 'path required');
      if (!directory) return error(res, 'directory required');
      if (!branch) return error(res, 'branch required');

      try {
        // createBranch: true -> git worktree add -b <branch> <dir>
        // createBranch: false -> git worktree add <dir> <branch> (existing branch)
        const args = createBranch
          ? ['worktree', 'add', '-b', branch, directory]
          : ['worktree', 'add', directory, branch];

        runGit(projectPath, args, {
          timeout: 15000,
        });

        // Return info about the new worktree
        const output = runGit(projectPath, ['worktree', 'list', '--porcelain'], {
          timeout: 5000,
        });
        const worktrees = parseWorktreeList(output);
        const created = worktrees.find(
          w => w.path === directory || w.path === path.resolve(projectPath, directory)
        );

        json(res, { ok: true, worktree: created || null });
      } catch (err) {
        error(res, err.message || 'Failed to create worktree', 500);
      }
      return true;
    }

    // POST /git/branch/delete — delete a local branch (safe delete by default)
    if (req.method === 'POST' && url.pathname === '/git/branch/delete') {
      const body = await readBody(req);
      const { path: projectPath, name, force } = body;

      if (!projectPath) return error(res, 'path required');
      if (!name || typeof name !== 'string') return error(res, 'name required');
      if (rejectMissingDestructiveConfirmation({ body, res, invalidField, error, operation: 'git branch delete' })) {
        return true;
      }

      // Prevent deleting main/master
      const protected_branches = ['main', 'master'];
      if (protected_branches.includes(name)) {
        return error(res, `Cannot delete protected branch '${name}'`, 400);
      }

      // Prevent deleting the current branch
      try {
        const current = runGit(projectPath, ['rev-parse', '--abbrev-ref', 'HEAD'], {
          timeout: 3000,
        }).trim();
        if (current === name) {
          return error(res, 'Cannot delete the currently checked out branch', 400);
        }
      } catch {
        // continue — worst case git branch -d will fail
      }

      try {
        const flag = force ? '-D' : '-d';
        runGit(projectPath, ['branch', flag, name]);
        json(res, { ok: true, branch: name });
      } catch (err) {
        const msg = err.message || 'Failed to delete branch';
        // If safe delete fails due to unmerged commits, hint about force
        if (!force && msg.includes('not fully merged')) {
          return error(res, `Branch '${name}' has unmerged commits. Use force delete to remove it anyway.`, 400);
        }
        error(res, msg, 500);
      }
      return true;
    }

    // POST /git/worktree/remove — remove a worktree
    if (req.method === 'POST' && url.pathname === '/git/worktree/remove') {
      const body = await readBody(req);
      const { path: projectPath, directory, force } = body;

      if (!projectPath) return error(res, 'path required');
      if (!directory) return error(res, 'directory required');
      if (rejectMissingDestructiveConfirmation({ body, res, invalidField, error, operation: 'git worktree remove' })) {
        return true;
      }

      try {
        const args = ['worktree', 'remove'];
        if (force) args.push('--force');
        args.push(directory);

        runGit(projectPath, args);
        json(res, { ok: true });
      } catch (err) {
        error(res, err.message || 'Failed to remove worktree', 500);
      }
      return true;
    }

    // POST /git/stash — stash uncommitted changes
    if (req.method === 'POST' && url.pathname === '/git/stash') {
      const body = await readBody(req);
      const { path: projectPath, pop } = body;

      if (!projectPath) return error(res, 'path required');

      try {
        if (pop) {
          runGit(projectPath, ['stash', 'pop']);
        } else {
          runGit(projectPath, ['stash']);
        }
        json(res, { ok: true });
      } catch (err) {
        error(res, err.message || 'Failed to stash', 500);
      }
      return true;
    }

    // POST /git/init — initialize a new git repo
    if (req.method === 'POST' && url.pathname === '/git/init') {
      const body = await readBody(req);
      const { path: projectPath } = body;

      if (!projectPath) return error(res, 'path required');

      try {
        runGit(projectPath, ['init']);
        json(res, { ok: true });
      } catch (err) {
        error(res, err.message || 'Failed to init repository', 500);
      }
      return true;
    }

    return false;
  };
}
