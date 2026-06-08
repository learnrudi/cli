import {
  IsoDateTimeSchema,
  JsonObjectSchema,
  deepFreezeSchema,
  isPlainObject,
  validationResult,
} from './common.js';

export const TOOL_INDEX_CACHE_VERSION = 1;

export const TOOL_DESCRIPTOR_SOURCES = Object.freeze([
  'cache',
  'live',
  'manifest',
]);

export const CachedToolSchema = deepFreezeSchema({
  title: 'CachedTool',
  type: 'object',
  additionalProperties: false,
  required: ['name', 'description', 'inputSchema'],
  properties: {
    name: { type: 'string', minLength: 1 },
    description: { type: 'string' },
    inputSchema: JsonObjectSchema,
  },
});

export const StackToolIndexEntrySchema = deepFreezeSchema({
  title: 'StackToolIndexEntry',
  type: 'object',
  additionalProperties: false,
  required: ['indexedAt', 'tools', 'error'],
  properties: {
    indexedAt: IsoDateTimeSchema,
    tools: { type: 'array', items: CachedToolSchema },
    error: { type: ['string', 'null'] },
    missingSecrets: { type: 'array', items: { type: 'string' } },
  },
});

export const ToolIndexCacheSchema = deepFreezeSchema({
  $id: 'https://schemas.rudi.dev/daemon/v1/tool-index-cache.schema.json',
  title: 'ToolIndexCache',
  type: 'object',
  additionalProperties: false,
  required: ['version', 'updatedAt', 'byStack'],
  properties: {
    version: { const: TOOL_INDEX_CACHE_VERSION },
    updatedAt: IsoDateTimeSchema,
    byStack: {
      type: 'object',
      additionalProperties: StackToolIndexEntrySchema,
    },
  },
});

export const ToolDescriptorSchema = deepFreezeSchema({
  $id: 'https://schemas.rudi.dev/daemon/v1/tool-descriptor.schema.json',
  title: 'ToolDescriptor',
  type: 'object',
  additionalProperties: false,
  required: ['stackId', 'toolName', 'description', 'inputSchema', 'indexedAt', 'source'],
  properties: {
    stackId: { type: 'string', minLength: 1 },
    toolName: { type: 'string', minLength: 1 },
    description: { type: 'string' },
    inputSchema: JsonObjectSchema,
    indexedAt: IsoDateTimeSchema,
    source: { type: 'string', enum: TOOL_DESCRIPTOR_SOURCES },
  },
});

export const ToolIndexStatusSchema = deepFreezeSchema({
  $id: 'https://schemas.rudi.dev/daemon/v1/tool-index-status.schema.json',
  title: 'ToolIndexStatus',
  type: 'object',
  additionalProperties: false,
  required: ['version', 'updatedAt', 'stackCount', 'toolCount', 'failures'],
  properties: {
    version: { const: TOOL_INDEX_CACHE_VERSION },
    updatedAt: {
      anyOf: [IsoDateTimeSchema, { type: 'null' }],
    },
    stackCount: { type: 'integer', minimum: 0 },
    toolCount: { type: 'integer', minimum: 0 },
    failures: { type: 'array', items: JsonObjectSchema },
  },
});

export function createToolIndexCache(input = {}) {
  return {
    version: TOOL_INDEX_CACHE_VERSION,
    updatedAt: typeof input.updatedAt === 'string' && input.updatedAt.length > 0
      ? input.updatedAt
      : new Date().toISOString(),
    byStack: isPlainObject(input.byStack) ? input.byStack : {},
  };
}

export function validateToolIndexCache(value) {
  const errors = [];
  if (!isPlainObject(value)) {
    return validationResult(['tool index cache must be an object']);
  }
  if (value.version !== TOOL_INDEX_CACHE_VERSION) {
    errors.push(`version must be ${TOOL_INDEX_CACHE_VERSION}`);
  }
  if (typeof value.updatedAt !== 'string' || Number.isNaN(Date.parse(value.updatedAt))) {
    errors.push('updatedAt must be an ISO date-time string');
  }
  if (!isPlainObject(value.byStack)) {
    errors.push('byStack must be an object');
  } else {
    for (const [stackId, entry] of Object.entries(value.byStack)) {
      if (!stackId) errors.push('byStack keys must be non-empty stack IDs');
      if (!isPlainObject(entry)) {
        errors.push(`byStack.${stackId} must be an object`);
        continue;
      }
      if (!Array.isArray(entry.tools)) {
        errors.push(`byStack.${stackId}.tools must be an array`);
      }
      if (entry.error !== null && entry.error !== undefined && typeof entry.error !== 'string') {
        errors.push(`byStack.${stackId}.error must be string or null`);
      }
      if (entry.missingSecrets !== undefined && !Array.isArray(entry.missingSecrets)) {
        errors.push(`byStack.${stackId}.missingSecrets must be an array when present`);
      }
    }
  }
  return validationResult(errors);
}

export function validateToolIndexStatus(value) {
  const errors = [];
  if (!isPlainObject(value)) {
    return validationResult(['tool index status must be an object']);
  }
  if (value.version !== TOOL_INDEX_CACHE_VERSION) {
    errors.push(`version must be ${TOOL_INDEX_CACHE_VERSION}`);
  }
  if (value.updatedAt !== null && (
    typeof value.updatedAt !== 'string' || Number.isNaN(Date.parse(value.updatedAt))
  )) {
    errors.push('updatedAt must be an ISO date-time string or null');
  }
  if (!Number.isInteger(value.stackCount) || value.stackCount < 0) {
    errors.push('stackCount must be a non-negative integer');
  }
  if (!Number.isInteger(value.toolCount) || value.toolCount < 0) {
    errors.push('toolCount must be a non-negative integer');
  }
  if (!Array.isArray(value.failures)) {
    errors.push('failures must be an array');
  } else {
    for (const [index, failure] of value.failures.entries()) {
      if (!isPlainObject(failure)) {
        errors.push(`failures.${index} must be an object`);
      }
    }
  }
  return validationResult(errors);
}
