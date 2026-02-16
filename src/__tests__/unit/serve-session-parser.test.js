import { test } from 'node:test';
import assert from 'node:assert';
import { extractSessionCwdFromJsonlChunk, parseSessionMessagesFromJsonl } from '../../commands/serve/sessions.js';

test('parseSessionMessagesFromJsonl includes user and assistant messages', () => {
  const lines = [
    JSON.stringify({ type: 'queue-operation', operation: 'dequeue' }),
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
        content: [{ type: 'text', text: 'hello from assistant' }],
      },
    }),
  ];

  const parsed = parseSessionMessagesFromJsonl(lines.join('\n'));
  assert.strictEqual(parsed.length, 2);
  assert.deepStrictEqual(parsed[0], {
    role: 'user',
    content: 'hello from user',
    timestamp: '2026-02-06T01:39:15.038Z',
  });
  assert.strictEqual(parsed[1].role, 'assistant');
  assert.strictEqual(parsed[1].content, 'hello from assistant');
  assert.strictEqual(parsed[1].timestamp, '2026-02-06T01:39:18.483Z');
});

test('parseSessionMessagesFromJsonl supports legacy human_turn entries', () => {
  const lines = [
    JSON.stringify({
      type: 'human_turn',
      timestamp: '2026-02-06T01:39:15.038Z',
      message: {
        role: 'user',
        content: [{ type: 'text', text: 'legacy user message' }],
      },
    }),
    JSON.stringify({
      type: 'assistant_turn',
      timestamp: '2026-02-06T01:39:18.483Z',
      message: {
        role: 'assistant',
        content: [{ type: 'text', text: 'legacy assistant message' }],
      },
    }),
  ];

  const parsed = parseSessionMessagesFromJsonl(lines.join('\n'));
  assert.strictEqual(parsed.length, 2);
  assert.strictEqual(parsed[0].role, 'user');
  assert.strictEqual(parsed[0].content, 'legacy user message');
  assert.strictEqual(parsed[1].role, 'assistant');
  assert.strictEqual(parsed[1].content, 'legacy assistant message');
});

test('parseSessionMessagesFromJsonl ignores malformed and unsupported entries', () => {
  const lines = [
    '{not-valid-json',
    JSON.stringify({ type: 'system', message: { role: 'system', content: 'skip' } }),
    JSON.stringify({
      timestamp: '2026-02-06T01:39:15.038Z',
      message: { role: 'user', content: 'role based message' },
    }),
  ];

  const parsed = parseSessionMessagesFromJsonl(lines.join('\n'));
  assert.deepStrictEqual(parsed, [
    {
      role: 'user',
      content: 'role based message',
      timestamp: '2026-02-06T01:39:15.038Z',
    },
  ]);
});

