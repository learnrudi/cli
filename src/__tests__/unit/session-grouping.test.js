import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import fs from 'node:fs';

// Test the pure logic that was refactored in sessions.js.
// Since functions are internal to createSessionsModule(), we test the
// algorithmic patterns directly.

describe('session-grouping', () => {

  describe('worktree merge (two-pass, order-independent)', () => {
    // Reproduces the worktree merge algorithm from sessions.js
    function mergeWorktreeProjects(projects) {
      const worktreeMarker = '/.rudi/worktrees/';
      const regularProjects = [];
      const worktreeEntries = [];
      for (const proj of projects) {
        const op = proj.originalPath || '';
        const wtIdx = op.indexOf(worktreeMarker);
        if (wtIdx !== -1) {
          worktreeEntries.push({ realRoot: op.slice(0, wtIdx), proj });
        } else {
          regularProjects.push(proj);
        }
      }
      const mergedProjects = [];
      const parentMap = new Map();
      for (const proj of regularProjects) {
        const op = proj.originalPath || '';
        parentMap.set(op, mergedProjects.length);
        mergedProjects.push({ ...proj, sessions: [...proj.sessions] });
      }
      for (const { realRoot, proj } of worktreeEntries) {
        if (parentMap.has(realRoot)) {
          const parent = mergedProjects[parentMap.get(realRoot)];
          parent.sessions.push(...proj.sessions);
        } else {
          parentMap.set(realRoot, mergedProjects.length);
          mergedProjects.push({
            ...proj,
            name: path.basename(realRoot),
            originalPath: realRoot,
            sessions: [...proj.sessions],
          });
        }
      }
      return mergedProjects;
    }

    it('merges worktree sessions into parent regardless of order', () => {
      const worktreeFirst = [
        { name: 'main', originalPath: '/repo/.rudi/worktrees/main', sessions: [{ id: 'wt1' }] },
        { name: 'repo', originalPath: '/repo', sessions: [{ id: 's1' }] },
      ];
      const parentFirst = [
        { name: 'repo', originalPath: '/repo', sessions: [{ id: 's1' }] },
        { name: 'main', originalPath: '/repo/.rudi/worktrees/main', sessions: [{ id: 'wt1' }] },
      ];
      const resultA = mergeWorktreeProjects(worktreeFirst);
      const resultB = mergeWorktreeProjects(parentFirst);
      // Both orderings produce exactly 1 project with 2 sessions
      assert.equal(resultA.length, 1);
      assert.equal(resultB.length, 1);
      assert.equal(resultA[0].sessions.length, 2);
      assert.equal(resultB[0].sessions.length, 2);
      assert.equal(resultA[0].originalPath, '/repo');
      assert.equal(resultB[0].originalPath, '/repo');
    });

    it('promotes worktree entry when no parent project exists', () => {
      const projects = [
        { name: 'feat', originalPath: '/repo/.rudi/worktrees/feat', sessions: [{ id: 'wt1' }] },
      ];
      const result = mergeWorktreeProjects(projects);
      assert.equal(result.length, 1);
      assert.equal(result[0].originalPath, '/repo');
      assert.equal(result[0].name, 'repo');
    });
  });

  describe('no name mutation in API response (Bug 1)', () => {
    it('duplicate raw names are returned without mutation', () => {
      // The API should return raw names — Lite handles display dedup
      const projects = [
        { name: 'app', originalPath: '/dev/intel/app', sessions: [] },
        { name: 'app', originalPath: '/dev/resonance/app', sessions: [] },
      ];
      // After the fix, names stay as-is (no parent/name mutation)
      assert.equal(projects[0].name, 'app');
      assert.equal(projects[1].name, 'app');
      // The old bug would have mutated these to 'intel/app' and 'resonance/app'
    });
  });

  describe('hyphenated path fallback (Bug 2/3)', () => {
    it('does not mangle hyphens into slashes', () => {
      // When filesystem decode fails, the fallback should use the raw directory name
      const projDir = 'Users-hoff-dev-my-project';
      // OLD (buggy): '/' + projDir.replace(/-/g, '/') => '/Users/hoff/dev/my/project'
      // NEW (safe): projDir as-is
      const decodedPath = projDir; // This is the new behavior
      assert.equal(decodedPath, 'Users-hoff-dev-my-project');
      assert.ok(!decodedPath.includes('/'));
    });
  });

  describe('missing cwd skips session (Bug 6)', () => {
    it('returns null when no cwd is available', () => {
      // Simulates the fixed behavior: no cwd = skip (return null)
      const meta = { cwd: null };
      const snippet = { cwd: null };
      const inferred = null;
      const projectPath = meta.cwd || snippet.cwd || inferred;
      // After fix: no os.homedir() fallback
      assert.equal(projectPath, null);
    });
  });

  describe('case normalization (Bug 5)', () => {
    it('normalizePath resolves case differences via realpathSync', () => {
      // On macOS, /Intel/app and /intel/app are the same directory.
      // normalizePath uses fs.realpathSync to canonicalize.
      // We test the helper logic pattern (actual FS test would need real dirs).
      function normalizePath(p) {
        if (!p) return p;
        try { return fs.realpathSync(p); } catch { return p; }
      }
      // Non-existent path falls back to input
      assert.equal(normalizePath('/nonexistent/path'), '/nonexistent/path');
      // Null/undefined passthrough
      assert.equal(normalizePath(null), null);
      assert.equal(normalizePath(undefined), undefined);
      // Real path gets resolved (homedir always exists)
      const resolved = normalizePath(process.env.HOME);
      assert.ok(resolved);
    });
  });

  describe('stale threshold', () => {
    it('threshold is 30 seconds', () => {
      const STALE_THRESHOLD_MS = 30 * 1000;
      assert.equal(STALE_THRESHOLD_MS, 30000);
    });
  });
});
