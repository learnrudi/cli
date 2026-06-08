import {
  IsoDateTimeSchema,
  JsonObjectSchema,
  deepFreezeSchema,
  validationResult,
} from './common.js';

export const CURRENT_RUN_GROUP_STATUSES = Object.freeze([
  'completed',
  'failed',
  'partial',
  'pending',
  'running',
  'stopped',
]);

export const TARGET_RUN_GROUP_STATUSES = Object.freeze([
  'completed',
  'failed',
  'partial',
  'queued',
  'running',
  'starting',
  'stopped',
  'stopping',
]);

export const RUN_GROUP_STATUSES = Object.freeze(
  Array.from(new Set([...CURRENT_RUN_GROUP_STATUSES, ...TARGET_RUN_GROUP_STATUSES])).sort(),
);

export const RUN_GROUP_TERMINAL_STATUSES = Object.freeze([
  'completed',
  'failed',
  'partial',
  'stopped',
]);

export const RUN_GROUP_EXECUTION_MODES = Object.freeze([
  'detached',
  'read_only',
  'shared_cwd',
  'worktree',
]);

export const RUN_GROUP_COORDINATION_MODES = Object.freeze([
  'dependency',
  'flat',
  'phased',
  'supervisor',
]);

export const RunGroupAggregateSchema = deepFreezeSchema({
  title: 'RunGroupAggregate',
  type: 'object',
  additionalProperties: false,
  required: ['sessionCount', 'completedCount', 'failedCount', 'totalCost', 'totalTokens'],
  properties: {
    sessionCount: { type: 'integer', minimum: 0 },
    completedCount: { type: 'integer', minimum: 0 },
    failedCount: { type: 'integer', minimum: 0 },
    totalCost: { type: 'number', minimum: 0 },
    totalTokens: { type: 'integer', minimum: 0 },
  },
});

export const RunGroupSchema = deepFreezeSchema({
  $id: 'https://schemas.rudi.dev/daemon/v1/run-group.schema.json',
  title: 'RunGroup',
  type: 'object',
  additionalProperties: false,
  required: ['id', 'status', 'executionMode', 'createdAt', 'sessionIds', 'errors', 'aggregate'],
  properties: {
    id: { type: 'string', minLength: 1 },
    name: { type: ['string', 'null'] },
    status: { type: 'string', enum: RUN_GROUP_STATUSES },
    cwd: { type: ['string', 'null'] },
    provider: { type: ['string', 'null'] },
    model: { type: ['string', 'null'] },
    executionMode: { type: 'string', enum: RUN_GROUP_EXECUTION_MODES },
    coordinationMode: { type: 'string', enum: RUN_GROUP_COORDINATION_MODES },
    createdAt: IsoDateTimeSchema,
    startedAt: { anyOf: [IsoDateTimeSchema, { type: 'null' }] },
    completedAt: { anyOf: [IsoDateTimeSchema, { type: 'null' }] },
    sessionIds: { type: 'array', items: { type: 'string' } },
    errors: { type: 'array', items: JsonObjectSchema },
    aggregate: RunGroupAggregateSchema,
  },
});

export function isRunGroupStatus(value) {
  return RUN_GROUP_STATUSES.includes(value);
}

export function isRunGroupTerminalStatus(value) {
  return RUN_GROUP_TERMINAL_STATUSES.includes(value);
}

export function validateRunGroupStatus(value) {
  const errors = [];
  if (!isRunGroupStatus(value)) {
    errors.push('status must be a known run-group status');
  }
  return validationResult(errors);
}
