import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  createGitCommand,
  createCommandPlan,
  createWhichCommand,
  runCommand,
} from '../../utils/subprocess.js';

test('createCommandPlan preserves shell-looking values as literal args', () => {
  assert.deepEqual(
    createCommandPlan('git', ['branch', '-d', 'feature; touch probe', '--', '$(probe)']),
    {
      command: 'git',
      args: ['branch', '-d', 'feature; touch probe', '--', '$(probe)'],
    }
  );
});

test('runCommand dispatches command and args separately', () => {
  const calls = [];

  runCommand('ps', ['-p', '123; touch probe', '-o', 'pid='], {
    encoding: 'utf-8',
    execFileSync(command, args, options) {
      calls.push({ command, args, options });
      return '123\n';
    },
  });

  assert.deepEqual(calls, [{
    command: 'ps',
    args: ['-p', '123; touch probe', '-o', 'pid='],
    options: { encoding: 'utf-8' },
  }]);
});

test('which and git helpers build argv plans', () => {
  assert.deepEqual(createWhichCommand('claude; touch probe'), {
    command: 'which',
    args: ['claude; touch probe'],
  });
  assert.deepEqual(createGitCommand('/tmp/repo', ['log', 'main..feature; touch probe', '--oneline']), {
    command: 'git',
    args: ['log', 'main..feature; touch probe', '--oneline'],
    cwd: '/tmp/repo',
  });
});
