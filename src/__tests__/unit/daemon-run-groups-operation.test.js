import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  projectRunGroupDetailSession,
  projectRunGroupLiveSession,
} from '../../daemon/operations/run-groups.js';

test('projectRunGroupDetailSession preserves the detail route session shape', () => {
  const detail = projectRunGroupDetailSession({
    id: 'session-12345678',
    provider: 'claude',
    provider_session_id: 'provider-1',
    title: 'Task title',
    title_override: null,
    model: 'sonnet',
    cwd: '/tmp/project',
    session_status: 'active',
    started_at: null,
    ended_at: null,
    exit_code: null,
    error_code: null,
    error_message: null,
    created_at: '2026-05-17T12:00:00.000Z',
    last_active_at: '2026-05-17T12:01:00.000Z',
    turn_count: 1,
    total_cost: 0.25,
    runtime_status: 'starting',
    runtime_turn_count: 2,
    runtime_cost_total: 0.5,
    runtime_tokens_total: 1000,
    runtime_last_error: null,
    worktree_path: null,
    worktree_branch: null,
    base_branch: null,
    completed_at: null,
    validation_passed: 1,
    validation_errors_json: '[]',
    validation_warnings_json: '[{"message":"minor"}]',
    validated_at: '2026-05-17T12:02:00.000Z',
  }, {
    groupStatus: 'running',
    liveEntry: {
      proc: { killed: false, pid: 4321 },
      turnActive: true,
    },
    progress: {
      snippet: 'working',
      type: 'assistant',
      ts: '2026-05-17T12:03:00.000Z',
      source: 'live',
    },
  });

  assert.equal(detail.status, 'running');
  assert.equal(detail.alive, true);
  assert.equal(detail.turn_active, true);
  assert.equal(detail.pid, 4321);
  assert.equal(detail.last_progress_snippet, 'working');
  assert.equal(detail.validation_passed, true);
  assert.deepEqual(detail.validation_errors, []);
  assert.deepEqual(detail.validation_warnings, [{ message: 'minor' }]);
  assert.equal(detail.validated_at, '2026-05-17T12:02:00.000Z');
});

test('projectRunGroupDetailSession reports pending/stopped from group state without a live process', () => {
  assert.equal(projectRunGroupDetailSession({
    id: 'session-pending',
    session_status: 'active',
    runtime_status: null,
    validation_errors_json: null,
    validation_warnings_json: null,
  }, {
    groupStatus: 'running',
  }).status, 'pending');

  assert.equal(projectRunGroupDetailSession({
    id: 'session-stopped',
    session_status: 'active',
    runtime_status: null,
    validation_errors_json: null,
    validation_warnings_json: null,
  }, {
    groupStatus: 'stopped',
  }).status, 'stopped');
});

test('projectRunGroupLiveSession preserves the live route summary shape', () => {
  const live = projectRunGroupLiveSession({
    id: 'session-abcdef1234',
    title: 'Original title',
    title_override: 'Override title',
    session_status: 'active',
    runtime_status: 'completed',
    runtime_turn_count: '3',
    runtime_cost_total: '1.25',
    runtime_tokens_total: '4096',
    runtime_last_error: '',
    worktree_branch: 'rudi/session',
    validation_passed: 0,
  }, {
    groupStatus: 'partial',
    liveEntry: null,
    progress: {
      snippet: 'done',
      type: 'result',
      ts: '2026-05-17T12:04:00.000Z',
      source: 'runtime_event',
    },
  });

  assert.deepEqual(live, {
    sessionId: 'session-abcdef1234',
    name: 'Override title',
    status: 'completed',
    alive: false,
    turnActive: false,
    turnCount: 3,
    costTotal: 1.25,
    tokensTotal: 4096,
    lastError: null,
    lastSnippet: 'done',
    lastProgressType: 'result',
    lastProgressAt: '2026-05-17T12:04:00.000Z',
    lastProgressSource: 'runtime_event',
    worktreeBranch: 'rudi/session',
    validationPassed: false,
  });
});
