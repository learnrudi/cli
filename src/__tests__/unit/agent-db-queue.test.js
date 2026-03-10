import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  dbWrite,
  flushDbWrites,
  getDbWriteQueueDepth,
  resetAgentDbStateForTests,
  setResolvedDbForTests,
} from '../../commands/agent/db.js';

test('dbWrite warns at threshold and drops oldest writes on overflow', (t) => {
  resetAgentDbStateForTests();
  t.after(() => resetAgentDbStateForTests());

  t.mock.method(global, 'setImmediate', () => 0);

  const warnings = [];
  t.mock.method(console, 'warn', (...args) => {
    warnings.push(args);
  });

  for (let i = 0; i < 10_001; i += 1) {
    const id = i;
    dbWrite(() => {
      executed.push(id);
    });
  }

  assert.equal(getDbWriteQueueDepth(), 9_001);

  const executed = [];
  setResolvedDbForTests({});
  flushDbWrites();

  assert.equal(executed.length, 9_001);
  assert.equal(executed[0], 1_000);
  assert.equal(executed.at(-1), 10_000);
  assert.equal(getDbWriteQueueDepth(), 0);
  assert.ok(warnings.some((args) => String(args[0]).includes('write queue depth warning')));
  assert.ok(warnings.some((args) => String(args[0]).includes('write queue overflow')));
});
