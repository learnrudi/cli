import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  createRunGroupCompletedEvent,
  createRunGroupFailureResult,
  createRunGroupSessionActivityEvent,
  createRunGroupSessionDoneEvent,
  createRunGroupStartedEvent,
  createRunGroupStoppedEvent,
  createRunGroupSuccessResult,
} from '../../commands/agent/run-group-domain.js';

test('createRunGroupSuccessResult returns an explicit success contract', () => {
  assert.deepEqual(createRunGroupSuccessResult({
    groupId: 'group-1',
    status: 'running',
    sessionIds: ['sess-1', 'sess-2'],
    startedSessionIds: ['sess-1'],
    errors: [{ sessionId: 'sess-2', message: 'spawn failed' }],
  }), {
    ok: true,
    groupId: 'group-1',
    status: 'running',
    sessionIds: ['sess-1', 'sess-2'],
    startedSessionIds: ['sess-1'],
    errors: [{ sessionId: 'sess-2', message: 'spawn failed' }],
  });
});

test('createRunGroupFailureResult returns an explicit failure contract', () => {
  assert.deepEqual(createRunGroupFailureResult({
    code: 'RUN_GROUP_INVALID_REQUEST',
    error: 'run-group requires between 2 and 10 tasks',
    statusCode: 400,
  }), {
    ok: false,
    code: 'RUN_GROUP_INVALID_REQUEST',
    error: 'run-group requires between 2 and 10 tasks',
    message: null,
    statusCode: 400,
  });
});

test('createRunGroupStartedEvent preserves the public started payload shape', () => {
  assert.deepEqual(createRunGroupStartedEvent({
    groupId: 'group-1',
    sessionIds: ['sess-1', 'sess-2'],
    activeSessionIds: ['sess-1'],
  }), {
    groupId: 'group-1',
    sessionIds: ['sess-1', 'sess-2'],
    activeSessionIds: ['sess-1'],
  });
});

test('createRunGroupSessionDoneEvent preserves the public session-done payload shape', () => {
  assert.deepEqual(createRunGroupSessionDoneEvent({
    groupId: 'group-1',
    sessionId: 'sess-1',
    status: 'completed',
  }), {
    groupId: 'group-1',
    sessionId: 'sess-1',
    status: 'completed',
    contractValidation: null,
  });
});

test('createRunGroupCompletedEvent preserves the public completed payload shape', () => {
  assert.deepEqual(createRunGroupCompletedEvent({
    groupId: 'group-1',
    status: 'partial',
    completedCount: '2',
    failedCount: 1,
  }), {
    groupId: 'group-1',
    status: 'partial',
    completedCount: 2,
    failedCount: 1,
  });
});

test('createRunGroupStoppedEvent preserves the public stopped payload shape', () => {
  assert.deepEqual(createRunGroupStoppedEvent({ groupId: 'group-1' }), {
    groupId: 'group-1',
  });
});

test('createRunGroupSessionActivityEvent preserves the public session-activity payload shape', () => {
  assert.deepEqual(createRunGroupSessionActivityEvent({
    groupId: 'group-1',
    sessionId: 'sess-1',
    turnCount: '3',
    costTotal: '1.25',
  }), {
    groupId: 'group-1',
    sessionId: 'sess-1',
    turnCount: 3,
    costTotal: 1.25,
    lastSnippet: null,
  });
});
