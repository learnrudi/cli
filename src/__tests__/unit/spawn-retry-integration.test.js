import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { spawnAgentProcess } from '../../commands/agent/spawn-process.js';
import { buildLifecycleRoutes } from '../../commands/agent/routes/lifecycle.js';
import {
  resetAgentDbStateForTests,
  setResolvedDbForTests,
} from '../../commands/agent/db.js';
import {
  createMockCtx,
  createMockReq,
  createMockRes,
} from '../helpers/serve-mocks.js';

function createTestDb(sessionId, initialStatus = 'starting') {
  const state = {
    sessionId,
    runtimeStatus: initialStatus,
    lastError: null,
    completedAt: null,
    updatedAt: null,
    providerSessionId: null,
    lastSeq: 0,
    runtimeEvents: [],
    sessionUpdates: [],
  };

  return {
    state,
    prepare(sql) {
      const normalized = sql.replace(/\s+/g, ' ').trim();
      return {
        get(...params) {
          if (normalized.includes('SELECT last_seq FROM session_runtime_state')) {
            return { last_seq: state.lastSeq };
          }
          if (normalized.includes('SELECT status FROM session_runtime_state')) {
            return { status: state.runtimeStatus };
          }
          return null;
        },
        run(...params) {
          if (normalized.startsWith('INSERT OR REPLACE INTO session_runtime_events')) {
            state.lastSeq = Number(params[1]);
            state.runtimeEvents.push({
              seq: params[1],
              type: params[2],
            });
            return { changes: 1 };
          }

          if (normalized.includes('UPDATE session_runtime_state SET provider_session_id = ?')) {
            state.providerSessionId = params[0];
            return { changes: 1 };
          }

          if (normalized.includes('UPDATE session_runtime_state SET updated_at = ?, last_seq = ?')) {
            state.updatedAt = params[0];
            state.lastSeq = Number(params[1]);
            return { changes: 1 };
          }

          if (normalized.startsWith('UPDATE session_runtime_state SET turn_count = turn_count + 1')) {
            return { changes: 1 };
          }

          if (normalized.startsWith('UPDATE session_runtime_state SET status = ?')) {
            let idx = 2;
            const nextState = params[0];
            const timestamp = params[1];
            let lastError;
            let completedAt;

            if (normalized.includes('last_error = ?')) {
              lastError = params[idx];
              idx += 1;
            }
            if (normalized.includes('completed_at = ?')) {
              completedAt = params[idx];
              idx += 1;
            }

            const rowSessionId = params[idx];
            const allowed = params.slice(idx + 1);
            if (rowSessionId !== state.sessionId) {
              return { changes: 0 };
            }
            if (!allowed.includes(state.runtimeStatus)) {
              return { changes: 0 };
            }

            state.runtimeStatus = nextState;
            state.updatedAt = timestamp;
            if (lastError !== undefined) state.lastError = lastError;
            if (completedAt !== undefined) state.completedAt = completedAt;
            return { changes: 1 };
          }

          if (normalized.startsWith('UPDATE sessions ')) {
            state.sessionUpdates.push({ sql: normalized, params });
            return { changes: 1 };
          }

          return { changes: 1 };
        },
      };
    },
  };
}

function writeFixtureScript(filePath, mode) {
  const source = `
import fs from 'node:fs';

const attemptFile = process.env.RUDI_TEST_ATTEMPT_FILE;
const mode = process.env.RUDI_TEST_MODE || ${JSON.stringify(mode)};
const current = fs.existsSync(attemptFile)
  ? Number(fs.readFileSync(attemptFile, 'utf8') || '0')
  : 0;
const attempt = current + 1;
fs.writeFileSync(attemptFile, String(attempt));

const emit = (payload) => {
  process.stdout.write(JSON.stringify(payload) + '\\n');
};

if (mode === 'fail-then-succeed') {
  if (attempt === 1) {
    emit({
      type: 'assistant',
      error: 'overloaded_error',
      message: {
        content: [{ type: 'text', text: 'The API is overloaded' }]
      }
    });
    emit({ type: 'result', is_error: true });
    setTimeout(() => process.exit(1), 10);
  } else {
    emit({
      type: 'assistant',
      session_id: 'provider-session-1',
      message: {
        content: [{ type: 'text', text: 'Recovered' }]
      }
    });
    emit({
      type: 'result',
      session_id: 'provider-session-1',
      result: 'ok'
    });
    setTimeout(() => process.exit(0), 10);
  }
} else {
  emit({
    type: 'assistant',
    error: 'overloaded_error',
    message: {
      content: [{ type: 'text', text: 'The API is overloaded' }]
    }
  });
  emit({ type: 'result', is_error: true });
  setTimeout(() => process.exit(1), 10);
}
`;

  fs.writeFileSync(filePath, source);
}

