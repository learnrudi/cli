import assert from 'node:assert';
import test from 'node:test';

import Database from 'better-sqlite3';
import { initSchemaWithDb } from '@learnrudi/db/schema';
import {
  buildEnrichmentPrompt,
  getAttemptTimeoutMs,
  getRetryDelayMs,
  parseEnrichmentResponse,
  resolveEnrichmentRuntimeConfig,
  shouldRetryEnrichmentFailure,
  writeEnrichment,
} from '../../commands/sessions/title-backfill.js';

function insertSession(db, sessionId) {
  const now = new Date().toISOString();
  db.prepare(`
    INSERT INTO sessions (id, provider, provider_session_id, origin, status, created_at, last_active_at)
    VALUES (?, 'claude', NULL, 'rudi', 'active', ?, ?)
  `).run(sessionId, now, now);
}

function ensureEnrichmentColumns(db) {
  try { db.exec('ALTER TABLE sessions ADD COLUMN description TEXT'); } catch {}
  try { db.exec('ALTER TABLE sessions ADD COLUMN enriched_at TEXT'); } catch {}
}

test('resolveEnrichmentRuntimeConfig clamps runtime overrides', () => {
  const config = resolveEnrichmentRuntimeConfig({
    maxConcurrency: 99,
    timeoutMs: 1000,
    delayMs: -1,
    maxAttempts: 0,
    retryBaseDelayMs: 999999,
  });

  assert.deepStrictEqual(config, {
    maxConcurrency: 20,
    timeoutMs: 5000,
    delayMs: 0,
    maxAttempts: 1,
    retryBaseDelayMs: 60000,
  });
});

test('retry helpers escalate timeout and only retry retryable failures', () => {
  assert.strictEqual(getAttemptTimeoutMs(45000, 1), 45000);
  assert.strictEqual(getAttemptTimeoutMs(45000, 2), 60000);
  assert.strictEqual(getRetryDelayMs(1, 1500), 1500);
  assert.strictEqual(getRetryDelayMs(2, 1500), 3000);
  assert.strictEqual(shouldRetryEnrichmentFailure('timeout', 1, 2), true);
  assert.strictEqual(shouldRetryEnrichmentFailure('missing_binary', 1, 2), false);
  assert.strictEqual(shouldRetryEnrichmentFailure('parse_error', 2, 2), false);
});

test('buildEnrichmentPrompt falls back to compact prompt on retry', () => {
  const full = buildEnrichmentPrompt(
    'Investigate a session',
    'Turn 1:\n  User: hi\n  Assistant: hello',
    { cwd: '/tmp/project', model: 'claude-sonnet', sessionType: 'task', parentSessionId: 'parent-1' },
    { compact: false },
  );
  const compact = buildEnrichmentPrompt(
    'Investigate a session',
    'Turn 1:\n  User: hi\n  Assistant: hello',
    { cwd: '/tmp/project', model: 'claude-sonnet', sessionType: 'task', parentSessionId: 'parent-1' },
    { compact: true },
  );

  assert.match(full, /Sample turns:/);
  assert.match(full, /subagent\/task spawned by a parent session/);
  assert.doesNotMatch(compact, /Sample turns:/);
  assert.match(compact, /keep the response concise/);
});

test('parseEnrichmentResponse normalizes fenced JSON responses', () => {
  const parsed = parseEnrichmentResponse(`
\`\`\`json
{"title":"Fix search ranking","description":"Updated ranking logic.","tags":["API"," Search ","bad!!!"]}
\`\`\`
`);

  assert.deepStrictEqual(parsed, {
    title: 'Fix search ranking',
    description: 'Updated ranking logic.',
    tags: ['api', 'search', 'bad'],
  });
});

test('writeEnrichment writes title, description, and tags atomically', () => {
  const db = new Database(':memory:');
  initSchemaWithDb(db);
  try {
    ensureEnrichmentColumns(db);
    insertSession(db, 'sid-success');
    const wrote = writeEnrichment(db, 'sid-success', {
      title: 'Review auth flow',
      description: 'Summarized the authentication changes.',
      tags: ['auth', 'review'],
    });

    assert.strictEqual(wrote, true);
    const session = db.prepare('SELECT title, description, enriched_at FROM sessions WHERE id = ?').get('sid-success');
    assert.strictEqual(session.title, 'Review auth flow');
    assert.strictEqual(session.description, 'Summarized the authentication changes.');
    assert.ok(session.enriched_at);

    const tags = db.prepare(`
      SELECT t.name
      FROM session_tags st
      JOIN tags t ON t.id = st.tag_id
      WHERE st.session_id = ?
      ORDER BY t.name
    `).all('sid-success').map((row) => row.name);
    assert.deepStrictEqual(tags, ['auth', 'review']);

    const secondWrite = writeEnrichment(db, 'sid-success', {
      title: 'Different title',
      description: 'Different description',
      tags: ['other'],
    });
    assert.strictEqual(secondWrite, false);
  } finally {
    db.close();
  }
});

test('writeEnrichment rolls back session update if tag write fails', () => {
  const db = new Database(':memory:');
  initSchemaWithDb(db);
  try {
    ensureEnrichmentColumns(db);
    insertSession(db, 'sid-rollback');
    db.exec('DROP TABLE session_tags');

    assert.throws(() => {
      writeEnrichment(db, 'sid-rollback', {
        title: 'Should rollback',
        description: 'This write should fail atomically.',
        tags: ['broken'],
      });
    });

    const session = db.prepare('SELECT title, description, enriched_at FROM sessions WHERE id = ?').get('sid-rollback');
    assert.strictEqual(session.title, null);
    assert.strictEqual(session.description, null);
    assert.strictEqual(session.enriched_at, null);
  } finally {
    db.close();
  }
});
