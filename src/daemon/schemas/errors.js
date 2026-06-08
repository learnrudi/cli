import {
  RequestIdSchema,
  deepFreezeSchema,
  isPlainObject,
  validationResult,
} from './common.js';

function defineErrorCode(code, status, defaultMessage, options = {}) {
  return deepFreezeSchema({
    code,
    status,
    defaultMessage,
    category: options.category || 'general',
    retryable: options.retryable === true,
  });
}

export const DAEMON_ERROR_CODES = deepFreezeSchema({
  BAD_REQUEST: defineErrorCode('BAD_REQUEST', 400, 'Bad request', { category: 'client' }),
  UNAUTHORIZED: defineErrorCode('UNAUTHORIZED', 401, 'Unauthorized', { category: 'auth' }),
  FORBIDDEN: defineErrorCode('FORBIDDEN', 403, 'Forbidden', { category: 'auth' }),
  NOT_FOUND: defineErrorCode('NOT_FOUND', 404, 'Not found', { category: 'client' }),
  REQUEST_TIMEOUT: defineErrorCode('REQUEST_TIMEOUT', 408, 'Request timed out', { category: 'timeout', retryable: true }),
  CONFLICT: defineErrorCode('CONFLICT', 409, 'Conflict', { category: 'state' }),
  GONE: defineErrorCode('GONE', 410, 'Resource no longer available', { category: 'state' }),
  REQUEST_TOO_LARGE: defineErrorCode('REQUEST_TOO_LARGE', 413, 'Request body too large', { category: 'client' }),
  RATE_LIMITED: defineErrorCode('RATE_LIMITED', 429, 'Rate limited', { category: 'backpressure', retryable: true }),
  INTERNAL_ERROR: defineErrorCode('INTERNAL_ERROR', 500, 'Internal server error', { category: 'server', retryable: true }),
  SERVICE_UNAVAILABLE: defineErrorCode('SERVICE_UNAVAILABLE', 503, 'Service unavailable', { category: 'dependency', retryable: true }),

  VALIDATION_ERROR: defineErrorCode('VALIDATION_ERROR', 400, 'Validation failed', { category: 'client' }),
  MISSING_REQUIRED_FIELD: defineErrorCode('MISSING_REQUIRED_FIELD', 400, 'Required field missing', { category: 'client' }),
  INVALID_FIELD: defineErrorCode('INVALID_FIELD', 400, 'Invalid field value', { category: 'client' }),
  DEPENDENCY_FAILURE: defineErrorCode('DEPENDENCY_FAILURE', 502, 'Dependency failed', { category: 'dependency', retryable: true }),
  OPERATION_TIMEOUT: defineErrorCode('OPERATION_TIMEOUT', 504, 'Operation timed out', { category: 'timeout', retryable: true }),
  STALE_STATE: defineErrorCode('STALE_STATE', 409, 'Resource state is stale', { category: 'state' }),

  DATABASE_NOT_INITIALIZED: defineErrorCode('DATABASE_NOT_INITIALIZED', 503, 'Database not initialized', { category: 'dependency', retryable: true }),
  SSE_CLIENT_CAP_REACHED: defineErrorCode('SSE_CLIENT_CAP_REACHED', 429, 'Too many SSE clients', { category: 'backpressure', retryable: true }),

  PROJECT_NOT_FOUND: defineErrorCode('PROJECT_NOT_FOUND', 404, 'Project not found', { category: 'client' }),
  PROJECT_ALREADY_EXISTS: defineErrorCode('PROJECT_ALREADY_EXISTS', 409, 'Project already exists', { category: 'state' }),

  NOTE_NOT_FOUND: defineErrorCode('NOTE_NOT_FOUND', 404, 'Note not found', { category: 'client' }),

  RUN_GROUP_NOT_FOUND: defineErrorCode('RUN_GROUP_NOT_FOUND', 404, 'Run group not found', { category: 'client' }),
});

export const DAEMON_ERROR_CODE_VALUES = Object.freeze(
  Object.values(DAEMON_ERROR_CODES)
    .map((definition) => definition.code)
    .sort(),
);

const ERROR_BY_CODE = new Map(
  Object.values(DAEMON_ERROR_CODES).map((definition) => [definition.code, definition]),
);

