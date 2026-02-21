import { test } from 'node:test';
import assert from 'node:assert';
import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import { buildTurnIndex, readByteRange } from '../../commands/sessions/turn-index.js';
import { createSessionsModule, parseSessionMessagesFromJsonl } from '../../commands/serve/sessions.js';
import { cacheSessionFileHint, SESSION_FILE_HINTS } from '../../commands/sessions/file-hints.js';
import { createMockReq, createMockRes, parseResBody } from '../helpers/serve-mocks.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function buildLineOffsets(content) {
  const buf = Buffer.from(content, 'utf-8');
  const offsets = [0];
  for (let i = 0; i < buf.length; i++) {
    if (buf[i] === 0x0a) offsets.push(i + 1);
  }
  if (offsets.length > 0 && offsets[offsets.length - 1] >= buf.length) {
    offsets.pop();
  }
  return offsets;
}

async function withTempJsonl(content, fn) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'rudi-pagination-'));
  const filePath = path.join(dir, 'session.jsonl');
  await fs.writeFile(filePath, content, 'utf-8');
  try {
    await fn(filePath);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
}

/** Mirror of sidecar encodeCursor */
function encodeCursor(turnNumber) {
  return Buffer.from(JSON.stringify({ t: turnNumber, v: 1 })).toString('base64url');
}

/** Mirror of sidecar decodeCursor */
function decodeCursor(token) {
  const obj = JSON.parse(Buffer.from(token, 'base64url').toString());
  if (obj.v !== 1) throw new Error('Unknown cursor version');
  return obj.t;
}

/**
 * Simulate readSessionMessagesPaginated's turn-based path using turn index.
 * Returns the same shape as the sidecar response.
 */
async function paginateFromIndex(filePath, turns, totalTurns, { count, cursor } = {}) {
  const pageSize = (Number.isFinite(count) && count > 0) ? count : 30;
  const endTurn = cursor ? Math.min(decodeCursor(cursor), totalTurns) : totalTurns;
  const startTurn = Math.max(0, endTurn - pageSize);

  let messages = [];
  if (startTurn < endTurn && turns.length > 0) {
    const startByte = turns[startTurn].startByte;
    const endByte = turns[endTurn - 1].endByte;
    const content = await readByteRange(filePath, startByte, endByte);
    messages = parseSessionMessagesFromJsonl(content, 'claude');
  }

  const hasMore = startTurn > 0;
  const nextCursor = hasMore ? encodeCursor(startTurn) : null;

  return { messages, nextCursor, hasMore };
}

// ---------------------------------------------------------------------------
// 6-turn fixture: 3 user messages + 3 assistant replies = 6 turns
// ---------------------------------------------------------------------------

