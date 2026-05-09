function defineError(code, status, defaultMessage) {
  return Object.freeze({ code, status, defaultMessage });
}

export const SIDECAR_ERROR_CODES = Object.freeze({
  BAD_REQUEST: defineError('BAD_REQUEST', 400, 'Bad request'),
  UNAUTHORIZED: defineError('UNAUTHORIZED', 401, 'Unauthorized'),
  FORBIDDEN: defineError('FORBIDDEN', 403, 'Forbidden'),
  NOT_FOUND: defineError('NOT_FOUND', 404, 'Not found'),
  REQUEST_TIMEOUT: defineError('REQUEST_TIMEOUT', 408, 'Request timed out'),
  CONFLICT: defineError('CONFLICT', 409, 'Conflict'),
  GONE: defineError('GONE', 410, 'Resource no longer available'),
  REQUEST_TOO_LARGE: defineError('REQUEST_TOO_LARGE', 413, 'Request body too large'),
  RATE_LIMITED: defineError('RATE_LIMITED', 429, 'Rate limited'),
  INTERNAL_ERROR: defineError('INTERNAL_ERROR', 500, 'Internal server error'),
  SERVICE_UNAVAILABLE: defineError('SERVICE_UNAVAILABLE', 503, 'Service unavailable'),

  MISSING_REQUIRED_FIELD: defineError('MISSING_REQUIRED_FIELD', 400, 'Required field missing'),
  INVALID_FIELD: defineError('INVALID_FIELD', 400, 'Invalid field value'),

  DATABASE_NOT_INITIALIZED: defineError('DATABASE_NOT_INITIALIZED', 503, 'Database not initialized'),
  SSE_CLIENT_CAP_REACHED: defineError('SSE_CLIENT_CAP_REACHED', 429, 'Too many SSE clients'),

  PROJECT_NOT_FOUND: defineError('PROJECT_NOT_FOUND', 404, 'Project not found'),
  PROJECT_ALREADY_EXISTS: defineError('PROJECT_ALREADY_EXISTS', 409, 'Project already exists'),

  NOTE_NOT_FOUND: defineError('NOTE_NOT_FOUND', 404, 'Note not found'),

  RUN_GROUP_NOT_FOUND: defineError('RUN_GROUP_NOT_FOUND', 404, 'Run group not found'),
});

const DEFAULT_ERROR_CODE_BY_STATUS = Object.freeze({
  400: SIDECAR_ERROR_CODES.BAD_REQUEST,
  401: SIDECAR_ERROR_CODES.UNAUTHORIZED,
  403: SIDECAR_ERROR_CODES.FORBIDDEN,
  404: SIDECAR_ERROR_CODES.NOT_FOUND,
  408: SIDECAR_ERROR_CODES.REQUEST_TIMEOUT,
  409: SIDECAR_ERROR_CODES.CONFLICT,
  410: SIDECAR_ERROR_CODES.GONE,
  413: SIDECAR_ERROR_CODES.REQUEST_TOO_LARGE,
  429: SIDECAR_ERROR_CODES.RATE_LIMITED,
  500: SIDECAR_ERROR_CODES.INTERNAL_ERROR,
  503: SIDECAR_ERROR_CODES.SERVICE_UNAVAILABLE,
});

export function resolveSidecarErrorDefinition(input, fallbackStatus = 500) {
  if (!input) {
    return DEFAULT_ERROR_CODE_BY_STATUS[fallbackStatus] || null;
  }

  if (typeof input === 'string') {
    return SIDECAR_ERROR_CODES[input]
      || defineError(input, fallbackStatus, null);
  }

  if (typeof input === 'object' && typeof input.code === 'string') {
    return defineError(
      input.code,
      Number.isFinite(input.status) ? input.status : fallbackStatus,
      input.defaultMessage ?? null,
    );
  }

  return null;
}
