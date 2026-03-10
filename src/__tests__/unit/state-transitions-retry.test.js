import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { transitionSessionStatus } from '../../commands/agent/db.js';

// Create a minimal mock DB that tracks the current status
function createMockDb(initialStatus) {
  const row = { status: initialStatus };
  return {
    row,
    prepare(sql) {
      return {
        run(...params) {
          // UPDATE session_runtime_state SET status = ?, updated_at = ?, ... WHERE session_id = ? AND status IN (...)
          if (sql.includes('UPDATE')) {
            // Params: [toStatus, timestamp, ...optional fields, sessionId, ...validFromStates]
            // Find sessionId by looking for 'test-session'
            const sessionIdIdx = params.indexOf('test-session');
            if (sessionIdIdx === -1) return { changes: 0 };

            const newStatus = params[0];
            const allowedStatuses = params.slice(sessionIdIdx + 1);

            if (allowedStatuses.includes(row.status)) {
              row.status = newStatus;
              return { changes: 1 };
            }
            return { changes: 0 };
          }
          return { changes: 0 };
        },
        get(...params) {
          if (sql.includes('SELECT status')) {
            return { status: row.status };
          }
          return null;
        },
      };
    },
  };
}

describe('retrying state transitions', () => {
  test('starting → retrying is valid', () => {
    const db = createMockDb('starting');
    const result = transitionSessionStatus(db, 'test-session', 'retrying');
    assert.equal(result, true);
    assert.equal(db.row.status, 'retrying');
  });

  test('running → retrying is valid', () => {
    const db = createMockDb('running');
    const result = transitionSessionStatus(db, 'test-session', 'retrying');
    assert.equal(result, true);
    assert.equal(db.row.status, 'retrying');
  });

  test('retrying → running is valid', () => {
    const db = createMockDb('retrying');
    const result = transitionSessionStatus(db, 'test-session', 'running');
    assert.equal(result, true);
    assert.equal(db.row.status, 'running');
  });

  test('retrying → error is valid', () => {
    const db = createMockDb('retrying');
    const result = transitionSessionStatus(db, 'test-session', 'error');
    assert.equal(result, true);
    assert.equal(db.row.status, 'error');
  });

  test('retrying → stopped is valid', () => {
    const db = createMockDb('retrying');
    const result = transitionSessionStatus(db, 'test-session', 'stopped');
    assert.equal(result, true);
    assert.equal(db.row.status, 'stopped');
  });

  test('retrying → crashed is valid', () => {
    const db = createMockDb('retrying');
    const result = transitionSessionStatus(db, 'test-session', 'crashed');
    assert.equal(result, true);
    assert.equal(db.row.status, 'crashed');
  });

  test('retrying → completed is INVALID (must go through running)', () => {
    const db = createMockDb('retrying');
    const result = transitionSessionStatus(db, 'test-session', 'completed');
    assert.equal(result, false);
    assert.equal(db.row.status, 'retrying'); // unchanged
  });

  test('error → retrying is INVALID (terminal state)', () => {
    const db = createMockDb('error');
    const result = transitionSessionStatus(db, 'test-session', 'retrying');
    assert.equal(result, false);
    assert.equal(db.row.status, 'error'); // unchanged
  });

  test('completed → retrying is INVALID (terminal state)', () => {
    const db = createMockDb('completed');
    const result = transitionSessionStatus(db, 'test-session', 'retrying');
    assert.equal(result, false);
    assert.equal(db.row.status, 'completed'); // unchanged
  });
});
