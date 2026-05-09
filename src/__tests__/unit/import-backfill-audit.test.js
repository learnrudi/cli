import { afterEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  auditZeroTurnSessions,
  classifyZeroTurnSource,
} from '../../commands/import.js';

const tempDirs = [];

afterEach(() => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    rmSync(dir, { recursive: true, force: true });
  }
});

function createTempFile(name, content) {
  const dir = mkdtempSync(join(tmpdir(), 'rudi-import-audit-'));
  tempDirs.push(dir);
  const filepath = join(dir, name);
  writeFileSync(filepath, content, 'utf-8');
  return filepath;
}

test('classifyZeroTurnSource marks missing files explicitly', () => {
  const result = classifyZeroTurnSource('/tmp/does-not-exist-rudi-import-audit.jsonl', 'claude');

  assert.equal(result.status, 'missing_file');
  assert.equal(result.turns.length, 0);
});

test('classifyZeroTurnSource detects queue-only Claude logs', () => {
  const filepath = createTempFile(
    'claude-queue-only.jsonl',
    `${JSON.stringify({ type: 'queue-operation', operation: 'dequeue', timestamp: '2026-01-01T00:00:00.000Z' })}\n`,
  );

  const result = classifyZeroTurnSource(filepath, 'claude');

  assert.equal(result.status, 'queue_only');
  assert.equal(result.turns.length, 0);
});

test('classifyZeroTurnSource detects metadata-only Codex logs', () => {
  const filepath = createTempFile(
    'codex-metadata-only.jsonl',
    [
      JSON.stringify({ timestamp: '2026-01-01T00:00:00.000Z', type: 'session_meta', payload: { id: 'sess-1', model: 'gpt-5' } }),
      JSON.stringify({ timestamp: '2026-01-01T00:00:01.000Z', type: 'turn_context', payload: { model: 'gpt-5' } }),
    ].join('\n'),
  );

  const result = classifyZeroTurnSource(filepath, 'codex');

  assert.equal(result.status, 'metadata_only');
  assert.equal(result.turns.length, 0);
});

test('classifyZeroTurnSource detects info-only Gemini logs', () => {
  const filepath = createTempFile(
    'gemini-info-only.json',
    JSON.stringify({
      messages: [
        { id: 'info-1', type: 'info', timestamp: '2026-01-01T00:00:00.000Z', content: 'Authentication required' },
        { id: 'info-2', type: 'info', timestamp: '2026-01-01T00:00:01.000Z', content: 'Authentication succeeded' },
      ],
    }),
  );

  const result = classifyZeroTurnSource(filepath, 'gemini');

  assert.equal(result.status, 'info_only');
  assert.equal(result.turns.length, 0);
});

test('classifyZeroTurnSource still returns backfillable turns when a source is recoverable', () => {
  const filepath = createTempFile(
    'codex-backfillable.jsonl',
    [
      JSON.stringify({ timestamp: '2026-01-01T00:00:00.000Z', type: 'session_meta', payload: { id: 'sess-2', model: 'gpt-5' } }),
      JSON.stringify({ timestamp: '2026-01-01T00:00:01.000Z', type: 'event_msg', payload: { type: 'user_message', message: 'hello' } }),
      JSON.stringify({ timestamp: '2026-01-01T00:00:02.000Z', type: 'event_msg', payload: { type: 'agent_reasoning', text: 'thinking' } }),
      JSON.stringify({ timestamp: '2026-01-01T00:00:03.000Z', type: 'event_msg', payload: { type: 'agent_message', message: 'hi there' } }),
      JSON.stringify({
        timestamp: '2026-01-01T00:00:04.000Z',
        type: 'event_msg',
        payload: {
          type: 'token_count',
          info: {
            last_token_usage: {
              input_tokens: 11,
              output_tokens: 7,
              cached_input_tokens: 0,
            },
          },
        },
      }),
    ].join('\n'),
  );

  const result = classifyZeroTurnSource(filepath, 'codex');

  assert.equal(result.status, 'backfillable');
  assert.equal(result.turns.length, 1);
  assert.equal(result.turns[0].userMessage, 'hello');
  assert.equal(result.turns[0].assistantResponse, 'hi there');
});

test('auditZeroTurnSessions summarizes recoverable and benign zero-turn sources', () => {
  const queueFile = createTempFile(
    'claude-queue-only.jsonl',
    `${JSON.stringify({ type: 'queue-operation', operation: 'dequeue', timestamp: '2026-01-01T00:00:00.000Z' })}\n`,
  );
  const geminiInfoFile = createTempFile(
    'gemini-info-only.json',
    JSON.stringify({
      messages: [
        { id: 'info-1', type: 'info', timestamp: '2026-01-01T00:00:00.000Z', content: 'Authentication required' },
      ],
    }),
  );
  const codexFile = createTempFile(
    'codex-backfillable.jsonl',
    [
      JSON.stringify({ timestamp: '2026-01-01T00:00:00.000Z', type: 'session_meta', payload: { id: 'sess-3', model: 'gpt-5' } }),
      JSON.stringify({ timestamp: '2026-01-01T00:00:01.000Z', type: 'event_msg', payload: { type: 'user_message', message: 'ship it' } }),
      JSON.stringify({ timestamp: '2026-01-01T00:00:02.000Z', type: 'event_msg', payload: { type: 'agent_message', message: 'done' } }),
    ].join('\n'),
  );

  const { summary } = auditZeroTurnSessions([
    {
      provider: 'claude',
      provider_session_id: 'claude-queue',
      origin_native_file: queueFile,
    },
    {
      provider: 'gemini',
      provider_session_id: 'gemini-info',
      origin_native_file: geminiInfoFile,
    },
    {
      provider: 'codex',
      provider_session_id: 'codex-turn',
      origin_native_file: codexFile,
    },
  ]);

  assert.equal(summary.sessionsExamined, 3);
  assert.equal(summary.hardFailures, 0);
  assert.equal(summary.counts.queue_only.sessions, 1);
  assert.equal(summary.counts.info_only.sessions, 1);
  assert.equal(summary.counts.backfillable.sessions, 1);
  assert.equal(summary.counts.backfillable.turns, 1);
});
