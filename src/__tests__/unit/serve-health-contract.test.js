import { test } from 'node:test';
import assert from 'node:assert/strict';

import { createHealthResponse } from '../../commands/serve.js';

test('createHealthResponse preserves the public /health payload shape', () => {
  assert.deepEqual(createHealthResponse(), {
    status: 'ok',
    version: '0.1.0',
  });
});
