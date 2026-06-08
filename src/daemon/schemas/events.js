import crypto from 'node:crypto';

import {
  IsoDateTimeSchema,
  deepFreezeSchema,
  isPlainObject,
  validationResult,
} from './common.js';

export const DAEMON_EVENT_VERSION = 1;

export const DAEMON_EVENT_TYPES = Object.freeze({
  DAEMON_STATUS_CHANGED: 'daemon.status.changed',
  PACKAGE_INSTALL_PROGRESS: 'package.install.progress',
  PACKAGE_INSTALL_COMPLETED: 'package.install.completed',
  TOOL_INDEX_REBUILT: 'tool_index.rebuilt',
  AGENT_SESSION_UPDATED: 'agent_session.updated',
  RUN_GROUP_UPDATED: 'run_group.updated',
  JOB_UPDATED: 'job.updated',
  ARTIFACT_CREATED: 'artifact.created',
});

export const DAEMON_EVENT_TYPE_VALUES = Object.freeze(
  Object.values(DAEMON_EVENT_TYPES).sort(),
);

export const EventResourceSchema = deepFreezeSchema({
  title: 'DaemonEventResource',
  type: 'object',
  additionalProperties: false,
  required: ['kind', 'id'],
  properties: {
    kind: {
      type: 'string',
      minLength: 1,
    },
    id: {
      type: 'string',
      minLength: 1,
    },
  },
});

export const EventEnvelopeSchema = deepFreezeSchema({
  $id: 'https://schemas.rudi.dev/daemon/v1/event-envelope.schema.json',
  title: 'DaemonEventEnvelope',
  type: 'object',
  additionalProperties: false,
  required: ['type', 'id', 'ts', 'version', 'resource', 'data'],
  properties: {
    type: {
      type: 'string',
      enum: DAEMON_EVENT_TYPE_VALUES,
    },
    id: {
      type: 'string',
      minLength: 1,
    },
    ts: IsoDateTimeSchema,
    version: {
      type: 'integer',
      minimum: 1,
    },
    resource: EventResourceSchema,
    data: {
      type: 'object',
      additionalProperties: true,
    },
  },
});

function generateEventId() {
  if (typeof crypto.randomUUID === 'function') {
    return `evt_${crypto.randomUUID()}`;
  }
  return `evt_${crypto.randomBytes(16).toString('hex')}`;
}

export function createDaemonEvent(input = {}) {
  if (!DAEMON_EVENT_TYPE_VALUES.includes(input.type)) {
    throw new Error('daemon event type must be a known DAEMON_EVENT_TYPES value');
  }
  if (!isPlainObject(input.resource)) {
    throw new Error('daemon event resource is required');
  }
  if (typeof input.resource.kind !== 'string' || input.resource.kind.length === 0) {
    throw new Error('daemon event resource.kind is required');
  }
  if (typeof input.resource.id !== 'string' || input.resource.id.length === 0) {
    throw new Error('daemon event resource.id is required');
  }

  return {
    type: input.type,
    id: typeof input.id === 'string' && input.id.length > 0 ? input.id : generateEventId(),
    ts: typeof input.ts === 'string' && input.ts.length > 0 ? input.ts : new Date().toISOString(),
    version: Number.isInteger(input.version) && input.version > 0
      ? input.version
      : DAEMON_EVENT_VERSION,
    resource: {
      kind: input.resource.kind,
      id: input.resource.id,
    },
    data: isPlainObject(input.data) ? input.data : {},
  };
}

export function validateDaemonEventEnvelope(value) {
  const errors = [];
  if (!isPlainObject(value)) {
    return validationResult(['event envelope must be an object']);
  }
  if (!DAEMON_EVENT_TYPE_VALUES.includes(value.type)) {
    errors.push('type must be a known daemon event type');
  }
  if (typeof value.id !== 'string' || value.id.length === 0) {
    errors.push('id is required');
  }
  if (typeof value.ts !== 'string' || Number.isNaN(Date.parse(value.ts))) {
    errors.push('ts must be an ISO date-time string');
  }
  if (!Number.isInteger(value.version) || value.version < 1) {
    errors.push('version must be an integer >= 1');
  }
  if (!isPlainObject(value.resource)) {
    errors.push('resource must be an object');
  } else {
    if (typeof value.resource.kind !== 'string' || value.resource.kind.length === 0) {
      errors.push('resource.kind is required');
    }
    if (typeof value.resource.id !== 'string' || value.resource.id.length === 0) {
      errors.push('resource.id is required');
    }
  }
  if (!isPlainObject(value.data)) {
    errors.push('data must be an object');
  }
  return validationResult(errors);
}
