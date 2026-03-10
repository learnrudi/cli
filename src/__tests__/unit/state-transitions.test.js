import { test } from 'node:test';
import assert from 'node:assert/strict';

import { transitionSessionStatus } from '../../commands/agent/db.js';
import { clampedInt } from '../../commands/serve.js';

function createRuntimeStateDb(initialStatus = 'starting') {
  const row = {
    session_id: 'session-1',
    status: initialStatus,
    updated_at: 'before',
    completed_at: null,
    last_error: null,
  };

  return {
    row,
    prepare(sql) {
      if (sql.includes('UPDATE session_runtime_state')) {
        return {
          run(...params) {
            let idx = 0;
            const nextStatus = params[idx++];
            const updatedAt = params[idx++];
            let lastError;
            let completedAt;

            if (sql.includes('last_error = ?')) {
              lastError = params[idx++];
            }
            if (sql.includes('completed_at = ?')) {
              completedAt = params[idx++];
            }

            const sessionId = params[idx++];
            const allowedFrom = params.slice(idx);
            if (sessionId !== row.session_id) return { changes: 0 };
            if (!allowedFrom.includes(row.status)) return { changes: 0 };

            row.status = nextStatus;
            row.updated_at = updatedAt;
            if (sql.includes('last_error = ?')) row.last_error = lastError;
            if (sql.includes('completed_at = ?')) row.completed_at = completedAt;
            return { changes: 1 };
          },
        };
      }

      if (sql.includes('SELECT status FROM session_runtime_state')) {
        return {
          get(sessionId) {
            if (sessionId !== row.session_id) return undefined;
            return { status: row.status };
          },
        };
      }

      throw new Error(`Unexpected SQL in test: ${sql}`);
    },
  };
}

test('transitionSessionStatus allows starting -> running', () => {
  const db = createRuntimeStateDb('starting');

  const changed = transitionSessionStatus(db, 'session-1', 'running');

  assert.equal(changed, true);
  assert.equal(db.row.status, 'running');
  assert.notEqual(db.row.updated_at, 'before');
});

test('transitionSessionStatus rejects completed -> running and warns', (t) => {
  const db = createRuntimeStateDb('completed');
  const warnings = [];
  t.mock.method(console, 'warn', (...args) => {
    warnings.push(args);
  });

  const changed = transitionSessionStatus(db, 'session-1', 'running');

  assert.equal(changed, false);
  assert.equal(db.row.status, 'completed');
  assert.equal(warnings.length, 1);
  assert.match(String(warnings[0][1]), /completed -> running/);
});

test('transitionSessionStatus records terminal metadata', () => {
  const db = createRuntimeStateDb('running');
  const completedAt = '2026-03-08T12:00:00.000Z';

  const changed = transitionSessionStatus(db, 'session-1', 'error', {
    lastError: 'spawn failed',
    completedAt,
  });

  assert.equal(changed, true);
  assert.equal(db.row.status, 'error');
  assert.equal(db.row.last_error, 'spawn failed');
  assert.equal(db.row.completed_at, completedAt);
});

test('transitionSessionStatus can force a terminal rewrite when allowed', () => {
  const db = createRuntimeStateDb('completed');
  const completedAt = '2026-03-08T12:30:00.000Z';

  const changed = transitionSessionStatus(db, 'session-1', 'crashed', {
    completedAt,
    allowTerminalUpdate: true,
  });

  assert.equal(changed, true);
  assert.equal(db.row.status, 'crashed');
  assert.equal(db.row.completed_at, completedAt);
});

test('clampedInt falls back and enforces bounds', () => {
  assert.equal(clampedInt(undefined, { min: 1, max: 100, fallback: 10 }), 10);
  assert.equal(clampedInt('-5', { min: 1, max: 100, fallback: 10 }), 1);
  assert.equal(clampedInt('250', { min: 1, max: 100, fallback: 10 }), 100);
  assert.equal(clampedInt('25', { min: 1, max: 100, fallback: 10 }), 25);
});
