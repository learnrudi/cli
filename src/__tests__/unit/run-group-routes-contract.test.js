import { after, before, beforeEach, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';

import {
  createMockCtx,
  createMockReq,
  createMockRes,
  parseResBody,
} from '../helpers/serve-mocks.js';

const originalHome = process.env.HOME;
const tempRoot = path.resolve(process.cwd(), 'tmp');
fs.mkdirSync(tempRoot, { recursive: true });
const tempHomeRoot = fs.mkdtempSync(path.join(tempRoot, 'run-group-contract-test-'));
const rudiHome = path.join(tempHomeRoot, '.rudi');
const FIXED_NOW = '2026-03-22T12:00:00.000Z';

let buildRunGroupRoutes;
let getDb;
let initSchema;
let closeDb;
let resetAgentDbStateForTests;

function assertErrorBody(res, expected) {
  assert.deepEqual(parseResBody(res), expected);
}

function insertRunGroup(db, {
  id,
  status = 'running',
  configJson = '{"tasks":[]}',
} = {}) {
  db.prepare(`
    INSERT INTO run_groups (
      id, status, config_json, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?)
  `).run(id, status, configJson, FIXED_NOW, FIXED_NOW);
}

function insertSession(db, {
  id,
  runGroupId,
  provider = 'claude',
  status = 'active',
} = {}) {
  db.prepare(`
    INSERT INTO sessions (
      id, provider, provider_session_id, run_group_id, origin, status, created_at, last_active_at
    ) VALUES (?, ?, ?, ?, 'rudi', ?, ?, ?)
  `).run(id, provider, `${id}-provider`, runGroupId, status, FIXED_NOW, FIXED_NOW);
}

function insertRuntimeState(db, {
  sessionId,
  status,
  completedAt = FIXED_NOW,
} = {}) {
  db.prepare(`
    INSERT INTO session_runtime_state (
      session_id, status, started_at, updated_at, completed_at
    ) VALUES (?, ?, ?, ?, ?)
  `).run(sessionId, status, FIXED_NOW, FIXED_NOW, completedAt);
}

function insertValidationFailure(db, {
  sessionId,
  runGroupId,
  taskIndex = 0,
  errors = [{ message: 'Expected artifact was missing' }],
} = {}) {
  db.prepare(`
    INSERT INTO task_validation_results (
      session_id, run_group_id, task_index, passed, errors_json, warnings_json, artifacts_json, validated_at
    ) VALUES (?, ?, ?, 0, ?, '[]', '[]', ?)
  `).run(sessionId, runGroupId, taskIndex, JSON.stringify(errors), FIXED_NOW);
}

function createKillableProc() {
  return {
    killed: false,
    signals: [],
    kill(signal) {
      this.signals.push(signal);
      if (signal === 'SIGTERM' || signal === 'SIGKILL') {
        this.killed = true;
      }
    },
    on(event, cb) {
      if (event === 'close') cb();
    },
  };
}

before(async () => {
  process.env.HOME = tempHomeRoot;

  ({ buildRunGroupRoutes } = await import('../../commands/agent/routes/run-group.js'));
  ({ getDb, initSchema, closeDb } = await import('@learnrudi/db'));
  ({ resetAgentDbStateForTests } = await import('../../commands/agent/db.js'));
});

beforeEach(() => {
  closeDb?.();
  resetAgentDbStateForTests?.();
  fs.rmSync(rudiHome, { recursive: true, force: true });
  fs.mkdirSync(rudiHome, { recursive: true });
  initSchema();
});

after(async () => {
  closeDb?.();
  resetAgentDbStateForTests?.();
  process.env.HOME = originalHome;
  await fsp.rm(tempHomeRoot, { recursive: true, force: true });
});

describe('buildRunGroupRoutes', () => {
  test('POST /agent/run-group/:id/stop returns a stable not-found contract for missing groups', async () => {
    const ctx = createMockCtx({ agentProcesses: new Map() });
    const handle = buildRunGroupRoutes(ctx);
    const { req, url } = createMockReq('POST', '/agent/run-group/group-missing/stop');
    const res = createMockRes();

    const handled = await handle(req, res, url);

    assert.equal(handled, true);
    assert.equal(res.state.statusCode, 404);
    assertErrorBody(res, {
      error: 'Run group not found',
      code: 'RUN_GROUP_NOT_FOUND',
    });
    assert.deepEqual(ctx._broadcasts, []);
  });

  test('POST /agent/run-group/:id/stop returns stopped status and broadcasts the Lite event shape', async () => {
    const db = getDb();
    insertRunGroup(db, {
      id: 'group-stop-1',
      status: 'running',
      configJson: JSON.stringify({
        tasks: [{
          sessionId: 'session-stop-1',
          taskIndex: 0,
          provider: 'claude',
          failurePolicy: 'stop-downstream',
        }],
      }),
    });
    insertSession(db, { id: 'session-stop-1', runGroupId: 'group-stop-1' });

    const proc = createKillableProc();
    const agentProcesses = new Map([
      ['session-stop-1', { proc }],
    ]);
    const ctx = createMockCtx({ agentProcesses });
    const handle = buildRunGroupRoutes(ctx);
    const { req, url } = createMockReq('POST', '/agent/run-group/group-stop-1/stop');
    const res = createMockRes();

    const handled = await handle(req, res, url);

    assert.equal(handled, true);
    assert.equal(res.state.statusCode, 200);
    assert.deepEqual(parseResBody(res), {
      ok: true,
      groupId: 'group-stop-1',
      stopped: 1,
      status: 'stopped',
    });
    assert.deepEqual(proc.signals, ['SIGTERM']);
    assert.deepEqual(ctx._broadcasts, [{
      type: 'run-group:stopped',
      data: { groupId: 'group-stop-1' },
    }]);

    const detailReq = createMockReq('GET', '/agent/run-group/group-stop-1');
    const detailRes = createMockRes();
    const detailHandled = await handle(detailReq.req, detailRes, detailReq.url);
    const detailBody = parseResBody(detailRes);

    assert.equal(detailHandled, true);
    assert.equal(detailRes.state.statusCode, 200);
    assert.equal(detailBody.group.status, 'stopped');
    assert.equal(detailBody.group.session_count, 1);
    assert.equal(detailBody.group.completed_count, 0);
    assert.equal(detailBody.group.failed_count, 0);
    assert.equal(detailBody.sessions.length, 1);
    assert.equal(detailBody.sessions[0].status, 'stopped');
    assert.equal(detailBody.sessions[0].runtime_status, 'stopped');
  });

  test('GET /agent/run-group/:id returns a stable not-found contract for missing groups', async () => {
    const ctx = createMockCtx({ agentProcesses: new Map() });
    const handle = buildRunGroupRoutes(ctx);
    const { req, url } = createMockReq('GET', '/agent/run-group/group-missing');
    const res = createMockRes();

    const handled = await handle(req, res, url);

    assert.equal(handled, true);
    assert.equal(res.state.statusCode, 404);
    assertErrorBody(res, {
      error: 'Run group not found',
      code: 'RUN_GROUP_NOT_FOUND',
    });
  });

  test('GET /agent/run-group/:id reports partial when all tasks exit cleanly but validation fails', async () => {
    const db = getDb();
    insertRunGroup(db, { id: 'group-validation-1', status: 'running' });
    insertSession(db, { id: 'session-validation-1', runGroupId: 'group-validation-1' });
    insertRuntimeState(db, { sessionId: 'session-validation-1', status: 'completed' });
    insertValidationFailure(db, {
      sessionId: 'session-validation-1',
      runGroupId: 'group-validation-1',
      errors: [{ message: 'Primary deliverable was not produced' }],
    });

    const ctx = createMockCtx({ agentProcesses: new Map() });
    const handle = buildRunGroupRoutes(ctx);
    const { req, url } = createMockReq('GET', '/agent/run-group/group-validation-1');
    const res = createMockRes();

    const handled = await handle(req, res, url);

    assert.equal(handled, true);
    assert.equal(res.state.statusCode, 200);
    const body = parseResBody(res);

    assert.equal(body.group.id, 'group-validation-1');
    assert.equal(body.group.status, 'partial');
    assert.equal(body.group.session_count, 1);
    assert.equal(body.group.completed_count, 1);
    assert.equal(body.group.failed_count, 0);
    assert.equal(body.group.validation_failed_count, 1);
    assert.equal(body.group.config_json, '{"tasks":[]}');
    assert.equal(typeof body.group.updated_at, 'string');
    assert.equal(typeof body.group.completed_at, 'string');

    assert.equal(body.sessions.length, 1);
    assert.deepEqual(body.sessions[0], {
      id: 'session-validation-1',
      provider: 'claude',
      provider_session_id: 'session-validation-1-provider',
      title: null,
      title_override: null,
      model: null,
      cwd: null,
      session_status: 'active',
      started_at: null,
      ended_at: null,
      exit_code: null,
      error_code: null,
      error_message: null,
      created_at: FIXED_NOW,
      last_active_at: FIXED_NOW,
      turn_count: 0,
      total_cost: 0,
      runtime_status: 'completed',
      runtime_turn_count: 0,
      runtime_cost_total: 0,
      runtime_tokens_total: 0,
      runtime_last_error: null,
      worktree_path: null,
      worktree_branch: null,
      base_branch: null,
      completed_at: FIXED_NOW,
      validation_passed: false,
      validation_errors_json: JSON.stringify([{ message: 'Primary deliverable was not produced' }]),
      validation_warnings_json: '[]',
      validated_at: FIXED_NOW,
      status: 'completed',
      alive: false,
      turn_active: false,
      pid: null,
      last_progress_snippet: null,
      last_progress_type: null,
      last_progress_at: null,
      last_progress_source: null,
      validation_errors: [{ message: 'Primary deliverable was not produced' }],
      validation_warnings: [],
    });
  });
});