test('parseSessionMessagesFromJsonl attaches tool_result to preceding assistant toolCalls', () => {
  const lines = [
    JSON.stringify({
      type: 'assistant',
      timestamp: '2026-02-06T01:39:18.483Z',
      message: {
        role: 'assistant',
        content: [
          { type: 'tool_use', id: 'tool-1', name: 'Read', input: { file_path: '/foo.ts' } },
        ],
      },
    }),
    JSON.stringify({
      type: 'user',
      timestamp: '2026-02-06T01:39:19.000Z',
      message: {
        role: 'user',
        content: [
          { type: 'tool_result', tool_use_id: 'tool-1', content: [{ type: 'text', text: 'file contents here' }] },
        ],
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
  ];

  const parsed = parseSessionMessagesFromJsonl(lines.join('\n'));
  assert.strictEqual(parsed.length, 2); // one merged assistant, one user
  const assistant = parsed[0];
  assert.strictEqual(assistant.role, 'assistant');
  assert.strictEqual(assistant.content, 'I read the file');
  assert.strictEqual(assistant.toolCalls.length, 1);
  assert.strictEqual(assistant.toolCalls[0].id, 'tool-1');
  assert.strictEqual(assistant.toolCalls[0].name, 'Read');
  assert.strictEqual(assistant.toolCalls[0].result, 'file contents here');
  assert.strictEqual(assistant.toolCalls[0].status, 'complete');
  assert.strictEqual(parsed[1].role, 'user');
  assert.strictEqual(parsed[1].content, 'thanks');
});

test('parseSessionMessagesFromJsonl keeps user attachments with placeholders', () => {
  const lines = [
    JSON.stringify({
      type: 'user',
      timestamp: '2026-02-06T01:39:15.038Z',
      message: {
        role: 'user',
        content: [
          { type: 'document', title: 'spec.md' },
          { type: 'image' },
        ],
      },
    }),
  ];

  const parsed = parseSessionMessagesFromJsonl(lines.join('\n'));
  assert.deepStrictEqual(parsed, [
    {
      role: 'user',
      content: '[Document: spec.md]\n[Image attached]',
      timestamp: '2026-02-06T01:39:15.038Z',
    },
  ]);
});

test('parseSessionMessagesFromJsonl merges consecutive assistant entries into single turn', () => {
  const lines = [
    JSON.stringify({
      type: 'assistant',
      timestamp: '2026-02-06T01:39:18.483Z',
      message: {
        role: 'assistant',
        content: [
          { type: 'tool_use', id: 'tool-1', name: 'Glob', input: { pattern: '*.ts' } },
        ],
      },
    }),
    JSON.stringify({
      type: 'user',
      timestamp: '2026-02-06T01:39:19.000Z',
      message: {
        role: 'user',
        content: [
          { type: 'tool_result', tool_use_id: 'tool-1', content: 'src/index.ts' },
        ],
      },
    }),
    JSON.stringify({
      type: 'assistant',
      timestamp: '2026-02-06T01:39:20.000Z',
      message: {
        role: 'assistant',
        content: [
          { type: 'tool_use', id: 'tool-2', name: 'Read', input: { file_path: 'src/index.ts' } },
        ],
      },
    }),
    JSON.stringify({
      type: 'user',
      timestamp: '2026-02-06T01:39:21.000Z',
      message: {
        role: 'user',
        content: [
          { type: 'tool_result', tool_use_id: 'tool-2', content: [{ type: 'text', text: 'export const x = 1;' }] },
        ],
      },
    }),
    JSON.stringify({
      type: 'assistant',
      timestamp: '2026-02-06T01:39:22.000Z',
      message: {
        role: 'assistant',
        content: [{ type: 'text', text: 'Found it!' }],
      },
    }),
    JSON.stringify({
      type: 'user',
      timestamp: '2026-02-06T01:39:23.000Z',
      message: { role: 'user', content: 'great' },
    }),
  ];

  const parsed = parseSessionMessagesFromJsonl(lines.join('\n'));
  assert.strictEqual(parsed.length, 2); // one merged assistant + one user
  const assistant = parsed[0];
  assert.strictEqual(assistant.content, 'Found it!');
  assert.strictEqual(assistant.toolCalls.length, 2);
  assert.strictEqual(assistant.toolCalls[0].name, 'Glob');
  assert.strictEqual(assistant.toolCalls[0].result, 'src/index.ts');
  assert.strictEqual(assistant.toolCalls[0].status, 'complete');
  assert.strictEqual(assistant.toolCalls[1].name, 'Read');
  assert.strictEqual(assistant.toolCalls[1].result, 'export const x = 1;');
  assert.strictEqual(assistant.toolCalls[1].status, 'complete');
});

test('parseSessionMessagesFromJsonl preserves thinking blocks', () => {
  const lines = [
    JSON.stringify({
      type: 'assistant',
      timestamp: '2026-02-06T01:39:18.483Z',
      message: {
        role: 'assistant',
        content: [
          { type: 'thinking', thinking: 'Let me consider this...' },
          { type: 'text', text: 'Here is my answer.' },
        ],
      },
    }),
    JSON.stringify({
      type: 'user',
      timestamp: '2026-02-06T01:39:20.000Z',
      message: { role: 'user', content: 'ok' },
    }),
  ];

  const parsed = parseSessionMessagesFromJsonl(lines.join('\n'));
  assert.strictEqual(parsed.length, 2);
  assert.strictEqual(parsed[0].thinking, 'Let me consider this...');
  assert.strictEqual(parsed[0].content, 'Here is my answer.');
});

test('parseSessionMessagesFromJsonl concatenates multiple thinking blocks', () => {
  const lines = [
    JSON.stringify({
      type: 'assistant',
      timestamp: '2026-02-06T01:39:18.483Z',
      message: {
        role: 'assistant',
        content: [
          { type: 'thinking', thinking: 'First thought' },
        ],
      },
    }),
    JSON.stringify({
      type: 'assistant',
      timestamp: '2026-02-06T01:39:19.000Z',
      message: {
        role: 'assistant',
        content: [
          { type: 'thinking', thinking: 'Second thought' },
          { type: 'text', text: 'Final answer.' },
        ],
      },
    }),
    JSON.stringify({
      type: 'user',
      timestamp: '2026-02-06T01:39:20.000Z',
      message: { role: 'user', content: 'ok' },
    }),
  ];

  const parsed = parseSessionMessagesFromJsonl(lines.join('\n'));
  assert.strictEqual(parsed[0].thinking, 'First thought\n\nSecond thought');
  assert.strictEqual(parsed[0].content, 'Final answer.');
});

test('parseSessionMessagesFromJsonl handles error tool results', () => {
  const lines = [
    JSON.stringify({
      type: 'assistant',
      timestamp: '2026-02-06T01:39:18.483Z',
      message: {
        role: 'assistant',
        content: [
          { type: 'tool_use', id: 'tool-err', name: 'Bash', input: { command: 'exit 1' } },
        ],
      },
    }),
    JSON.stringify({
      type: 'user',
      timestamp: '2026-02-06T01:39:19.000Z',
      message: {
        role: 'user',
        content: [
          { type: 'tool_result', tool_use_id: 'tool-err', is_error: true, content: 'command failed' },
        ],
      },
    }),
    JSON.stringify({
      type: 'assistant',
      timestamp: '2026-02-06T01:39:20.000Z',
      message: {
        role: 'assistant',
        content: [{ type: 'text', text: 'The command failed.' }],
      },
    }),
    JSON.stringify({
      type: 'user',
      timestamp: '2026-02-06T01:39:21.000Z',
      message: { role: 'user', content: 'ok' },
    }),
  ];

  const parsed = parseSessionMessagesFromJsonl(lines.join('\n'));
  assert.strictEqual(parsed[0].toolCalls[0].status, 'error');
  assert.strictEqual(parsed[0].toolCalls[0].result, 'command failed');
});

test('parseSessionMessagesFromJsonl flushes trailing assistant turn at end of file', () => {
  const lines = [
    JSON.stringify({
      type: 'user',
      timestamp: '2026-02-06T01:39:15.038Z',
      message: { role: 'user', content: 'hello' },
    }),
    JSON.stringify({
      type: 'assistant',
      timestamp: '2026-02-06T01:39:18.483Z',
      message: {
        role: 'assistant',
        content: [{ type: 'text', text: 'goodbye' }],
      },
    }),
  ];

  const parsed = parseSessionMessagesFromJsonl(lines.join('\n'));
  assert.strictEqual(parsed.length, 2);
  assert.strictEqual(parsed[1].role, 'assistant');
  assert.strictEqual(parsed[1].content, 'goodbye');
});

test('parseSessionMessagesFromJsonl leaves interrupted tools as pending', () => {
  const lines = [
    JSON.stringify({
      type: 'assistant',
      timestamp: '2026-02-06T01:39:18.483Z',
      message: {
        role: 'assistant',
        content: [
          { type: 'tool_use', id: 'tool-interrupted', name: 'Bash', input: { command: 'sleep 100' } },
        ],
      },
    }),
    // No tool_result — session was interrupted
  ];

  const parsed = parseSessionMessagesFromJsonl(lines.join('\n'));
  assert.strictEqual(parsed.length, 1);
  assert.strictEqual(parsed[0].toolCalls[0].status, 'pending');
  assert.strictEqual(parsed[0].toolCalls[0].result, undefined);
});

test('parseSessionMessagesFromJsonl supports codex custom tool call outputs', () => {
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
        type: 'custom_tool_call',
        id: 'custom-1',
        name: 'exec_command',
        input: 'ls -la',
      },
    }),
    JSON.stringify({
      type: 'response_item',
      timestamp: '2026-02-06T01:41:02.000Z',
      payload: {
        type: 'custom_tool_call_output',
        call_id: 'custom-1',
        output: JSON.stringify({
          output: 'permission denied',
          metadata: { exit_code: 1 },
        }),
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
  ];

  const parsed = parseSessionMessagesFromJsonl(lines.join('\n'), 'codex');
  assert.strictEqual(parsed.length, 2);
  assert.strictEqual(parsed[0].role, 'user');
  assert.strictEqual(parsed[0].content, 'run command');
  assert.strictEqual(parsed[1].role, 'assistant');
  assert.strictEqual(parsed[1].content, 'done');
  assert.strictEqual(parsed[1].toolCalls.length, 1);
  assert.deepStrictEqual(parsed[1].toolCalls[0].input, { exec_command: 'ls -la' });
  assert.strictEqual(parsed[1].toolCalls[0].result, 'permission denied');
  assert.strictEqual(parsed[1].toolCalls[0].status, 'error');
});

test('parseSessionMessagesFromJsonl strips codex function_call_output wrapper headers', () => {
  const lines = [
    JSON.stringify({
      type: 'event_msg',
      timestamp: '2026-02-06T01:42:00.000Z',
      payload: { type: 'user_message', message: 'run command' },
    }),
    JSON.stringify({
      type: 'response_item',
      timestamp: '2026-02-06T01:42:01.000Z',
      payload: {
        type: 'function_call',
        call_id: 'call-1',
        name: 'exec_command',
        arguments: JSON.stringify({ cmd: 'echo hi' }),
      },
    }),
    JSON.stringify({
      type: 'response_item',
      timestamp: '2026-02-06T01:42:02.000Z',
      payload: {
        type: 'function_call_output',
        call_id: 'call-1',
        output: 'Chunk ID: abc\nWall time: 0.1 seconds\nProcess exited with code 0\nOriginal token count: 1\nOutput:\nhi\n',
      },
    }),
    JSON.stringify({
      type: 'response_item',
      timestamp: '2026-02-06T01:42:03.000Z',
      payload: {
        type: 'message',
        role: 'assistant',
        content: [{ type: 'output_text', text: 'done' }],
      },
    }),
  ];

  const parsed = parseSessionMessagesFromJsonl(lines.join('\n'), 'codex');
  assert.strictEqual(parsed.length, 2);
  assert.strictEqual(parsed[1].toolCalls[0].result, 'hi');
  assert.strictEqual(parsed[1].toolCalls[0].status, 'complete');
});

test('extractSessionCwdFromJsonlChunk returns cwd from Claude session entries', () => {
  const lines = [
    JSON.stringify({ type: 'queue-operation', operation: 'dequeue' }),
    JSON.stringify({
      type: 'user',
      cwd: '/Users/hoff/dev/pre-dev-intel/site/reports',
      message: { role: 'user', content: 'hello' },
    }),
  ];

  const cwd = extractSessionCwdFromJsonlChunk(lines.join('\n'));
  assert.strictEqual(cwd, '/Users/hoff/dev/pre-dev-intel/site/reports');
});

test('parseSessionMessagesFromJsonl strips system XML from user messages', () => {
  const taskNotification = '<task-notification>\n<task-id>b7a114a</task-id>\n<status>completed</status>\n<summary>Background command completed</summary>\n</task-notification>\nRead the output file to retrieve the result';
  const lines = [
    // User message that is ONLY a task notification — should be stripped to just the trailing text
    JSON.stringify({
      type: 'user',
      timestamp: '2026-02-06T01:40:00.000Z',
      message: { role: 'user', content: taskNotification },
    }),
    // User message with system-reminder in tool result content
    JSON.stringify({
      type: 'user',
      timestamp: '2026-02-06T01:40:01.000Z',
      message: { role: 'user', content: 'real user message' },
    }),
  ];

  const parsed = parseSessionMessagesFromJsonl(lines.join('\n'));
  // First message should have the notification XML stripped, leaving just the trailing text
  assert.strictEqual(parsed[0].content, 'Read the output file to retrieve the result');
  assert.strictEqual(parsed[1].content, 'real user message');
});

test('parseSessionMessagesFromJsonl strips system XML from assistant text', () => {
  const lines = [
    JSON.stringify({
      type: 'assistant',
      timestamp: '2026-02-06T01:40:00.000Z',
      message: {
        role: 'assistant',
        content: [
          { type: 'text', text: 'Here is the result.<system-reminder>Ignore this</system-reminder>' },
        ],
      },
    }),
    // User to flush
    JSON.stringify({
      type: 'user',
      timestamp: '2026-02-06T01:40:01.000Z',
      message: { role: 'user', content: 'ok' },
    }),
  ];

  const parsed = parseSessionMessagesFromJsonl(lines.join('\n'));
  assert.strictEqual(parsed[0].role, 'assistant');
  assert.strictEqual(parsed[0].content, 'Here is the result.');
});

test('parseSessionMessagesFromJsonl drops empty user messages after stripping', () => {
  const lines = [
    // User message that is ONLY a task notification with no other text
    JSON.stringify({
      type: 'user',
      timestamp: '2026-02-06T01:40:00.000Z',
      message: { role: 'user', content: '<task-notification>\n<task-id>abc</task-id>\n</task-notification>' },
    }),
  ];

  const parsed = parseSessionMessagesFromJsonl(lines.join('\n'));
  assert.strictEqual(parsed.length, 0);
});

test('extractSessionCwdFromJsonlChunk returns null when cwd missing', () => {
  const lines = [
    JSON.stringify({ type: 'queue-operation', operation: 'dequeue' }),
    JSON.stringify({
      type: 'assistant',
      message: { role: 'assistant', content: [{ type: 'text', text: 'no cwd here' }] },
    }),
  ];

  const cwd = extractSessionCwdFromJsonlChunk(lines.join('\n'));
  assert.strictEqual(cwd, null);
});
