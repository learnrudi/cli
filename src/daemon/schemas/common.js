export const DAEMON_SCHEMA_NAMESPACE = 'io.rudi.daemon.v1';
export const DAEMON_SCHEMA_VERSION = '1.0.0';
export const DAEMON_SCHEMA_MAJOR = 1;
export const REQUEST_ID_HEADER = 'x-rudi-request-id';

export const HTTP_METHODS = Object.freeze([
  'DELETE',
  'GET',
  'PATCH',
  'POST',
  'PUT',
]);

export function deepFreezeSchema(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) {
    return value;
  }

  for (const child of Object.values(value)) {
    deepFreezeSchema(child);
  }
  return Object.freeze(value);
}

export function isPlainObject(value) {
  return Boolean(value)
    && typeof value === 'object'
    && !Array.isArray(value);
}

export function validationResult(errors) {
  return {
    ok: errors.length === 0,
    errors,
  };
}

export const RequestIdSchema = deepFreezeSchema({
  title: 'RequestId',
  type: 'string',
  minLength: 1,
  description: 'Opaque request correlation ID returned in x-rudi-request-id.',
});

export const IsoDateTimeSchema = deepFreezeSchema({
  title: 'IsoDateTime',
  type: 'string',
  format: 'date-time',
});

export const JsonObjectSchema = deepFreezeSchema({
  title: 'JsonObject',
  type: 'object',
  additionalProperties: true,
});

export const RequestContextSchema = deepFreezeSchema({
  $id: 'https://schemas.rudi.dev/daemon/v1/request-context.schema.json',
  title: 'DaemonRequestContext',
  type: 'object',
  additionalProperties: false,
  required: ['requestId', 'method', 'path', 'startedAt', 'caller', 'auth', 'client'],
  properties: {
    requestId: RequestIdSchema,
    method: {
      type: 'string',
      enum: HTTP_METHODS,
    },
    path: {
      type: 'string',
      minLength: 1,
    },
    startedAt: {
      type: 'integer',
      minimum: 0,
      description: 'Date.now() timestamp captured at request ingress.',
    },
    caller: JsonObjectSchema,
    auth: JsonObjectSchema,
    client: JsonObjectSchema,
  },
});

export const SuccessEnvelopeSchema = deepFreezeSchema({
  $id: 'https://schemas.rudi.dev/daemon/v1/success-envelope.schema.json',
  title: 'DaemonSuccessEnvelope',
  type: 'object',
  additionalProperties: false,
  required: ['ok', 'data'],
  properties: {
    ok: {
      const: true,
    },
    data: {
      description: 'Operation result payload. Shape is defined by the operation schema.',
    },
  },
});

export function createSuccessEnvelope(data) {
  return {
    ok: true,
    data,
  };
}

export function validateSuccessEnvelope(value) {
  const errors = [];
  if (!isPlainObject(value)) {
    return validationResult(['envelope must be an object']);
  }
  if (value.ok !== true) {
    errors.push('ok must be true');
  }
  if (!Object.prototype.hasOwnProperty.call(value, 'data')) {
    errors.push('data is required');
  }
  return validationResult(errors);
}

export function createRequestContext(input = {}) {
  const now = Number.isInteger(input.startedAt) && input.startedAt >= 0
    ? input.startedAt
    : Date.now();

  return {
    requestId: typeof input.requestId === 'string' && input.requestId.length > 0
      ? input.requestId
      : `req_${now}`,
    method: HTTP_METHODS.includes(input.method) ? input.method : 'GET',
    path: typeof input.path === 'string' && input.path.length > 0 ? input.path : '/',
    startedAt: now,
    caller: isPlainObject(input.caller) ? input.caller : {},
    auth: isPlainObject(input.auth) ? input.auth : { required: true, result: 'unknown' },
    client: isPlainObject(input.client) ? input.client : {},
  };
}

export function validateRequestContext(value) {
  const errors = [];
  if (!isPlainObject(value)) {
    return validationResult(['request context must be an object']);
  }
  if (typeof value.requestId !== 'string' || value.requestId.length === 0) {
    errors.push('requestId is required');
  }
  if (!HTTP_METHODS.includes(value.method)) {
    errors.push('method must be a supported HTTP method');
  }
  if (typeof value.path !== 'string' || value.path.length === 0 || !value.path.startsWith('/')) {
    errors.push('path must be an absolute HTTP path');
  }
  if (!Number.isInteger(value.startedAt) || value.startedAt < 0) {
    errors.push('startedAt must be a non-negative integer');
  }
  if (!isPlainObject(value.caller)) {
    errors.push('caller must be an object');
  }
  if (!isPlainObject(value.auth)) {
    errors.push('auth must be an object');
  }
  if (!isPlainObject(value.client)) {
    errors.push('client must be an object');
  }
  return validationResult(errors);
}
