import { test } from 'node:test';
import assert from 'node:assert';
import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import { buildTurnIndex, readByteRange } from '../../commands/sessions/turn-index.js';
import { parseSessionMessagesFromJsonl } from '../../commands/serve/sessions.js';

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
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'rudi-turn-index-'));
  const filePath = path.join(dir, 'session.jsonl');
  await fs.writeFile(filePath, content, 'utf-8');
  try {
    await fn(filePath);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
}

test('buildTurnIndex matches parsed Claude message count and per-turn byte ranges', async () => {
  const lines = [
    JSON.stringify({
      type: 'user',
      timestamp: '2026-02-06T01:39:15.038Z',
      message: { role: 'user', content: 'hello from user' },
    }),
    JSON.stringify({
      type: 'assistant',
      timestamp: '2026-02-06T01:39:18.483Z',
      message: {
        role: 'assistant',
        content: [
          { type: 'tool_use', id: 'tool-1', name: 'Read', input: { file_path: '/tmp/x' } },
        ],
      },
    }),
    JSON.stringify({
      type: 'user',
      timestamp: '2026-02-06T01:39:19.000Z',
      message: {
        role: 'user',
        content: [{ type: 'tool_result', tool_use_id: 'tool-1', content: 'file contents' }],
      },
    }),
    JSON.stringify({
      type: 'assistant',
      timestamp: '2026-02-06T01:39:20.000Z',
      message: {
        role: 'assistant',
        content: [{ type: 'text', text: 'I read the file' }],
      },
    }),
    JSON.stringify({
      type: 'user',
      timestamp: '2026-02-06T01:39:21.000Z',
      message: { role: 'user', content: 'thanks' },
    }),
    JSON.stringify({
      type: 'assistant',
      timestamp: '2026-02-06T01:39:22.000Z',
      message: {
        role: 'assistant',
        content: [{ type: 'text', text: 'You are welcome.' }],
      },
    }),
  ];
  const content = `${lines.join('\n')}\n`;
  const parsed = parseSessionMessagesFromJsonl(content, 'claude');
  const lineOffsets = buildLineOffsets(content);
  const fileSize = Buffer.byteLength(content, 'utf-8');
  const contentBuf = Buffer.from(content, 'utf-8');

  await withTempJsonl(content, async (filePath) => {
    const index = await buildTurnIndex(filePath, 'claude', lineOffsets, fileSize);

    assert.strictEqual(index.totalTurns, parsed.length);
    assert.strictEqual(index.coveredLines, lineOffsets.length);

    for (const turn of index.turns) {
      const slice = contentBuf.subarray(turn.startByte, turn.endByte).toString('utf-8');
      const parsedSlice = parseSessionMessagesFromJsonl(slice, 'claude');
      assert.strictEqual(parsedSlice.length, 1);
    }
  });
});

test('buildTurnIndex matches parsed Codex message count and per-turn byte ranges', async () => {
  const lines = [
    JSON.stringify({
      type: 'event_msg',
      timestamp: '2026-02-06T01:41:00.000Z',
      payload: { type: 'user_message', message: 'run command' },
    }),
    JSON.stringify({
      type: 'response_item',
      timestamp: '2026-02-06T01:41:01.000Z',
      payload: {
        type: 'function_call',
        call_id: 'call-1',
        name: 'exec_command',
        arguments: JSON.stringify({ cmd: 'echo hi' }),
      },
    }),
    JSON.stringify({
      type: 'response_item',
      timestamp: '2026-02-06T01:41:02.000Z',
      payload: {
        type: 'function_call_output',
        call_id: 'call-1',
        output: 'hi',
      },
    }),
    JSON.stringify({
      type: 'response_item',
      timestamp: '2026-02-06T01:41:03.000Z',
      payload: {
        type: 'message',
        role: 'assistant',
        content: [{ type: 'output_text', text: 'done' }],
      },
    }),
    JSON.stringify({
      type: 'event_msg',
      timestamp: '2026-02-06T01:41:04.000Z',
      payload: { type: 'user_message', message: 'next task' },
    }),
    JSON.stringify({
      type: 'response_item',
      timestamp: '2026-02-06T01:41:05.000Z',
      payload: {
        type: 'message',
        role: 'assistant',
        content: [{ type: 'output_text', text: 'all set' }],
      },
    }),
  ];
  const content = `${lines.join('\n')}\n`;
  const parsed = parseSessionMessagesFromJsonl(content, 'codex');
  const lineOffsets = buildLineOffsets(content);
  const fileSize = Buffer.byteLength(content, 'utf-8');
  const contentBuf = Buffer.from(content, 'utf-8');

  await withTempJsonl(content, async (filePath) => {
    const index = await buildTurnIndex(filePath, 'codex', lineOffsets, fileSize);

    assert.strictEqual(index.totalTurns, parsed.length);
    assert.strictEqual(index.coveredLines, lineOffsets.length);

    for (const turn of index.turns) {
      const slice = contentBuf.subarray(turn.startByte, turn.endByte).toString('utf-8');
      const parsedSlice = parseSessionMessagesFromJsonl(slice, 'codex');
      assert.strictEqual(parsedSlice.length, 1);
    }
  });
});

