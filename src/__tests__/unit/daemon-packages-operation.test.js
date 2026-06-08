import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  createStackPackageStatus,
  listInstalledPackageStatuses,
  listInstalledStackSummaries,
  normalizePackageKind,
  projectPackageDescriptor,
} from '../../daemon/operations/packages.js';

test('normalizePackageKind preserves current package route kind filtering', () => {
  assert.equal(normalizePackageKind('stack'), 'stack');
  assert.equal(normalizePackageKind(' skill '), null);
  assert.equal(normalizePackageKind('skill', { routeOnly: false }), 'skill');
  assert.equal(normalizePackageKind('unknown'), null);
});

test('projectPackageDescriptor preserves current search/list response projection', () => {
  assert.deepEqual(projectPackageDescriptor({
    id: 'agent:codex',
    name: 'Codex',
    description: 'OpenAI Codex CLI',
    version: '5.1.0',
    tags: ['openai'],
  }, 'agent'), {
    id: 'agent:codex',
    kind: 'agent',
    name: 'Codex',
    description: 'OpenAI Codex CLI',
    version: '5.1.0',
    category: null,
    tags: ['openai'],
    requires: null,
  });
});

test('listInstalledStackSummaries preserves the legacy /packages/installed shape', () => {
  const config = {
    stacks: {
      vercel: {
        version: '1.0.0',
        installedAt: '2026-03-08T12:00:00.000Z',
        path: '/tmp/vercel',
        secrets: [{ name: 'VERCEL_TOKEN', required: true }],
      },
    },
  };

  assert.deepEqual(listInstalledStackSummaries(config), {
    vercel: {
      version: '1.0.0',
      installedAt: '2026-03-08T12:00:00.000Z',
      secrets: [{ name: 'VERCEL_TOKEN', required: true }],
    },
  });
});

test('createStackPackageStatus projects target package status without exposing secret values', () => {
  const status = createStackPackageStatus('image-generator', {
    version: '2.0.0',
    installedAt: '2026-05-17T12:00:00.000Z',
    path: '/Users/hoff/.rudi/stacks/image-generator',
    runtime: 'node',
    launch: { bin: 'node', args: ['server.js'] },
    secrets: [
      { name: 'OPENAI_API_KEY', required: true },
      { name: 'OPTIONAL_KEY', required: false },
    ],
  }, {
    secretConfig: {
      OPENAI_API_KEY: { configured: true, provider: 'secrets.json' },
      OPTIONAL_KEY: { configured: false, provider: 'secrets.json' },
    },
    toolIndex: {
      byStack: {
        'image-generator': {
          indexedAt: '2026-05-17T13:00:00.000Z',
          tools: [{ name: 'generate_image' }, { name: 'list_models' }],
          error: null,
        },
      },
    },
  });

  assert.deepEqual(status, {
    id: 'stack:image-generator',
    kind: 'stack',
    name: 'image-generator',
    version: '2.0.0',
    installed: true,
    path: '/Users/hoff/.rudi/stacks/image-generator',
    manifestPath: '/Users/hoff/.rudi/stacks/image-generator/manifest.json',
    runtime: 'node',
    secrets: [
      { name: 'OPENAI_API_KEY', required: true, configured: true, source: 'secrets.json' },
      { name: 'OPTIONAL_KEY', required: false, configured: false, source: 'secrets.json' },
    ],
    mcp: {
      launch: { bin: 'node', args: ['server.js'] },
    },
    lastIndexedAt: '2026-05-17T13:00:00.000Z',
    toolCount: 2,
    problems: [],
  });
});

test('listInstalledPackageStatuses reports missing secrets and index failures as problems', () => {
  const statuses = listInstalledPackageStatuses({
    secrets: {
      VERCEL_TOKEN: { configured: false, provider: 'secrets.json' },
    },
    stacks: {
      vercel: {
        version: '1.0.0',
        path: '/tmp/vercel',
        runtime: 'node',
        secrets: [{ name: 'VERCEL_TOKEN', required: true }],
      },
    },
  }, {
    toolIndex: {
      byStack: {
        vercel: {
          indexedAt: '2026-05-17T13:00:00.000Z',
          tools: [],
          error: 'Missing required secrets: VERCEL_TOKEN',
          missingSecrets: ['VERCEL_TOKEN'],
        },
      },
    },
  });

  assert.equal(statuses.length, 1);
  assert.deepEqual(statuses[0].problems, [
    {
      code: 'missing_secret',
      message: 'Missing required secrets: VERCEL_TOKEN',
      details: { secrets: ['VERCEL_TOKEN'] },
    },
    {
      code: 'index_failed',
      message: 'Missing required secrets: VERCEL_TOKEN',
    },
    {
      code: 'missing_secret',
      message: 'Tool index missing secrets: VERCEL_TOKEN',
      details: { secrets: ['VERCEL_TOKEN'] },
    },
    {
      code: 'launch_missing',
      message: 'Stack launch configuration is missing',
    },
  ]);
});
