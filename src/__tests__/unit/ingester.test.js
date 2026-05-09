import { test } from 'node:test';
import assert from 'node:assert';
import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import Database from 'better-sqlite3';
import { initSchemaWithDb } from '@learnrudi/db/schema';
import { createSessionsIngesterModule } from '../../commands/sessions/ingester.js';

function isoFor(n) {
  const ms = Date.parse('2026-02-18T00:00:00.000Z') + (n * 1000);
  return new Date(ms).toISOString();
}

function buildClaudeTurnLines(startTurn, count, { withUsage = false } = {}) {
  const lines = [];
  for (let i = 0; i < count; i++) {
    const turn = startTurn + i;
    lines.push({
      type: 'user',
      uuid: `user-turn-${turn}`,
      timestamp: isoFor(turn * 2),
      message: { role: 'user', content: `User ${turn}` },
    });
    const assistantEntry = {
      type: 'assistant',
      timestamp: isoFor(turn * 2 + 1),
      message: {
        role: 'assistant',
        content: [{ type: 'text', text: `Assistant ${turn}` }],
      },
    };
    if (withUsage) {
      assistantEntry.message.model = 'claude-sonnet-4-5-20250929';
      assistantEntry.message.usage = {
        input_tokens: 100 * turn,
        output_tokens: 50 * turn,
        cache_read_input_tokens: 10 * turn,
        cache_creation_input_tokens: 5 * turn,
      };
    }
    lines.push(assistantEntry);
  }
  return lines;
}

async function writeJsonl(filePath, entries) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  const content = entries.map((e) => JSON.stringify(e)).join('\n') + '\n';
  await fs.writeFile(filePath, content, 'utf-8');
}

async function appendJsonl(filePath, entries) {
  const content = entries.map((e) => JSON.stringify(e)).join('\n') + '\n';
  await fs.appendFile(filePath, content, 'utf-8');
}

async function withHarness(fn) {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'rudi-ingester-'));
  const dbPath = path.join(tmp, 'test.db');
  const claudeRoot = path.join(tmp, '.claude', 'projects');
  const codexRoot = path.join(tmp, '.codex', 'sessions');
  await fs.mkdir(claudeRoot, { recursive: true });
  await fs.mkdir(codexRoot, { recursive: true });

  const db = new Database(dbPath);
  initSchemaWithDb(db);

  const ingester = createSessionsIngesterModule({
    log: () => {},
    resolveDb: () => db,
    paths: {
      claudeProjectsDir: claudeRoot,
      codexSessionsDir: codexRoot,
    },
  });

  try {
    await fn({
      tmp,
      db,
      ingester,
      claudeRoot,
      codexRoot,
    });
  } finally {
    ingester.cleanup();
    db.close();
    await fs.rm(tmp, { recursive: true, force: true });
  }
}

test('incremental ingestion appends only new turns and advances checkpoint', async () => {
  await withHarness(async ({ db, ingester, claudeRoot }) => {
    const sessionId = 'session-incremental';
    const filePath = path.join(claudeRoot, 'proj-a', `${sessionId}.jsonl`);

    await writeJsonl(filePath, buildClaudeTurnLines(1, 3));
    const first = await ingester.ingestFile(filePath, { provider: 'claude', sessionId });
    assert.strictEqual(first.turnsAdded, 3);

    const c1 = db.prepare('SELECT COUNT(*) as c FROM turns WHERE session_id = ?').get(sessionId).c;
    assert.strictEqual(c1, 3);

    await appendJsonl(filePath, buildClaudeTurnLines(4, 2));
    const second = await ingester.ingestFile(filePath, { provider: 'claude', sessionId });
    assert.strictEqual(second.turnsAdded, 2);

    const c2 = db.prepare('SELECT COUNT(*) as c FROM turns WHERE session_id = ?').get(sessionId).c;
    assert.strictEqual(c2, 5);

    const st = await fs.stat(filePath);
    const pos = db.prepare('SELECT byte_offset, file_size FROM file_positions WHERE file_path = ?').get(filePath);
    assert.strictEqual(pos.byte_offset, st.size);
    assert.strictEqual(pos.file_size, st.size);
  });
});

test('idempotent replay does not create duplicate turns', async () => {
  await withHarness(async ({ db, ingester, claudeRoot }) => {
    const sessionId = 'session-idempotent';
    const filePath = path.join(claudeRoot, 'proj-b', `${sessionId}.jsonl`);

    await writeJsonl(filePath, buildClaudeTurnLines(1, 3));
    await ingester.ingestFile(filePath, { provider: 'claude', sessionId });

    const c1 = db.prepare('SELECT COUNT(*) as c FROM turns WHERE session_id = ?').get(sessionId).c;
    assert.strictEqual(c1, 3);

    db.prepare('UPDATE file_positions SET byte_offset = 0, file_size = 0 WHERE file_path = ?').run(filePath);
    await ingester.ingestFile(filePath, { provider: 'claude', sessionId });

    const c2 = db.prepare('SELECT COUNT(*) as c FROM turns WHERE session_id = ?').get(sessionId).c;
    const distinct = db.prepare('SELECT COUNT(DISTINCT provider_turn_id) as c FROM turns WHERE session_id = ?').get(sessionId).c;
    assert.strictEqual(c2, 3);
    assert.strictEqual(distinct, 3);
  });
});

