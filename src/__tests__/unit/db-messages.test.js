/**
 * Stage 3 parity tests: DB-backed messages vs JSONL-parsed messages.
 *
 * Verifies:
 * 1. DB turn rows produce the same user/assistant message content as JSONL parser
 * 2. Cursor chain traverses all turns exactly once with no skip/repeat
 * 3. Empty session returns correct shape
 * 4. Usage/aggregates match
 */

import { test } from 'node:test';
import assert from 'node:assert';
import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import Database from 'better-sqlite3';
import { initSchemaWithDb } from '@learnrudi/db/schema';
import { createSessionsIngesterModule } from '../../commands/sessions/ingester.js';
import { createSessionsModule } from '../../commands/serve/sessions.js';
import { parseSessionMessagesFromJsonl } from '../../commands/sessions/providers/registry.js';
import { cacheSessionFileHint, SESSION_FILE_HINTS } from '../../commands/sessions/file-hints.js';
import { createMockReq, createMockRes, parseResBody } from '../helpers/serve-mocks.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function isoFor(n) {
  const ms = Date.parse('2026-02-18T00:00:00.000Z') + (n * 1000);
  return new Date(ms).toISOString();
}

function buildClaudeTurnLines(startTurn, count) {
  const lines = [];
  for (let i = 0; i < count; i++) {
    const turn = startTurn + i;
    lines.push({
      type: 'user',
      uuid: `user-turn-${turn}`,
      timestamp: isoFor(turn * 2),
      message: { role: 'user', content: `User message ${turn}` },
    });
    lines.push({
      type: 'assistant',
      timestamp: isoFor(turn * 2 + 1),
      message: {
        role: 'assistant',
        content: [{ type: 'text', text: `Assistant response ${turn}` }],
        model: 'claude-sonnet-4-5-20250929',
        usage: {
          input_tokens: 100 * turn,
          output_tokens: 50 * turn,
          cache_read_input_tokens: 10 * turn,
          cache_creation_input_tokens: 5 * turn,
        },
      },
    });
  }
  return lines;
}

async function writeJsonl(filePath, entries) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  const content = entries.map((e) => JSON.stringify(e)).join('\n') + '\n';
  await fs.writeFile(filePath, content, 'utf-8');
  return content;
}

// Cursor encode/decode — mirrors serve/sessions.js (not exported, so inline)
function encodeCursor(turnNumber) {
  return Buffer.from(JSON.stringify({ t: turnNumber, v: 1 })).toString('base64url');
}

function decodeCursor(token) {
  const obj = JSON.parse(Buffer.from(token, 'base64url').toString());
  return obj.t;
}

function buildClaudeToolTurnEntries() {
  return [
    {
      type: 'user',
      uuid: 'tool-turn-1',
      timestamp: isoFor(2),
      message: { role: 'user', content: 'Read the file' },
    },
    {
      type: 'assistant',
      timestamp: isoFor(3),
      message: {
        role: 'assistant',
        content: [
          { type: 'text', text: 'Opening file' },
          { type: 'tool_use', id: 'toolu_read_1', name: 'Read', input: { file_path: '/tmp/a.txt' } },
          { type: 'text', text: 'Read complete' },
        ],
        model: 'claude-sonnet-4-5-20250929',
        usage: {
          input_tokens: 120,
          output_tokens: 45,
        },
      },
    },
    {
      type: 'user',
      timestamp: isoFor(4),
      message: {
        role: 'user',
        content: [
          { type: 'tool_result', tool_use_id: 'toolu_read_1', content: 'hello world' },
        ],
      },
    },
  ];
}

/**
 * Map a DB turn row → messages, same as _turnToMessages in sessions.js.
 */
function turnRowToMessages(row) {
  const msgs = [];
  if (row.user_message) {
    msgs.push({
      role: 'user',
      content: row.user_message,
      timestamp: row.ts || undefined,
    });
  }
  if (row.assistant_response || row.thinking || row.tool_results) {
    const msg = {
      role: 'assistant',
      content: row.assistant_response || '',
      timestamp: row.ts || undefined,
    };
    if (row.thinking) msg.thinking = row.thinking;
    if (row.tool_results) {
      try { msg.toolCalls = JSON.parse(row.tool_results); } catch {}
    }
    msgs.push(msg);
  }
  return msgs;
}

/**
 * Simulate readSessionMessagesFromDb pagination by querying DB directly.
 */