test('incremental index extension: build first 2 lines, then extend from line 2, matches full build', async () => {
  const lines = [
    JSON.stringify({
      type: 'user',
      timestamp: '2026-02-06T01:00:00.000Z',
      message: { role: 'user', content: 'msg 1' },
    }),
    JSON.stringify({
      type: 'assistant',
      timestamp: '2026-02-06T01:00:01.000Z',
      message: { role: 'assistant', content: [{ type: 'text', text: 'reply 1' }] },
    }),
    JSON.stringify({
      type: 'user',
      timestamp: '2026-02-06T01:00:02.000Z',
      message: { role: 'user', content: 'msg 2' },
    }),
    JSON.stringify({
      type: 'assistant',
      timestamp: '2026-02-06T01:00:03.000Z',
      message: { role: 'assistant', content: [{ type: 'text', text: 'reply 2' }] },
    }),
    JSON.stringify({
      type: 'user',
      timestamp: '2026-02-06T01:00:04.000Z',
      message: { role: 'user', content: 'msg 3' },
    }),
    JSON.stringify({
      type: 'assistant',
      timestamp: '2026-02-06T01:00:05.000Z',
      message: { role: 'assistant', content: [{ type: 'text', text: 'reply 3' }] },
    }),
  ];
  const content = `${lines.join('\n')}\n`;
  const lineOffsets = buildLineOffsets(content);
  const fileSize = Buffer.byteLength(content, 'utf-8');

  await withTempJsonl(content, async (filePath) => {
    // Full build for reference
    const full = await buildTurnIndex(filePath, 'claude', lineOffsets, fileSize);
    assert.strictEqual(full.totalTurns, 6);

    // Build first 2 lines only (user + assistant = 2 turns).
    // Pass full lineOffsets + fileSize but fromLine=0, scanning stops at line 2
    // because buildTurnIndex iterates lineOffsets.length lines.
    // To truly truncate, we pass a trimmed lineOffsets (first 2 entries).
    const splitLine = 2;
    const splitByte = lineOffsets[splitLine]; // byte where line 2 starts
    const partial = await buildTurnIndex(filePath, 'claude', lineOffsets, splitByte, 0, []);
    assert.strictEqual(partial.totalTurns, 2, 'partial should have 2 turns');

    // Now extend from line 2 with the full lineOffsets + fileSize
    const incremental = await buildTurnIndex(
      filePath, 'claude', lineOffsets, fileSize,
      splitLine, partial.turns,
    );

    // The combined result should match the full build
    assert.strictEqual(incremental.totalTurns, full.totalTurns, 'total turns should match');

    for (let i = 0; i < full.turns.length; i++) {
      assert.strictEqual(incremental.turns[i].startByte, full.turns[i].startByte, `turn ${i} startByte`);
      assert.strictEqual(incremental.turns[i].endByte, full.turns[i].endByte, `turn ${i} endByte`);
    }
  });
});

test('readByteRange returns correct slice', async () => {
  const content = 'hello world\nsecond line\nthird line\n';
  await withTempJsonl(content, async (filePath) => {
    const slice = await readByteRange(filePath, 0, 11);
    assert.strictEqual(slice, 'hello world');

    const slice2 = await readByteRange(filePath, 12, 23);
    assert.strictEqual(slice2, 'second line');

    const empty = await readByteRange(filePath, 5, 5);
    assert.strictEqual(empty, '');
  });
});
