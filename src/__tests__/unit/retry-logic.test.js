import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { createRetryState, canRetry, getNextDelay, incrementRetry, resetRetry } from '../../commands/agent/retry-logic.js';

describe('createRetryState', () => {
  test('returns initial state', () => {
    const state = createRetryState();
    assert.equal(state.count, 0);
    assert.equal(state.maxRetries, 3);
    assert.deepEqual(state.delays, [1000, 2000, 4000]);
  });
});

describe('canRetry', () => {
  test('returns true when count < maxRetries', () => {
    const state = createRetryState();
    assert.equal(canRetry(state), true);
  });

  test('returns false when count >= maxRetries', () => {
    const state = createRetryState();
    state.count = 3;
    assert.equal(canRetry(state), false);
  });

  test('returns false when count > maxRetries', () => {
    const state = createRetryState();
    state.count = 5;
    assert.equal(canRetry(state), false);
  });
});

describe('getNextDelay', () => {
  test('returns correct backoff delays', () => {
    const state = createRetryState();
    assert.equal(getNextDelay(state), 1000); // count=0 → delays[0]

    state.count = 1;
    assert.equal(getNextDelay(state), 2000); // count=1 → delays[1]

    state.count = 2;
    assert.equal(getNextDelay(state), 4000); // count=2 → delays[2]
  });

  test('falls back to last delay if count exceeds delays array', () => {
    const state = createRetryState();
    state.count = 10;
    assert.equal(getNextDelay(state), 4000); // falls back to last
  });
});

describe('incrementRetry', () => {
  test('increments count', () => {
    const state = createRetryState();
    incrementRetry(state);
    assert.equal(state.count, 1);
    incrementRetry(state);
    assert.equal(state.count, 2);
  });

  test('retryCount semantics: count = scheduled retries', () => {
    const state = createRetryState();
    // Before first retry: count=0 (no retries scheduled)
    assert.equal(state.count, 0);

    // First retry is scheduled
    incrementRetry(state);
    // After first retry: count=1 (one retry scheduled)
    assert.equal(state.count, 1);
  });
});

describe('resetRetry', () => {
  test('resets count to 0', () => {
    const state = createRetryState();
    state.count = 3;
    resetRetry(state);
    assert.equal(state.count, 0);
  });
});

describe('stops after maxRetries', () => {
  test('canRetry returns false after 3 increments', () => {
    const state = createRetryState();
    assert.equal(canRetry(state), true);
    incrementRetry(state); // count=1
    assert.equal(canRetry(state), true);
    incrementRetry(state); // count=2
    assert.equal(canRetry(state), true);
    incrementRetry(state); // count=3
    assert.equal(canRetry(state), false);
  });
});
