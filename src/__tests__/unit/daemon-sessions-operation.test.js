import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  applySessionDbMetadata,
  applySessionTags,
  mergeWorktreeSessionProjects,
} from '../../daemon/operations/sessions.js';

test('applySessionDbMetadata preserves the sessions/projects DB overlay shape', () => {
  const session = {
    sessionId: 'provider-session-1',
    provider: 'codex',
    originNativeFile: '/already/from-provider.jsonl',
  };

  assert.equal(applySessionDbMetadata(session, {
    title: 'Generated title',
    title_override: 'Pinned title',
    description: 'A useful session',
    total_cost: 1.25,
    total_input_tokens: 100,
    total_output_tokens: 40,
    turn_count: 3,
    parent_session_id: 'parent-1',
    is_sidechain: 1,
    session_type: 'task',
    origin_native_file: '/from/db.jsonl',
  }), session);

  assert.deepEqual(session, {
    sessionId: 'provider-session-1',
    provider: 'codex',
    originNativeFile: '/already/from-provider.jsonl',
    dbTitle: 'Pinned title',
    description: 'A useful session',
    totalCost: 1.25,
    totalInputTokens: 100,
    totalOutputTokens: 40,
    turnCount: 3,
    parentSessionId: 'parent-1',
    isSidechain: true,
    sessionType: 'task',
  });
});

test('applySessionDbMetadata fills originNativeFile only when provider discovery did not', () => {
  const session = { sessionId: 'session-1', provider: 'claude' };
  applySessionDbMetadata(session, {
    title: 'Title',
    title_override: null,
    origin_native_file: '/from/db.jsonl',
  });

  assert.equal(session.dbTitle, 'Title');
  assert.equal(session.originNativeFile, '/from/db.jsonl');
});

test('applySessionTags only attaches non-empty tag arrays', () => {
  const session = { sessionId: 'session-1' };
  applySessionTags(session, []);
  assert.deepEqual(session, { sessionId: 'session-1' });

  applySessionTags(session, ['review', 'priority']);
  assert.deepEqual(session.tags, ['review', 'priority']);
});

test('mergeWorktreeSessionProjects folds worktree sessions into their parent project', () => {
  const merged = mergeWorktreeSessionProjects([
    {
      name: 'RUDI',
      originalPath: '/Users/hoff/dev/RUDI',
      sessions: [{
        sessionId: 'parent-old',
        modified: '2026-05-17T10:00:00.000Z',
      }],
    },
    {
      name: 'main',
      originalPath: '/Users/hoff/dev/RUDI/.rudi/worktrees/main',
      sessions: [{
        sessionId: 'worktree-new',
        modified: '2026-05-17T11:00:00.000Z',
      }],
    },
  ]);

  assert.equal(merged.length, 1);
  assert.equal(merged[0].originalPath, '/Users/hoff/dev/RUDI');
  assert.deepEqual(merged[0].sessions.map(session => session.sessionId), [
    'worktree-new',
    'parent-old',
  ]);
});

test('mergeWorktreeSessionProjects promotes orphaned worktree projects to the real root', () => {
  const merged = mergeWorktreeSessionProjects([
    {
      name: 'feature',
      originalPath: '/Users/hoff/dev/RUDI/.rudi/worktrees/feature',
      sessions: [{
        sessionId: 'worktree-only',
        modified: '2026-05-17T11:00:00.000Z',
      }],
    },
  ]);

  assert.deepEqual(merged, [{
    name: 'RUDI',
    originalPath: '/Users/hoff/dev/RUDI',
    sessions: [{
      sessionId: 'worktree-only',
      modified: '2026-05-17T11:00:00.000Z',
    }],
  }]);
});
