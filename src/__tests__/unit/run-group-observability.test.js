import { test } from 'node:test';
import assert from 'node:assert/strict';

import { extractEventSnippet } from '../../commands/agent/process-io.js';
import {
  emitRunGroupRouteLog,
  readLastRunGroupRuntimeProgress,
  resolveRunGroupSessionProgress,
} from '../../commands/agent/routes/run-group.js';

test('extractEventSnippet returns a tool marker for assistant tool_use blocks', () => {
  const snippet = extractEventSnippet({
    type: 'assistant',
    content: [
      { type: 'tool_use', name: 'search_graph' },
    ],
  });

  assert.strictEqual(snippet, 'Tool: search_graph');
});

test('readLastRunGroupRuntimeProgress reads payload_json rows and skips malformed payloads', () => {
  let seenSql = '';
  const db = {
    prepare(sql) {
      seenSql = sql.replace(/\s+/g, ' ').trim();
      return {
        all(sessionId) {
          assert.strictEqual(sessionId, 'sess-1');
          return [
            { type: 'assistant', payload_json: '{bad-json', ts: '2026-03-18T18:00:00.000Z' },
            {
              type: 'assistant',
              payload_json: JSON.stringify({
                type: 'assistant',
                content: [{ type: 'text', text: 'Debugger found the first bad state.' }],
              }),
              ts: '2026-03-18T18:01:00.000Z',
            },
          ];
        },
      };
    },
  };

  const progress = readLastRunGroupRuntimeProgress(db, 'sess-1');

  assert.ok(seenSql.includes('SELECT type, payload_json, ts FROM session_runtime_events'));
  assert.ok(seenSql.includes("type IN ('assistant', 'result', 'system', 'error')"));
  assert.strictEqual(progress.snippet, 'Debugger found the first bad state.');
  assert.strictEqual(progress.type, 'assistant');
  assert.strictEqual(progress.ts, '2026-03-18T18:01:00.000Z');
  assert.strictEqual(progress.source, 'runtime_event');
});

test('resolveRunGroupSessionProgress prefers live in-memory progress over persisted state', () => {
  const resolved = resolveRunGroupSessionProgress(
    {
      lastProgressSnippet: 'Implementor is applying the patch.',
      lastProgressType: 'assistant',
      lastProgressAt: '2026-03-18T18:10:00.000Z',
    },
    {
      snippet: 'Older persisted snippet',
      type: 'result',
      ts: '2026-03-18T18:05:00.000Z',
      source: 'runtime_event',
    },
  );

  assert.deepStrictEqual(resolved, {
    snippet: 'Implementor is applying the patch.',
    type: 'assistant',
    ts: '2026-03-18T18:10:00.000Z',
    source: 'live',
  });
});

test('resolveRunGroupSessionProgress falls back to persisted runtime progress', () => {
  const resolved = resolveRunGroupSessionProgress(null, {
    snippet: 'Completed successfully',
    type: 'result',
    ts: '2026-03-18T18:20:00.000Z',
    source: 'runtime_event',
  });

  assert.deepStrictEqual(resolved, {
    snippet: 'Completed successfully',
    type: 'result',
    ts: '2026-03-18T18:20:00.000Z',
    source: 'runtime_event',
  });
});

test('emitRunGroupRouteLog is a safe no-op when logging is unavailable', () => {
  assert.strictEqual(
    emitRunGroupRouteLog(null, 'info', 'cleanup finished', { cleaned: 2 }),
    false,
  );
});

test('emitRunGroupRouteLog swallows logger failures so routes do not crash after work succeeds', () => {
  assert.doesNotThrow(() => {
    emitRunGroupRouteLog(() => {
      throw new Error('logger exploded');
    }, 'info', 'cleanup finished', { cleaned: 2 });
  });
});

test('emitRunGroupRouteLog preserves the agent log contract when logging succeeds', () => {
  const calls = [];
  const logged = emitRunGroupRouteLog((source, level, message, data) => {
    calls.push({ source, level, message, data });
  }, 'warn', 'merge conflict', { groupId: 'g1' });

  assert.strictEqual(logged, true);
  assert.deepStrictEqual(calls, [{
    source: 'agent',
    level: 'warn',
    message: 'merge conflict',
    data: { groupId: 'g1' },
  }]);
});
