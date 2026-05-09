import { after, beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import Database from 'better-sqlite3';
import { initSchemaWithDb } from '@learnrudi/db/schema';

const originalHome = process.env.HOME;
const tempRoot = path.join(os.tmpdir(), 'rudi-sessions-db-reconcile');
fs.mkdirSync(tempRoot, { recursive: true });

let tempHomeRoot = null;

beforeEach(async () => {
  if (tempHomeRoot) {
    await fsp.rm(tempHomeRoot, { recursive: true, force: true });
  }
  tempHomeRoot = await fsp.mkdtemp(path.join(tempRoot, 'sessions-db-reconcile-'));
  process.env.HOME = tempHomeRoot;
});

after(async () => {
  process.env.HOME = originalHome;
  if (tempHomeRoot) {
    await fsp.rm(tempHomeRoot, { recursive: true, force: true });
  }
});

test('reconcileSessionsToDb reuses existing rows keyed by provider_session_id', async () => {
  const db = new Database(':memory:');
  initSchemaWithDb(db);

  const projectDir = path.join(tempHomeRoot, '.claude', 'projects', 'proj-legacy');
  const sessionId = 'session-legacy-id';
  const rowId = 'legacy-random-row-id';
  const filePath = path.join(projectDir, `${sessionId}.jsonl`);
  const now = new Date().toISOString();
  const logs = [];

  await fsp.mkdir(projectDir, { recursive: true });
  await fsp.writeFile(filePath, '\n', 'utf-8');

  db.prepare(`
    INSERT INTO sessions (id, provider, provider_session_id, origin, status, created_at, last_active_at)
    VALUES (?, 'claude', ?, 'provider-import', 'active', ?, ?)
  `).run(rowId, sessionId, now, now);

  try {
    const { createSessionsDbModule } = await import(`../../commands/sessions/db.js?ts=${Date.now()}`);
    const module = createSessionsDbModule({
      log: (_scope, level, message) => logs.push({ level, message }),
      resolveDb: () => db,
      caches: {
        diffStatsCache: new Map(),
        gitStatusCache: new Map(),
        sessionPathMap: new Map(),
        GIT_STATUS_TTL_MS: 0,
      },
      onProjectsReady: () => {},
    });

    try {
      await module.reconcileSessionsToDb();
    } finally {
      module.cleanup();
    }

    const row = db.prepare(`
      SELECT id, provider_session_id, origin_native_file
      FROM sessions
      WHERE provider = 'claude' AND provider_session_id = ? AND status != 'deleted'
    `).get(sessionId);
    const count = db.prepare(`
      SELECT COUNT(*) as c
      FROM sessions
      WHERE provider = 'claude' AND provider_session_id = ? AND status != 'deleted'
    `).get(sessionId).c;

    assert.equal(count, 1);
    assert.equal(row.id, rowId);
    assert.equal(row.origin_native_file, filePath);
    assert.equal(
      logs.some((entry) => entry.message.includes('[reconcile.claude] INSERT failed')),
      false,
    );
  } finally {
    db.close();
  }
});

test('periodicReconcile prunes sessions whose native files disappear after startup', async () => {
  const db = new Database(':memory:');
  initSchemaWithDb(db);

  const projectDir = path.join(tempHomeRoot, '.claude', 'projects', 'proj-prune');
  const sessionId = 'session-prune-id';
  const filePath = path.join(projectDir, `${sessionId}.jsonl`);
  const turnTs = new Date().toISOString();
  const logs = [];

  await fsp.mkdir(projectDir, { recursive: true });
  await fsp.writeFile(filePath, '\n', 'utf-8');

  try {
    const { createSessionsDbModule } = await import(`../../commands/sessions/db.js?ts=${Date.now()}`);
    const module = createSessionsDbModule({
      log: (_scope, level, message) => logs.push({ level, message }),
      resolveDb: () => db,
      caches: {
        diffStatsCache: new Map(),
        gitStatusCache: new Map(),
        sessionPathMap: new Map(),
        GIT_STATUS_TTL_MS: 0,
      },
      onProjectsReady: () => {},
    });

    try {
      await module.reconcileSessionsToDb();

      db.prepare(`
        INSERT INTO turns (id, session_id, provider, provider_session_id, turn_number, ts)
        VALUES (?, ?, 'claude', ?, 1, ?)
      `).run('turn-prune-id', sessionId, sessionId, turnTs);

      await fsp.rm(filePath, { force: true });
      await module.periodicReconcile();
    } finally {
      module.cleanup();
    }

    const session = db.prepare(`
      SELECT status, deleted_at
      FROM sessions
      WHERE id = ?
    `).get(sessionId);
    const turnCount = db.prepare(`
      SELECT COUNT(*) as c
      FROM turns
      WHERE session_id = ?
    `).get(sessionId).c;

    assert.equal(session.status, 'deleted');
    assert.ok(session.deleted_at);
    assert.equal(turnCount, 0);
    assert.equal(
      logs.some((entry) => entry.message.includes('[reconcile.claude] pruned 1 missing sessions')),
      true,
    );
  } finally {
    db.close();
  }
});

test('reconcileSessionsToDb purges tool calls before deleting turns for deleted sessions', async () => {
  const db = new Database(':memory:');
  initSchemaWithDb(db);
  const logs = [];
  const now = new Date().toISOString();

  db.prepare(`
    INSERT INTO sessions (id, provider, provider_session_id, origin, status, created_at, last_active_at, deleted_at)
    VALUES (?, 'claude', ?, 'provider-import', 'deleted', ?, ?, ?)
  `).run('deleted-session-id', 'deleted-session-id', now, now, now);

  db.pragma('foreign_keys = OFF');
  db.prepare(`
    INSERT INTO turns (id, session_id, provider, provider_session_id, turn_number, ts)
    VALUES (?, ?, 'claude', ?, 1, ?)
  `).run('deleted-turn-id', 'deleted-session-id', 'deleted-session-id', now);
  db.prepare(`
    INSERT INTO tool_calls (id, session_id, turn_id, provider, tool_name, success, ts_ms)
    VALUES (?, ?, ?, 'claude', 'Read', 1, 0)
  `).run('deleted-tool-call-id', 'deleted-session-id', 'deleted-turn-id');
  db.pragma('foreign_keys = ON');

  try {
    const { createSessionsDbModule } = await import(`../../commands/sessions/db.js?ts=${Date.now()}`);
    const module = createSessionsDbModule({
      log: (_scope, level, message) => logs.push({ level, message }),
      resolveDb: () => db,
      caches: {
        diffStatsCache: new Map(),
        gitStatusCache: new Map(),
        sessionPathMap: new Map(),
        GIT_STATUS_TTL_MS: 0,
      },
      onProjectsReady: () => {},
    });

    try {
      await module.reconcileSessionsToDb();
    } finally {
      module.cleanup();
    }

    const turnCount = db.prepare(`
      SELECT COUNT(*) as c
      FROM turns
      WHERE session_id = 'deleted-session-id'
    `).get().c;
    const toolCallCount = db.prepare(`
      SELECT COUNT(*) as c
      FROM tool_calls
      WHERE session_id = 'deleted-session-id'
    `).get().c;

    assert.equal(turnCount, 0);
    assert.equal(toolCallCount, 0);
    assert.equal(
      logs.some((entry) => entry.message.includes('purged 1 tool calls from deleted sessions')),
      true,
    );
  } finally {
    db.close();
  }
});

test('reconcileSessionsToDb prunes active missing sessions with tool calls', async () => {
  const db = new Database(':memory:');
  initSchemaWithDb(db);
  const logs = [];
  const now = new Date().toISOString();
  const projectDir = path.join(tempHomeRoot, '.claude', 'projects', 'proj-live');
  const liveFile = path.join(projectDir, 'live-session.jsonl');
  const missingFile = path.join(tempHomeRoot, '.claude', 'projects', 'proj-missing', 'missing-session.jsonl');

  await fsp.mkdir(projectDir, { recursive: true });
  await fsp.writeFile(liveFile, '\n', 'utf-8');

  db.prepare(`
    INSERT INTO sessions (
      id, provider, provider_session_id, origin, origin_native_file,
      status, created_at, last_active_at, turn_count
    )
    VALUES (?, 'claude', ?, 'provider-import', ?, 'active', ?, ?, 1)
  `).run('missing-session-id', 'missing-session-id', missingFile, now, now);

  db.prepare(`
    INSERT INTO turns (id, session_id, provider, provider_session_id, turn_number, ts)
    VALUES (?, ?, 'claude', ?, 1, ?)
  `).run('missing-turn-id', 'missing-session-id', 'missing-session-id', now);
  db.prepare(`
    INSERT INTO tool_calls (id, session_id, turn_id, provider, tool_name, success, ts_ms)
    VALUES (?, ?, ?, 'claude', 'Read', 1, 0)
  `).run('missing-tool-call-id', 'missing-session-id', 'missing-turn-id');

  try {
    const { createSessionsDbModule } = await import(`../../commands/sessions/db.js?ts=${Date.now()}`);
    const module = createSessionsDbModule({
      log: (_scope, level, message) => logs.push({ level, message }),
      resolveDb: () => db,
      caches: {
        diffStatsCache: new Map(),
        gitStatusCache: new Map(),
        sessionPathMap: new Map(),
        GIT_STATUS_TTL_MS: 0,
      },
      onProjectsReady: () => {},
    });

    try {
      await module.reconcileSessionsToDb();
    } finally {
      module.cleanup();
    }

    const session = db.prepare(`
      SELECT status, deleted_at
      FROM sessions
      WHERE id = 'missing-session-id'
    `).get();
    const turnCount = db.prepare(`
      SELECT COUNT(*) as c
      FROM turns
      WHERE session_id = 'missing-session-id'
    `).get().c;
    const toolCallCount = db.prepare(`
      SELECT COUNT(*) as c
      FROM tool_calls
      WHERE session_id = 'missing-session-id'
    `).get().c;

    assert.equal(session.status, 'deleted');
    assert.ok(session.deleted_at);
    assert.equal(turnCount, 0);
    assert.equal(toolCallCount, 0);
    assert.equal(
      logs.some((entry) => entry.message.includes('[reconcile.claude] pruned 1 missing sessions')),
      true,
    );
  } finally {
    db.close();
  }
});
