import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { EventEmitter } from 'node:events';

import { normalize } from '../../commands/agent/normalizers/codex.js';
import { attachStdoutHandler } from '../../commands/agent/process-io.js';
import {
  flushDbWrites,
  resetAgentDbStateForTests,
  setResolvedDbForTests,
} from '../../commands/agent/db.js';

describe('codex normalizer', () => {
  test('preserves capped raw metadata for unknown provider events', () => {
    const normalized = normalize({
      type: 'future.event',
      payload: {
        type: 'future_payload',
        text: 'x'.repeat(20_000),
      },
    });

    assert.equal(normalized.type, 'system');
    assert.equal(normalized.subtype, 'unknown');
    assert.equal(normalized.providerEventType, 'future.event');
    assert.equal(normalized.providerItemType, 'future_payload');
    assert.equal(normalized.unknownReason, 'unknown_event_type');
    assert.equal(normalized.rawPayloadTruncated, true);
    assert.ok(typeof normalized.rawPayload === 'string');
    assert.ok(normalized.rawPayload.length <= 16_000);
  });

  test('persists unknown codex system events as runtime milestones', () => {
    const state = {
      lastSeq: 0,
      runtimeEvents: [],
      updatedAt: null,
    };
    const db = {
      prepare(sql) {
        const normalizedSql = sql.replace(/\s+/g, ' ').trim();
        return {
          get() {
            if (normalizedSql.includes('SELECT last_seq FROM session_runtime_state')) {
              return { last_seq: state.lastSeq };
            }
            return null;
          },
          run(...params) {
            if (normalizedSql.startsWith('INSERT OR REPLACE INTO session_runtime_events')) {
              state.lastSeq = Number(params[1]);
              state.runtimeEvents.push({
                seq: Number(params[1]),
                type: params[2],
                payload: JSON.parse(params[3]),
              });
              return { changes: 1 };
            }
            if (normalizedSql.includes('UPDATE session_runtime_state SET updated_at = ?, last_seq = ?')) {
              state.updatedAt = params[0];
              state.lastSeq = Number(params[1]);
              return { changes: 1 };
            }
            return { changes: 1 };
          },
        };
      },
    };

    setResolvedDbForTests(db);
    try {
      const stdout = new EventEmitter();
      const broadcasts = [];
      const entry = {
        provider: 'codex',
        proc: { stdout },
        stdoutBuffer: '',
        providerSessionId: null,
        _turnInputTokens: 0,
        _turnOutputTokens: 0,
        _turnCacheReadTokens: 0,
        _turnCacheCreationTokens: 0,
        _turnToolsUsed: [],
      };
      attachStdoutHandler({
        log() {},
        broadcast(type, payload) {
          broadcasts.push({ type, payload });
        },
        resumeSessionIndex: new Map(),
      }, 'sess-codex-1', entry);

      stdout.emit('data', Buffer.from(`${JSON.stringify({
        type: 'future.event',
        payload: { type: 'future_payload', foo: 'bar' },
      })}\n`));
      flushDbWrites();

      assert.equal(broadcasts.length, 1);
      assert.equal(broadcasts[0].type, 'agent:event');
      assert.equal(broadcasts[0].payload.event.subtype, 'unknown');
      assert.equal(state.runtimeEvents.length, 1);
      assert.equal(state.runtimeEvents[0].type, 'system');
      assert.equal(state.runtimeEvents[0].payload.providerEventType, 'future.event');
      assert.equal(state.runtimeEvents[0].payload.providerItemType, 'future_payload');
      assert.equal(state.runtimeEvents[0].payload.unknownReason, 'unknown_event_type');
      assert.ok(typeof state.runtimeEvents[0].payload.rawPayload === 'string');
      assert.equal(state.runtimeEvents[0].payload.rawEventType, 'future.event');
    } finally {
      resetAgentDbStateForTests();
    }
  });
});
