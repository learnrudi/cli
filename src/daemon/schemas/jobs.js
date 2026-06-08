import {
  IsoDateTimeSchema,
  JsonObjectSchema,
  deepFreezeSchema,
  validationResult,
} from './common.js';

export const JOB_TYPES = Object.freeze([
  'artifact_register',
  'package_install',
  'session_repair',
  'tool_index_all',
  'tool_index_stack',
]);

export const JOB_STATUSES = Object.freeze([
  'cancelled',
  'completed',
  'failed',
  'queued',
  'running',
]);

export const JOB_TERMINAL_STATUSES = Object.freeze([
  'cancelled',
  'completed',
  'failed',
]);

export const LEGACY_PACKAGE_INSTALL_ACK_STATUSES = Object.freeze([
  'started',
]);

export const JobSchema = deepFreezeSchema({
  $id: 'https://schemas.rudi.dev/daemon/v1/job.schema.json',
  title: 'DaemonJob',
  type: 'object',
  additionalProperties: false,
  required: ['id', 'type', 'status', 'input', 'createdAt', 'attempts', 'maxAttempts'],
  properties: {
    id: { type: 'string', minLength: 1 },
    type: { type: 'string', enum: JOB_TYPES },
    status: { type: 'string', enum: JOB_STATUSES },
    input: JsonObjectSchema,
    result: JsonObjectSchema,
    error: {
      anyOf: [JsonObjectSchema, { type: 'string' }, { type: 'null' }],
    },
    createdAt: IsoDateTimeSchema,
    startedAt: { anyOf: [IsoDateTimeSchema, { type: 'null' }] },
    finishedAt: { anyOf: [IsoDateTimeSchema, { type: 'null' }] },
    attempts: { type: 'integer', minimum: 0 },
    maxAttempts: { type: 'integer', minimum: 1 },
    idempotencyKey: { type: ['string', 'null'] },
  },
});

export function isJobStatus(value) {
  return JOB_STATUSES.includes(value);
}

export function isJobTerminalStatus(value) {
  return JOB_TERMINAL_STATUSES.includes(value);
}

export function validateJobStatus(value) {
  const errors = [];
  if (!isJobStatus(value)) {
    errors.push('status must be a known job status');
  }
  return validationResult(errors);
}
