import { test } from 'node:test';
import assert from 'node:assert';
import { parseWorktreeList } from '../../commands/serve/git.js';

test('parseWorktreeList parses single worktree', () => {
  const output = [
    'worktree /Users/hoff/dev/nba-props',
    'HEAD abc123def456',
    'branch refs/heads/main',
    '',
  ].join('\n');

  const result = parseWorktreeList(output);
  assert.strictEqual(result.length, 1);
  assert.deepStrictEqual(result[0], {
    path: '/Users/hoff/dev/nba-props',
    head: 'abc123def456',
    branch: 'main',
    bare: false,
    detached: false,
  });
});

test('parseWorktreeList parses multiple worktrees', () => {
  const output = [
    'worktree /Users/hoff/dev/nba-props',
    'HEAD abc123',
    'branch refs/heads/main',
    '',
    'worktree /Users/hoff/dev/nba-props--line-movement',
    'HEAD def456',
    'branch refs/heads/feature/line-movement',
    '',
  ].join('\n');

  const result = parseWorktreeList(output);
  assert.strictEqual(result.length, 2);
  assert.strictEqual(result[0].branch, 'main');
  assert.strictEqual(result[0].path, '/Users/hoff/dev/nba-props');
  assert.strictEqual(result[1].branch, 'feature/line-movement');
  assert.strictEqual(result[1].path, '/Users/hoff/dev/nba-props--line-movement');
});

test('parseWorktreeList handles detached HEAD', () => {
  const output = [
    'worktree /Users/hoff/dev/nba-props--detached',
    'HEAD abc123',
    'detached',
    '',
  ].join('\n');

  const result = parseWorktreeList(output);
  assert.strictEqual(result.length, 1);
  assert.strictEqual(result[0].detached, true);
  assert.strictEqual(result[0].branch, '');
});

test('parseWorktreeList handles bare repo', () => {
  const output = [
    'worktree /Users/hoff/dev/repo.git',
    'HEAD abc123',
    'bare',
    '',
    'worktree /Users/hoff/dev/repo-wt',
    'HEAD def456',
    'branch refs/heads/main',
    '',
  ].join('\n');

  const result = parseWorktreeList(output);
  assert.strictEqual(result.length, 2);
  assert.strictEqual(result[0].bare, true);
  assert.strictEqual(result[0].branch, '');
  assert.strictEqual(result[1].bare, false);
  assert.strictEqual(result[1].branch, 'main');
});

test('parseWorktreeList handles empty output', () => {
  const result = parseWorktreeList('');
  assert.strictEqual(result.length, 0);
});