test('ingester reuses an existing session row id when provider_session_id was imported under a legacy id', async () => {
  await withHarness(async ({ db, ingester, claudeRoot }) => {
    const sessionId = 'session-legacy-row';
    const rowId = 'legacy-row-id';
    const filePath = path.join(claudeRoot, 'proj-legacy', `${sessionId}.jsonl`);
    const now = new Date().toISOString();

    db.prepare(`
      INSERT INTO sessions (id, provider, provider_session_id, origin, status, created_at, last_active_at)
      VALUES (?, 'claude', ?, 'provider-import', 'active', ?, ?)
    `).run(rowId, sessionId, now, now);

    await writeJsonl(filePath, buildClaudeTurnLines(1, 2));
    const result = await ingester.ingestFile(filePath, { provider: 'claude', sessionId });

    assert.strictEqual(result.turnsAdded, 2);
    assert.strictEqual(
      db.prepare('SELECT COUNT(*) as c FROM turns WHERE session_id = ?').get(rowId).c,
      2,
    );
    assert.strictEqual(
      db.prepare('SELECT COUNT(*) as c FROM turns WHERE session_id = ?').get(sessionId).c,
      0,
    );

    const session = db.prepare('SELECT turn_count FROM sessions WHERE id = ?').get(rowId);
    assert.strictEqual(session.turn_count, 2);
  });
});

test('truncation recovery resets turn set and re-ingests from offset 0', async () => {
  await withHarness(async ({ db, ingester, claudeRoot }) => {
    const sessionId = 'session-truncate';
    const filePath = path.join(claudeRoot, 'proj-c', `${sessionId}.jsonl`);

    await writeJsonl(filePath, buildClaudeTurnLines(1, 2));
    await ingester.ingestFile(filePath, { provider: 'claude', sessionId });
    assert.strictEqual(
      db.prepare('SELECT COUNT(*) as c FROM turns WHERE session_id = ?').get(sessionId).c,
      2,
    );

    await writeJsonl(filePath, buildClaudeTurnLines(100, 1));
    await ingester.ingestFile(filePath, { provider: 'claude', sessionId });

    const c = db.prepare('SELECT COUNT(*) as c FROM turns WHERE session_id = ?').get(sessionId).c;
    const firstMsg = db.prepare('SELECT user_message FROM turns WHERE session_id = ? ORDER BY turn_number ASC LIMIT 1').get(sessionId);
    assert.strictEqual(c, 1);
    assert.strictEqual(firstMsg.user_message, 'User 100');
  });
});

test('partial trailing line is ignored until newline arrives', async () => {
  await withHarness(async ({ db, ingester, claudeRoot }) => {
    const sessionId = 'session-partial';
    const filePath = path.join(claudeRoot, 'proj-d', `${sessionId}.jsonl`);

    const firstTurn = buildClaudeTurnLines(1, 1);
    const secondTurn = buildClaudeTurnLines(2, 1);
    const user2 = JSON.stringify(secondTurn[0]);
    const cut = 40;
    const initialContent = firstTurn.map((e) => JSON.stringify(e)).join('\n') + '\n' + user2.slice(0, cut);
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    await fs.writeFile(filePath, initialContent, 'utf-8');

    await ingester.ingestFile(filePath, { provider: 'claude', sessionId });
    const c1 = db.prepare('SELECT COUNT(*) as c FROM turns WHERE session_id = ?').get(sessionId).c;
    assert.strictEqual(c1, 1);

    const st1 = await fs.stat(filePath);
    const pos1 = db.prepare('SELECT byte_offset FROM file_positions WHERE file_path = ?').get(filePath).byte_offset;
    assert.ok(pos1 < st1.size, 'checkpoint should stay before partial line');

    const tail = user2.slice(cut) + '\n' + JSON.stringify(secondTurn[1]) + '\n';
    await fs.appendFile(filePath, tail, 'utf-8');
    await ingester.ingestFile(filePath, { provider: 'claude', sessionId });

    const c2 = db.prepare('SELECT COUNT(*) as c FROM turns WHERE session_id = ?').get(sessionId).c;
    assert.strictEqual(c2, 2);
  });
});

test('model and token usage extracted from raw JSONL entries', async () => {
  await withHarness(async ({ db, ingester, claudeRoot }) => {
    const sessionId = 'session-usage';
    const filePath = path.join(claudeRoot, 'proj-usage', `${sessionId}.jsonl`);

    await writeJsonl(filePath, buildClaudeTurnLines(1, 3, { withUsage: true }));
    const result = await ingester.ingestFile(filePath, { provider: 'claude', sessionId });
    assert.strictEqual(result.turnsAdded, 3);

    const turns = db.prepare('SELECT * FROM turns WHERE session_id = ? ORDER BY turn_number').all(sessionId);
    assert.strictEqual(turns.length, 3);

    // Turn 1: input_tokens = 100 + 10 (cache_read) + 5 (cache_creation) = 115, output = 50
    assert.strictEqual(turns[0].model, 'claude-sonnet-4-5-20250929');
    assert.strictEqual(turns[0].uuid, 'user-turn-1');
    assert.strictEqual(turns[0].input_tokens, 115);
    assert.strictEqual(turns[0].context_tokens, 115);
    assert.strictEqual(turns[0].output_tokens, 50);
    assert.strictEqual(turns[0].cache_read_tokens, 10);
    assert.strictEqual(turns[0].cache_creation_tokens, 5);

    // Cost computed from pricing: sonnet-4-5 = $3/Mtok in, $15/Mtok out, $0.3/Mtok cache_read, $3.75/Mtok cache_write
    // input_tokens=115 includes cache_read=10 + cache_creation=5, so base_input = 115 - 10 - 5 = 100
    // Turn 1: 100*3/1M + 50*15/1M + 10*0.3/1M + 5*3.75/1M
    assert.ok(turns[0].cost > 0, 'cost should be computed from pricing');
    const expectedCost1 = (100 * 3 + 50 * 15 + 10 * 0.3 + 5 * 3.75) / 1_000_000;
    assert.ok(Math.abs(turns[0].cost - expectedCost1) < 0.000001, `cost mismatch: ${turns[0].cost} vs ${expectedCost1}`);

    // Turn 2: input = 200 + 20 + 10 = 230, output = 100
    assert.strictEqual(turns[1].input_tokens, 230);
    assert.strictEqual(turns[1].context_tokens, 230);
    assert.strictEqual(turns[1].output_tokens, 100);
    assert.ok(turns[1].cost > turns[0].cost, 'turn 2 should cost more than turn 1');
  });
});

