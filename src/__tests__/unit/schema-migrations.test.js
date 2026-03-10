import { test } from 'node:test';
import assert from 'node:assert';
import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import Database from 'better-sqlite3';
import { initSchemaWithDb } from '@learnrudi/db/schema';

test('migrations v19-v20 normalize raw JSON tool previews and recover file paths', async () => {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'rudi-schema-migration-'));
  const dbPath = path.join(tmp, 'test.db');
  const db = new Database(dbPath);

  try {
    db.exec(`
      CREATE TABLE schema_version (
        version INTEGER PRIMARY KEY,
        applied_at TEXT NOT NULL
      );

      CREATE TABLE tool_calls (
        id TEXT PRIMARY KEY,
        provider TEXT NOT NULL,
        tool_name TEXT NOT NULL,
        file_path TEXT,
        input_preview TEXT
      );
    `);

    db.prepare('INSERT INTO schema_version (version, applied_at) VALUES (?, ?)')
      .run(18, new Date('2026-03-07T00:00:00.000Z').toISOString());

    const insert = db.prepare(`
      INSERT INTO tool_calls (id, provider, tool_name, file_path, input_preview)
      VALUES (?, ?, ?, ?, ?)
    `);

    insert.run(
      'claude-bash',
      'claude',
      'Bash',
      null,
      JSON.stringify({ command: 'npm run build', description: 'Build the app' }),
    );
    insert.run(
      'claude-read',
      'claude',
      'Read',
      null,
      JSON.stringify({ file_path: '/tmp/demo.ts', offset: 1, limit: 100 }),
    );
    insert.run(
      'claude-glob',
      'claude',
      'Glob',
      null,
      JSON.stringify({ pattern: '**/*.ts', path: '/tmp/project' }),
    );
    insert.run(
      'codex-apply-patch',
      'codex',
      'apply_patch',
      null,
      JSON.stringify({
        apply_patch: [
          '*** Begin Patch',
          '*** Update File: /tmp/example.ts',
          '@@',
          '-const retries = 0;',
          '+const retries = 1;',
          '*** End Patch',
        ].join('\n'),
      }),
    );

    const result = initSchemaWithDb(db);
    assert.strictEqual(result.version, 22);
    assert.strictEqual(result.migrated, true);
    assert.strictEqual(result.from, 18);

    const rows = db.prepare(`
      SELECT id, file_path, input_preview
      FROM tool_calls
      ORDER BY id
    `).all();

    assert.deepStrictEqual(rows, [
      {
        id: 'claude-bash',
        file_path: null,
        input_preview: 'npm run build',
      },
      {
        id: 'claude-glob',
        file_path: '/tmp/project',
        input_preview: '**/*.ts',
      },
      {
        id: 'claude-read',
        file_path: '/tmp/demo.ts',
        input_preview: '/tmp/demo.ts',
      },
      {
        id: 'codex-apply-patch',
        file_path: '/tmp/example.ts',
        input_preview: [
          '*** Begin Patch',
          '*** Update File: /tmp/example.ts',
          '@@',
          '-const retries = 0;',
          '+const retries = 1;',
          '*** End Patch',
        ].join('\n'),
      },
    ]);
  } finally {
    db.close();
    await fs.rm(tmp, { recursive: true, force: true });
  }
});