function queryDbPage(db, sessionId, { count = 30, cursor } = {}) {
  const pageSize = count;
  const limit = pageSize + 1;
  let rows;
  if (cursor) {
    const beforeTurnNumber = decodeCursor(cursor);
    rows = db.prepare(`
      SELECT * FROM turns
      WHERE session_id = ? AND turn_number < ?
      ORDER BY turn_number DESC
      LIMIT ?
    `).all(sessionId, beforeTurnNumber, limit);
  } else {
    rows = db.prepare(`
      SELECT * FROM turns
      WHERE session_id = ?
      ORDER BY turn_number DESC
      LIMIT ?
    `).all(sessionId, limit);
  }

  const hasMore = rows.length > pageSize;
  if (hasMore) rows = rows.slice(0, pageSize);
  rows.reverse();

  const messages = [];
  for (const row of rows) messages.push(...turnRowToMessages(row));

  const nextCursor = hasMore && rows.length > 0
    ? encodeCursor(rows[0].turn_number)
    : null;

  const sessionRow = db.prepare('SELECT turn_count FROM sessions WHERE id = ?').get(sessionId);

  return {
    messages,
    hasMore,
    nextCursor,
    totalTurns: sessionRow?.turn_count || 0,
  };
}

async function withHarness(fn) {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'rudi-dbmsg-'));
  const dbPath = path.join(tmp, 'test.db');
  const claudeRoot = path.join(tmp, '.claude', 'projects');
  await fs.mkdir(claudeRoot, { recursive: true });

  const db = new Database(dbPath);
  initSchemaWithDb(db);

  const ingester = createSessionsIngesterModule({
    log: () => {},
    resolveDb: () => db,
    paths: { claudeProjectsDir: claudeRoot, codexSessionsDir: path.join(tmp, '.codex') },
  });

  try {
    await fn({ tmp, db, ingester, claudeRoot });
  } finally {
    ingester.cleanup();
    db.close();
    await fs.rm(tmp, { recursive: true, force: true });
  }
}

function createRouteModule(resolveDb) {
  return createSessionsModule({
    log() {},
    broadcast() {},
    json(res, data, status = 200) {
      res.writeHead(status, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(data));
      return true;
    },
    error(res, message, status = 400) {
      res.writeHead(status, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: message }));
      return true;
    },
    async readBody() { return {}; },
    getProjectGitStatus() { return null; },
    resolveDb,
  });
}

