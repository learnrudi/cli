import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  getToolIndexStatus,
  listToolDescriptors,
  readToolIndexCache,
  rebuildStackToolIndex,
  rebuildToolIndex,
} from '../../daemon/operations/tool-index.js';
import {
  validateToolIndexStatus,
} from '../../daemon/schemas/index.js';

const sampleIndex = {
  version: 1,
  updatedAt: '2026-05-17T12:00:00.000Z',
  byStack: {
    'stack:images': {
      indexedAt: '2026-05-17T12:01:00.000Z',
      tools: [
        {
          name: 'generate_image',
          description: 'Generate an image',
          inputSchema: {
            type: 'object',
            properties: {
              prompt: { type: 'string' },
            },
          },
        },
      ],
      error: null,
    },
    'stack:mail': {
      indexedAt: '2026-05-17T12:02:00.000Z',
      tools: [],
      error: 'Missing required secrets: GMAIL_TOKEN',
      missingSecrets: ['GMAIL_TOKEN'],
    },
  },
};

test('readToolIndexCache returns null when the cache is absent', () => {
  assert.equal(readToolIndexCache({}, {
    readToolIndex: () => null,
  }), null);
});

test('readToolIndexCache validates the router cache shape by default', () => {
  assert.throws(
    () => readToolIndexCache({}, {
      readToolIndex: () => ({ version: 99, byStack: null }),
    }),
    /tool index cache failed schema validation/,
  );

  assert.deepEqual(readToolIndexCache({ validate: false }, {
    readToolIndex: () => ({ version: 99, byStack: null }),
  }), { version: 99, byStack: null });
});

test('getToolIndexStatus counts stacks, tools, failures, and missing secrets', () => {
  const status = getToolIndexStatus({ index: sampleIndex });

  assert.deepEqual(status, {
    version: 1,
    updatedAt: '2026-05-17T12:00:00.000Z',
    stackCount: 2,
    toolCount: 1,
    failures: [
      {
        stackId: 'stack:mail',
        error: 'Missing required secrets: GMAIL_TOKEN',
        missingSecrets: ['GMAIL_TOKEN'],
      },
    ],
  });
  assert.deepEqual(validateToolIndexStatus(status), { ok: true, errors: [] });
});

test('listToolDescriptors flattens cached tools and fills legacy defaults', () => {
  const descriptors = listToolDescriptors({
    version: 1,
    updatedAt: '2026-05-17T12:00:00.000Z',
    byStack: {
      'stack:images': {
        indexedAt: '2026-05-17T12:01:00.000Z',
        tools: [
          {
            name: 'generate_image',
            description: 'Generate an image',
            inputSchema: { type: 'object', properties: {} },
          },
          {
            name: 'list_models',
          },
        ],
        error: null,
      },
    },
  }, { validate: false });

  assert.deepEqual(descriptors, [
    {
      stackId: 'stack:images',
      toolName: 'generate_image',
      description: 'Generate an image',
      inputSchema: { type: 'object', properties: {} },
      indexedAt: '2026-05-17T12:01:00.000Z',
      source: 'cache',
    },
    {
      stackId: 'stack:images',
      toolName: 'list_models',
      description: 'list_models',
      inputSchema: { type: 'object', properties: {} },
      indexedAt: '2026-05-17T12:01:00.000Z',
      source: 'cache',
    },
  ]);
});

test('rebuildToolIndex delegates to core indexing and validates the resulting cache', async () => {
  const calls = [];
  const result = await rebuildToolIndex({
    stacks: ['stack:images'],
    log: () => {},
    timeout: 20000,
  }, {
    indexAllStacks: async options => {
      calls.push(options);
      return {
        indexed: 1,
        failed: 0,
        index: sampleIndex,
      };
    },
  });

  assert.equal(result.indexed, 1);
  assert.equal(result.failed, 0);
  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0].stacks, ['stack:images']);
  assert.equal(calls[0].timeout, 20000);
  assert.equal(typeof calls[0].log, 'function');
});

test('rebuildStackToolIndex rebuilds one stack and rejects empty stack IDs', async () => {
  const calls = [];
  await rebuildStackToolIndex(' stack:mail ', { validate: false }, {
    indexAllStacks: async options => {
      calls.push(options);
      return {
        indexed: 1,
        failed: 0,
        index: { version: 99 },
      };
    },
  });

  assert.deepEqual(calls, [
    {
      stacks: ['stack:mail'],
    },
  ]);
  await assert.rejects(
    () => rebuildStackToolIndex(' ', {}, {
      indexAllStacks: async () => ({ indexed: 0, failed: 0, index: sampleIndex }),
    }),
    /stackId is required/,
  );
});