test('migration v20 recovers truncated JSON preview blobs', async () => {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'rudi-schema-migration-'));
  const dbPath = path.join(tmp, 'test.db');
  const db = new Database(dbPath);

  try {
    db.exec(`
      CREATE TABLE schema_version (
        version INTEGER PRIMARY KEY,
        applied_at TEXT NOT NULL
      );

      CREATE TABLE tool_calls (
        id TEXT PRIMARY KEY,
        provider TEXT NOT NULL,
        tool_name TEXT NOT NULL,
        file_path TEXT,
        input_preview TEXT
      );
    `);

    db.prepare('INSERT INTO schema_version (version, applied_at) VALUES (?, ?)')
      .run(19, new Date('2026-03-07T00:00:00.000Z').toISOString());

    const insert = db.prepare(`
      INSERT INTO tool_calls (id, provider, tool_name, file_path, input_preview)
      VALUES (?, ?, ?, ?, ?)
    `);

    insert.run(
      'claude-edit',
      'claude',
      'Edit',
      null,
      '{"replace_all":false,"file_path":"/tmp/edit.ts","old_string":"const retries = 0;","new_string":"const retries = 1;',
    );
    insert.run(
      'claude-bash-truncated',
      'claude',
      'Bash',
      null,
      '{"command":"npm run lint -- --fix","description":"Fix lint failures',
    );
    insert.run(
      'codex-apply-patch-truncated',
      'codex',
      'apply_patch',
      null,
      '{"apply_patch":"*** Begin Patch\\n*** Update File: /tmp/worker.ts\\n@@\\n-const retries = 0;\\n+const retries = 1;',
    );

    const result = initSchemaWithDb(db);
    assert.strictEqual(result.version, 22);
    assert.strictEqual(result.migrated, true);
    assert.strictEqual(result.from, 19);

    const rows = db.prepare(`
      SELECT id, file_path, input_preview
      FROM tool_calls
      ORDER BY id
    `).all();

    assert.deepStrictEqual(rows, [
      {
        id: 'claude-bash-truncated',
        file_path: null,
        input_preview: 'npm run lint -- --fix',
      },
      {
        id: 'claude-edit',
        file_path: '/tmp/edit.ts',
        input_preview: '/tmp/edit.ts',
      },
      {
        id: 'codex-apply-patch-truncated',
        file_path: '/tmp/worker.ts',
        input_preview: '*** Begin Patch\n*** Update File: /tmp/worker.ts\n@@\n-const retries = 0;\n+const retries = 1;',
      },
    ]);
  } finally {
    db.close();
    await fs.rm(tmp, { recursive: true, force: true });
  }
});

test('migration v22 adds generic orchestration columns', async () => {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'rudi-schema-migration-'));
  const dbPath = path.join(tmp, 'test.db');
  const db = new Database(dbPath);

  try {
    db.exec(`
      CREATE TABLE schema_version (
        version INTEGER PRIMARY KEY,
        applied_at TEXT NOT NULL
      );

      CREATE TABLE run_groups (
        id TEXT PRIMARY KEY,
        name TEXT,
        status TEXT NOT NULL DEFAULT 'pending',
        project_path TEXT,
        base_branch TEXT,
        provider TEXT DEFAULT 'claude',
        model TEXT,
        permission_mode TEXT,
        session_count INTEGER NOT NULL DEFAULT 0,
        completed_count INTEGER NOT NULL DEFAULT 0,
        failed_count INTEGER NOT NULL DEFAULT 0,
        total_cost REAL NOT NULL DEFAULT 0,
        total_tokens INTEGER NOT NULL DEFAULT 0,
        config_json TEXT,
        created_at TEXT NOT NULL,
        started_at TEXT,
        completed_at TEXT,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE session_runtime_state (
        session_id TEXT PRIMARY KEY,
        status TEXT NOT NULL,
        provider TEXT,
        provider_session_id TEXT,
        resume_session_id TEXT,
        cwd TEXT,
        started_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        completed_at TEXT,
        last_seq INTEGER NOT NULL DEFAULT 0,
        turn_count INTEGER NOT NULL DEFAULT 0,
        cost_total REAL NOT NULL DEFAULT 0,
        tokens_total INTEGER NOT NULL DEFAULT 0,
        compaction_count INTEGER NOT NULL DEFAULT 0,
        tokens_saved_total INTEGER NOT NULL DEFAULT 0,
        last_compaction_at TEXT,
        last_compaction_json TEXT,
        unseen_completion INTEGER NOT NULL DEFAULT 0,
        last_error TEXT,
        worktree_path TEXT,
        worktree_branch TEXT,
        project_root TEXT,
        base_branch TEXT,
        use_worktree INTEGER NOT NULL DEFAULT 1
      );
    `);

    db.prepare('INSERT INTO schema_version (version, applied_at) VALUES (?, ?)')
      .run(21, new Date('2026-03-07T00:00:00.000Z').toISOString());

    const result = initSchemaWithDb(db);
    assert.strictEqual(result.version, 22);
    assert.strictEqual(result.migrated, true);
    assert.strictEqual(result.from, 21);

    const runGroupCols = db.prepare(`PRAGMA table_info(run_groups)`).all();
    const runtimeCols = db.prepare(`PRAGMA table_info(session_runtime_state)`).all();
    const runGroupNames = runGroupCols.map((col) => col.name);
    const runtimeNames = runtimeCols.map((col) => col.name);

    assert.ok(runGroupNames.includes('execution_mode'));
    assert.ok(runGroupNames.includes('coordination_mode'));
    assert.ok(runGroupNames.includes('requires_git'));
    assert.ok(runGroupNames.includes('workspace_root'));
    assert.ok(runtimeNames.includes('execution_mode'));
  } finally {
    db.close();
    await fs.rm(tmp, { recursive: true, force: true });
  }
});