function build6TurnFixture() {
  const lines = [];
  for (let i = 0; i < 3; i++) {
    lines.push(JSON.stringify({
      type: 'user',
      timestamp: `2026-02-06T01:00:0${i * 2}.000Z`,
      message: { role: 'user', content: `User message ${i + 1}` },
    }));
    lines.push(JSON.stringify({
      type: 'assistant',
      timestamp: `2026-02-06T01:00:0${i * 2 + 1}.000Z`,
      message: {
        role: 'assistant',
        content: [{ type: 'text', text: `Assistant reply ${i + 1}` }],
      },
    }));
  }
  return `${lines.join('\n')}\n`;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

test('cursor chain stays string throughout pagination', async () => {
  const content = build6TurnFixture();
  const lineOffsets = buildLineOffsets(content);
  const fileSize = Buffer.byteLength(content, 'utf-8');

  await withTempJsonl(content, async (filePath) => {
    const { turns, totalTurns } = await buildTurnIndex(filePath, 'claude', lineOffsets, fileSize);

    // Page 1: latest 2 turns
    const page1 = await paginateFromIndex(filePath, turns, totalTurns, { count: 2 });
    assert.strictEqual(typeof page1.nextCursor, 'string', 'first cursor should be a string');
    assert.strictEqual(page1.hasMore, true);

    // Page 2
    const page2 = await paginateFromIndex(filePath, turns, totalTurns, { count: 2, cursor: page1.nextCursor });
    assert.strictEqual(typeof page2.nextCursor, 'string', 'second cursor should be a string');
    assert.strictEqual(page2.hasMore, true);

    // Page 3 (final)
    const page3 = await paginateFromIndex(filePath, turns, totalTurns, { count: 2, cursor: page2.nextCursor });
    assert.strictEqual(page3.nextCursor, null, 'final page cursor should be null');
    assert.strictEqual(page3.hasMore, false);
  });
});

test('exact page size: count=2 on 6-turn fixture returns 2 messages per page', async () => {
  const content = build6TurnFixture();
  const lineOffsets = buildLineOffsets(content);
  const fileSize = Buffer.byteLength(content, 'utf-8');

  await withTempJsonl(content, async (filePath) => {
    const { turns, totalTurns } = await buildTurnIndex(filePath, 'claude', lineOffsets, fileSize);
    assert.strictEqual(totalTurns, 6);

    const page1 = await paginateFromIndex(filePath, turns, totalTurns, { count: 2 });
    assert.strictEqual(page1.messages.length, 2, 'page 1 should have exactly 2 messages');

    const page2 = await paginateFromIndex(filePath, turns, totalTurns, { count: 2, cursor: page1.nextCursor });
    assert.strictEqual(page2.messages.length, 2, 'page 2 should have exactly 2 messages');

    const page3 = await paginateFromIndex(filePath, turns, totalTurns, { count: 2, cursor: page2.nextCursor });
    assert.strictEqual(page3.messages.length, 2, 'page 3 should have exactly 2 messages');
  });
});

test('no repeat, no skip: all messages across pages equal full parse', async () => {
  const content = build6TurnFixture();
  const lineOffsets = buildLineOffsets(content);
  const fileSize = Buffer.byteLength(content, 'utf-8');
  const fullParse = parseSessionMessagesFromJsonl(content, 'claude');

  await withTempJsonl(content, async (filePath) => {
    const { turns, totalTurns } = await buildTurnIndex(filePath, 'claude', lineOffsets, fileSize);

    const allMessages = [];
    let cursor = null;
    let pages = 0;
    while (true) {
      const page = await paginateFromIndex(filePath, turns, totalTurns, {
        count: 2,
        ...(cursor ? { cursor } : {}),
      });
      // Pages come newest-first; prepend to reconstruct chronological order
      allMessages.unshift(...page.messages);
      cursor = page.nextCursor;
      pages++;
      if (!page.hasMore) break;
      assert.ok(pages < 100, 'safety: should not loop indefinitely');
    }

    assert.strictEqual(allMessages.length, fullParse.length, 'should have same total message count');

    // Compare content of each message
    for (let i = 0; i < fullParse.length; i++) {
      assert.strictEqual(allMessages[i].role, fullParse[i].role, `message ${i} role mismatch`);
    }

    // Check no duplicates (by stringified content)
    const seen = new Set();
    for (const msg of allMessages) {
      const key = `${msg.role}:${JSON.stringify(msg.content)}`;
      assert.ok(!seen.has(key), `duplicate message found: ${key}`);
      seen.add(key);
    }
  });
});

test('count with no cursor returns last N turns', async () => {
  const content = build6TurnFixture();
  const lineOffsets = buildLineOffsets(content);
  const fileSize = Buffer.byteLength(content, 'utf-8');
  const fullParse = parseSessionMessagesFromJsonl(content, 'claude');

  await withTempJsonl(content, async (filePath) => {
    const { turns, totalTurns } = await buildTurnIndex(filePath, 'claude', lineOffsets, fileSize);

    const page = await paginateFromIndex(filePath, turns, totalTurns, { count: 3 });
    assert.strictEqual(page.messages.length, 3);
    assert.strictEqual(page.hasMore, true);

    // Should be the last 3 messages from fullParse
    for (let i = 0; i < 3; i++) {
      assert.strictEqual(
        page.messages[i].role,
        fullParse[fullParse.length - 3 + i].role,
        `message ${i} should match the last 3 turns from full parse`,
      );
    }
  });
});

test('invalid cursor throws', () => {
  assert.throws(
    () => decodeCursor('not-valid-base64url'),
  );
});

test('cursor with wrong version throws', async () => {
  const badCursor = Buffer.from(JSON.stringify({ t: 5, v: 99 })).toString('base64url');
  assert.throws(
    () => decodeCursor(badCursor),
    { message: /Unknown cursor version/ },
  );
});

test('legacy tail translation: tail without count becomes count', async () => {
  // This test verifies the translation logic:
  // When tail is provided without count, it gets translated to count = min(tail, 200)
  // This is tested by verifying the output matches count-based pagination

  const content = build6TurnFixture();
  const lineOffsets = buildLineOffsets(content);
  const fileSize = Buffer.byteLength(content, 'utf-8');

  await withTempJsonl(content, async (filePath) => {
    const { turns, totalTurns } = await buildTurnIndex(filePath, 'claude', lineOffsets, fileSize);

    // Simulate legacy translation: tail=10 → count=10 (min(10, 200))
    const translatedCount = Math.min(10, 200);
    const page = await paginateFromIndex(filePath, turns, totalTurns, { count: translatedCount });

    // All 6 turns fit within count=10
    assert.strictEqual(page.messages.length, 6);
    assert.strictEqual(page.hasMore, false);
    assert.strictEqual(page.nextCursor, null);
  });
});

test('cursor encode/decode round-trip', () => {
  for (const turnNumber of [0, 1, 42, 9999]) {
    const cursor = encodeCursor(turnNumber);
    assert.strictEqual(typeof cursor, 'string');
    assert.strictEqual(decodeCursor(cursor), turnNumber);
  }
});

test('single-turn session: count=1 returns 1 message, no more', async () => {
  const content = [
    JSON.stringify({
      type: 'user',
      timestamp: '2026-02-06T01:00:00.000Z',
      message: { role: 'user', content: 'hello' },
    }),
    JSON.stringify({
      type: 'assistant',
      timestamp: '2026-02-06T01:00:01.000Z',
      message: {
        role: 'assistant',
        content: [{ type: 'text', text: 'hi' }],
      },
    }),
  ].join('\n') + '\n';
  const lineOffsets = buildLineOffsets(content);
  const fileSize = Buffer.byteLength(content, 'utf-8');

  await withTempJsonl(content, async (filePath) => {
    const { turns, totalTurns } = await buildTurnIndex(filePath, 'claude', lineOffsets, fileSize);

    const page = await paginateFromIndex(filePath, turns, totalTurns, { count: 1 });
    assert.strictEqual(page.messages.length, 1);
    assert.strictEqual(page.hasMore, true);

    const page2 = await paginateFromIndex(filePath, turns, totalTurns, { count: 1, cursor: page.nextCursor });
    assert.strictEqual(page2.messages.length, 1);
    assert.strictEqual(page2.hasMore, false);
    assert.strictEqual(page2.nextCursor, null);
  });
});

// ---------------------------------------------------------------------------
// Route-level tests — exercise GET /sessions/:id/messages through handleSessions
// ---------------------------------------------------------------------------

function createRouteModule() {
  const _logs = [];
  return createSessionsModule({
    log(source, level, msg) { _logs.push({ source, level, msg }); },
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
    resolveDb: () => null,
  });
}

async function withMessagesMode(mode, fn) {
  const prev = process.env.RUDI_DB_MESSAGES;
  if (mode === null || mode === undefined) {
    delete process.env.RUDI_DB_MESSAGES;
  } else {
    process.env.RUDI_DB_MESSAGES = mode;
  }
  try {
    await fn();
  } finally {
    if (prev === undefined) delete process.env.RUDI_DB_MESSAGES;
    else process.env.RUDI_DB_MESSAGES = prev;
  }
}

test('route: GET /sessions/:id/messages?count=2 returns string nextCursor and hasMore', async () => {
  await withMessagesMode('0', async () => {
    const content = build6TurnFixture();
    await withTempJsonl(content, async (filePath) => {
      const sessionId = `route-test-${Date.now()}`;
      cacheSessionFileHint(sessionId, 'claude', filePath);
      try {
        const { handleSessions } = createRouteModule();
        const { req, url } = createMockReq('GET', `/sessions/${sessionId}/messages`, {
          query: 'count=2',
        });
        const res = createMockRes();
        await handleSessions(req, res, url);

        assert.strictEqual(res.state.statusCode, 200);
        const body = parseResBody(res);
        assert.strictEqual(body.messages.length, 2);
        assert.strictEqual(body.hasMore, true);
        assert.strictEqual(typeof body.nextCursor, 'string');
        assert.ok(body.nextCursor.length > 0, 'cursor should be non-empty string');
      } finally {
        SESSION_FILE_HINTS.delete(sessionId);
      }
    });
  });
});

test('route: cursor chain through handleSessions returns all messages without repeat', async () => {
  await withMessagesMode('0', async () => {
    const content = build6TurnFixture();
    const fullParse = parseSessionMessagesFromJsonl(content, 'claude');

    await withTempJsonl(content, async (filePath) => {
      const sessionId = `route-chain-${Date.now()}`;
      cacheSessionFileHint(sessionId, 'claude', filePath);
      try {
        const { handleSessions } = createRouteModule();

        const allMessages = [];
        let cursor = null;
        let pages = 0;
        while (true) {
          const query = cursor ? `count=2&cursor=${cursor}` : 'count=2';
          const { req, url } = createMockReq('GET', `/sessions/${sessionId}/messages`, { query });
          const res = createMockRes();
          await handleSessions(req, res, url);

          assert.strictEqual(res.state.statusCode, 200);
          const body = parseResBody(res);
          allMessages.unshift(...body.messages);
          cursor = body.nextCursor;
          pages++;
          if (!body.hasMore) break;
          assert.ok(pages < 50, 'too many pages');
          assert.strictEqual(typeof cursor, 'string', 'cursor must be string');
        }

        assert.strictEqual(allMessages.length, fullParse.length, 'all messages should be returned');

        // Verify no duplicates by role+content
        const seen = new Set();
        for (const msg of allMessages) {
          const key = `${msg.role}:${JSON.stringify(msg.content)}`;
          assert.ok(!seen.has(key), `duplicate: ${key}`);
          seen.add(key);
        }
      } finally {
        SESSION_FILE_HINTS.delete(sessionId);
      }
    });
  });
});

test('route: legacy tail param is translated to count (returns string cursor)', async () => {
  await withMessagesMode('0', async () => {
    const content = build6TurnFixture();
    await withTempJsonl(content, async (filePath) => {
      const sessionId = `route-tail-${Date.now()}`;
      cacheSessionFileHint(sessionId, 'claude', filePath);
      try {
        const { handleSessions } = createRouteModule();
        const { req, url } = createMockReq('GET', `/sessions/${sessionId}/messages`, {
          query: 'tail=3',
        });
        const res = createMockRes();
        await handleSessions(req, res, url);

        assert.strictEqual(res.state.statusCode, 200);
        const body = parseResBody(res);
        assert.strictEqual(body.messages.length, 3);
        assert.strictEqual(body.hasMore, true);
        assert.strictEqual(typeof body.nextCursor, 'string');
      } finally {
        SESSION_FILE_HINTS.delete(sessionId);
      }
    });
  });
});

test('route: legacy before param without count/cursor returns 400', async () => {
  await withMessagesMode('0', async () => {
    const content = build6TurnFixture();
    await withTempJsonl(content, async (filePath) => {
      const sessionId = `route-before-${Date.now()}`;
      cacheSessionFileHint(sessionId, 'claude', filePath);
      try {
        const { handleSessions } = createRouteModule();
        const { req, url } = createMockReq('GET', `/sessions/${sessionId}/messages`, {
          query: 'tail=10&before=50',
        });
        const res = createMockRes();
        await handleSessions(req, res, url);

        assert.strictEqual(res.state.statusCode, 400);
        const body = parseResBody(res);
        assert.ok(body.error.includes('no longer supported'), `expected deprecation error, got: ${body.error}`);
      } finally {
        SESSION_FILE_HINTS.delete(sessionId);
      }
    });
  });
});

test('route: invalid cursor returns 400', async () => {
  await withMessagesMode('0', async () => {
    const content = build6TurnFixture();
    await withTempJsonl(content, async (filePath) => {
      const sessionId = `route-invalid-${Date.now()}`;
      cacheSessionFileHint(sessionId, 'claude', filePath);
      try {
        const { handleSessions } = createRouteModule();
        const { req, url } = createMockReq('GET', `/sessions/${sessionId}/messages`, {
          query: 'count=2&cursor=garbage',
        });
        const res = createMockRes();
        await handleSessions(req, res, url);

        assert.strictEqual(res.state.statusCode, 400);
      } finally {
        SESSION_FILE_HINTS.delete(sessionId);
      }
    });
  });
});
