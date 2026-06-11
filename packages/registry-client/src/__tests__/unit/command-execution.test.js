import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import {
  createRegistryArchiveExtractCommand,
  installRawBinaryDownload,
  runRegistryCommandPlan,
} from '../../index.js';

test('registry archive extraction builds argv without shell-interpreting paths', () => {
  assert.deepEqual(
    createRegistryArchiveExtractCommand('tar.xz', '/tmp/download;touch probe.tar.xz', '/tmp/out $(probe)', {
      stripComponents: 1,
    }),
    {
      command: 'tar',
      args: ['-xJf', '/tmp/download;touch probe.tar.xz', '-C', '/tmp/out $(probe)', '--strip-components=1'],
    }
  );
});

test('registry archive extraction rejects unsupported archive types', () => {
  assert.throws(
    () => createRegistryArchiveExtractCommand('rar', '/tmp/archive.rar', '/tmp/out'),
    /Unsupported archive type/
  );
});

test('runRegistryCommandPlan dispatches command and args separately', () => {
  const calls = [];

  runRegistryCommandPlan(
    {
      command: 'unzip',
      args: ['-o', '/tmp/archive;touch probe.zip', '-d', '/tmp/out $(probe)'],
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
  assert.equal(calls[0].command, 'unzip');
  assert.deepEqual(calls[0].args, ['-o', '/tmp/archive;touch probe.zip', '-d', '/tmp/out $(probe)']);
  assert.equal(calls[0].options.stdio, 'pipe');
});

test('raw binary download is installed as an executable without shell commands', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'rudi-raw-binary-'));

  try {
    const downloadPath = path.join(root, 'download;touch probe');
    const destPath = path.join(root, 'dest $(probe)');
    fs.mkdirSync(destPath, { recursive: true });
    fs.writeFileSync(downloadPath, '#!/bin/sh\nexit 0\n');

    const installedPath = installRawBinaryDownload(downloadPath, destPath, 'yt-dlp');

    assert.equal(installedPath, path.join(destPath, 'yt-dlp'));
    assert.equal(fs.readFileSync(installedPath, 'utf8'), '#!/bin/sh\nexit 0\n');
    assert.equal(fs.statSync(installedPath).mode & 0o111, 0o111);
    assert.equal(fs.existsSync(path.join(root, 'touch probe')), false);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