test('codex shell tool previews store the extracted command instead of raw JSON', async () => {
  await withHarness(async ({ db, ingester, codexRoot }) => {
    const sessionId = 'codex-shell-preview';
    const filePath = path.join(codexRoot, `${sessionId}.jsonl`);
    const entries = [
      {
        type: 'event_msg',
        timestamp: isoFor(2),
        payload: { type: 'user_message', message: 'Find the cleanup handler' },
      },
      {
        type: 'response_item',
        timestamp: isoFor(3),
        payload: {
          type: 'function_call',
          id: 'call-1',
          call_id: 'call-1',
          name: 'exec_command',
          arguments: JSON.stringify({
            cmd: 'rg -n "cleanup" src/commands/serve.js',
            yield_time_ms: 1000,
          }),
        },
      },
      {
        type: 'response_item',
        timestamp: isoFor(4),
        payload: {
          type: 'function_call_output',
          call_id: 'call-1',
          output: 'Chunk ID: test\nWall time: 0.1s\nProcess exited with code 0\nOriginal token count: 1\nOutput:\n42:const cleanup = () => {}',
        },
      },
      {
        type: 'response_item',
        timestamp: isoFor(5),
        payload: {
          type: 'message',
          role: 'assistant',
          content: [{ type: 'output_text', text: 'Found it.' }],
        },
      },
    ];

    await writeJsonl(filePath, entries);
    const result = await ingester.ingestFile(filePath, { provider: 'codex', sessionId });
    assert.strictEqual(result.turnsAdded, 1);

    const row = db.prepare(`
      SELECT canonical_name, input_preview
      FROM tool_calls
      WHERE session_id = ?
      LIMIT 1
    `).get(sessionId);

    assert.strictEqual(row.canonical_name, 'shell');
    assert.strictEqual(row.input_preview, 'rg -n "cleanup" src/commands/serve.js');
  });
});

test('codex apply_patch tool calls capture the edited file path', async () => {
  await withHarness(async ({ db, ingester, codexRoot }) => {
    const sessionId = 'codex-apply-patch';
    const filePath = path.join(codexRoot, `${sessionId}.jsonl`);
    const entries = [
      {
        type: 'event_msg',
        timestamp: isoFor(6),
        payload: { type: 'user_message', message: 'Patch the worker to log retries.' },
      },
      {
        type: 'response_item',
        timestamp: isoFor(7),
        payload: {
          type: 'function_call',
          id: 'patch-1',
          call_id: 'patch-1',
          name: 'apply_patch',
          arguments: JSON.stringify({
            apply_patch: [
              '*** Begin Patch',
              '*** Update File: /tmp/example.ts',
              '@@',
              '-const retries = 0;',
              '+const retries = 1;',
              '*** End Patch',
            ].join('\n'),
          }),
        },
      },
      {
        type: 'response_item',
        timestamp: isoFor(8),
        payload: {
          type: 'function_call_output',
          call_id: 'patch-1',
          output: 'Success. Updated the following files:\nM /tmp/example.ts',
        },
      },
      {
        type: 'response_item',
        timestamp: isoFor(9),
        payload: {
          type: 'message',
          role: 'assistant',
          content: [{ type: 'output_text', text: 'Patched.' }],
        },
      },
    ];

    await writeJsonl(filePath, entries);
    const result = await ingester.ingestFile(filePath, { provider: 'codex', sessionId });
    assert.strictEqual(result.turnsAdded, 1);

    const row = db.prepare(`
      SELECT canonical_name, file_path, input_preview
      FROM tool_calls
      WHERE session_id = ?
      LIMIT 1
    `).get(sessionId);

    assert.strictEqual(row.canonical_name, 'file_edit');
    assert.strictEqual(row.file_path, '/tmp/example.ts');
    assert.ok(row.input_preview.startsWith('*** Begin Patch'));
  });
});

