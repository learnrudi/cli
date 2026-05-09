import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import { createMockCtx, createMockReq, createMockRes, parseResBody } from '../helpers/serve-mocks.js';
import { createSessionsModule } from '../../commands/serve/sessions.js';

function createSessionsRoute(resolveDb = () => null) {
  const ctx = createMockCtx();
  const sessionsModule = createSessionsModule({
    log: ctx.log,
    broadcast: ctx.broadcast,
    json: ctx.json,
    error: ctx.error,
    readBody: ctx.readBody,
    getProjectGitStatus: () => null,
    resolveDb,
  });
  return { ctx, sessionsModule };
}

function createSubagentsDb(rows) {
  return {
    prepare(sql) {
      if (sql.includes('FROM sessions') && sql.includes('WHERE parent_session_id = ?')) {
        return {
          all(parentSessionId) {
            assert.strictEqual(parentSessionId, 'parent-session');
            return rows;
          },
        };
      }
      throw new Error(`Unexpected SQL in test mock: ${sql}`);
    },
  };
}

describe('sessions route contracts', () => {
  test('POST /sessions/:id/title missing title returns 400 BAD_REQUEST', async () => {
    const { sessionsModule } = createSessionsRoute();
    const { req, url } = createMockReq('POST', '/sessions/abc/title', { body: {} });
    const res = createMockRes();

    try {
      const handled = await sessionsModule.handleSessions(req, res, url);
      assert.strictEqual(handled, true);
      assert.strictEqual(res.state.statusCode, 400);
      assert.deepEqual(parseResBody(res), {
        error: 'title required',
        code: 'BAD_REQUEST',
      });
    } finally {
      sessionsModule.cleanup();
    }
  });

  test('POST /sessions/:id/title degrades gracefully when DB is unavailable', async () => {
    const { sessionsModule } = createSessionsRoute(() => null);
    const { req, url } = createMockReq('POST', '/sessions/abc/title', {
      body: { title: '  Sidecar hardening pass  ' },
    });
    const res = createMockRes();

    try {
      const handled = await sessionsModule.handleSessions(req, res, url);
      assert.strictEqual(handled, true);
      assert.strictEqual(res.state.statusCode, 200);
      assert.deepEqual(parseResBody(res), {
        ok: true,
        title: 'Sidecar hardening pass',
      });
    } finally {
      sessionsModule.cleanup();
    }
  });

  test('GET /sessions/:id/subagents returns normalized subagents with aggregates', async () => {
    const db = createSubagentsDb([
      {
        id: 'child-1',
        agent_id: 'agent-a',
        session_type: 'task',
        model: 'claude-sonnet-4-5-20250929',
        status: 'completed',
        total_cost: 1.25,
        total_input_tokens: 1200,
        total_output_tokens: 400,
        turn_count: 3,
        snippet: 'Implemented the error registry',
        created_at: '2026-03-22T12:00:00.000Z',
        last_active_at: '2026-03-22T12:10:00.000Z',
      },
      {
        id: 'child-2',
        agent_id: null,
        session_type: null,
        model: null,
        status: null,
        total_cost: 0,
        total_input_tokens: 50,
        total_output_tokens: 25,
        turn_count: 1,
        snippet: null,
        created_at: null,
        last_active_at: null,
      },
    ]);
    const { sessionsModule } = createSessionsRoute(() => db);
    const { req, url } = createMockReq('GET', '/sessions/parent-session/subagents');
    const res = createMockRes();

    try {
      const handled = await sessionsModule.handleSessions(req, res, url);
      assert.strictEqual(handled, true);
      assert.strictEqual(res.state.statusCode, 200);
      assert.deepEqual(parseResBody(res), {
        subagents: [
          {
            sessionId: 'child-1',
            agentId: 'agent-a',
            sessionType: 'task',
            model: 'claude-sonnet-4-5-20250929',
            status: 'completed',
            totalCost: 1.25,
            totalInputTokens: 1200,
            totalOutputTokens: 400,
            turnCount: 3,
            snippet: 'Implemented the error registry',
            createdAt: '2026-03-22T12:00:00.000Z',
            lastActiveAt: '2026-03-22T12:10:00.000Z',
          },
          {
            sessionId: 'child-2',
            agentId: '',
            sessionType: 'task',
            model: '',
            status: 'active',
            totalCost: 0,
            totalInputTokens: 50,
            totalOutputTokens: 25,
            turnCount: 1,
            snippet: '',
            createdAt: '',
            lastActiveAt: '',
          },
        ],
        aggregated: {
          totalCost: 1.25,
          totalInputTokens: 1250,
          totalOutputTokens: 425,
          count: 2,
        },
      });
    } finally {
      sessionsModule.cleanup();
    }
  });

  test('GET /sessions/:id/subagents returns 503 when database is unavailable', async () => {
    const { sessionsModule } = createSessionsRoute(() => null);
    const { req, url } = createMockReq('GET', '/sessions/parent-session/subagents');
    const res = createMockRes();

    try {
      const handled = await sessionsModule.handleSessions(req, res, url);
      assert.strictEqual(handled, true);
      assert.strictEqual(res.state.statusCode, 503);
      assert.deepEqual(parseResBody(res), {
        error: 'database not available',
        code: 'SERVICE_UNAVAILABLE',
      });
    } finally {
      sessionsModule.cleanup();
    }
  });
});
