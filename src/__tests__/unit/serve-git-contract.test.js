import { test, describe } from 'node:test';
import assert from 'node:assert';
import { execFileSync } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { createMockCtx, createMockRes, createMockReq, parseResBody } from '../helpers/serve-mocks.js';
import { createGitHandler } from '../../commands/serve/git.js';

function makeGitHandler() {
  const ctx = createMockCtx();
  return createGitHandler(ctx);
}

function assertConfirmationRequired(res, operation) {
  assert.strictEqual(res.state.statusCode, 400);
  assert.deepStrictEqual(parseResBody(res), {
    error: `confirmDestructive must be true for ${operation}`,
    code: 'INVALID_FIELD',
    details: {
      field: 'confirmDestructive',
      location: 'body',
      reason: 'explicit_confirmation_required',
      operation,
    },
  });
}

function makeTempGitRepo() {
  const repoPath = fs.mkdtempSync(path.join(os.tmpdir(), 'rudi-git-route-'));
  execFileSync('git', ['init'], { cwd: repoPath, stdio: 'ignore' });
  execFileSync('git', ['config', 'user.email', 'rudi-test@example.com'], { cwd: repoPath });
  execFileSync('git', ['config', 'user.name', 'RUDI Test'], { cwd: repoPath });
  return repoPath;
}

function makeProbePath() {
  return path.join(os.tmpdir(), `rudi-git-probe-${process.pid}-${Date.now()}-${Math.random().toString(16).slice(2)}`);
}

async function callGitRoute(method, pathname, body) {
  const handleGit = makeGitHandler();
  const { req, url } = createMockReq(method, pathname, { body });
  const res = createMockRes();

  await handleGit(req, res, url);

  return res;
}

describe('createGitHandler destructive operation contracts', () => {
  test('POST /git/revert requires destructive confirmation', async () => {
    const handleGit = makeGitHandler();
    const { req, url } = createMockReq('POST', '/git/revert', {
      body: { path: '/tmp/rudi-git-contract', files: ['file.txt'] },
    });
    const res = createMockRes();

    await handleGit(req, res, url);

    assertConfirmationRequired(res, 'git revert');
  });

  test('POST /git/branch/delete requires destructive confirmation', async () => {
    const handleGit = makeGitHandler();
    const { req, url } = createMockReq('POST', '/git/branch/delete', {
      body: { path: '/tmp/rudi-git-contract', name: 'feature/test' },
    });
    const res = createMockRes();

    await handleGit(req, res, url);

    assertConfirmationRequired(res, 'git branch delete');
  });

  test('POST /git/worktree/remove requires destructive confirmation', async () => {
    const handleGit = makeGitHandler();
    const { req, url } = createMockReq('POST', '/git/worktree/remove', {
      body: { path: '/tmp/rudi-git-contract', directory: '/tmp/rudi-worktree-contract' },
    });
    const res = createMockRes();

    await handleGit(req, res, url);

    assertConfirmationRequired(res, 'git worktree remove');
  });
});

describe('createGitHandler command execution contracts', () => {
  test('POST /git/stage stages files without destructive confirmation', async () => {
    const repoPath = makeTempGitRepo();
    fs.writeFileSync(path.join(repoPath, 'safe.txt'), 'safe');

    try {
      const res = await callGitRoute('POST', '/git/stage', {
        path: repoPath,
        files: ['safe.txt'],
      });

      assert.strictEqual(res.state.statusCode, 200);
      assert.deepStrictEqual(parseResBody(res), { ok: true });

      const status = execFileSync('git', ['status', '--porcelain'], {
        cwd: repoPath,
        encoding: 'utf-8',
      });
      assert.match(status, /^A\s+safe\.txt$/m);
    } finally {
      fs.rmSync(repoPath, { recursive: true, force: true });
    }
  });

  test('POST /git/stage treats file names as literal git args', async () => {
    const repoPath = makeTempGitRepo();
    const probePath = makeProbePath();
    fs.writeFileSync(path.join(repoPath, 'safe.txt'), 'safe');

    try {
      const res = await callGitRoute('POST', '/git/stage', {
        path: repoPath,
        files: [`safe.txt; touch ${probePath}`],
      });

      assert.strictEqual(fs.existsSync(probePath), false);
      assert.strictEqual(res.state.statusCode, 500);
    } finally {
      fs.rmSync(repoPath, { recursive: true, force: true });
      fs.rmSync(probePath, { force: true });
    }
  });

  test('POST /git/branch/create treats branch names as literal git args', async () => {
    const repoPath = makeTempGitRepo();
    const probePath = makeProbePath();

    try {
      const res = await callGitRoute('POST', '/git/branch/create', {
        path: repoPath,
        name: `feature-$(touch ${probePath})`,
      });

      assert.strictEqual(fs.existsSync(probePath), false);
      assert.strictEqual(res.state.statusCode, 500);
    } finally {
      fs.rmSync(repoPath, { recursive: true, force: true });
      fs.rmSync(probePath, { force: true });
    }
  });
});
