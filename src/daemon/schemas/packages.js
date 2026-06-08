import {
  IsoDateTimeSchema,
  JsonObjectSchema,
  deepFreezeSchema,
  isPlainObject,
  validationResult,
} from './common.js';

export const PACKAGE_KINDS = Object.freeze([
  'agent',
  'binary',
  'prompt',
  'runtime',
  'skill',
  'stack',
  'tool',
  'workflow',
]);

export const PACKAGE_ROUTE_KINDS = Object.freeze([
  'agent',
  'binary',
  'prompt',
  'runtime',
  'stack',
]);

export const PACKAGE_SOURCES = Object.freeze([
  'bundled',
  'local',
  'registry',
]);

export const PACKAGE_STATUSES = Object.freeze([
  'broken',
  'disabled',
  'installed',
]);

export const PACKAGE_PROBLEM_CODES = Object.freeze([
  'index_failed',
  'install_failed',
  'invalid_manifest',
  'launch_missing',
  'missing_manifest',
  'missing_runtime',
  'missing_secret',
]);

export const PackageDescriptorSchema = deepFreezeSchema({
  $id: 'https://schemas.rudi.dev/daemon/v1/package-descriptor.schema.json',
  title: 'PackageDescriptor',
  type: 'object',
  additionalProperties: false,
  required: ['id', 'kind', 'name'],
  properties: {
    id: { type: 'string', minLength: 1 },
    kind: { type: 'string', enum: PACKAGE_KINDS },
    name: { type: 'string', minLength: 1 },
    description: { type: 'string' },
    version: { type: ['string', 'null'] },
    category: { type: ['string', 'null'] },
    tags: { type: 'array', items: { type: 'string' } },
    requires: JsonObjectSchema,
  },
});

export const PackageProblemSchema = deepFreezeSchema({
  title: 'PackageProblem',
  type: 'object',
  additionalProperties: false,
  required: ['code', 'message'],
  properties: {
    code: { type: 'string', enum: PACKAGE_PROBLEM_CODES },
    message: { type: 'string', minLength: 1 },
    details: JsonObjectSchema,
  },
});

export const PackageStatusSchema = deepFreezeSchema({
  $id: 'https://schemas.rudi.dev/daemon/v1/package-status.schema.json',
  title: 'PackageStatus',
  type: 'object',
  additionalProperties: false,
  required: ['id', 'kind', 'name', 'installed', 'secrets', 'problems'],
  properties: {
    id: { type: 'string', minLength: 1 },
    kind: { type: 'string', enum: PACKAGE_KINDS },
    name: { type: 'string', minLength: 1 },
    version: { type: ['string', 'null'] },
    installed: { type: 'boolean' },
    path: { type: ['string', 'null'] },
    manifestPath: { type: ['string', 'null'] },
    runtime: { type: ['string', 'null'] },
    secrets: { type: 'array', items: JsonObjectSchema },
    mcp: JsonObjectSchema,
    lastIndexedAt: {
      anyOf: [IsoDateTimeSchema, { type: 'null' }],
    },
    toolCount: { type: 'integer', minimum: 0 },
    problems: { type: 'array', items: PackageProblemSchema },
  },
});

export function normalizePackageId(value) {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  if (trimmed.includes(':')) return trimmed;
  return null;
}

export function validatePackageStatus(value) {
  const errors = [];
  if (!isPlainObject(value)) {
    return validationResult(['package status must be an object']);
  }
  for (const field of PackageStatusSchema.required) {
    if (!Object.prototype.hasOwnProperty.call(value, field)) {
      errors.push(`${field} is required`);
    }
  }
  if (value.kind !== undefined && !PACKAGE_KINDS.includes(value.kind)) {
    errors.push('kind must be a known package kind');
  }
  if (value.installed !== undefined && typeof value.installed !== 'boolean') {
    errors.push('installed must be boolean');
  }
  if (value.problems !== undefined && !Array.isArray(value.problems)) {
    errors.push('problems must be an array');
  }
  return validationResult(errors);
}