test('compaction metadata is persisted from Claude system events', async () => {
  await withHarness(async ({ db, ingester, claudeRoot }) => {
    const sessionId = 'session-compaction-meta';
    const filePath = path.join(claudeRoot, 'proj-compaction', `${sessionId}.jsonl`);
    const entries = [
      {
        type: 'user',
        uuid: 'user-turn-1',
        timestamp: isoFor(2),
        message: { role: 'user', content: 'Summarize the project state' },
      },
      {
        type: 'assistant',
        timestamp: isoFor(3),
        message: {
          role: 'assistant',
          content: [{ type: 'text', text: 'I will compact context now.' }],
        },
      },
      {
        type: 'system',
        subtype: 'context_compaction',
        timestamp: isoFor(4),
        compaction: {
          trigger: 'token_limit',
          preTokens: 200000,
          tokensSaved: 64000,
          compactedToolIds: ['toolu_abc123'],
        },
      },
    ];

    await writeJsonl(filePath, entries);
    const result = await ingester.ingestFile(filePath, { provider: 'claude', sessionId });
    assert.strictEqual(result.turnsAdded, 1);

    const row = db.prepare(`
      SELECT compact_metadata
      FROM turns
      WHERE session_id = ?
      ORDER BY turn_number DESC
      LIMIT 1
    `).get(sessionId);
    assert.ok(row?.compact_metadata, 'compact_metadata should be populated');

    const meta = JSON.parse(row.compact_metadata);
    assert.strictEqual(meta.trigger, 'token_limit');
    assert.strictEqual(meta.preTokens, 200000);
    assert.strictEqual(meta.tokensSaved, 64000);
    assert.deepStrictEqual(meta.compactedToolIds, ['toolu_abc123']);
  });
});

test('compaction metadata is persisted from Claude compact-summary entries', async () => {
  await withHarness(async ({ db, ingester, claudeRoot }) => {
    const sessionId = 'session-compact-summary';
    const filePath = path.join(claudeRoot, 'proj-compaction', `${sessionId}.jsonl`);
    const entries = [
      {
        type: 'user',
        uuid: 'user-turn-1',
        timestamp: isoFor(2),
        message: { role: 'user', content: 'First question' },
      },
      {
        type: 'assistant',
        timestamp: isoFor(3),
        message: {
          role: 'assistant',
          content: [{ type: 'text', text: 'First answer' }],
        },
      },
      {
        type: 'user',
        uuid: 'user-turn-2',
        timestamp: isoFor(4),
        isCompactSummary: true,
        isVisibleInTranscriptOnly: true,
        message: {
          role: 'user',
          content: 'This session is being continued from a previous conversation that ran out of context.',
        },
      },
      {
        type: 'assistant',
        timestamp: isoFor(5),
        message: {
          role: 'assistant',
          content: [{ type: 'text', text: 'Continuing with compacted context.' }],
        },
      },
    ];

    await writeJsonl(filePath, entries);
    const result = await ingester.ingestFile(filePath, { provider: 'claude', sessionId });
    assert.strictEqual(result.turnsAdded, 2);

    const row = db.prepare(`
      SELECT compact_metadata
      FROM turns
      WHERE session_id = ?
      ORDER BY turn_number DESC
      LIMIT 1
    `).get(sessionId);
    assert.ok(row?.compact_metadata, 'compact_metadata should be populated');

    const meta = JSON.parse(row.compact_metadata);
    assert.strictEqual(meta.trigger, 'auto');
    assert.strictEqual(meta.source, 'claude_compact_summary');
    assert.strictEqual(meta.isCompactSummary, true);
  });
});

test('session aggregates match sum of turns after ingestion', async () => {
  await withHarness(async ({ db, ingester, claudeRoot }) => {
    const sessionId = 'session-aggregates';
    const filePath = path.join(claudeRoot, 'proj-agg', `${sessionId}.jsonl`);

    await writeJsonl(filePath, buildClaudeTurnLines(1, 5, { withUsage: true }));
    await ingester.ingestFile(filePath, { provider: 'claude', sessionId });

    const session = db.prepare('SELECT turn_count, started_at, total_cost, total_input_tokens, total_output_tokens FROM sessions WHERE id = ?').get(sessionId);
    const sums = db.prepare('SELECT COUNT(*) as c, SUM(cost) as cost, SUM(input_tokens) as inp, SUM(output_tokens) as out FROM turns WHERE session_id = ?').get(sessionId);
    const minTs = db.prepare('SELECT MIN(ts) as min_ts FROM turns WHERE session_id = ?').get(sessionId);

    assert.strictEqual(session.turn_count, 5);
    assert.strictEqual(session.turn_count, sums.c);
    assert.strictEqual(session.total_input_tokens, sums.inp);
    assert.strictEqual(session.total_output_tokens, sums.out);
    assert.strictEqual(session.started_at, minTs.min_ts);
    assert.ok(session.total_cost > 0, 'session total_cost should be computed from turn costs');
    assert.ok(Math.abs(session.total_cost - sums.cost) < 0.000001, `session total_cost (${session.total_cost}) should match sum of turn costs (${sums.cost})`);
  });
});

test('reconcileAll ingests missed files', async () => {
  await withHarness(async ({ db, ingester, claudeRoot }) => {
    const sidA = 'session-gap-a';
    const sidB = 'session-gap-b';
    const fileA = path.join(claudeRoot, 'proj-e', `${sidA}.jsonl`);
    const fileB = path.join(claudeRoot, 'proj-f', `${sidB}.jsonl`);

    await writeJsonl(fileA, buildClaudeTurnLines(1, 1));
    await writeJsonl(fileB, buildClaudeTurnLines(2, 1));

    await ingester.ingestFile(fileA, { provider: 'claude', sessionId: sidA });
    assert.strictEqual(
      db.prepare('SELECT COUNT(*) as c FROM turns WHERE session_id = ?').get(sidA).c,
      1,
    );
    assert.strictEqual(
      db.prepare('SELECT COUNT(*) as c FROM turns WHERE session_id = ?').get(sidB).c,
      0,
    );

    const rec = await ingester.reconcileAll();
    assert.ok(rec.filesScanned >= 2);
    assert.strictEqual(
      db.prepare('SELECT COUNT(*) as c FROM turns WHERE session_id = ?').get(sidB).c,
      1,
    );
  });
});

