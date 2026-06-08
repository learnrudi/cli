import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import {
  buildAdminRoutes,
  buildDaemonHealthRoutes,
  buildEnvRoutes,
  buildLocalLlmRoutes,
} from '../../daemon/routes/index.js';
import {
  createMockCtx,
  createMockReq,
  createMockRes,
  parseResBody,
} from '../helpers/serve-mocks.js';

function createAttachedRes(ctx) {
  const res = createMockRes();
  ctx.attachRequestContext(res, ctx.createRequestContext({ method: 'GET', url: '/' }));
  return res;
}

const targetLocalLlm = {
  providerFamily: 'openai_compatible',
  targets: {
    mac_host: {
      runtimeBaseUrl: 'http://localhost:11434/v1',
      consumerUrls: {
        host_process: 'http://localhost:11434/v1',
        docker_container: 'http://host.docker.internal:11434/v1',
      },
      healthCheck: {
        method: 'GET',
        path: '/models',
      },
      apiKeyPolicy: 'placeholder',
      placeholderApiKey: 'ollama',
    },
  },
  consumers: {
    'content-engine': {
      defaultConsumerContext: 'docker_container',
      env: {
        LOCAL_LLM_BASE_URL: '{{baseUrl}}',
        LOCAL_LLM_API_KEY: '{{apiKey}}',
        LOCAL_LLM_MODEL: '{{model}}',
      },
    },
  },
};

function createLocalLlmDeps() {
  return {
    getPackage: async (id) => ({ id, kind: 'runtime', name: 'ollama' }),
    getManifest: async () => ({ meta: { localLlm: targetLocalLlm } }),
    fetchImpl: async () => ({
      ok: true,
      status: 200,
      async json() {
        return { data: [{ id: 'llama3.2:3b' }] };
      },
    }),
  };
}

describe('daemon health/status routes', () => {
  test('GET /health preserves the unauthenticated public payload', () => {
    const ctx = createMockCtx();
    const routes = buildDaemonHealthRoutes(ctx, { version: '0.1.0' });
    const { req, url } = createMockReq('GET', '/health');
    const res = createAttachedRes(ctx);

    assert.equal(routes.handlePublic(req, res, url), true);
    assert.deepEqual(parseResBody(res), {
      status: 'ok',
      version: '0.1.0',
    });
    assert.equal(res._rudiRequestContext.auth.required, false);
    assert.equal(res._rudiRequestContext.auth.result, 'skipped');
  });

  test('GET /ready returns readiness without exposing operational secrets', () => {
    const ctx = createMockCtx();
    const routes = buildDaemonHealthRoutes(ctx, {
      getDbStatus: () => ({ status: 'ready', ready: true }),
      getToolIndexStatus: () => ({ status: 'ready', ready: true, toolCount: 2 }),
    });
    const { req, url } = createMockReq('GET', '/ready');
    const res = createAttachedRes(ctx);

    assert.equal(routes.handle(req, res, url), true);
    assert.deepEqual(parseResBody(res), {
      status: 'ready',
      ready: true,
      checks: {
        routes: true,
        db: { status: 'ready', ready: true },
        toolIndex: { status: 'ready', ready: true, toolCount: 2 },
      },
    });
  });

  test('GET /version returns the sidecar API version only', () => {
    const ctx = createMockCtx();
    const routes = buildDaemonHealthRoutes(ctx, { version: '9.9.9' });
    const { req, url } = createMockReq('GET', '/version');
    const res = createAttachedRes(ctx);

    assert.equal(routes.handle(req, res, url), true);
    assert.deepEqual(parseResBody(res), { version: '9.9.9' });
  });

  test('GET /daemon/status returns schema-backed daemon runtime status', () => {
    const ctx = createMockCtx();
    const routes = buildDaemonHealthRoutes(ctx, {
      agentProcesses: new Map([
        ['alive', { proc: { killed: false } }],
        ['stopped', { proc: { killed: true } }],
      ]),
      getDbStatus: () => ({ status: 'ready', ready: true }),
      getPackageCounts: () => ({ stack: 3 }),
      getPort: () => 8123,
      getToolIndexStatus: () => ({ status: 'ready', ready: true, toolCount: 5 }),
      nowMs: () => 2000,
      startedAt: '2026-05-17T12:00:00.000Z',
      startedAtMs: 500,
      version: '0.1.0',
    });
    const { req, url } = createMockReq('GET', '/daemon/status');
    const res = createAttachedRes(ctx);

    assert.equal(routes.handle(req, res, url), true);
    assert.deepEqual(parseResBody(res), {
      version: '0.1.0',
      pid: process.pid,
      port: 8123,
      uptimeMs: 1500,
      rudiHome: parseResBody(res).rudiHome,
      platform: process.platform,
      runtime: {
        name: 'node',
        version: process.version,
      },
      startedAt: '2026-05-17T12:00:00.000Z',
      toolIndexStatus: { status: 'ready', ready: true, toolCount: 5 },
      dbStatus: { status: 'ready', ready: true },
      packageCounts: { stack: 3 },
      activeSessionCount: 1,
      activeJobCount: 0,
    });
  });
});

