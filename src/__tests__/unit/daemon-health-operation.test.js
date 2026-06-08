import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  getDaemonStatus,
  getHealth,
  getReadiness,
} from '../../daemon/operations/health.js';
import {
  validateDaemonHealth,
  validateDaemonReadiness,
  validateDaemonStatus,
} from '../../daemon/schemas/index.js';

test('getHealth preserves the legacy /health response shape', () => {
  const health = getHealth({ version: '0.1.0' });

  assert.deepEqual(health, {
    status: 'ok',
    version: '0.1.0',
  });
  assert.deepEqual(validateDaemonHealth(health), { ok: true, errors: [] });
});

test('getReadiness separates readiness from liveness', () => {
  const ready = getReadiness({
    checks: {
      db: { status: 'ready' },
      toolIndex: true,
    },
  });
  const notReady = getReadiness({
    checks: {
      db: { status: 'ready' },
      toolIndex: { status: 'missing' },
    },
  });

  assert.deepEqual(ready, {
    status: 'ready',
    ready: true,
    checks: {
      db: { status: 'ready' },
      toolIndex: true,
    },
  });
  assert.deepEqual(validateDaemonReadiness(ready), { ok: true, errors: [] });
  assert.equal(notReady.status, 'not_ready');
  assert.equal(notReady.ready, false);
});

test('getDaemonStatus returns a schema-valid deterministic status payload', () => {
  const status = getDaemonStatus({
    version: '0.1.0',
    pid: 123,
    port: 8100,
    nowMs: 2000,
    startedAtMs: 500,
    rudiHome: '/tmp/rudi',
    platform: 'darwin',
    runtime: { name: 'node', version: 'v20.0.0' },
    startedAt: '2026-05-17T12:00:00.000Z',
    toolIndexStatus: { status: 'ok', toolCount: 2 },
    dbStatus: { status: 'ok' },
    packageCounts: { stack: 3 },
    activeSessionCount: 4,
    activeJobCount: 1,
  });

  assert.deepEqual(status, {
    version: '0.1.0',
    pid: 123,
    port: 8100,
    uptimeMs: 1500,
    rudiHome: '/tmp/rudi',
    platform: 'darwin',
    runtime: { name: 'node', version: 'v20.0.0' },
    startedAt: '2026-05-17T12:00:00.000Z',
    toolIndexStatus: { status: 'ok', toolCount: 2 },
    dbStatus: { status: 'ok' },
    packageCounts: { stack: 3 },
    activeSessionCount: 4,
    activeJobCount: 1,
  });
  assert.deepEqual(validateDaemonStatus(status), { ok: true, errors: [] });
});

test('getDaemonStatus rejects invalid port values before creating a status contract', () => {
  assert.throws(
    () => getDaemonStatus({ port: 0 }),
    /daemon status port must be an integer between 1 and 65535/,
  );
});