async function withMessagesMode(mode, fn) {
  const prev = process.env.RUDI_DB_MESSAGES;
  process.env.RUDI_DB_MESSAGES = mode;
  try {
    await fn();
  } finally {
    if (prev === undefined) delete process.env.RUDI_DB_MESSAGES;
    else process.env.RUDI_DB_MESSAGES = prev;
  }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

test('DB messages match JSONL-parsed messages for same fixture', async () => {
  await withHarness(async ({ db, ingester, claudeRoot }) => {
    const sessionId = 'session-parity';
    const filePath = path.join(claudeRoot, 'proj-parity', `${sessionId}.jsonl`);
    const entries = buildClaudeTurnLines(1, 5);
    const jsonlContent = await writeJsonl(filePath, entries);

    // Ingest into DB
    await ingester.ingestFile(filePath, { provider: 'claude', sessionId });

    // DB path: query all turns
    const dbResult = queryDbPage(db, sessionId, { count: 100 });

    // JSONL path: parse directly
    const jsonlMessages = parseSessionMessagesFromJsonl(jsonlContent, 'claude');

    // Same number of messages (each turn = user + assistant = 2 messages)
    assert.strictEqual(dbResult.messages.length, jsonlMessages.length,
      `DB has ${dbResult.messages.length} msgs, JSONL has ${jsonlMessages.length}`);

    // Compare content of each message
    for (let i = 0; i < jsonlMessages.length; i++) {
      const db_m = dbResult.messages[i];
      const jl_m = jsonlMessages[i];
      assert.strictEqual(db_m.role, jl_m.role, `msg[${i}] role mismatch`);
      assert.strictEqual(db_m.content.trim(), jl_m.content.trim(), `msg[${i}] content mismatch`);
    }

    assert.strictEqual(dbResult.totalTurns, 5);
    assert.strictEqual(dbResult.hasMore, false);
  });
});

test('cursor chain traverses all turns exactly once', async () => {
  await withHarness(async ({ db, ingester, claudeRoot }) => {
    const sessionId = 'session-cursor-chain';
    const filePath = path.join(claudeRoot, 'proj-cursor', `${sessionId}.jsonl`);
    await writeJsonl(filePath, buildClaudeTurnLines(1, 10));
    await ingester.ingestFile(filePath, { provider: 'claude', sessionId });

    const pageSize = 3;
    const allMessages = [];
    let cursor = undefined;
    let pages = 0;

    while (true) {
      const page = queryDbPage(db, sessionId, { count: pageSize, cursor });
      allMessages.push(...page.messages);
      pages++;

      if (!page.hasMore || !page.nextCursor) break;
      cursor = page.nextCursor;

      // Safety: prevent infinite loop
      if (pages > 20) {
        assert.fail('Too many pages — infinite loop?');
      }
    }

    // 10 turns × 2 messages each = 20 messages total
    assert.strictEqual(allMessages.length, 20, `expected 20 messages, got ${allMessages.length}`);

    // Verify no skips/repeats: extract user message numbers
    const userMsgs = allMessages.filter((m) => m.role === 'user').map((m) => m.content);
    for (let i = 1; i <= 10; i++) {
      assert.ok(
        userMsgs.includes(`User message ${i}`),
        `Missing user message ${i}`
      );
    }
    // No duplicates
    assert.strictEqual(new Set(userMsgs).size, 10, 'Duplicate user messages in cursor chain');
  });
});

test('empty session returns correct shape', async () => {
  await withHarness(async ({ db }) => {
    const sessionId = 'session-empty';
    // Insert session row with no turns
    db.prepare(`
      INSERT INTO sessions (id, provider, provider_session_id, origin, status, created_at, last_active_at)
      VALUES (?, 'claude', ?, 'provider-import', 'active', datetime('now'), datetime('now'))
    `).run(sessionId, sessionId);

    const result = queryDbPage(db, sessionId, { count: 30 });
    assert.deepStrictEqual(result.messages, []);
    assert.strictEqual(result.hasMore, false);
    assert.strictEqual(result.nextCursor, null);
    assert.strictEqual(result.totalTurns, 0);
  });
});

test('usage aggregates match sum of ingested turns', async () => {
  await withHarness(async ({ db, ingester, claudeRoot }) => {
    const sessionId = 'session-usage-agg';
    const filePath = path.join(claudeRoot, 'proj-usage', `${sessionId}.jsonl`);
    await writeJsonl(filePath, buildClaudeTurnLines(1, 5));
    await ingester.ingestFile(filePath, { provider: 'claude', sessionId });

    const session = db.prepare(`
      SELECT turn_count, total_input_tokens, total_output_tokens
      FROM sessions WHERE id = ?
    `).get(sessionId);
    const sums = db.prepare(`
      SELECT COUNT(*) as c, SUM(input_tokens) as inp, SUM(output_tokens) as out
      FROM turns WHERE session_id = ?
    `).get(sessionId);

    assert.strictEqual(session.turn_count, sums.c);
    assert.strictEqual(session.total_input_tokens, sums.inp);
    assert.strictEqual(session.total_output_tokens, sums.out);
    assert.ok(session.total_input_tokens > 0, 'input tokens should be positive');
    assert.ok(session.total_output_tokens > 0, 'output tokens should be positive');
  });
});

test('page size = 1 still covers all turns', async () => {
  await withHarness(async ({ db, ingester, claudeRoot }) => {
    const sessionId = 'session-page1';
    const filePath = path.join(claudeRoot, 'proj-p1', `${sessionId}.jsonl`);
    await writeJsonl(filePath, buildClaudeTurnLines(1, 4));
    await ingester.ingestFile(filePath, { provider: 'claude', sessionId });

    const allMessages = [];
    let cursor = undefined;
    let pages = 0;

    while (true) {
      const page = queryDbPage(db, sessionId, { count: 1, cursor });
      allMessages.push(...page.messages);
      pages++;
      if (!page.hasMore) break;
      cursor = page.nextCursor;
      if (pages > 20) assert.fail('infinite loop');
    }

    assert.strictEqual(allMessages.length, 8); // 4 turns × 2 messages
    assert.strictEqual(pages, 4); // 4 pages of 1 turn each
  });
});

test('DB route mode returns paginated messages with string cursor', async () => {
  await withMessagesMode('1', async () => {
    await withHarness(async ({ db, ingester, claudeRoot }) => {
      const sessionId = `route-db-${Date.now()}`;
      const filePath = path.join(claudeRoot, 'proj-route-db', `${sessionId}.jsonl`);
      await writeJsonl(filePath, buildClaudeTurnLines(1, 6));
      await ingester.ingestFile(filePath, { provider: 'claude', sessionId });
      cacheSessionFileHint(sessionId, 'claude', filePath);

      const { handleSessions } = createRouteModule(() => db);
      try {
        const p1 = createMockReq('GET', `/sessions/${sessionId}/messages`, { query: 'count=2' });
        const r1 = createMockRes();
        await handleSessions(p1.req, r1, p1.url);
        assert.strictEqual(r1.state.statusCode, 200);
        const b1 = parseResBody(r1);
        assert.strictEqual(Array.isArray(b1.messages), true);
        assert.strictEqual(b1.messages.length, 4); // 2 turns -> 4 chat messages
        assert.strictEqual(typeof b1.nextCursor, 'string');
        assert.strictEqual(b1.hasMore, true);

        const p2 = createMockReq('GET', `/sessions/${sessionId}/messages`, { query: `count=2&cursor=${b1.nextCursor}` });
        const r2 = createMockRes();
        await handleSessions(p2.req, r2, p2.url);
        assert.strictEqual(r2.state.statusCode, 200);
        const b2 = parseResBody(r2);
        assert.strictEqual(Array.isArray(b2.messages), true);
        assert.strictEqual(b2.messages.length, 4);
      } finally {
        SESSION_FILE_HINTS.delete(sessionId);
      }
    });
  });
});

test('DB route enriches assistant messages with contentBlocks when JSONL is available', async () => {
  await withMessagesMode('1', async () => {
    await withHarness(async ({ db, ingester, claudeRoot }) => {
      const sessionId = `route-blocks-${Date.now()}`;
      const filePath = path.join(claudeRoot, 'proj-route-blocks', `${sessionId}.jsonl`);
      await writeJsonl(filePath, buildClaudeToolTurnEntries());
      await ingester.ingestFile(filePath, { provider: 'claude', sessionId });
      cacheSessionFileHint(sessionId, 'claude', filePath);

      const { handleSessions } = createRouteModule(() => db);
      try {
        const p = createMockReq('GET', `/sessions/${sessionId}/messages`, { query: 'count=10' });
        const r = createMockRes();
        await handleSessions(p.req, r, p.url);
        assert.strictEqual(r.state.statusCode, 200);

        const body = parseResBody(r);
        const assistant = body.messages.find((m) => m.role === 'assistant');
        assert.ok(assistant, 'should have assistant message');
        assert.deepStrictEqual(assistant.contentBlocks, [
          { type: 'text', text: 'Opening file' },
          { type: 'tool', toolIndex: 0 },
          { type: 'text', text: 'Read complete' },
        ]);
        assert.strictEqual(assistant.toolCalls?.[0]?.result, 'hello world');
      } finally {
        SESSION_FILE_HINTS.delete(sessionId);
      }
    });
  });
});

test('DB route falls back to DB-only messages when JSONL file is missing', async () => {
  await withMessagesMode('1', async () => {
    await withHarness(async ({ db, ingester, claudeRoot }) => {
      const sessionId = `route-blocks-missing-${Date.now()}`;
      const filePath = path.join(claudeRoot, 'proj-route-blocks-missing', `${sessionId}.jsonl`);
      await writeJsonl(filePath, buildClaudeToolTurnEntries());
      await ingester.ingestFile(filePath, { provider: 'claude', sessionId });
      cacheSessionFileHint(sessionId, 'claude', filePath);
      await fs.rm(filePath);

      const { handleSessions } = createRouteModule(() => db);
      try {
        const p = createMockReq('GET', `/sessions/${sessionId}/messages`, { query: 'count=10' });
        const r = createMockRes();
        await handleSessions(p.req, r, p.url);
        assert.strictEqual(r.state.statusCode, 200);

        const body = parseResBody(r);
        const assistant = body.messages.find((m) => m.role === 'assistant');
        assert.ok(assistant, 'should have assistant message');
        assert.strictEqual(assistant.contentBlocks, undefined);
        assert.strictEqual(assistant.toolCalls?.[0]?.result, 'hello world');
      } finally {
        SESSION_FILE_HINTS.delete(sessionId);
      }
    });
  });
});

test('DB route mode returns 503 when database is unavailable', async () => {
  await withMessagesMode('1', async () => {
    const sessionId = `route-db-down-${Date.now()}`;
    const { handleSessions } = createRouteModule(() => null);
    const req = createMockReq('GET', `/sessions/${sessionId}/messages`, { query: 'count=2' });
    const res = createMockRes();
    await handleSessions(req.req, res, req.url);
    assert.strictEqual(res.state.statusCode, 503);
    const body = parseResBody(res);
    assert.ok(typeof body.error === 'string' && body.error.length > 0);
  });
});

test('DB route returns contextTokens, uuid, and compactMetadata in messages', async () => {
  await withMessagesMode('1', async () => {
    await withHarness(async ({ db, ingester, claudeRoot }) => {
      const sessionId = `route-meta-${Date.now()}`;
      const filePath = path.join(claudeRoot, 'proj-meta', `${sessionId}.jsonl`);

      // Build entries with usage + compaction event
      const entries = [
        {
          type: 'user',
          uuid: 'uuid-turn-1',
          timestamp: isoFor(2),
          message: { role: 'user', content: 'Hello world' },
        },
        {
          type: 'assistant',
          timestamp: isoFor(3),
          message: {
            role: 'assistant',
            content: [{ type: 'text', text: 'Hi there' }],
            model: 'claude-sonnet-4-5-20250929',
            usage: {
              input_tokens: 500,
              output_tokens: 200,
              cache_read_input_tokens: 100,
              cache_creation_input_tokens: 50,
            },
          },
        },
        {
          type: 'system',
          subtype: 'context_compaction',
          timestamp: isoFor(4),
          compaction: {
            trigger: 'token_limit',
            preTokens: 150000,
            tokensSaved: 50000,
            compactedToolIds: ['toolu_abc'],
          },
        },
      ];

      await writeJsonl(filePath, entries);
      await ingester.ingestFile(filePath, { provider: 'claude', sessionId });
      cacheSessionFileHint(sessionId, 'claude', filePath);

      const { handleSessions } = createRouteModule(() => db);
      try {
        const p = createMockReq('GET', `/sessions/${sessionId}/messages`, { query: 'count=10' });
        const r = createMockRes();
        await handleSessions(p.req, r, p.url);
        assert.strictEqual(r.state.statusCode, 200);
        const body = parseResBody(r);

        assert.ok(Array.isArray(body.messages));
        assert.strictEqual(body.messages.length, 2); // user + assistant

        const assistantMsg = body.messages.find(m => m.role === 'assistant');
        assert.ok(assistantMsg, 'should have assistant message');

        // contextTokens = max(input_tokens + cache_read + cache_creation) = 500 + 100 + 50 = 650
        assert.strictEqual(assistantMsg.contextTokens, 650, 'contextTokens should be input+cache total');
        assert.strictEqual(assistantMsg.uuid, 'uuid-turn-1', 'uuid should flow through API');
        assert.strictEqual(assistantMsg.inputTokens, 650); // accumulated: 500 + 100 + 50
        assert.strictEqual(assistantMsg.outputTokens, 200);

        // compactMetadata
        assert.ok(assistantMsg.compactMetadata, 'compactMetadata should be present');
        assert.strictEqual(assistantMsg.compactMetadata.trigger, 'token_limit');
        assert.strictEqual(assistantMsg.compactMetadata.preTokens, 150000);
        assert.strictEqual(assistantMsg.compactMetadata.tokensSaved, 50000);
        assert.deepStrictEqual(assistantMsg.compactMetadata.compactedToolIds, ['toolu_abc']);
      } finally {
        SESSION_FILE_HINTS.delete(sessionId);
      }
    });
  });
});

test('full lifecycle: context trajectory and compaction flow through API', async () => {
  await withMessagesMode('1', async () => {
    await withHarness(async ({ db, ingester, claudeRoot }) => {
      const sessionId = `route-lifecycle-${Date.now()}`;
      const filePath = path.join(claudeRoot, 'proj-lifecycle', `${sessionId}.jsonl`);

      // 4 turns: growing context → compaction → post-compaction turn
      const entries = [
        // Turn 1: 10K context
        { type: 'user', uuid: 'lc-turn-1', timestamp: isoFor(2),
          message: { role: 'user', content: 'Start project' } },
        { type: 'assistant', timestamp: isoFor(3),
          message: {
            role: 'assistant', content: [{ type: 'text', text: 'Starting...' }],
            model: 'claude-sonnet-4-5-20250929',
            usage: { input_tokens: 10000, output_tokens: 2000, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 },
          } },

        // Turn 2: 50K context
        { type: 'user', uuid: 'lc-turn-2', timestamp: isoFor(4),
          message: { role: 'user', content: 'Expand the plan' } },
        { type: 'assistant', timestamp: isoFor(5),
          message: {
            role: 'assistant', content: [{ type: 'text', text: 'Expanded...' }],
            model: 'claude-sonnet-4-5-20250929',
            usage: { input_tokens: 50000, output_tokens: 8000, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 },
          } },

        // Turn 3: 90K context + compaction
        { type: 'user', uuid: 'lc-turn-3', timestamp: isoFor(6),
          message: { role: 'user', content: 'Implement everything' } },
        { type: 'assistant', timestamp: isoFor(7),
          message: {
            role: 'assistant', content: [{ type: 'text', text: 'Implementing...' }],
            model: 'claude-sonnet-4-5-20250929',
            usage: { input_tokens: 90000, output_tokens: 20000, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 },
          } },
        { type: 'system', subtype: 'context_compaction', timestamp: isoFor(8),
          compaction: { trigger: 'token_limit', preTokens: 110000, tokensSaved: 70000 } },

        // Turn 4: 40K context (post-compaction)
        { type: 'user', uuid: 'lc-turn-4', timestamp: isoFor(10),
          message: { role: 'user', content: 'Add tests' } },
        { type: 'assistant', timestamp: isoFor(11),
          message: {
            role: 'assistant', content: [{ type: 'text', text: 'Tests added...' }],
            model: 'claude-sonnet-4-5-20250929',
            usage: { input_tokens: 40000, output_tokens: 6000, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 },
          } },
      ];

      await writeJsonl(filePath, entries);
      await ingester.ingestFile(filePath, { provider: 'claude', sessionId });
      cacheSessionFileHint(sessionId, 'claude', filePath);

      const { handleSessions } = createRouteModule(() => db);
      try {
        // Fetch all messages via API
        const p = createMockReq('GET', `/sessions/${sessionId}/messages`, { query: 'count=20' });
        const r = createMockRes();
        await handleSessions(p.req, r, p.url);
        assert.strictEqual(r.state.statusCode, 200);
        const body = parseResBody(r);

        // 4 turns × 2 messages = 8
        assert.strictEqual(body.messages.length, 8);
        assert.strictEqual(body.totalTurns, 4);
        assert.strictEqual(body.hasMore, false);

        // Extract assistant messages (they carry the metrics)
        const assistants = body.messages.filter(m => m.role === 'assistant');
        assert.strictEqual(assistants.length, 4);

        // Context trajectory: 10K → 50K → 90K → 40K
        assert.strictEqual(assistants[0].contextTokens, 10000);
        assert.strictEqual(assistants[1].contextTokens, 50000);
        assert.strictEqual(assistants[2].contextTokens, 90000);
        assert.strictEqual(assistants[3].contextTokens, 40000, 'post-compaction context should drop');

        // UUIDs flow through
        assert.strictEqual(assistants[0].uuid, 'lc-turn-1');
        assert.strictEqual(assistants[3].uuid, 'lc-turn-4');

        // Compaction on turn 3
        assert.ok(assistants[2].compactMetadata, 'turn 3 should carry compaction metadata');
        assert.strictEqual(assistants[2].compactMetadata.trigger, 'token_limit');
        assert.strictEqual(assistants[2].compactMetadata.tokensSaved, 70000);
        assert.strictEqual(assistants[0].compactMetadata, undefined, 'turn 1 should not have compaction');

        // Turn numbers sequential
        const turnNums = assistants.map(a => a.turnNumber);
        assert.deepStrictEqual(turnNums, [1, 2, 3, 4]);

        // Usage aggregates
        assert.ok(body.usage, 'response should include usage');
        assert.strictEqual(body.usage.turnCount, 4);
        assert.ok(body.usage.totalInputTokens > 0);
        assert.ok(body.usage.totalCostUsd > 0);

        // Costs are present on each turn
        for (const a of assistants) {
          assert.ok(typeof a.costUsd === 'number' && a.costUsd > 0, `turn ${a.turnNumber} should have cost`);
        }
      } finally {
        SESSION_FILE_HINTS.delete(sessionId);
      }
    });
  });
});