describe('daemon utility routes', () => {
  test('GET /env is handled by daemon env routes', () => {
    const ctx = createMockCtx();
    const routes = buildEnvRoutes(ctx);
    const { req, url } = createMockReq('GET', '/env');
    const res = createMockRes();

    assert.equal(routes.handle(req, res, url), true);
    const body = parseResBody(res);
    assert.equal(typeof body.home, 'string');
    assert.equal(typeof body.platform, 'string');
  });

  test('GET /local-llm/status exposes normalized daemon runtime status', async () => {
    const ctx = createMockCtx();
    const routes = buildLocalLlmRoutes(ctx, createLocalLlmDeps());
    const { req, url } = createMockReq('GET', '/local-llm/status');
    const res = createMockRes();

    assert.equal(await routes.handle(req, res, url), true);
    assert.deepEqual(parseResBody(res), {
      runtime: 'ollama',
      providerFamily: 'openai_compatible',
      target: 'mac_host',
      consumer: null,
      consumerContext: 'host_process',
      baseUrl: 'http://localhost:11434/v1',
      healthUrl: 'http://localhost:11434/v1/models',
      apiKeyPolicy: 'placeholder',
      available: true,
      statusCode: 200,
      models: ['llama3.2:3b'],
      error: null,
    });
  });

  test('GET /local-llm/env/:consumer exposes consumer env from daemon route', async () => {
    const ctx = createMockCtx();
    const routes = buildLocalLlmRoutes(ctx, createLocalLlmDeps());
    const { req, url } = createMockReq('GET', '/local-llm/env/content-engine', {
      query: 'model=llama3.2%3A3b',
    });
    const res = createMockRes();

    assert.equal(await routes.handle(req, res, url), true);
    assert.deepEqual(parseResBody(res), {
      runtime: 'ollama',
      providerFamily: 'openai_compatible',
      target: 'mac_host',
      consumer: 'content-engine',
      consumerContext: 'docker_container',
      baseUrl: 'http://host.docker.internal:11434/v1',
      env: {
        LOCAL_LLM_BASE_URL: 'http://host.docker.internal:11434/v1',
        LOCAL_LLM_API_KEY: 'ollama',
        LOCAL_LLM_MODEL: 'llama3.2:3b',
      },
    });
  });

  test('POST /admin/backfill preserves started response shape', () => {
    const ctx = createMockCtx();
    const calls = [];
    const routes = buildAdminRoutes(ctx, {
      backfillSessionTurnsToDb: async () => {
        calls.push('backfill');
        return { ok: true };
      },
      getTurnIngestStats: () => ({
        errors: [],
        backfillRunning: false,
        backfillFilesDone: 0,
        backfillFilesTotal: 10,
      }),
    });
    const { req, url } = createMockReq('POST', '/admin/backfill');
    const res = createMockRes();

    assert.equal(routes.handle(req, res, url), true);
    assert.deepEqual(parseResBody(res), {
      status: 'started',
      backfillRunning: false,
      progress: {
        filesDone: 0,
        filesTotal: 10,
      },
    });
  });
});
