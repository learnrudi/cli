import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  cleanupRemovedStack,
  filterRemovablePackages,
} from '../../commands/remove.js';

test('cleanupRemovedStack removes stack config, orphaned secrets, and cached tools', async () => {
  const calls = [];
  let readCount = 0;
  const beforeConfig = {
    stacks: {
      'stack:slack': {
        secrets: [
          { name: 'SLACK_BOT_TOKEN', required: true },
          'SLACK_CHANNEL_ID',
          { key: 'SHARED_TOKEN', required: false },
        ],
      },
      'stack:other': {
        secrets: [{ name: 'SHARED_TOKEN', required: true }],
      },
    },
  };
  const afterConfig = {
    stacks: {
      'stack:other': {
        secrets: [{ name: 'SHARED_TOKEN', required: true }],
      },
    },
  };

  const result = await cleanupRemovedStack('slack', {
    readRudiConfig() {
      readCount++;
      return readCount === 1 ? beforeConfig : afterConfig;
    },
    removeStack(stackId) {
      calls.push(['removeStack', stackId]);
    },
    async removeSecret(name) {
      calls.push(['removeSecret', name]);
    },
    removeStackFromToolIndex(stackId) {
      calls.push(['removeStackFromToolIndex', stackId]);
      return true;
    },
  });

  assert.deepEqual(calls, [
    ['removeStack', 'stack:slack'],
    ['removeSecret', 'SLACK_BOT_TOKEN'],
    ['removeSecret', 'SLACK_CHANNEL_ID'],
    ['removeStackFromToolIndex', 'stack:slack'],
  ]);
  assert.deepEqual(result, {
    removedSecrets: ['SLACK_BOT_TOKEN', 'SLACK_CHANNEL_ID'],
    prunedToolIndex: true,
  });
});

test('filterRemovablePackages excludes external discovered skills', () => {
  const packages = filterRemovablePackages([
    { id: 'skill:local-flat', kind: 'skill', source: 'rudi' },
    { id: 'skill:legacy-local', kind: 'skill' },
    { id: 'skill:external-docx', kind: 'skill', source: 'claude' },
    { id: 'stack:slack', kind: 'stack' },
  ]);

  assert.deepEqual(packages.map(pkg => pkg.id), [
    'skill:local-flat',
    'skill:legacy-local',
    'stack:slack',
  ]);
});
