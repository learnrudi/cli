import path from 'node:path';

import {
  PACKAGE_KINDS,
  PACKAGE_PROBLEM_CODES,
  PACKAGE_ROUTE_KINDS,
  validatePackageStatus,
} from '../schemas/index.js';

function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function requireValidPackageStatus(status) {
  const validation = validatePackageStatus(status);
  if (!validation.ok) {
    throw new Error(`package status failed schema validation: ${validation.errors.join('; ')}`);
  }
  return status;
}

function normalizeSecretDefinition(secret) {
  if (typeof secret === 'string') {
    return {
      name: secret,
      required: true,
    };
  }
  if (isPlainObject(secret)) {
    const name = typeof secret.name === 'string' ? secret.name : secret.key;
    if (typeof name !== 'string' || name.length === 0) return null;
    return {
      name,
      required: secret.required !== false,
    };
  }
  return null;
}

function stackNameFromId(stackId) {
  if (typeof stackId !== 'string') return null;
  const trimmed = stackId.trim();
  if (!trimmed) return null;
  const colonIndex = trimmed.indexOf(':');
  return colonIndex >= 0 ? trimmed.slice(colonIndex + 1) : trimmed;
}

function normalizeStackPackageId(stackId) {
  const name = stackNameFromId(stackId);
  return name ? `stack:${name}` : null;
}

function addProblem(problems, code, message, details = undefined) {
  if (!PACKAGE_PROBLEM_CODES.includes(code)) {
    throw new Error(`unknown package problem code: ${code}`);
  }
  const problem = { code, message };
  if (details !== undefined) {
    problem.details = details;
  }
  problems.push(problem);
}

export function normalizePackageKind(rawKind, options = {}) {
  const kind = typeof rawKind === 'string' ? rawKind.trim() : '';
  if (!kind) return null;
  const allowed = options.routeOnly === false ? PACKAGE_KINDS : PACKAGE_ROUTE_KINDS;
  return allowed.includes(kind) ? kind : null;
}

export function projectPackageDescriptor(pkg, fallbackKind = null) {
  const kind = pkg?.kind || fallbackKind || null;
  return {
    id: pkg?.id || (kind && pkg?.name ? `${kind}:${pkg.name}` : null),
    kind,
    name: pkg?.name || null,
    description: pkg?.description || '',
    version: pkg?.version || null,
    category: pkg?.category || null,
    tags: Array.isArray(pkg?.tags) ? pkg.tags : [],
    requires: pkg?.requires || null,
  };
}

export function listInstalledStackSummaries(config) {
  const stacks = {};
  for (const [stackId, stackConfig] of Object.entries(config?.stacks || {})) {
    stacks[stackId] = {
      version: stackConfig.version || null,
      installedAt: stackConfig.installedAt || null,
      secrets: Array.isArray(stackConfig.secrets) ? stackConfig.secrets : [],
    };
  }
  return stacks;
}

export function createStackPackageStatus(stackId, stackConfig = {}, options = {}) {
  const id = normalizeStackPackageId(stackId);
  const name = stackNameFromId(stackId);
  const toolIndexEntry = options.toolIndex?.byStack?.[stackId] || options.toolIndex?.byStack?.[name] || null;
  const secretConfig = isPlainObject(options.secretConfig) ? options.secretConfig : {};
  const secrets = [];
  const missingRequiredSecrets = [];

  for (const rawSecret of Array.isArray(stackConfig.secrets) ? stackConfig.secrets : []) {
    const secret = normalizeSecretDefinition(rawSecret);
    if (!secret) continue;
    const configured = secretConfig[secret.name]?.configured === true;
    secrets.push({
      name: secret.name,
      required: secret.required,
      configured,
      source: secretConfig[secret.name]?.provider || 'unknown',
    });
    if (secret.required && !configured) {
      missingRequiredSecrets.push(secret.name);
    }
  }

  const problems = [];
  if (missingRequiredSecrets.length > 0) {
    addProblem(
      problems,
      'missing_secret',
      `Missing required secrets: ${missingRequiredSecrets.join(', ')}`,
      { secrets: missingRequiredSecrets },
    );
  }
  if (toolIndexEntry?.error) {
    addProblem(problems, 'index_failed', toolIndexEntry.error);
  }
  if (Array.isArray(toolIndexEntry?.missingSecrets) && toolIndexEntry.missingSecrets.length > 0) {
    addProblem(
      problems,
      'missing_secret',
      `Tool index missing secrets: ${toolIndexEntry.missingSecrets.join(', ')}`,
      { secrets: toolIndexEntry.missingSecrets },
    );
  }
  if (!stackConfig.launch) {
    addProblem(problems, 'launch_missing', 'Stack launch configuration is missing');
  }

  const manifestPath = typeof stackConfig.path === 'string' && stackConfig.path.length > 0
    ? path.join(stackConfig.path, 'manifest.json')
    : null;

  return requireValidPackageStatus({
    id,
    kind: 'stack',
    name,
    version: stackConfig.version || null,
    installed: stackConfig.installed !== false,
    path: stackConfig.path || null,
    manifestPath,
    runtime: stackConfig.runtime || null,
    secrets,
    mcp: {
      launch: stackConfig.launch || null,
    },
    lastIndexedAt: toolIndexEntry?.indexedAt || null,
    toolCount: Array.isArray(toolIndexEntry?.tools) ? toolIndexEntry.tools.length : 0,
    problems,
  });
}

export function listInstalledPackageStatuses(config, options = {}) {
  return Object.entries(config?.stacks || {}).map(([stackId, stackConfig]) => (
    createStackPackageStatus(stackId, stackConfig, {
      toolIndex: options.toolIndex || null,
      secretConfig: config?.secrets || {},
    })
  ));
}