test('backfillAll ingests unsynced files and skips already-synced files', async () => {
  await withHarness(async ({ db, ingester, claudeRoot }) => {
    const sidA = 'session-backfill-a';
    const sidB = 'session-backfill-b';
    const fileA = path.join(claudeRoot, 'proj-backfill-a', `${sidA}.jsonl`);
    const fileB = path.join(claudeRoot, 'proj-backfill-b', `${sidB}.jsonl`);

    await writeJsonl(fileA, buildClaudeTurnLines(1, 2));
    await writeJsonl(fileB, buildClaudeTurnLines(10, 2));

    // Seed one file so backfill should skip it.
    await ingester.ingestFile(fileA, { provider: 'claude', sessionId: sidA });

    const beforeA = db.prepare('SELECT COUNT(*) as c FROM turns WHERE session_id = ?').get(sidA).c;
    const beforeB = db.prepare('SELECT COUNT(*) as c FROM turns WHERE session_id = ?').get(sidB).c;
    assert.strictEqual(beforeA, 2);
    assert.strictEqual(beforeB, 0);

    const progress = [];
    const summary = await ingester.backfillAll({
      onProgress: (p) => progress.push(p),
    });

    const afterA = db.prepare('SELECT COUNT(*) as c FROM turns WHERE session_id = ?').get(sidA).c;
    const afterB = db.prepare('SELECT COUNT(*) as c FROM turns WHERE session_id = ?').get(sidB).c;
    assert.strictEqual(afterA, 2, 'already-synced file should not duplicate turns');
    assert.strictEqual(afterB, 2, 'unsynced file should be ingested by backfill');

    assert.ok(summary.filesTotal >= 2);
    assert.ok(summary.filesDone >= 2);
    assert.ok(summary.filesSkipped >= 1);
    assert.ok(summary.filesIngested >= 1);
    assert.ok(progress.length > 0);
  });
});

test('backfillAll reports running state and completion metadata', async () => {
  await withHarness(async ({ ingester, claudeRoot }) => {
    const sessionId = 'session-backfill-state';
    const filePath = path.join(claudeRoot, 'proj-backfill-state', `${sessionId}.jsonl`);
    await writeJsonl(filePath, buildClaudeTurnLines(1, 2));

    const backfillPromise = ingester.backfillAll();
    const during = ingester.getStats();
    assert.strictEqual(during.backfillRunning, true);

    await backfillPromise;

    const after = ingester.getStats();
    assert.strictEqual(after.backfillRunning, false);
    assert.ok(typeof after.lastBackfillAt === 'string' && after.lastBackfillAt.length > 0);
    assert.ok(after.backfillFilesDone >= 1);
    assert.ok(after.backfillFilesTotal >= after.backfillFilesDone);
  });
});

test('repairNoTextTurns rebuilds sessions that contain legacy no-text rows', async () => {
  await withHarness(async ({ db, ingester, claudeRoot }) => {
    const sessionId = 'session-repair-no-text';
    const filePath = path.join(claudeRoot, 'proj-repair', `${sessionId}.jsonl`);
    await writeJsonl(filePath, buildClaudeTurnLines(1, 2, { withUsage: true }));
    await ingester.ingestFile(filePath, { provider: 'claude', sessionId });

    // Simulate legacy sparse rows: wipe message text but keep rows.
    db.prepare(`
      UPDATE turns
      SET user_message = NULL, assistant_response = NULL
      WHERE session_id = ?
    `).run(sessionId);

    const beforeNoText = db.prepare(`
      SELECT COUNT(*) as c
      FROM turns
      WHERE session_id = ?
        AND (user_message IS NULL OR TRIM(user_message) = '')
        AND (assistant_response IS NULL OR TRIM(assistant_response) = '')
    `).get(sessionId).c;
    assert.strictEqual(beforeNoText, 2);

    const summary = await ingester.repairNoTextTurns();
    assert.ok(summary.sessionsTotal >= 1);
    assert.ok(summary.rebuilt >= 1);

    const afterNoText = db.prepare(`
      SELECT COUNT(*) as c
      FROM turns
      WHERE session_id = ?
        AND (user_message IS NULL OR TRIM(user_message) = '')
        AND (assistant_response IS NULL OR TRIM(assistant_response) = '')
    `).get(sessionId).c;
    assert.strictEqual(afterNoText, 0);

    const restored = db.prepare(`
      SELECT COUNT(*) as c
      FROM turns
      WHERE session_id = ?
        AND user_message IS NOT NULL
        AND assistant_response IS NOT NULL
    `).get(sessionId).c;
    assert.strictEqual(restored, 2);
  });
});

