import {
  IsoDateTimeSchema,
  JsonObjectSchema,
  deepFreezeSchema,
  validationResult,
} from './common.js';

export const SESSION_PROVIDERS = Object.freeze([
  'claude',
  'codex',
  'gemini',
  'ollama',
]);

export const SESSION_STATUSES = Object.freeze([
  'active',
  'archived',
  'deleted',
]);

export const AGENT_SESSION_STATUSES = Object.freeze([
  'completed',
  'crashed',
  'error',
  'retrying',
  'running',
  'starting',
  'stopped',
]);

export const SESSION_EXECUTION_MODES = Object.freeze([
  'detached',
  'read_only',
  'shared_cwd',
  'worktree',
]);

export const AgentSessionSchema = deepFreezeSchema({
  $id: 'https://schemas.rudi.dev/daemon/v1/agent-session.schema.json',
  title: 'AgentSession',
  type: 'object',
  additionalProperties: false,
  required: ['id', 'provider', 'status', 'cwd', 'startedAt'],
  properties: {
    id: { type: 'string', minLength: 1 },
    provider: { type: 'string', enum: SESSION_PROVIDERS },
    model: { type: ['string', 'null'] },
    cwd: { type: ['string', 'null'] },
    status: { type: 'string', enum: AGENT_SESSION_STATUSES },
    pid: { type: ['integer', 'null'], minimum: 0 },
    startedAt: IsoDateTimeSchema,
    endedAt: { anyOf: [IsoDateTimeSchema, { type: 'null' }] },
    lastActivityAt: { anyOf: [IsoDateTimeSchema, { type: 'null' }] },
    permissionMode: { type: ['string', 'null'] },
    mcpConfig: JsonObjectSchema,
    cost: { type: 'number', minimum: 0 },
    turns: { type: 'integer', minimum: 0 },
    lastError: { type: ['string', 'null'] },
  },
});

export const SessionSummarySchema = deepFreezeSchema({
  $id: 'https://schemas.rudi.dev/daemon/v1/session-summary.schema.json',
  title: 'SessionSummary',
  type: 'object',
  additionalProperties: false,
  required: ['id', 'provider', 'status', 'createdAt', 'lastActiveAt'],
  properties: {
    id: { type: 'string', minLength: 1 },
    provider: { type: 'string', enum: SESSION_PROVIDERS },
    providerSessionId: { type: ['string', 'null'] },
    projectId: { type: ['string', 'null'] },
    runGroupId: { type: ['string', 'null'] },
    title: { type: ['string', 'null'] },
    snippet: { type: ['string', 'null'] },
    status: { type: 'string', enum: SESSION_STATUSES },
    model: { type: ['string', 'null'] },
    cwd: { type: ['string', 'null'] },
    projectPath: { type: ['string', 'null'] },
    createdAt: IsoDateTimeSchema,
    lastActiveAt: IsoDateTimeSchema,
    turnCount: { type: 'integer', minimum: 0 },
    totalCost: { type: 'number', minimum: 0 },
  },
});

export function isAgentSessionStatus(value) {
  return AGENT_SESSION_STATUSES.includes(value);
}

export function validateAgentSessionStatus(value) {
  const errors = [];
  if (!isAgentSessionStatus(value)) {
    errors.push('status must be a known agent session runtime status');
  }
  return validationResult(errors);
}
