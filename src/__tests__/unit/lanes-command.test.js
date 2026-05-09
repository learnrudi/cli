import { after, before, beforeEach, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const originalLog = console.log;
const originalError = console.error;
const tempRoot = path.resolve(process.cwd(), 'tmp');
fs.mkdirSync(tempRoot, { recursive: true });
const suiteRoot = fs.mkdtempSync(path.join(tempRoot, 'lanes-command-test-'));

let cmdLanes;
let consoleLines = [];

function git(cwd, args) {
  return execFileSync('git', args, {
    cwd,
    encoding: 'utf-8',
    stdio: ['ignore', 'pipe', 'pipe'],
  }).trim();
}

function configureGitIdentity(repoPath) {
  git(repoPath, ['config', 'user.name', 'RUDI Test']);
  git(repoPath, ['config', 'user.email', 'rudi-test@example.com']);
}

function writeFile(repoPath, relativePath, content) {
  fs.writeFileSync(path.join(repoPath, relativePath), content);
}

function createRemoteClone(name) {
  const remotePath = path.join(suiteRoot, `${name}-remote.git`);
  git(suiteRoot, ['init', '--bare', remotePath]);

  const repoPath = path.join(suiteRoot, name);
  git(suiteRoot, ['clone', remotePath, repoPath]);
  configureGitIdentity(repoPath);

  writeFile(repoPath, 'README.md', '# test\n');
  git(repoPath, ['add', 'README.md']);
  git(repoPath, ['commit', '-m', 'initial']);
  git(repoPath, ['branch', '-M', 'main']);
  git(repoPath, ['push', '-u', 'origin', 'main']);
  git(remotePath, ['symbolic-ref', 'HEAD', 'refs/heads/main']);

  git(repoPath, ['branch', 'dev']);
  git(repoPath, ['push', '-u', 'origin', 'dev']);

  return { remotePath, repoPath };
}

before(async () => {
  ({ cmdLanes } = await import('../../commands/lanes.js'));
});

beforeEach(() => {
  consoleLines = [];
  console.log = (...args) => {
    consoleLines.push(args.join(' '));
  };
  console.error = (...args) => {
    consoleLines.push(args.join(' '));
  };
});

after(async () => {
  console.log = originalLog;
  console.error = originalError;
  await fsp.rm(suiteRoot, { recursive: true, force: true });
});

describe('lanes command', () => {
  test('init creates a sibling dev worktree from main checkout', async () => {
    const { repoPath } = createRemoteClone('init-repo');
    const devPath = `${repoPath}-dev`;

    await cmdLanes(['init'], { cwd: repoPath });

    assert.equal(git(repoPath, ['rev-parse', '--abbrev-ref', 'HEAD']), 'main');
    assert.equal(git(repoPath, ['show-ref', '--verify', '--quiet', 'refs/heads/dev']) || '', '');
    assert.equal(git(devPath, ['rev-parse', '--abbrev-ref', 'HEAD']), 'dev');
    assert.match(consoleLines.join('\n'), /Dev worktree:/);
  });

  test('sync fast-forwards main and dev from upstreams', async () => {
    const { remotePath, repoPath } = createRemoteClone('sync-repo');
    const devPath = `${repoPath}-dev`;

    await cmdLanes(['init'], { cwd: repoPath });

    const upstreamPath = path.join(suiteRoot, 'sync-upstream');
    git(suiteRoot, ['clone', '--branch', 'main', remotePath, upstreamPath]);
    configureGitIdentity(upstreamPath);

    git(upstreamPath, ['checkout', 'main']);
    writeFile(upstreamPath, 'README.md', '# main update\n');
    git(upstreamPath, ['add', 'README.md']);
    git(upstreamPath, ['commit', '-m', 'main update']);
    git(upstreamPath, ['push', 'origin', 'main']);

    git(upstreamPath, ['checkout', 'dev']);
    writeFile(upstreamPath, 'dev.txt', 'dev update\n');
    git(upstreamPath, ['add', 'dev.txt']);
    git(upstreamPath, ['commit', '-m', 'dev update']);
    git(upstreamPath, ['push', 'origin', 'dev']);

    consoleLines = [];
    await cmdLanes(['sync'], { cwd: repoPath });

    assert.equal(git(repoPath, ['rev-parse', 'HEAD']), git(repoPath, ['rev-parse', 'origin/main']));
    assert.equal(git(devPath, ['rev-parse', 'HEAD']), git(devPath, ['rev-parse', 'origin/dev']));
    assert.match(consoleLines.join('\n'), /Lanes synced/);
  });
});
