import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';

import {
  createArchiveExtractCommand,
  createNativeInstallerCommand,
  createNpmInstallCommand,
  createPipInstallCommand,
  createPostInstallCommand,
  runCommandPlan,
} from '../../installer.js';

test('archive extraction builds argv without shell-interpreting paths', () => {
  assert.deepEqual(
    createArchiveExtractCommand('tar.gz', '/tmp/pkg;touch probe.tgz', '/tmp/out $(probe)', {
      stripComponents: 1,
    }),
    {
      command: 'tar',
      args: ['-xzf', '/tmp/pkg;touch probe.tgz', '-C', '/tmp/out $(probe)', '--strip-components=1'],
    }
  );
});

test('npm install validates registry package names and builds argv', () => {
  assert.deepEqual(
    createNpmInstallCommand({
      npmCmd: '/opt/rudi/node/bin/npm',
      packageName: '@openai/codex',
      global: true,
      prefix: '/tmp/rudi node',
      ignoreScripts: true,
    }),
    {
      command: '/opt/rudi/node/bin/npm',
      args: [
        'install',
        '-g',
        '@openai/codex',
        '--ignore-scripts',
        '--no-audit',
        '--no-fund',
        '--prefix',
        '/tmp/rudi node',
      ],
    }
  );

  assert.throws(
    () => createNpmInstallCommand({
      npmCmd: 'npm',
      packageName: 'left-pad; touch probe',
    }),
    /Invalid npm package name/
  );
});

test('pip install validates registry package specs and builds argv', () => {
  assert.deepEqual(
    createPipInstallCommand('/tmp/venv/bin/pip', 'httpie'),
    {
      command: '/tmp/venv/bin/pip',
      args: ['install', 'httpie'],
    }
  );

  assert.throws(
    () => createPipInstallCommand('/tmp/venv/bin/pip', 'httpie; touch probe'),
    /Invalid pip package spec/
  );
});

test('postInstall supports npx bin invocations and rejects shell syntax', () => {
  assert.deepEqual(
    createPostInstallCommand('npx playwright install chromium', '/tmp/rudi bins'),
    {
      command: path.join('/tmp/rudi bins', 'playwright'),
      args: ['install', 'chromium'],
    }
  );

  assert.throws(
    () => createPostInstallCommand('npx playwright install chromium; touch probe', '/tmp/bin'),
    /Unsupported postInstall command/
  );
});

test('postInstall supports structured bin metadata', () => {
  assert.deepEqual(
    createPostInstallCommand({
      bin: 'playwright',
      args: ['install', 'chromium'],
    }, '/tmp/rudi bins'),
    {
      command: path.join('/tmp/rudi bins', 'playwright'),
      args: ['install', 'chromium'],
    }
  );
});

test('native installers require explicit command metadata, not shell pipelines', () => {
  assert.deepEqual(
    createNativeInstallerCommand({
      darwin: {
        command: 'npm',
        args: ['install', '-g', '@anthropic-ai/claude-code'],
      },
    }, 'darwin'),
    {
      command: 'npm',
      args: ['install', '-g', '@anthropic-ai/claude-code'],
    }
  );

  assert.throws(
    () => createNativeInstallerCommand({
      darwin: 'curl -fsSL https://claude.ai/install.sh | sh',
    }, 'darwin'),
    /Native installer must be explicit argv metadata/
  );
});

test('runCommandPlan dispatches command and args separately', () => {
  const calls = [];

  runCommandPlan(
    {
      command: 'tar',
      args: ['-xzf', '/tmp/pkg;touch probe.tgz', '-C', '/tmp/out $(probe)'],
    },
    {
      stdio: 'pipe',
      execFileSync: (command, args, options) => {
        calls.push({ command, args, options });
        return Buffer.from('');
      },
    }
  );

  assert.equal(calls.length, 1);
  assert.equal(calls[0].command, 'tar');
  assert.deepEqual(calls[0].args, ['-xzf', '/tmp/pkg;touch probe.tgz', '-C', '/tmp/out $(probe)']);
  assert.equal(calls[0].options.stdio, 'pipe');
});
