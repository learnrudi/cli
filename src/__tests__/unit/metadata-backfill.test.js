import { after, beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import Database from 'better-sqlite3';
import { initSchemaWithDb } from '@learnrudi/db/schema';

const originalHome = process.env.HOME;
const tempRoot = path.join(os.tmpdir(), 'rudi-metadata-backfill');
fs.mkdirSync(tempRoot, { recursive: true });

let tempHomeRoot = null;

beforeEach(async () => {
  if (tempHomeRoot) {
    await fsp.rm(tempHomeRoot, { recursive: true, force: true });
  }
  tempHomeRoot = await fsp.mkdtemp(path.join(tempRoot, 'metadata-backfill-'));
  process.env.HOME = tempHomeRoot;
});

after(async () => {
  process.env.HOME = originalHome;
  if (tempHomeRoot) {
    await fsp.rm(tempHomeRoot, { recursive: true, force: true });
  }
});

test('metadata backfill reuses legacy agent rows keyed by provider_session_id', async () => {
  const db = new Database(':memory:');
  initSchemaWithDb(db);

  const logs = [];
  const now = new Date().toISOString();
  const projDir = 'proj-meta';
  const projectPath = path.join(tempHomeRoot, '.claude', 'projects', projDir);
  const sessionId = 'agent-a123456';
  const rowId = 'legacy-agent-row-id';
  const filePath = path.join(projectPath, `${sessionId}.jsonl`);

  await fsp.mkdir(projectPath, { recursive: true });
  await fsp.writeFile(
    filePath,
    [
      JSON.stringify({
        cwd: '/tmp/task-cwd',
        gitBranch: 'feature/agent',
        isSidechain: true,
        sessionId: 'parent-session-id',
        agentId: 'a123456',
      }),
      JSON.stringify({ message: { model: 'claude-3-7-sonnet' } }),
      '',
    ].join('\n'),
    'utf-8',
  );

  db.prepare(`
    INSERT INTO sessions (
      id, provider, provider_session_id, origin, status,
      session_type, created_at, last_active_at
    )
    VALUES (?, 'claude', ?, 'provider-import', 'active', 'task', ?, ?)
  `).run(rowId, sessionId, now, now);

  try {
    const { createMetadataBackfillModule } = await import(`../../commands/sessions/metadata-backfill.js?ts=${Date.now()}`);
    const module = createMetadataBackfillModule({
      log: (_scope, level, message) => logs.push({ level, message }),
      resolveDb: () => db,
      broadcast: () => {},
    });

    const result = await module.backfillMetadata();
    const row = db.prepare(`
      SELECT id, provider_session_id, cwd, project_path, git_branch, model,
             parent_session_id, agent_id, is_sidechain, session_type
      FROM sessions
      WHERE provider = 'claude' AND provider_session_id = ?
    `).get(sessionId);
    const count = db.prepare(`
      SELECT COUNT(*) as c
      FROM sessions
      WHERE provider = 'claude' AND provider_session_id = ?
    `).get(sessionId).c;

    assert.equal(result.errors, 0);
    assert.equal(count, 1);
    assert.equal(row.id, rowId);
    assert.equal(row.provider_session_id, sessionId);
    assert.equal(row.cwd, '/tmp/task-cwd');
    assert.equal(row.project_path, '/proj/meta');
    assert.equal(row.git_branch, 'feature/agent');
    assert.equal(row.model, 'claude-3-7-sonnet');
    assert.equal(row.parent_session_id, 'parent-session-id');
    assert.equal(row.agent_id, 'a123456');
    assert.equal(row.is_sidechain, 1);
    assert.equal(row.session_type, 'task');
    assert.equal(
      logs.some((entry) => entry.message.includes('error inserting orphan')),
      false,
    );
  } finally {
    db.close();
  }
});
