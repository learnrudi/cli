import { test } from 'node:test';
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import { initSchemaWithDb } from '@learnrudi/db/schema';
import {
  findSessionIdentityRow,
  resolveSessionRowIdentity,
} from '@learnrudi/db/session-identity';
import { repairLegacySessionIdentity } from '../../commands/import.js';

function withDb(fn) {
  const db = new Database(':memory:');
  initSchemaWithDb(db);
  try {
    fn(db);
  } finally {
    db.close();
  }
}

test('resolveSessionRowIdentity reuses a legacy row keyed by provider_session_id', () => {
  withDb((db) => {
    const now = new Date().toISOString();
    db.prepare(`
      INSERT INTO sessions (id, provider, provider_session_id, origin, status, created_at, last_active_at)
      VALUES (?, 'codex', ?, 'provider-import', 'active', ?, ?)
    `).run('legacy-row-id', 'native-session-id', now, now);

    const resolved = resolveSessionRowIdentity(db, 'codex', 'native-session-id');

    assert.equal(resolved.rowId, 'legacy-row-id');
    assert.equal(resolved.existed, true);
    assert.equal(resolved.row?.provider_session_id, 'native-session-id');
  });
});

test('findSessionIdentityRow prefers exact internal ids and ignores deleted rows by default', () => {
  withDb((db) => {
    const now = new Date().toISOString();
    db.prepare(`
      INSERT INTO sessions (id, provider, provider_session_id, origin, status, created_at, last_active_at)
      VALUES (?, 'claude', ?, 'provider-import', 'active', ?, ?)
    `).run('active-row-id', 'shared-native-id', now, now);
    db.prepare(`
      INSERT INTO sessions (id, provider, provider_session_id, origin, status, created_at, last_active_at, deleted_at)
      VALUES (?, 'claude', ?, 'provider-import', 'deleted', ?, ?, ?)
    `).run('deleted-row-id', 'deleted-native-id', now, now, now);

    const byId = findSessionIdentityRow(db, {
      provider: 'claude',
      sessionId: 'active-row-id',
    });
    const deletedDefault = findSessionIdentityRow(db, {
      provider: 'claude',
      sessionId: 'deleted-native-id',
    });
    const deletedIncluded = findSessionIdentityRow(db, {
      provider: 'claude',
      sessionId: 'deleted-native-id',
      includeDeleted: true,
    });

    assert.equal(byId?.id, 'active-row-id');
    assert.equal(deletedDefault, null);
    assert.equal(deletedIncluded?.id, 'deleted-row-id');
  });
});

test('repairLegacySessionIdentity relinks broken child rows onto the canonical session id', () => {
  withDb((db) => {
    const now = new Date().toISOString();
    db.prepare(`
      INSERT INTO sessions (id, provider, provider_session_id, origin, status, created_at, last_active_at, turn_count)
      VALUES (?, 'claude', ?, 'provider-import', 'active', ?, ?, 0)
    `).run('legacy-row-id', 'native-session-id', now, now);

    db.pragma('foreign_keys = OFF');
    db.prepare(`
      INSERT INTO turns (id, session_id, provider, provider_session_id, turn_number, ts)
      VALUES (?, ?, 'claude', ?, 1, ?)
    `).run('broken-turn-id', 'native-session-id', 'native-session-id', now);
    db.pragma('foreign_keys = ON');

    const dryRun = repairLegacySessionIdentity(db, {
      providers: ['claude'],
      dryRun: true,
    });
    assert.equal(dryRun.needsRelink, 1);
    assert.equal(dryRun.relinked, 0);

    const applied = repairLegacySessionIdentity(db, {
      providers: ['claude'],
      dryRun: false,
    });
    const repairedTurn = db.prepare(`
      SELECT session_id
      FROM turns
      WHERE id = 'broken-turn-id'
    `).get();
    const repairedSession = db.prepare(`
      SELECT turn_count
      FROM sessions
      WHERE id = 'legacy-row-id'
    `).get();

    assert.equal(applied.relinked, 1);
    assert.equal(applied.touchedRows, 1);
    assert.equal(applied.foreignKeyViolations, 0);
    assert.equal(repairedTurn.session_id, 'legacy-row-id');
    assert.equal(repairedSession.turn_count, 1);
  });
});
