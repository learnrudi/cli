import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { classifyError, isRetryable, ERROR_CODES, ERROR_CATEGORIES } from '../../commands/agent/error-classifier.js';

describe('classifyError', () => {
  describe('transient errors (retryable)', () => {
    test('429 rate limit → API_RATE_LIMIT', () => {
      const result = classifyError('Error 429 rate limit exceeded', null);
      assert.equal(result.code, ERROR_CODES.API_RATE_LIMIT);
      assert.equal(result.category, ERROR_CATEGORIES.TRANSIENT);
      assert.equal(result.retryable, true);
    });

    test('tool.use.concurrency → API_CONCURRENCY', () => {
      const result = classifyError('tool.use.concurrency error', null);
      assert.equal(result.code, ERROR_CODES.API_CONCURRENCY);
      assert.equal(result.retryable, true);
    });

    test('concurrent tool → API_CONCURRENCY', () => {
      const result = classifyError('concurrent tool calls not allowed', null);
      assert.equal(result.code, ERROR_CODES.API_CONCURRENCY);
      assert.equal(result.retryable, true);
    });

    test('overloaded → API_OVERLOADED', () => {
      const result = classifyError('529 overloaded', null);
      assert.equal(result.code, ERROR_CODES.API_OVERLOADED);
      assert.equal(result.retryable, true);
    });

    test('ETIMEDOUT → NETWORK_TIMEOUT', () => {
      const result = classifyError('connect ETIMEDOUT 1.2.3.4', null);
      assert.equal(result.code, ERROR_CODES.NETWORK_TIMEOUT);
      assert.equal(result.retryable, true);
    });

    test('ECONNRESET → NETWORK_RESET', () => {
      const result = classifyError('read ECONNRESET', null);
      assert.equal(result.code, ERROR_CODES.NETWORK_RESET);
      assert.equal(result.retryable, true);
    });

    test('ECONNREFUSED → NETWORK_RESET', () => {
      const result = classifyError('connect ECONNREFUSED 127.0.0.1', null);
      assert.equal(result.code, ERROR_CODES.NETWORK_RESET);
      assert.equal(result.retryable, true);
    });
  });

  describe('permanent errors (not retryable)', () => {
    test('authentication_failed → AUTH_FAILURE', () => {
      const result = classifyError('authentication_failed', null);
      assert.equal(result.code, ERROR_CODES.AUTH_FAILURE);
      assert.equal(result.category, ERROR_CATEGORIES.PERMANENT);
      assert.equal(result.retryable, false);
    });

    test('401 unauthorized → AUTH_FAILURE', () => {
      const result = classifyError('401 unauthorized', null);
      assert.equal(result.code, ERROR_CODES.AUTH_FAILURE);
      assert.equal(result.retryable, false);
    });

    test('invalid model → INVALID_MODEL', () => {
      const result = classifyError('invalid model specified', null);
      assert.equal(result.code, ERROR_CODES.INVALID_MODEL);
      assert.equal(result.retryable, false);
    });

    test('ENOENT spawn → SPAWN_FAILURE', () => {
      const result = classifyError('ENOENT spawn /usr/bin/claude', null);
      assert.equal(result.code, ERROR_CODES.SPAWN_FAILURE);
      assert.equal(result.retryable, false);
    });

    test('exit code 137 → SIGKILL', () => {
      const result = classifyError('', 137);
      assert.equal(result.code, ERROR_CODES.SIGKILL);
      assert.equal(result.retryable, false);
    });

    test('exit code 143 (> 128) → SIGNAL_N', () => {
      const result = classifyError('', 143);
      assert.equal(result.code, ERROR_CODES.SIGNAL_N);
      assert.equal(result.retryable, false);
    });
  });

  describe('edge cases', () => {
    test('unknown text → UNKNOWN (permanent, fail-safe)', () => {
      const result = classifyError('something unexpected happened', null);
      assert.equal(result.code, ERROR_CODES.UNKNOWN);
      assert.equal(result.category, ERROR_CATEGORIES.PERMANENT);
      assert.equal(result.retryable, false);
    });

    test('null text → UNKNOWN', () => {
      const result = classifyError(null, null);
      assert.equal(result.code, ERROR_CODES.UNKNOWN);
      assert.equal(result.retryable, false);
    });

    test('undefined text → UNKNOWN', () => {
      const result = classifyError(undefined, null);
      assert.equal(result.code, ERROR_CODES.UNKNOWN);
      assert.equal(result.retryable, false);
    });

    test('empty string → UNKNOWN', () => {
      const result = classifyError('', null);
      assert.equal(result.code, ERROR_CODES.UNKNOWN);
      assert.equal(result.retryable, false);
    });

    test('combined stderr + stdout text matches first pattern', () => {
      // overloaded should match before auth failure if both present
      const result = classifyError('overloaded authentication_failed', null);
      assert.equal(result.retryable, true); // transient patterns checked first
    });
  });
});

describe('isRetryable', () => {
  test('returns true for retryable classification', () => {
    assert.equal(isRetryable({ retryable: true }), true);
  });

  test('returns false for non-retryable classification', () => {
    assert.equal(isRetryable({ retryable: false }), false);
  });
});
