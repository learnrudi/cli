import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import { buildPackageRoutes } from '../../commands/serve/routes/packages.js';
import {
  createMockCtx,
  createMockReq,
  createMockRes,
  parseResBody,
} from '../helpers/serve-mocks.js';

function assertErrorBody(res, expected) {
  assert.deepEqual(parseResBody(res), expected);
}

describe('buildPackageRoutes', () => {
  test('GET /packages/search validates kind and returns projected package metadata', async () => {
    const ctx = createMockCtx();
    const { handle } = buildPackageRoutes(ctx, {
      async searchPackages(query, options) {
        assert.equal(query, 'audio');
        assert.deepEqual(options, { kind: 'stack' });
        return [{
          id: 'stack:audio-tools',
          kind: 'stack',
          name: 'Audio Tools',
          description: 'Edit audio files',
          version: '1.2.3',
          tags: ['media'],
          requires: { binaries: ['ffmpeg'] },
        }];
      },
    });

    const invalidReq = createMockReq('GET', '/packages/search', { query: 'q=audio&kind=nope' });
    const invalidRes = createMockRes();
    await handle(invalidReq.req, invalidRes, invalidReq.url);
    assert.equal(invalidRes.state.statusCode, 400);
    assertErrorBody(invalidRes, {
      error: 'invalid kind',
      code: 'INVALID_FIELD',
      details: { field: 'kind', location: 'query', reason: 'unsupported_value', value: 'nope' },
    });

    const { req, url } = createMockReq('GET', '/packages/search', { query: 'q=audio&kind=stack' });
    const res = createMockRes();
    const handled = await handle(req, res, url);
    assert.equal(handled, true);
    assert.deepEqual(parseResBody(res), {
      packages: [{
        id: 'stack:audio-tools',
        kind: 'stack',
        name: 'Audio Tools',
        description: 'Edit audio files',
        version: '1.2.3',
        category: null,
        tags: ['media'],
        requires: { binaries: ['ffmpeg'] },
      }],
    });
  });

  test('GET /packages/list requires a kind and returns projected results', async () => {
    const ctx = createMockCtx();
    const { handle } = buildPackageRoutes(ctx, {
      async listPackages(kind) {
        assert.equal(kind, 'agent');
        return [{
          id: 'agent:codex',
          name: 'Codex',
          description: 'OpenAI Codex CLI',
          version: '5.1.0',
          tags: ['openai'],
        }];
      },
    });

    const missingReq = createMockReq('GET', '/packages/list');
    const missingRes = createMockRes();
    await handle(missingReq.req, missingRes, missingReq.url);
    assert.equal(missingRes.state.statusCode, 400);
    assertErrorBody(missingRes, {
      error: 'valid kind required',
      code: 'INVALID_FIELD',
      details: { field: 'kind', location: 'query', reason: 'required_supported_value' },
    });

    const { req, url } = createMockReq('GET', '/packages/list', { query: 'kind=agent' });
    const res = createMockRes();
    await handle(req, res, url);
    assert.deepEqual(parseResBody(res), {
      packages: [{
        id: 'agent:codex',
        kind: 'agent',
        name: 'Codex',
        description: 'OpenAI Codex CLI',
        version: '5.1.0',
        category: null,
        tags: ['openai'],
        requires: null,
      }],
    });
  });

  test('GET /packages/installed returns stack metadata from rudi config', async () => {
    const ctx = createMockCtx();
    const { handle } = buildPackageRoutes(ctx, {
      readRudiConfig() {
        return {
          stacks: {
            'stack:vercel': {
              version: '1.0.0',
              installedAt: '2026-03-08T12:00:00.000Z',
              secrets: [{ name: 'VERCEL_TOKEN', required: true }],
              path: '/tmp/vercel',
            },
          },
        };
      },
    });

    const { req, url } = createMockReq('GET', '/packages/installed');
    const res = createMockRes();
    await handle(req, res, url);
    assert.deepEqual(parseResBody(res), {
      stacks: {
        'stack:vercel': {
          version: '1.0.0',
          installedAt: '2026-03-08T12:00:00.000Z',
          secrets: [{ name: 'VERCEL_TOKEN', required: true }],
        },
      },
    });
  });

  test('POST and DELETE /packages/secrets validate names and sync metadata', async () => {
    const ctx = createMockCtx();
    const calls = [];
    const { handle } = buildPackageRoutes(ctx, {
      async setSecret(name, value) {
        calls.push(['set', name, value]);
      },
      async removeSecret(name) {
        calls.push(['remove', name]);
      },
      updateSecretStatus(name, configured, provider) {
        calls.push(['status', name, configured, provider]);
      },
      async getMaskedSecrets() {
        return { TEST_KEY: 'test...1234' };
      },
    });

    const invalidReq = createMockReq('POST', '/packages/secrets', {
      body: { name: 'not-valid', value: 'abc' },
    });
    const invalidRes = createMockRes();
    await handle(invalidReq.req, invalidRes, invalidReq.url);
    assert.equal(invalidRes.state.statusCode, 400);

    const setReq = createMockReq('POST', '/packages/secrets', {
      body: { name: 'TEST_KEY', value: 'test1234' },
    });
    const setRes = createMockRes();
    await handle(setReq.req, setRes, setReq.url);
    assert.deepEqual(parseResBody(setRes), { ok: true });

    const listReq = createMockReq('GET', '/packages/secrets');
    const listRes = createMockRes();
    await handle(listReq.req, listRes, listReq.url);
    assert.deepEqual(parseResBody(listRes), { secrets: { TEST_KEY: 'test...1234' } });

    const deleteReq = createMockReq('DELETE', '/packages/secrets/TEST_KEY');
    const deleteRes = createMockRes();
    await handle(deleteReq.req, deleteRes, deleteReq.url);
    assert.deepEqual(parseResBody(deleteRes), { ok: true });

    assert.deepEqual(calls, [
      ['set', 'TEST_KEY', 'test1234'],
      ['status', 'TEST_KEY', true, 'secrets.json'],
      ['remove', 'TEST_KEY'],
      ['status', 'TEST_KEY', false, 'secrets.json'],
    ]);
  });

  test('POST /packages/install creates an async job, dedupes same package, and exposes completion', async () => {
    const ctx = createMockCtx();
    let releaseInstall;
    const waitForInstall = new Promise((resolve) => {
      releaseInstall = resolve;
    });

    const { handle } = buildPackageRoutes(ctx, {
      async installAndRegisterPackage({ id, force, onProgress }) {
        assert.equal(id, 'stack:vercel');
        assert.equal(force, true);
        onProgress({ phase: 'resolving', detail: 'manifest' });
        await waitForInstall;
        onProgress({ phase: 'registering' });
        return {
          id,
          kind: 'stack',
          path: '/tmp/vercel',
          version: '1.0.0',
          secrets: { found: [], missing: ['VERCEL_TOKEN'] },
        };
      },
    });

    const startReq = createMockReq('POST', '/packages/install', {
      body: { id: 'stack:vercel', force: true },
    });
    const startRes = createMockRes();
    await handle(startReq.req, startRes, startReq.url);
    const started = parseResBody(startRes);
    assert.equal(started.status, 'started');
    assert.equal(typeof started.jobId, 'string');

    const dedupeReq = createMockReq('POST', '/packages/install', {
      body: { id: 'stack:vercel', force: true },
    });
    const dedupeRes = createMockRes();
    await handle(dedupeReq.req, dedupeRes, dedupeReq.url);
    assert.deepEqual(parseResBody(dedupeRes), {
      jobId: started.jobId,
      status: 'running',
      id: 'stack:vercel',
      reused: true,
    });

    const conflictReq = createMockReq('POST', '/packages/install', {
      body: { id: 'stack:other' },
    });
    const conflictRes = createMockRes();
    await handle(conflictReq.req, conflictRes, conflictReq.url);
    assert.equal(conflictRes.state.statusCode, 409);
    assert.deepEqual(parseResBody(conflictRes), {
      error: 'another package install is already in progress',
      activeJobId: started.jobId,
      activePackageId: 'stack:vercel',
    });

    releaseInstall();
    await new Promise((resolve) => setTimeout(resolve, 0));

    const jobReq = createMockReq('GET', `/packages/jobs/${encodeURIComponent(started.jobId)}`);
    const jobRes = createMockRes();
    await handle(jobReq.req, jobRes, jobReq.url);
    const jobBody = parseResBody(jobRes);
    assert.equal(jobBody.status, 'completed');
    assert.deepEqual(jobBody.result, {
      id: 'stack:vercel',
      kind: 'stack',
      path: '/tmp/vercel',
      version: '1.0.0',
      secrets: { found: [], missing: ['VERCEL_TOKEN'] },
    });

    const progressEvents = ctx._broadcasts.filter((event) => event.type === 'package:progress');
    assert.ok(progressEvents.some((event) => event.data.phase === 'starting'));
    assert.ok(progressEvents.some((event) => event.data.phase === 'resolving'));
    assert.ok(progressEvents.some((event) => event.data.phase === 'registering'));
    assert.ok(ctx._broadcasts.some((event) => event.type === 'package:complete' && event.data.success === true));
  });
});
