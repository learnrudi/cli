import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { normalize } from '../../commands/agent/normalizers/claude.js';

describe('claude normalizer', () => {
  test('preserves finishReason on assistant events', () => {
    const normalized = normalize({
      type: 'assistant',
      message: {
        role: 'assistant',
        model: 'claude-sonnet-4-5-20250929',
        stop_reason: 'end_turn',
        content: [{ type: 'text', text: 'done' }],
        usage: {
          input_tokens: 10,
          output_tokens: 5,
        },
      },
    });

    assert.equal(normalized.type, 'assistant');
    assert.equal(normalized.finishReason, 'end_turn');
    assert.equal(normalized.model, 'claude-sonnet-4-5-20250929');
  });
});