async function waitFor(predicate, timeoutMs = 2000, intervalMs = 10) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
  throw new Error(`Condition not met within ${timeoutMs}ms`);
}

function createAgentCtx() {
  return createMockCtx({
    agentProcesses: new Map(),
    queueSessionsUpdated() {},
    resumeSessionIndex: new Map(),
    pendingPermissions: new Map(),
    sessionAlwaysAllowed: new Map(),
    maxConcurrent: 10,
  });
}

function spawnWithFixture({ ctx, sessionId, scriptPath, attemptFile, cwd, mode }) {
  return spawnAgentProcess(ctx, {
    sessionId,
    prompt: 'Retry this request',
    provider: 'claude',
    model: 'test-model',
    providerConfig: {
      headless: { stdin: 'close' },
      capabilities: { inputStreaming: false },
    },
    binaryPath: process.execPath,
    args: [scriptPath],
    env: {
      ...process.env,
      RUDI_TEST_ATTEMPT_FILE: attemptFile,
      RUDI_TEST_MODE: mode,
    },
    spawnCwd: cwd,
    effectiveCwd: cwd,
    workingDir: cwd,
    sessionRowMode: 'existingSession',
    existingSessionId: sessionId,
  });
}

test('spawnAgentProcess retries a transient failure and succeeds on respawn', async (t) => {
  resetAgentDbStateForTests();
  const originalSetImmediate = global.setImmediate;
  global.setImmediate = (fn, ...args) => {
    fn(...args);
    return 0;
  };

  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rudi-spawn-retry-'));
  const attemptFile = path.join(tmpDir, 'attempt.txt');
  const scriptPath = path.join(tmpDir, 'agent-fixture.mjs');
  writeFixtureScript(scriptPath, 'fail-then-succeed');

  const sessionId = '11111111-1111-4111-8111-111111111111';
  const db = createTestDb(sessionId);
  setResolvedDbForTests(db);

  t.after(() => {
    global.setImmediate = originalSetImmediate;
    resetAgentDbStateForTests();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  const ctx = createAgentCtx();
  const entry = spawnWithFixture({
    ctx,
    sessionId,
    scriptPath,
    attemptFile,
    cwd: tmpDir,
    mode: 'fail-then-succeed',
  });
  entry._retryState.delays = [5, 5, 5];

  await waitFor(() => !ctx.agentProcesses.has(sessionId));

  assert.equal(fs.readFileSync(attemptFile, 'utf8'), '2');
  assert.equal(db.state.runtimeStatus, 'completed');

  const retryBroadcast = ctx._broadcasts.find((item) => item.type === 'agent:error' && item.data.retryable);
  assert.ok(retryBroadcast);
  assert.equal(retryBroadcast.data.code, 'API_OVERLOADED');
  assert.equal(retryBroadcast.data.retryCount, 1);
  assert.equal(retryBroadcast.data.nextRetryMs, 5);

  const doneEvents = ctx._broadcasts.filter((item) => item.type === 'agent:done');
  assert.ok(doneEvents.some((item) => item.data.exitCode === 0));
});

test('stopping during a retry delay cancels the pending respawn', async (t) => {
  resetAgentDbStateForTests();
  const originalSetImmediate = global.setImmediate;
  global.setImmediate = (fn, ...args) => {
    fn(...args);
    return 0;
  };

  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rudi-spawn-stop-'));
  const attemptFile = path.join(tmpDir, 'attempt.txt');
  const scriptPath = path.join(tmpDir, 'agent-fixture.mjs');
  writeFixtureScript(scriptPath, 'always-fail');

  const sessionId = '22222222-2222-4222-8222-222222222222';
  const db = createTestDb(sessionId);
  setResolvedDbForTests(db);

  t.after(() => {
    global.setImmediate = originalSetImmediate;
    resetAgentDbStateForTests();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  const ctx = createAgentCtx();
  const entry = spawnWithFixture({
    ctx,
    sessionId,
    scriptPath,
    attemptFile,
    cwd: tmpDir,
    mode: 'always-fail',
  });
  entry._retryState.delays = [100, 100, 100];

  await waitFor(() => ctx._broadcasts.some((item) => item.type === 'agent:error' && item.data.retryable));

  const handleLifecycle = buildLifecycleRoutes(ctx);
  const { req, url } = createMockReq('POST', '/agent/stop', {
    body: { sessionId },
  });
  const res = createMockRes();
  await handleLifecycle(req, res, url);

  await new Promise((resolve) => setTimeout(resolve, 150));

  assert.equal(fs.readFileSync(attemptFile, 'utf8'), '1');
  assert.equal(ctx.agentProcesses.has(sessionId), false);
  assert.equal(db.state.runtimeStatus, 'stopped');
  assert.ok(ctx._broadcasts.some((item) => item.type === 'agent:stopped' && item.data.sessionId === sessionId));
});
