import { test } from 'node:test';
import assert from 'node:assert';
import crypto from 'node:crypto';
import Database from 'better-sqlite3';
import { initSchemaWithDb } from '@learnrudi/db/schema';
import { shouldRunInitialTurnBackfill } from '../../commands/serve.js';

function withDb(fn) {
  const db = new Database(':memory:');
  initSchemaWithDb(db);
  try {
    fn(db);
  } finally {
    db.close();
  }
}

function insertSession(db, sessionId, status = 'active') {
  const now = new Date().toISOString();
  db.prepare(`
    INSERT INTO sessions (id, provider, provider_session_id, origin, status, created_at, last_active_at)
    VALUES (?, 'claude', ?, 'provider-import', ?, ?, ?)
  `).run(sessionId, sessionId, status, now, now);
}

function insertTurn(db, sessionId, turnNumber = 1) {
  const now = new Date().toISOString();
  db.prepare(`
    INSERT INTO turns (id, session_id, provider, provider_session_id, turn_number, ts)
    VALUES (?, ?, 'claude', ?, ?, ?)
  `).run(crypto.randomUUID(), sessionId, sessionId, turnNumber, now);
}

test('shouldRunInitialTurnBackfill returns false for null db', () => {
  assert.strictEqual(shouldRunInitialTurnBackfill(null), false);
});

test('shouldRunInitialTurnBackfill returns false for invalid db object', () => {
  assert.strictEqual(shouldRunInitialTurnBackfill({}), false);
});

test('shouldRunInitialTurnBackfill returns false when no sessions exist', () => {
  withDb((db) => {
    assert.strictEqual(shouldRunInitialTurnBackfill(db), false);
  });
});

test('shouldRunInitialTurnBackfill returns true when sessions exist but turns are empty', () => {
  withDb((db) => {
    insertSession(db, 'sid-backfill-yes');
    assert.strictEqual(shouldRunInitialTurnBackfill(db), true);
  });
});

test('shouldRunInitialTurnBackfill returns false when at least one turn exists', () => {
  withDb((db) => {
    insertSession(db, 'sid-backfill-no');
    insertTurn(db, 'sid-backfill-no', 1);
    assert.strictEqual(shouldRunInitialTurnBackfill(db), false);
  });
});

test('shouldRunInitialTurnBackfill ignores deleted sessions', () => {
  withDb((db) => {
    insertSession(db, 'sid-deleted', 'deleted');
    assert.strictEqual(shouldRunInitialTurnBackfill(db), false);
  });
});