test('uuid populated on INSERT and preserved via COALESCE on UPDATE', async () => {
  await withHarness(async ({ db, ingester, claudeRoot }) => {
    const sessionId = 'session-uuid-coalesce';
    const filePath = path.join(claudeRoot, 'proj-uuid', `${sessionId}.jsonl`);

    await writeJsonl(filePath, buildClaudeTurnLines(1, 3, { withUsage: true }));
    await ingester.ingestFile(filePath, { provider: 'claude', sessionId });

    // Verify uuid populated on INSERT
    const uuids = db.prepare(
      'SELECT turn_number, uuid FROM turns WHERE session_id = ? ORDER BY turn_number',
    ).all(sessionId);
    assert.strictEqual(uuids.length, 3);
    assert.strictEqual(uuids[0].uuid, 'user-turn-1');
    assert.strictEqual(uuids[1].uuid, 'user-turn-2');
    assert.strictEqual(uuids[2].uuid, 'user-turn-3');

    // Re-ingest (triggers UPDATE path via rewind) — uuid should be preserved
    db.prepare('UPDATE file_positions SET byte_offset = 0, file_size = 0 WHERE file_path = ?').run(filePath);
    await ingester.ingestFile(filePath, { provider: 'claude', sessionId });

    const after = db.prepare(
      'SELECT turn_number, uuid FROM turns WHERE session_id = ? ORDER BY turn_number',
    ).all(sessionId);
    assert.strictEqual(after.length, 3);
    assert.strictEqual(after[0].uuid, 'user-turn-1', 'uuid should survive UPDATE via COALESCE');
    assert.strictEqual(after[1].uuid, 'user-turn-2');
    assert.strictEqual(after[2].uuid, 'user-turn-3');
  });
});

test('uuid not clobbered to NULL when rewind window misses original entry', async () => {
  await withHarness(async ({ db, ingester, claudeRoot }) => {
    const sessionId = 'session-uuid-preserve';
    const filePath = path.join(claudeRoot, 'proj-uuid-preserve', `${sessionId}.jsonl`);

    // Insert turns with uuid
    await writeJsonl(filePath, buildClaudeTurnLines(1, 2, { withUsage: true }));
    await ingester.ingestFile(filePath, { provider: 'claude', sessionId });

    const before = db.prepare(
      'SELECT uuid FROM turns WHERE session_id = ? ORDER BY turn_number',
    ).all(sessionId);
    assert.strictEqual(before[0].uuid, 'user-turn-1');
    assert.strictEqual(before[1].uuid, 'user-turn-2');

    // Simulate: manually null out uuid to mimic a turn that was inserted pre-v11
    // then set one back to test mixed state
    db.prepare('UPDATE turns SET uuid = NULL WHERE session_id = ? AND turn_number = 1').run(sessionId);

    // Re-ingest from 0 — turn 1 gets uuid back, turn 2 keeps its uuid
    db.prepare('UPDATE file_positions SET byte_offset = 0, file_size = 0 WHERE file_path = ?').run(filePath);
    await ingester.ingestFile(filePath, { provider: 'claude', sessionId });

    const after = db.prepare(
      'SELECT uuid FROM turns WHERE session_id = ? ORDER BY turn_number',
    ).all(sessionId);
    assert.strictEqual(after[0].uuid, 'user-turn-1', 'NULL uuid should be filled by COALESCE');
    assert.strictEqual(after[1].uuid, 'user-turn-2', 'existing uuid should not be clobbered');
  });
});

// ---------------------------------------------------------------------------
// Session lifecycle tests
// ---------------------------------------------------------------------------

test('session started_at set from first turn, last_active_at advances on append', async () => {
  await withHarness(async ({ db, ingester, claudeRoot }) => {
    const sessionId = 'session-lifecycle-ts';
    const filePath = path.join(claudeRoot, 'proj-lifecycle', `${sessionId}.jsonl`);

    // Initial ingest: turns at t=2s and t=4s
    await writeJsonl(filePath, buildClaudeTurnLines(1, 2, { withUsage: true }));
    await ingester.ingestFile(filePath, { provider: 'claude', sessionId });

    // Turn ts comes from user entry timestamp: turn 1 → isoFor(1*2)=isoFor(2), turn 2 → isoFor(2*2)=isoFor(4)
    const s1 = db.prepare('SELECT started_at, last_active_at, turn_count FROM sessions WHERE id = ?').get(sessionId);
    assert.strictEqual(s1.turn_count, 2);
    assert.strictEqual(s1.started_at, isoFor(2), 'started_at should be timestamp of first turn');
    assert.strictEqual(s1.last_active_at, isoFor(4), 'last_active_at should be latest turn ts (user entry)');

    // Append turns 3 and 4: user ts at isoFor(6) and isoFor(8)
    await appendJsonl(filePath, buildClaudeTurnLines(3, 2, { withUsage: true }));
    await ingester.ingestFile(filePath, { provider: 'claude', sessionId });

    const s2 = db.prepare('SELECT started_at, last_active_at, turn_count FROM sessions WHERE id = ?').get(sessionId);
    assert.strictEqual(s2.turn_count, 4);
    assert.strictEqual(s2.started_at, isoFor(2), 'started_at must not change on subsequent ingests');
    assert.strictEqual(s2.last_active_at, isoFor(8), 'last_active_at should advance to latest turn');
  });
});

test('cost and token aggregates accumulate correctly across incremental ingests', async () => {
  await withHarness(async ({ db, ingester, claudeRoot }) => {
    const sessionId = 'session-cost-accum';
    const filePath = path.join(claudeRoot, 'proj-cost', `${sessionId}.jsonl`);

    await writeJsonl(filePath, buildClaudeTurnLines(1, 2, { withUsage: true }));
    await ingester.ingestFile(filePath, { provider: 'claude', sessionId });

    const s1 = db.prepare('SELECT total_cost, total_input_tokens, total_output_tokens FROM sessions WHERE id = ?').get(sessionId);
    assert.ok(s1.total_cost > 0, 'cost should be positive after first ingest');
    const cost1 = s1.total_cost;
    const inp1 = s1.total_input_tokens;

    // Append more turns (higher turn numbers = higher token counts)
    await appendJsonl(filePath, buildClaudeTurnLines(3, 2, { withUsage: true }));
    await ingester.ingestFile(filePath, { provider: 'claude', sessionId });

    const s2 = db.prepare('SELECT total_cost, total_input_tokens, total_output_tokens, turn_count FROM sessions WHERE id = ?').get(sessionId);
    assert.strictEqual(s2.turn_count, 4);
    assert.ok(s2.total_cost > cost1, 'cost should grow after appending turns');
    assert.ok(s2.total_input_tokens > inp1, 'input tokens should grow');

    // Verify session aggregates match sum of individual turns
    const sums = db.prepare('SELECT SUM(cost) as c, SUM(input_tokens) as i, SUM(output_tokens) as o FROM turns WHERE session_id = ?').get(sessionId);
    assert.ok(Math.abs(s2.total_cost - sums.c) < 0.000001, 'session cost must match sum of turn costs');
    assert.strictEqual(s2.total_input_tokens, sums.i);
    assert.strictEqual(s2.total_output_tokens, sums.o);
  });
});

