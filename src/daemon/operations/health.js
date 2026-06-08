import os from 'node:os';

import { PATHS } from '@learnrudi/env';

import {
  DAEMON_HEALTH_STATUSES,
  DAEMON_READINESS_STATUSES,
  validateDaemonHealth,
  validateDaemonReadiness,
  validateDaemonStatus,
} from '../schemas/index.js';

function requireValidResult(name, result, validation) {
  if (!validation.ok) {
    throw new Error(`${name} failed schema validation: ${validation.errors.join('; ')}`);
  }
  return result;
}

function normalizeIsoDateTime(value, fallbackMs) {
  if (typeof value === 'string' && !Number.isNaN(Date.parse(value))) {
    return value;
  }
  return new Date(fallbackMs).toISOString();
}

function normalizeNonNegativeInteger(value, fallback = 0) {
  if (Number.isInteger(value) && value >= 0) {
    return value;
  }
  return fallback;
}

function normalizePort(value) {
  if (!Number.isInteger(value) || value < 1 || value > 65535) {
    throw new Error('daemon status port must be an integer between 1 and 65535');
  }
  return value;
}

export function getHealth(options = {}) {
  const status = DAEMON_HEALTH_STATUSES.includes(options.status)
    ? options.status
    : 'ok';
  const result = {
    status,
    version: typeof options.version === 'string' && options.version.length > 0
      ? options.version
      : 'unknown',
  };

  return requireValidResult('daemon health', result, validateDaemonHealth(result));
}

export function getReadiness(options = {}) {
  const checks = options.checks && typeof options.checks === 'object' && !Array.isArray(options.checks)
    ? options.checks
    : {};
  const ready = Object.values(checks).every((check) => {
    if (check === true) return true;
    if (check && typeof check === 'object') {
      return check.ready === true || check.status === 'ok' || check.status === 'ready';
    }
    return false;
  });
  const result = {
    status: ready ? 'ready' : 'not_ready',
    ready,
    checks,
  };

  if (!DAEMON_READINESS_STATUSES.includes(result.status)) {
    throw new Error('daemon readiness produced an unknown status');
  }

  return requireValidResult('daemon readiness', result, validateDaemonReadiness(result));
}

export function getDaemonStatus(options = {}) {
  const nowMs = normalizeNonNegativeInteger(options.nowMs, Date.now());
  const startedAtMs = normalizeNonNegativeInteger(options.startedAtMs, nowMs);
  const uptimeMs = normalizeNonNegativeInteger(options.uptimeMs, Math.max(0, nowMs - startedAtMs));

  const result = {
    version: typeof options.version === 'string' && options.version.length > 0
      ? options.version
      : 'unknown',
    pid: normalizeNonNegativeInteger(options.pid, process.pid),
    port: normalizePort(options.port),
    uptimeMs,
    rudiHome: typeof options.rudiHome === 'string' && options.rudiHome.length > 0
      ? options.rudiHome
      : PATHS.home,
    platform: typeof options.platform === 'string' && options.platform.length > 0
      ? options.platform
      : os.platform(),
    runtime: options.runtime && typeof options.runtime === 'object' && !Array.isArray(options.runtime)
      ? options.runtime
      : {
          name: 'node',
          version: process.version,
        },
    startedAt: normalizeIsoDateTime(options.startedAt, startedAtMs),
    toolIndexStatus: options.toolIndexStatus && typeof options.toolIndexStatus === 'object' && !Array.isArray(options.toolIndexStatus)
      ? options.toolIndexStatus
      : { status: 'unknown' },
    dbStatus: options.dbStatus && typeof options.dbStatus === 'object' && !Array.isArray(options.dbStatus)
      ? options.dbStatus
      : { status: 'unknown' },
    packageCounts: options.packageCounts && typeof options.packageCounts === 'object' && !Array.isArray(options.packageCounts)
      ? options.packageCounts
      : {},
    activeSessionCount: normalizeNonNegativeInteger(options.activeSessionCount, 0),
    activeJobCount: normalizeNonNegativeInteger(options.activeJobCount, 0),
  };

  return requireValidResult('daemon status', result, validateDaemonStatus(result));
}
