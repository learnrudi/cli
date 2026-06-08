import {
  IsoDateTimeSchema,
  deepFreezeSchema,
  isPlainObject,
  validationResult,
} from './common.js';

export const SECRET_NAME_PATTERN = '^[A-Z][A-Z0-9_]*$';
export const SECRET_NAME_RE = new RegExp(SECRET_NAME_PATTERN);

export const SECRET_SOURCES = Object.freeze([
  'env',
  'keychain',
  'secrets.json',
  'unknown',
]);

export const SecretStatusSchema = deepFreezeSchema({
  $id: 'https://schemas.rudi.dev/daemon/v1/secret-status.schema.json',
  title: 'SecretStatus',
  type: 'object',
  additionalProperties: false,
  required: ['name', 'configured', 'requiredFor', 'optionalFor', 'source'],
  properties: {
    name: {
      type: 'string',
      pattern: SECRET_NAME_PATTERN,
    },
    configured: { type: 'boolean' },
    requiredFor: { type: 'array', items: { type: 'string' } },
    optionalFor: { type: 'array', items: { type: 'string' } },
    source: { type: 'string', enum: SECRET_SOURCES },
    lastCheckedAt: {
      anyOf: [IsoDateTimeSchema, { type: 'null' }],
    },
  },
});

export function validateSecretName(value) {
  const errors = [];
  if (typeof value !== 'string' || value.length === 0) {
    errors.push('secret name is required');
  } else if (!SECRET_NAME_RE.test(value)) {
    errors.push('secret name must be UPPER_SNAKE_CASE');
  }
  return validationResult(errors);
}

export function validateSecretStatus(value) {
  const errors = [];
  if (!isPlainObject(value)) {
    return validationResult(['secret status must be an object']);
  }

  const nameValidation = validateSecretName(value.name);
  errors.push(...nameValidation.errors);

  if (typeof value.configured !== 'boolean') {
    errors.push('configured must be a boolean');
  }
  if (!Array.isArray(value.requiredFor) || value.requiredFor.some(item => typeof item !== 'string')) {
    errors.push('requiredFor must be an array of strings');
  }
  if (!Array.isArray(value.optionalFor) || value.optionalFor.some(item => typeof item !== 'string')) {
    errors.push('optionalFor must be an array of strings');
  }
  if (!SECRET_SOURCES.includes(value.source)) {
    errors.push(`source must be one of: ${SECRET_SOURCES.join(', ')}`);
  }
  if (value.lastCheckedAt !== undefined && value.lastCheckedAt !== null && (
    typeof value.lastCheckedAt !== 'string' || Number.isNaN(Date.parse(value.lastCheckedAt))
  )) {
    errors.push('lastCheckedAt must be an ISO date-time string or null');
  }

  return validationResult(errors);
}