test('context tokens trajectory: grows per turn, drops after compaction, resumes growth', async () => {
  await withHarness(async ({ db, ingester, claudeRoot }) => {
    const sessionId = 'session-ctx-trajectory';
    const filePath = path.join(claudeRoot, 'proj-ctx', `${sessionId}.jsonl`);

    // Build a realistic conversation: 3 turns with growing context, compaction, then 2 more
    const entries = [];

    // Turn 1: 10K context
    entries.push({
      type: 'user', uuid: 'ctx-turn-1', timestamp: isoFor(2),
      message: { role: 'user', content: 'Start a project plan' },
    });
    entries.push({
      type: 'assistant', timestamp: isoFor(3),
      message: {
        role: 'assistant',
        content: [{ type: 'text', text: 'Here is the plan...' }],
        model: 'claude-sonnet-4-5-20250929',
        usage: { input_tokens: 10000, output_tokens: 2000, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 },
      },
    });

    // Turn 2: 25K context (growing)
    entries.push({
      type: 'user', uuid: 'ctx-turn-2', timestamp: isoFor(4),
      message: { role: 'user', content: 'Add more detail to section 3' },
    });
    entries.push({
      type: 'assistant', timestamp: isoFor(5),
      message: {
        role: 'assistant',
        content: [{ type: 'text', text: 'Expanded section 3...' }],
        model: 'claude-sonnet-4-5-20250929',
        usage: { input_tokens: 25000, output_tokens: 5000, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 },
      },
    });

    // Turn 3: 80K context (near limit) + compaction event
    entries.push({
      type: 'user', uuid: 'ctx-turn-3', timestamp: isoFor(6),
      message: { role: 'user', content: 'Now implement the architecture' },
    });
    entries.push({
      type: 'assistant', timestamp: isoFor(7),
      message: {
        role: 'assistant',
        content: [{ type: 'text', text: 'Implementing architecture...' }],
        model: 'claude-sonnet-4-5-20250929',
        usage: { input_tokens: 80000, output_tokens: 15000, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 },
      },
    });
    entries.push({
      type: 'system', subtype: 'context_compaction', timestamp: isoFor(8),
      compaction: { trigger: 'token_limit', preTokens: 95000, tokensSaved: 60000, compactedToolIds: ['toolu_1', 'toolu_2'] },
    });

    // Turn 4: 35K context (post-compaction, dropped from 80K)
    entries.push({
      type: 'user', uuid: 'ctx-turn-4', timestamp: isoFor(10),
      message: { role: 'user', content: 'Continue with tests' },
    });
    entries.push({
      type: 'assistant', timestamp: isoFor(11),
      message: {
        role: 'assistant',
        content: [{ type: 'text', text: 'Writing tests...' }],
        model: 'claude-sonnet-4-5-20250929',
        usage: { input_tokens: 35000, output_tokens: 8000, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 },
      },
    });

    // Turn 5: 55K context (growing again)
    entries.push({
      type: 'user', uuid: 'ctx-turn-5', timestamp: isoFor(12),
      message: { role: 'user', content: 'Add integration tests' },
    });
    entries.push({
      type: 'assistant', timestamp: isoFor(13),
      message: {
        role: 'assistant',
        content: [{ type: 'text', text: 'Integration tests added...' }],
        model: 'claude-sonnet-4-5-20250929',
        usage: { input_tokens: 55000, output_tokens: 10000, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 },
      },
    });

    await writeJsonl(filePath, entries);
    await ingester.ingestFile(filePath, { provider: 'claude', sessionId });

    const turns = db.prepare(
      'SELECT turn_number, context_tokens, input_tokens, compact_metadata, uuid FROM turns WHERE session_id = ? ORDER BY turn_number',
    ).all(sessionId);

    assert.strictEqual(turns.length, 5);

    // Context trajectory: 10K → 25K → 80K → 35K (post-compact) → 55K
    assert.strictEqual(turns[0].context_tokens, 10000);
    assert.strictEqual(turns[1].context_tokens, 25000);
    assert.strictEqual(turns[2].context_tokens, 80000);
    assert.strictEqual(turns[3].context_tokens, 35000, 'context should drop after compaction');
    assert.strictEqual(turns[4].context_tokens, 55000, 'context should resume growing');

    // Context grows, drops, grows — not monotonic
    assert.ok(turns[2].context_tokens > turns[1].context_tokens, 'context grows before compaction');
    assert.ok(turns[3].context_tokens < turns[2].context_tokens, 'context drops after compaction');
    assert.ok(turns[4].context_tokens > turns[3].context_tokens, 'context resumes growth');

    // Compaction metadata on turn 3 (the turn just before compaction event)
    assert.ok(turns[2].compact_metadata, 'turn 3 should have compaction metadata');
    const meta = JSON.parse(turns[2].compact_metadata);
    assert.strictEqual(meta.trigger, 'token_limit');
    assert.strictEqual(meta.tokensSaved, 60000);

    // UUIDs all populated
    for (let i = 0; i < 5; i++) {
      assert.strictEqual(turns[i].uuid, `ctx-turn-${i + 1}`, `turn ${i + 1} uuid`);
    }
  });
});

