/**
 * Git worktree helpers — consolidated from /agent/start and /agent/spawn-child.
 */

import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { execSync, execFileSync } from 'child_process';
import { getDb } from '@learnrudi/db';

/**
 * Get the actual repository root, even when called from inside a worktree.
 * git rev-parse --show-toplevel returns the worktree root (wrong for our purposes).
 * git rev-parse --git-common-dir returns the shared .git dir → parent = real repo root.
 */
export function getRepoRoot(cwd) {
  const gitCommonDir = execFileSync('git', ['rev-parse', '--git-common-dir'], {
    cwd, stdio: 'pipe',
  }).toString().trim();
  // Resolve relative path (e.g., ".git" → absolute)
  const absGitDir = path.resolve(cwd, gitCommonDir);
  return path.dirname(absGitDir);
}

/**
 * Create a branch-attached worktree for a new parent session.
 * Returns { worktreePath, worktreeBranch, gitignoreWarning } or
 * { worktreePath: null } if creation fails (non-fatal fallback).
 */
export function createSessionWorktree({ repoRoot, currentBranch, shortId, log }) {
  const safeBranchDir = (currentBranch || 'detached').replace(/\//g, '-');
  const worktreesBase = path.join(repoRoot, '.rudi', 'worktrees');

  // Find unique directory name: branch, branch-2, branch-3, ...
  let worktreeDir = path.join(worktreesBase, safeBranchDir);
  if (fs.existsSync(worktreeDir)) {
    let suffix = 2;
    while (fs.existsSync(path.join(worktreesBase, `${safeBranchDir}-${suffix}`))) suffix++;
    worktreeDir = path.join(worktreesBase, `${safeBranchDir}-${suffix}`);
  }

  try {
    fs.mkdirSync(worktreesBase, { recursive: true });

    // Try the current branch directly first (works if not checked out elsewhere)
    let branchName = currentBranch;
    try {
      execSync(
        `git worktree add ${JSON.stringify(worktreeDir)} ${branchName}`,
        { cwd: repoRoot, stdio: 'pipe' }
      );
    } catch {
      // Branch already checked out (expected — main repo is on it)
      // Clean up any partial directory from the failed attempt
      try { fs.rmSync(worktreeDir, { recursive: true, force: true }); } catch {}
      // Collision fallback: sanitize slashes to dashes to avoid git ref conflict
      const safeBase = currentBranch.replace(/\//g, '-');
      branchName = `${safeBase}-session-${shortId}`;
      execSync(
        `git worktree add -b ${branchName} ${JSON.stringify(worktreeDir)}`,
        { cwd: repoRoot, stdio: 'pipe' }
      );
    }

    let worktreePath = null;
    let worktreeBranch = null;

    // Verify worktree directory actually exists before using it
    if (fs.existsSync(worktreeDir)) {
      worktreePath = worktreeDir;
      worktreeBranch = branchName;
    } else {
      log('agent', 'warn', `worktree dir missing after creation, using shared cwd`, { sessionId: shortId });
    }
    log('agent', 'info', `worktree created on branch ${branchName}: ${worktreeDir}`, { sessionId: shortId });

    // Check if .rudi/ is in .gitignore
    let gitignoreWarning = false;
    try {
      const gitignorePath = path.join(repoRoot, '.gitignore');
      const gitignoreContent = fs.existsSync(gitignorePath)
        ? fs.readFileSync(gitignorePath, 'utf-8')
        : '';
      if (!gitignoreContent.split('\n').some(line => line.trim() === '.rudi/' || line.trim() === '.rudi')) {
        gitignoreWarning = true;
      }
    } catch {
      gitignoreWarning = true;
    }

    return { worktreePath, worktreeBranch, gitignoreWarning };
  } catch (wtErr) {
    log('agent', 'warn', `worktree creation failed, using shared cwd: ${wtErr.message}`, { sessionId: shortId });
    return { worktreePath: null, worktreeBranch: null, gitignoreWarning: false };
  }
}

/**
 * Restore an existing worktree for a resumed session.
 * Returns { worktreePath, worktreeBranch, baseBranch } or all nulls.
 */
export function restoreSessionWorktree({ resumeSessionId, repoRoot, currentBranch, shortId, log }) {
  try {
    const db = getDb();
    const row = db.prepare(
      'SELECT worktree_path, worktree_branch, base_branch FROM session_runtime_state WHERE session_id = ? OR resume_session_id = ?'
    ).get(resumeSessionId, resumeSessionId);

    if (row?.worktree_path && fs.existsSync(row.worktree_path)) {
      log('agent', 'info', `resumed into existing worktree: ${row.worktree_path}`, { sessionId: shortId });
      return {
        worktreePath: row.worktree_path,
        worktreeBranch: row.worktree_branch,
        baseBranch: row.base_branch || currentBranch,
      };
    }

    if (row?.worktree_branch) {
      // Worktree dir missing but branch exists — try recreating
      const recreateName = row.worktree_branch.replace(/\//g, '-');
      const worktreeDir = path.join(repoRoot, '.rudi', 'worktrees', recreateName);
      try {
        fs.mkdirSync(path.join(repoRoot, '.rudi', 'worktrees'), { recursive: true });
        execSync(
          `git worktree add ${JSON.stringify(worktreeDir)} ${row.worktree_branch}`,
          { cwd: repoRoot, stdio: 'pipe' }
        );
        log('agent', 'info', `recreated worktree from existing branch: ${worktreeDir}`, { sessionId: shortId });
        return {
          worktreePath: worktreeDir,
          worktreeBranch: row.worktree_branch,
          baseBranch: row.base_branch || currentBranch,
        };
      } catch (recreateErr) {
        log('agent', 'warn', `worktree recreate failed: ${recreateErr.message}`, { sessionId: shortId });
      }
    }
  } catch (dbErr) {
    log('agent', 'warn', `worktree DB lookup failed: ${dbErr.message}`, { sessionId: shortId });
  }

  return { worktreePath: null, worktreeBranch: null, baseBranch: currentBranch };
}

/**
 * Create an isolated worktree for a child session with collision-retry loop.
 * Returns { worktreePath, worktreeBranch } or throws on exhaustion.
 */
export function createChildWorktree({ parentRepoRoot, sanitizedDesc, resolvedBaseRef, shortId, log }) {
  const worktreesBase = path.join(parentRepoRoot, '.rudi', 'worktrees');
  fs.mkdirSync(worktreesBase, { recursive: true });

  for (let attempt = 0; attempt < 5; attempt++) {
    const suffix = crypto.randomUUID().slice(0, 8);
    const branchName = `child-${sanitizedDesc}-${suffix}`;
    const wtDir = path.join(worktreesBase, branchName);

    try {
      execFileSync('git', ['worktree', 'add', '-b', branchName, wtDir, resolvedBaseRef], {
        cwd: parentRepoRoot, stdio: 'pipe',
      });
      return { worktreePath: wtDir, worktreeBranch: branchName };
    } catch (wtErr) {
      // Clean up partial dir and any partially-created branch
      try { fs.rmSync(wtDir, { recursive: true, force: true }); } catch {}
      try { execFileSync('git', ['branch', '-D', '--', branchName], { cwd: parentRepoRoot, stdio: 'pipe' }); } catch {}
      if (attempt === 4) {
        log('agent', 'error', `worktree creation failed after 5 attempts: ${wtErr.message}`, { sessionId: shortId });
        throw new Error('WORKTREE_BRANCH_COLLISION');
      }
    }
  }
}