const DEFAULT_ERROR_BY_STATUS = new Map([
  [400, DAEMON_ERROR_CODES.BAD_REQUEST],
  [401, DAEMON_ERROR_CODES.UNAUTHORIZED],
  [403, DAEMON_ERROR_CODES.FORBIDDEN],
  [404, DAEMON_ERROR_CODES.NOT_FOUND],
  [408, DAEMON_ERROR_CODES.REQUEST_TIMEOUT],
  [409, DAEMON_ERROR_CODES.CONFLICT],
  [410, DAEMON_ERROR_CODES.GONE],
  [413, DAEMON_ERROR_CODES.REQUEST_TOO_LARGE],
  [429, DAEMON_ERROR_CODES.RATE_LIMITED],
  [500, DAEMON_ERROR_CODES.INTERNAL_ERROR],
  [502, DAEMON_ERROR_CODES.DEPENDENCY_FAILURE],
  [503, DAEMON_ERROR_CODES.SERVICE_UNAVAILABLE],
  [504, DAEMON_ERROR_CODES.OPERATION_TIMEOUT],
]);

export const DaemonErrorSchema = deepFreezeSchema({
  $id: 'https://schemas.rudi.dev/daemon/v1/error.schema.json',
  title: 'DaemonError',
  type: 'object',
  additionalProperties: false,
  required: ['code', 'message'],
  properties: {
    code: {
      type: 'string',
      enum: DAEMON_ERROR_CODE_VALUES,
    },
    message: {
      type: 'string',
      minLength: 1,
    },
    details: {
      description: 'Structured remediation or validation context. Must not contain secrets.',
    },
  },
});

export const FailureEnvelopeSchema = deepFreezeSchema({
  $id: 'https://schemas.rudi.dev/daemon/v1/failure-envelope.schema.json',
  title: 'DaemonFailureEnvelope',
  type: 'object',
  additionalProperties: false,
  required: ['ok', 'error'],
  properties: {
    ok: {
      const: false,
    },
    error: DaemonErrorSchema,
    requestId: RequestIdSchema,
  },
});

export function resolveDaemonErrorDefinition(input, fallbackStatus = 500) {
  if (!input) {
    return DEFAULT_ERROR_BY_STATUS.get(fallbackStatus) || DAEMON_ERROR_CODES.INTERNAL_ERROR;
  }

  if (typeof input === 'string') {
    return ERROR_BY_CODE.get(input)
      || DEFAULT_ERROR_BY_STATUS.get(fallbackStatus)
      || DAEMON_ERROR_CODES.INTERNAL_ERROR;
  }

  if (isPlainObject(input) && typeof input.code === 'string') {
    const status = Number.isInteger(input.status) ? input.status : fallbackStatus;
    return ERROR_BY_CODE.get(input.code)
      || DEFAULT_ERROR_BY_STATUS.get(status)
      || DAEMON_ERROR_CODES.INTERNAL_ERROR;
  }

  return DEFAULT_ERROR_BY_STATUS.get(fallbackStatus) || DAEMON_ERROR_CODES.INTERNAL_ERROR;
}

export function createFailureEnvelope(input = {}) {
  const definition = resolveDaemonErrorDefinition(input.code, input.status || 500);
  const error = {
    code: definition.code,
    message: typeof input.message === 'string' && input.message.length > 0
      ? input.message
      : definition.defaultMessage,
  };

  if (input.details !== undefined) {
    error.details = input.details;
  }

  const envelope = {
    ok: false,
    error,
  };

  if (typeof input.requestId === 'string' && input.requestId.length > 0) {
    envelope.requestId = input.requestId;
  }

  return envelope;
}

export function validateFailureEnvelope(value) {
  const errors = [];
  if (!isPlainObject(value)) {
    return validationResult(['envelope must be an object']);
  }
  if (value.ok !== false) {
    errors.push('ok must be false');
  }
  if (!isPlainObject(value.error)) {
    errors.push('error must be an object');
  } else {
    if (!DAEMON_ERROR_CODE_VALUES.includes(value.error.code)) {
      errors.push('error.code must be a stable daemon error code');
    }
    if (typeof value.error.message !== 'string' || value.error.message.length === 0) {
      errors.push('error.message is required');
    }
  }
  if (value.requestId !== undefined && (typeof value.requestId !== 'string' || value.requestId.length === 0)) {
    errors.push('requestId must be a non-empty string when present');
  }
  return validationResult(errors);
}