test('multi-session cross-project: independent aggregates and correct session metadata', async () => {
  await withHarness(async ({ db, ingester, claudeRoot }) => {
    const sidA = 'session-proj-alpha';
    const sidB = 'session-proj-beta';
    const sidC = 'session-proj-alpha-2';

    // Two sessions in project-alpha, one in project-beta
    const fileA = path.join(claudeRoot, 'project-alpha', `${sidA}.jsonl`);
    const fileB = path.join(claudeRoot, 'project-beta', `${sidB}.jsonl`);
    const fileC = path.join(claudeRoot, 'project-alpha', `${sidC}.jsonl`);

    await writeJsonl(fileA, buildClaudeTurnLines(1, 3, { withUsage: true }));
    await writeJsonl(fileB, buildClaudeTurnLines(10, 5, { withUsage: true }));
    await writeJsonl(fileC, buildClaudeTurnLines(20, 2, { withUsage: true }));

    await ingester.ingestFile(fileA, { provider: 'claude', sessionId: sidA });
    await ingester.ingestFile(fileB, { provider: 'claude', sessionId: sidB });
    await ingester.ingestFile(fileC, { provider: 'claude', sessionId: sidC });

    // Each session has independent turn counts
    const sA = db.prepare('SELECT turn_count, total_cost, started_at FROM sessions WHERE id = ?').get(sidA);
    const sB = db.prepare('SELECT turn_count, total_cost, started_at FROM sessions WHERE id = ?').get(sidB);
    const sC = db.prepare('SELECT turn_count, total_cost, started_at FROM sessions WHERE id = ?').get(sidC);

    assert.strictEqual(sA.turn_count, 3);
    assert.strictEqual(sB.turn_count, 5);
    assert.strictEqual(sC.turn_count, 2);

    // Costs are independent — session B with higher turn numbers should cost more
    assert.ok(sB.total_cost > sA.total_cost, 'session B (turns 10-14) should cost more than A (turns 1-3)');
    assert.ok(sC.total_cost > sA.total_cost, 'session C (turns 20-21) should cost more than A');

    // started_at reflects each session's own first turn
    assert.strictEqual(sA.started_at, isoFor(2));   // turn 1 → ts = isoFor(1*2)
    assert.strictEqual(sB.started_at, isoFor(20));   // turn 10 → ts = isoFor(10*2)
    assert.strictEqual(sC.started_at, isoFor(40));   // turn 20 → ts = isoFor(20*2)

    // Turns don't leak across sessions
    const turnsA = db.prepare('SELECT COUNT(*) as c FROM turns WHERE session_id = ?').get(sidA).c;
    const turnsB = db.prepare('SELECT COUNT(*) as c FROM turns WHERE session_id = ?').get(sidB).c;
    const turnsC = db.prepare('SELECT COUNT(*) as c FROM turns WHERE session_id = ?').get(sidC).c;
    assert.strictEqual(turnsA, 3);
    assert.strictEqual(turnsB, 5);
    assert.strictEqual(turnsC, 2);

    // Total across all sessions
    const total = db.prepare('SELECT COUNT(*) as c FROM turns').get().c;
    assert.strictEqual(total, 10);
    const totalSessions = db.prepare("SELECT COUNT(*) as c FROM sessions WHERE status = 'active'").get().c;
    assert.strictEqual(totalSessions, 3);
  });
});

test('turn_number sequence stays consistent across rewind re-ingests', async () => {
  await withHarness(async ({ db, ingester, claudeRoot }) => {
    const sessionId = 'session-turn-seq';
    const filePath = path.join(claudeRoot, 'proj-seq', `${sessionId}.jsonl`);

    await writeJsonl(filePath, buildClaudeTurnLines(1, 4, { withUsage: true }));
    await ingester.ingestFile(filePath, { provider: 'claude', sessionId });

    const before = db.prepare(
      'SELECT turn_number, user_message FROM turns WHERE session_id = ? ORDER BY turn_number',
    ).all(sessionId);
    assert.deepStrictEqual(before.map(r => r.turn_number), [1, 2, 3, 4]);
    assert.deepStrictEqual(before.map(r => r.user_message), ['User 1', 'User 2', 'User 3', 'User 4']);

    // Reset offset to 0 and re-ingest (UPDATE path for all turns)
    db.prepare('UPDATE file_positions SET byte_offset = 0, file_size = 0 WHERE file_path = ?').run(filePath);
    await ingester.ingestFile(filePath, { provider: 'claude', sessionId });

    const after = db.prepare(
      'SELECT turn_number, user_message FROM turns WHERE session_id = ? ORDER BY turn_number',
    ).all(sessionId);
    assert.deepStrictEqual(after.map(r => r.turn_number), [1, 2, 3, 4], 'turn numbers must not change on re-ingest');
    assert.deepStrictEqual(after.map(r => r.user_message), ['User 1', 'User 2', 'User 3', 'User 4']);
    assert.strictEqual(after.length, 4, 'no duplicate rows');
  });
});
