import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import os from 'os';
import path from 'path';
import childProcess from 'node:child_process';
import { EventEmitter } from 'node:events';
import { syncBuiltinESMExports } from 'node:module';

import { buildStartRoute } from '../../commands/agent/routes/start.js';
import {
  resetAgentDbStateForTests,
  setResolvedDbForTests,
} from '../../commands/agent/db.js';
import {
  createMockCtx,
  createMockReq,
  createMockRes,
  parseResBody,
} from '../helpers/serve-mocks.js';

function createMockProc(options = {}) {
  const writes = options.writes || [];
  const proc = new EventEmitter();
  proc.pid = 4242;
  proc.killed = false;
  proc.stdout = new EventEmitter();
  proc.stderr = new EventEmitter();
  proc.stdin = new EventEmitter();
  proc.stdin.writable = true;
  proc.stdin.write = (chunk) => {
    writes.push(chunk);
    return true;
  };
  proc.stdin.end = () => {
    proc.stdin.writable = false;
  };
  proc.kill = () => {
    proc.killed = true;
    return true;
  };
  return proc;
}

test('concurrent /agent/start requests reuse a single spawned process for the same resumeSessionId', async () => {
  resetAgentDbStateForTests();

  const fakeCwd = fs.mkdtempSync(path.join(os.tmpdir(), 'rudi-start-dedupe-'));
  const originalSetImmediate = global.setImmediate;
  const originalExistsSync = fs.existsSync;
  const originalExecSync = childProcess.execSync;
  const originalSpawn = childProcess.spawn;
  let spawnCalls = 0;

  global.setImmediate = () => 0;
  fs.existsSync = (filePath) => {
    if (typeof filePath === 'string' && /(?:\/\.local\/bin\/claude|\/\.rudi\/runtimes\/node|\/\.rudi\/agents\/claude)/.test(filePath)) {
      return false;
    }
    return originalExistsSync(filePath);
  };
  childProcess.execSync = (command, options) => {
    if (command === 'which claude') {
      return '/tmp/fake-claude\n';
    }
    return originalExecSync(command, options);
  };
  childProcess.spawn = () => {
    spawnCalls += 1;
    return createMockProc();
  };
  syncBuiltinESMExports();

  setResolvedDbForTests({
    prepare() {
      return {
        get() {
          return undefined;
        },
        run() {
          return { changes: 1 };
        },
      };
    },
  });

  try {
    const agentProcesses = new Map();
    const ctx = createMockCtx({
      agentProcesses,
      queueSessionsUpdated() {},
      resumeSessionIndex: new Map(),
      maxConcurrent: 10,
      getSidecarPort: () => 0,
      getSidecarToken: () => '',
      pendingPermissions: new Map(),
      sessionAlwaysAllowed: new Map(),
    });
    const handle = buildStartRoute(ctx);

    const requestBody = {
      provider: 'claude',
      prompt: 'Inspect the repo',
      resumeSessionId: 'resume-123',
      cwd: fakeCwd,
    };

    const { req: reqA, url: urlA } = createMockReq('POST', '/agent/start', { body: requestBody });
    const { req: reqB, url: urlB } = createMockReq('POST', '/agent/start', { body: requestBody });
    const resA = createMockRes();
    const resB = createMockRes();

    await Promise.all([
      handle(reqA, resA, urlA),
      handle(reqB, resB, urlB),
    ]);

    const bodyA = parseResBody(resA);
    const bodyB = parseResBody(resB);
    assert.equal(bodyA.sessionId, bodyB.sessionId);
    assert.equal(Number(Boolean(bodyA.reused)) + Number(Boolean(bodyB.reused)), 1);
    assert.equal(agentProcesses.size, 1);
    assert.equal(spawnCalls, 1);

    for (const entry of agentProcesses.values()) {
      entry.proc.kill();
    }
  } finally {
    global.setImmediate = originalSetImmediate;
    fs.existsSync = originalExistsSync;
    childProcess.execSync = originalExecSync;
    childProcess.spawn = originalSpawn;
    syncBuiltinESMExports();
    resetAgentDbStateForTests();
    fs.rmSync(fakeCwd, { recursive: true, force: true });
  }
});

test('/agent/start launches Claude stream-json stdin sessions in print mode', async () => {
  resetAgentDbStateForTests();

  const fakeCwd = fs.mkdtempSync(path.join(os.tmpdir(), 'rudi-start-stream-json-'));
  const originalSetImmediate = global.setImmediate;
  const originalExistsSync = fs.existsSync;
  const originalExecSync = childProcess.execSync;
  const originalSpawn = childProcess.spawn;
  const stdinWrites = [];
  let capturedArgs = null;

  global.setImmediate = () => 0;
  fs.existsSync = (filePath) => {
    if (typeof filePath === 'string' && /(?:\/\.local\/bin\/claude|\/\.rudi\/runtimes\/node|\/\.rudi\/agents\/claude)/.test(filePath)) {
      return false;
    }
    return originalExistsSync(filePath);
  };
  childProcess.execSync = (command, options) => {
    if (command === 'which claude') {
      return '/tmp/fake-claude\n';
    }
    return originalExecSync(command, options);
  };
  childProcess.spawn = (_binaryPath, args) => {
    capturedArgs = args;
    return createMockProc({ writes: stdinWrites });
  };
  syncBuiltinESMExports();

  setResolvedDbForTests({
    prepare() {
      return {
        get() {
          return undefined;
        },
        run() {
          return { changes: 1 };
        },
      };
    },
  });

  try {
    const agentProcesses = new Map();
    const ctx = createMockCtx({
      agentProcesses,
      queueSessionsUpdated() {},
      resumeSessionIndex: new Map(),
      maxConcurrent: 10,
      getSidecarPort: () => 0,
      getSidecarToken: () => '',
      pendingPermissions: new Map(),
      sessionAlwaysAllowed: new Map(),
    });
    const handle = buildStartRoute(ctx);

    const { req, url } = createMockReq('POST', '/agent/start', {
      body: {
        provider: 'claude',
        prompt: 'Inspect the repo',
        cwd: fakeCwd,
        useWorktree: false,
      },
    });
    const res = createMockRes();

    await handle(req, res, url);

    assert.equal(res.state.statusCode, 200);
    assert.ok(capturedArgs.includes('--print'));
    assert.deepEqual(capturedArgs.slice(0, 3), ['--output-format', 'stream-json', '--verbose']);
    assert.equal(capturedArgs.includes('--input-format'), true);
    assert.equal(capturedArgs.includes('-p'), false);

    assert.equal(stdinWrites.length, 1);
    const payload = JSON.parse(stdinWrites[0]);
    assert.deepEqual(payload, {
      type: 'user',
      message: {
        role: 'user',
        content: [{ type: 'text', text: 'Inspect the repo' }],
      },
    });

    for (const entry of agentProcesses.values()) {
      entry.proc.kill();
    }
  } finally {
    global.setImmediate = originalSetImmediate;
    fs.existsSync = originalExistsSync;
    childProcess.execSync = originalExecSync;
    childProcess.spawn = originalSpawn;
    syncBuiltinESMExports();
    resetAgentDbStateForTests();
    fs.rmSync(fakeCwd, { recursive: true, force: true });
  }
});
