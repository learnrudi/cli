import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { detectRuntime as detectAuthRuntime } from '../../commands/auth.js';
import {
  checkAuth,
  checkIfRunning,
  detectRuntime as detectWhichRuntime,
} from '../../commands/which.js';

async function withTempStack(layout, run) {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'rudi-stack-'));
  try {
    await layout(dir);
    await run(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

test('auth runtime detection finds flat node stack auth script', async () => {
  await withTempStack(
    async (dir) => {
      await mkdir(path.join(dir, 'src'), { recursive: true });
      await writeFile(path.join(dir, 'src', 'auth.ts'), '');
    },
    async (dir) => {
      const result = await detectAuthRuntime(dir);

      assert.deepEqual(result, {
        runtime: 'node',
        authScript: path.join(dir, 'src', 'auth.ts'),
        useTsx: true,
      });
    },
  );
});

test('auth runtime detection still finds structured node stack auth script', async () => {
  await withTempStack(
    async (dir) => {
      await mkdir(path.join(dir, 'node', 'src'), { recursive: true });
      await writeFile(path.join(dir, 'node', 'src', 'auth.ts'), '');
    },
    async (dir) => {
      const result = await detectAuthRuntime(dir);

      assert.deepEqual(result, {
        runtime: 'node',
        authScript: path.join(dir, 'node', 'src', 'auth.ts'),
        useTsx: true,
      });
    },
  );
});

test('which runtime detection finds flat node stack entry point', async () => {
  await withTempStack(
    async (dir) => {
      await mkdir(path.join(dir, 'src'), { recursive: true });
      await writeFile(path.join(dir, 'src', 'index.ts'), '');
    },
    async (dir) => {
      const result = await detectWhichRuntime(dir);

      assert.deepEqual(result, {
        runtime: 'node',
        entry: 'src/index.ts',
      });
    },
  );
});

test('which runtime detection still finds structured node stack entry point', async () => {
  await withTempStack(
    async (dir) => {
      await mkdir(path.join(dir, 'node', 'dist'), { recursive: true });
      await writeFile(path.join(dir, 'node', 'dist', 'index.js'), '');
    },
    async (dir) => {
      const result = await detectWhichRuntime(dir);

      assert.deepEqual(result, {
        runtime: 'node',
        entry: 'node/dist/index.js',
      });
    },
  );
});

test('which runtime detection finds flat python stack entry point', async () => {
  await withTempStack(
    async (dir) => {
      await mkdir(path.join(dir, 'src'), { recursive: true });
      await writeFile(path.join(dir, 'src', 'index.py'), '');
    },
    async (dir) => {
      const result = await detectWhichRuntime(dir);

      assert.deepEqual(result, {
        runtime: 'python',
        entry: 'src/index.py',
      });
    },
  );
});

test('which auth status finds account tokens in RUDI stack state', async () => {
  const home = await mkdtemp(path.join(os.tmpdir(), 'rudi-home-'));
  await withTempStack(
    async (dir) => {
      const stackName = path.basename(dir);
      const accountDir = path.join(home, 'state', 'stacks', stackName, 'accounts', 'rudi@example.com');
      await mkdir(accountDir, { recursive: true });
      await writeFile(path.join(accountDir, 'token.json'), '{}');
    },
    async (dir) => {
      const stackName = path.basename(dir);
      const result = await checkAuth(dir, 'node', { rudiHome: home });

      assert.equal(result.configured, true);
      assert.deepEqual(result.files, [
        `state/stacks/${stackName}/accounts/rudi@example.com/token.json`,
      ]);
    },
  );
  await rm(home, { recursive: true, force: true });
});

test('which running check treats stack names as literal process filters', () => {
  const calls = [];
  const running = checkIfRunning('video-editor"; touch /tmp/rudi-probe #', {
    runCommand(command, args) {
      calls.push({ command, args });
      return [
        'hoff 101 0.0 node /Users/hoff/.rudi/stacks/video-editor/dist/index.js',
        'hoff 202 0.0 node /Users/hoff/.rudi/stacks/google-workspace/dist/index.js',
      ].join('\n');
    },
  });

  assert.equal(running, false);
  assert.deepEqual(calls, [{ command: 'ps', args: ['aux'] }]);
});
