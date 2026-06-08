import {
  indexAllStacks,
  readToolIndex,
} from '@learnrudi/core';

import {
  TOOL_DESCRIPTOR_SOURCES,
  TOOL_INDEX_CACHE_VERSION,
  isPlainObject,
  validateToolIndexCache,
  validateToolIndexStatus,
} from '../schemas/index.js';

const defaultDependencies = Object.freeze({
  indexAllStacks,
  readToolIndex,
});

function isIsoDateTime(value) {
  return typeof value === 'string' && !Number.isNaN(Date.parse(value));
}

function requireValidToolIndexCache(index) {
  const validation = validateToolIndexCache(index);
  if (!validation.ok) {
    throw new Error(`tool index cache failed schema validation: ${validation.errors.join('; ')}`);
  }
  return index;
}

function requireValidToolIndexStatus(status) {
  const validation = validateToolIndexStatus(status);
  if (!validation.ok) {
    throw new Error(`tool index status failed schema validation: ${validation.errors.join('; ')}`);
  }
  return status;
}

function normalizeRebuildOptions(options) {
  const normalized = {};
  if (Array.isArray(options.stacks)) {
    normalized.stacks = options.stacks;
  }
  if (typeof options.log === 'function') {
    normalized.log = options.log;
  }
  if (options.timeout !== undefined) {
    normalized.timeout = options.timeout;
  }
  return normalized;
}

function normalizeMissingSecrets(value) {
  return Array.isArray(value) ? value.filter(secret => typeof secret === 'string') : [];
}

function normalizeToolDescriptor(stackId, entry, tool, source, fallbackIndexedAt) {
  if (!isPlainObject(tool) || typeof tool.name !== 'string' || tool.name.length === 0) {
    return null;
  }

  const indexedAt = isIsoDateTime(entry.indexedAt)
    ? entry.indexedAt
    : fallbackIndexedAt;

  return {
    stackId,
    toolName: tool.name,
    description: typeof tool.description === 'string' ? tool.description : tool.name,
    inputSchema: isPlainObject(tool.inputSchema)
      ? tool.inputSchema
      : { type: 'object', properties: {} },
    indexedAt,
    source,
  };
}

export function readToolIndexCache(options = {}, dependencies = defaultDependencies) {
  const index = dependencies.readToolIndex();
  if (!index) return null;
  if (options.validate === false) return index;
  return requireValidToolIndexCache(index);
}

export function getToolIndexStatus(options = {}, dependencies = defaultDependencies) {
  const index = Object.prototype.hasOwnProperty.call(options, 'index')
    ? options.index
    : readToolIndexCache({ validate: options.validate }, dependencies);

  if (index && options.validate !== false) {
    requireValidToolIndexCache(index);
  }

  const byStack = isPlainObject(index?.byStack) ? index.byStack : {};
  const failures = [];
  let toolCount = 0;

  for (const [stackId, entry] of Object.entries(byStack)) {
    if (!isPlainObject(entry)) {
      failures.push({ stackId, error: 'Invalid tool index entry', missingSecrets: [] });
      continue;
    }

    const tools = Array.isArray(entry.tools) ? entry.tools : [];
    const missingSecrets = normalizeMissingSecrets(entry.missingSecrets);
    toolCount += tools.length;

    if (typeof entry.error === 'string' || missingSecrets.length > 0) {
      failures.push({
        stackId,
        error: typeof entry.error === 'string' ? entry.error : null,
        missingSecrets,
      });
    }
  }

  return requireValidToolIndexStatus({
    version: TOOL_INDEX_CACHE_VERSION,
    updatedAt: isIsoDateTime(index?.updatedAt) ? index.updatedAt : null,
    stackCount: Object.keys(byStack).length,
    toolCount,
    failures,
  });
}

export function listToolDescriptors(index, options = {}) {
  if (!index) return [];
  if (options.validate !== false) {
    requireValidToolIndexCache(index);
  }

  const source = TOOL_DESCRIPTOR_SOURCES.includes(options.source) ? options.source : 'cache';
  const byStack = isPlainObject(index.byStack) ? index.byStack : {};
  const fallbackIndexedAt = isIsoDateTime(index.updatedAt)
    ? index.updatedAt
    : new Date(0).toISOString();
  const descriptors = [];

  for (const [stackId, entry] of Object.entries(byStack)) {
    if (!isPlainObject(entry) || !Array.isArray(entry.tools)) continue;
    for (const tool of entry.tools) {
      const descriptor = normalizeToolDescriptor(
        stackId,
        entry,
        tool,
        source,
        fallbackIndexedAt,
      );
      if (descriptor) {
        descriptors.push(descriptor);
      }
    }
  }

  return descriptors;
}

export async function rebuildToolIndex(options = {}, dependencies = defaultDependencies) {
  const result = await dependencies.indexAllStacks(normalizeRebuildOptions(options));
  if (options.validate !== false) {
    requireValidToolIndexCache(result?.index);
  }
  return result;
}

export async function rebuildStackToolIndex(stackId, options = {}, dependencies = defaultDependencies) {
  const normalizedStackId = typeof stackId === 'string' ? stackId.trim() : '';
  if (!normalizedStackId) {
    throw new Error('stackId is required to rebuild a stack tool index');
  }

  return rebuildToolIndex({
    ...options,
    stacks: [normalizedStackId],
  }, dependencies);
}
