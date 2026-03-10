import assert from 'node:assert';
import test from 'node:test';

import {
  buildPhasePlan,
  normalizeCoordinationMode,
  normalizeExecutionMode,
  normalizeGroupTasks,
} from '../../commands/agent/group-spec.js';

test('normalizeExecutionMode keeps backward compatibility with useWorktree=false', () => {
  assert.strictEqual(normalizeExecutionMode(null, { useWorktree: false }), 'shared_cwd');
  assert.strictEqual(normalizeExecutionMode(null, { useWorktree: true }), 'worktree');
  assert.strictEqual(normalizeExecutionMode('readonly'), 'read_only');
  assert.strictEqual(normalizeExecutionMode('detached'), 'detached');
});

test('normalizeCoordinationMode defaults invalid input to flat', () => {
  assert.strictEqual(normalizeCoordinationMode(null), 'flat');
  assert.strictEqual(normalizeCoordinationMode('invalid'), 'flat');
  assert.strictEqual(normalizeCoordinationMode('phased'), 'phased');
});

test('normalizeGroupTasks preserves richer task metadata from orchestration plans', () => {
  const tasks = normalizeGroupTasks({
    tasks: [{
      prompt: 'Audit the auth flow',
      name: 'Auth audit',
      role: 'reviewer',
      goal: 'Find auth boundary risks',
      deliverable: 'Short report',
      rationale: 'Authentication is changing',
      provider: 'claude',
      model: 'haiku',
      files_touched: ['src/auth.ts'],
      depends_on: [0],
      requires_write: false,
      context_paths: ['/tmp/context.md'],
      artifacts_in: ['codebase-map.md'],
      artifacts_out: ['auth-findings.md'],
      extra_note: 'preserve me',
    }],
  }, { provider: 'claude', model: 'sonnet' });

  assert.strictEqual(tasks.length, 1);
  assert.deepStrictEqual(tasks[0], {
    prompt: 'Audit the auth flow',
    name: 'Auth audit',
    provider: 'claude',
    model: 'haiku',
    role: 'reviewer',
    goal: 'Find auth boundary risks',
    deliverable: 'Short report',
    rationale: 'Authentication is changing',
    filesTouched: ['src/auth.ts'],
    dependsOn: [0],
    requiresWrite: false,
    contextPaths: ['/tmp/context.md'],
    artifactsIn: ['codebase-map.md'],
    artifactsOut: ['auth-findings.md'],
    metadata: { extra_note: 'preserve me' },
  });
});

test('buildPhasePlan normalizes invalid phases and appends unassigned tasks', () => {
  const phases = buildPhasePlan(
    [{}, {}, {}, {}],
    [[1, 0, 1, 99], 'bad', [3], []],
  );

  assert.deepStrictEqual(phases, [[1, 0], [3], [2]]);
});
