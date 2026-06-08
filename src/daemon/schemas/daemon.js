import {
  IsoDateTimeSchema,
  JsonObjectSchema,
  deepFreezeSchema,
  isPlainObject,
  validationResult,
} from './common.js';

export const DAEMON_HEALTH_STATUSES = Object.freeze([
  'ok',
  'degraded',
  'unavailable',
]);

export const DAEMON_READINESS_STATUSES = Object.freeze([
  'ready',
  'not_ready',
]);

export const DaemonHealthSchema = deepFreezeSchema({
  $id: 'https://schemas.rudi.dev/daemon/v1/health.schema.json',
  title: 'DaemonHealth',
  type: 'object',
  additionalProperties: false,
  required: ['status', 'version'],
  properties: {
    status: {
      type: 'string',
      enum: DAEMON_HEALTH_STATUSES,
    },
    version: {
      type: 'string',
      minLength: 1,
    },
  },
});

export const DaemonReadinessSchema = deepFreezeSchema({
  $id: 'https://schemas.rudi.dev/daemon/v1/readiness.schema.json',
  title: 'DaemonReadiness',
  type: 'object',
  additionalProperties: false,
  required: ['status', 'ready', 'checks'],
  properties: {
    status: {
      type: 'string',
      enum: DAEMON_READINESS_STATUSES,
    },
    ready: { type: 'boolean' },
    checks: JsonObjectSchema,
  },
});

export const DaemonStatusSchema = deepFreezeSchema({
  $id: 'https://schemas.rudi.dev/daemon/v1/status.schema.json',
  title: 'DaemonStatus',
  type: 'object',
  additionalProperties: false,
  required: [
    'version',
    'pid',
    'port',
    'uptimeMs',
    'rudiHome',
    'platform',
    'runtime',
    'startedAt',
    'toolIndexStatus',
    'dbStatus',
    'packageCounts',
    'activeSessionCount',
    'activeJobCount',
  ],
  properties: {
    version: { type: 'string', minLength: 1 },
    pid: { type: 'integer', minimum: 0 },
    port: { type: 'integer', minimum: 1, maximum: 65535 },
    uptimeMs: { type: 'integer', minimum: 0 },
    rudiHome: { type: 'string', minLength: 1 },
    platform: { type: 'string', minLength: 1 },
    runtime: JsonObjectSchema,
    startedAt: IsoDateTimeSchema,
    toolIndexStatus: JsonObjectSchema,
    dbStatus: JsonObjectSchema,
    packageCounts: JsonObjectSchema,
    activeSessionCount: { type: 'integer', minimum: 0 },
    activeJobCount: { type: 'integer', minimum: 0 },
  },
});

export function validateDaemonHealth(value) {
  const errors = [];
  if (!isPlainObject(value)) {
    return validationResult(['daemon health must be an object']);
  }
  if (!DAEMON_HEALTH_STATUSES.includes(value.status)) {
    errors.push('status must be a known daemon health status');
  }
  if (typeof value.version !== 'string' || value.version.length === 0) {
    errors.push('version is required');
  }
  return validationResult(errors);
}

export function validateDaemonReadiness(value) {
  const errors = [];
  if (!isPlainObject(value)) {
    return validationResult(['daemon readiness must be an object']);
  }
  if (!DAEMON_READINESS_STATUSES.includes(value.status)) {
    errors.push('status must be a known daemon readiness status');
  }
  if (typeof value.ready !== 'boolean') {
    errors.push('ready must be boolean');
  }
  if (!isPlainObject(value.checks)) {
    errors.push('checks must be an object');
  }
  return validationResult(errors);
}

export function validateDaemonStatus(value) {
  const errors = [];
  if (!isPlainObject(value)) {
    return validationResult(['daemon status must be an object']);
  }

  for (const field of DaemonStatusSchema.required) {
    if (!Object.prototype.hasOwnProperty.call(value, field)) {
      errors.push(`${field} is required`);
    }
  }
  if (value.port !== undefined && (!Number.isInteger(value.port) || value.port < 1 || value.port > 65535)) {
    errors.push('port must be an integer between 1 and 65535');
  }
  if (value.activeSessionCount !== undefined && (!Number.isInteger(value.activeSessionCount) || value.activeSessionCount < 0)) {
    errors.push('activeSessionCount must be a non-negative integer');
  }
  if (value.activeJobCount !== undefined && (!Number.isInteger(value.activeJobCount) || value.activeJobCount < 0)) {
    errors.push('activeJobCount must be a non-negative integer');
  }
  return validationResult(errors);
}
