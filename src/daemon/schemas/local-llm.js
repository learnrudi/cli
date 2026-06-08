import {
  JsonObjectSchema,
  deepFreezeSchema,
  isPlainObject,
  validationResult,
} from './common.js';

export const LOCAL_LLM_PROVIDER_FAMILIES = Object.freeze([
  'openai_compatible',
  'unknown',
]);

export const LocalLlmRuntimeStatusSchema = deepFreezeSchema({
  $id: 'https://schemas.rudi.dev/daemon/v1/local-llm-runtime-status.schema.json',
  title: 'LocalLlmRuntimeStatus',
  type: 'object',
  additionalProperties: false,
  required: [
    'runtime',
    'providerFamily',
    'target',
    'consumer',
    'consumerContext',
    'baseUrl',
    'healthUrl',
    'apiKeyPolicy',
    'available',
    'statusCode',
    'models',
    'error',
  ],
  properties: {
    runtime: { type: 'string', minLength: 1 },
    providerFamily: { type: 'string', enum: LOCAL_LLM_PROVIDER_FAMILIES },
    target: { type: 'string', minLength: 1 },
    consumer: { type: ['string', 'null'] },
    consumerContext: { type: 'string', minLength: 1 },
    baseUrl: { type: 'string', minLength: 1 },
    healthUrl: { type: 'string', minLength: 1 },
    apiKeyPolicy: { type: 'string', minLength: 1 },
    available: { type: 'boolean' },
    statusCode: { type: ['integer', 'null'], minimum: 100, maximum: 599 },
    models: { type: 'array', items: { type: 'string' } },
    error: { type: ['string', 'null'] },
  },
});

export const LocalLlmEnvExportSchema = deepFreezeSchema({
  $id: 'https://schemas.rudi.dev/daemon/v1/local-llm-env-export.schema.json',
  title: 'LocalLlmEnvExport',
  type: 'object',
  additionalProperties: false,
  required: [
    'runtime',
    'providerFamily',
    'target',
    'consumer',
    'consumerContext',
    'baseUrl',
    'env',
  ],
  properties: {
    runtime: { type: 'string', minLength: 1 },
    providerFamily: { type: 'string', enum: LOCAL_LLM_PROVIDER_FAMILIES },
    target: { type: 'string', minLength: 1 },
    consumer: { type: 'string', minLength: 1 },
    consumerContext: { type: 'string', minLength: 1 },
    baseUrl: { type: 'string', minLength: 1 },
    env: JsonObjectSchema,
  },
});

function hasString(value, field) {
  return typeof value[field] === 'string' && value[field].length > 0;
}

function validateProviderFamily(value, errors) {
  if (!LOCAL_LLM_PROVIDER_FAMILIES.includes(value.providerFamily)) {
    errors.push('providerFamily must be a known local LLM provider family');
  }
}

function validateStringMap(value, field, errors) {
  if (!isPlainObject(value[field])) {
    errors.push(`${field} must be an object`);
    return;
  }
  for (const [key, entry] of Object.entries(value[field])) {
    if (typeof key !== 'string' || key.length === 0 || typeof entry !== 'string') {
      errors.push(`${field} must contain string keys and values`);
      return;
    }
  }
}

export function validateLocalLlmRuntimeStatus(value) {
  const errors = [];
  if (!isPlainObject(value)) {
    return validationResult(['local LLM runtime status must be an object']);
  }

  for (const field of LocalLlmRuntimeStatusSchema.required) {
    if (!Object.prototype.hasOwnProperty.call(value, field)) {
      errors.push(`${field} is required`);
    }
  }
  for (const field of ['runtime', 'target', 'consumerContext', 'baseUrl', 'healthUrl', 'apiKeyPolicy']) {
    if (value[field] !== undefined && !hasString(value, field)) {
      errors.push(`${field} must be a non-empty string`);
    }
  }
  validateProviderFamily(value, errors);
  if (value.consumer !== null && value.consumer !== undefined && typeof value.consumer !== 'string') {
    errors.push('consumer must be a string or null');
  }
  if (value.available !== undefined && typeof value.available !== 'boolean') {
    errors.push('available must be boolean');
  }
  if (
    value.statusCode !== null
    && value.statusCode !== undefined
    && (!Number.isInteger(value.statusCode) || value.statusCode < 100 || value.statusCode > 599)
  ) {
    errors.push('statusCode must be null or an HTTP status code');
  }
  if (value.models !== undefined && (!Array.isArray(value.models) || value.models.some(model => typeof model !== 'string'))) {
    errors.push('models must be an array of strings');
  }
  if (value.error !== null && value.error !== undefined && typeof value.error !== 'string') {
    errors.push('error must be a string or null');
  }

  return validationResult(errors);
}

export function validateLocalLlmEnvExport(value) {
  const errors = [];
  if (!isPlainObject(value)) {
    return validationResult(['local LLM env export must be an object']);
  }

  for (const field of LocalLlmEnvExportSchema.required) {
    if (!Object.prototype.hasOwnProperty.call(value, field)) {
      errors.push(`${field} is required`);
    }
  }
  for (const field of ['runtime', 'target', 'consumer', 'consumerContext', 'baseUrl']) {
    if (value[field] !== undefined && !hasString(value, field)) {
      errors.push(`${field} must be a non-empty string`);
    }
  }
  validateProviderFamily(value, errors);
  if (value.env !== undefined) {
    validateStringMap(value, 'env', errors);
  }

  return validationResult(errors);
}
