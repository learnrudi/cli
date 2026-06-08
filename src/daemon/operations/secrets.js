import { readRudiConfig } from '@learnrudi/core';
import {
  getMaskedSecrets,
  getStorageInfo,
} from '@learnrudi/secrets';

import {
  SECRET_NAME_RE,
  SECRET_SOURCES,
  isPlainObject,
  validateSecretName,
  validateSecretStatus,
} from '../schemas/index.js';

const defaultDependencies = Object.freeze({
  getMaskedSecrets,
  getStorageInfo,
  readRudiConfig,
});

function requireValidSecretStatus(status) {
  const validation = validateSecretStatus(status);
  if (!validation.ok) {
    throw new Error(`secret status failed schema validation: ${validation.errors.join('; ')}`);
  }
  return status;
}

function normalizeSource(source) {
  if (source === 'file') return 'secrets.json';
  return SECRET_SOURCES.includes(source) ? source : null;
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
    if (typeof name === 'string' && name.length > 0) {
      return {
        name,
        required: secret.required !== false,
      };
    }
  }
  return null;
}

function addRequirement(requirements, name, stackId, required) {
  if (!SECRET_NAME_RE.test(name) || typeof stackId !== 'string' || stackId.length === 0) return;
  if (!requirements.has(name)) {
    requirements.set(name, {
      requiredFor: new Set(),
      optionalFor: new Set(),
    });
  }

  const requirement = requirements.get(name);
  if (required) {
    requirement.requiredFor.add(stackId);
  } else {
    requirement.optionalFor.add(stackId);
  }
}

function collectRequirements(config) {
  const requirements = new Map();
  for (const [stackId, stackConfig] of Object.entries(config?.stacks || {})) {
    for (const rawSecret of Array.isArray(stackConfig?.secrets) ? stackConfig.secrets : []) {
      const secret = normalizeSecretDefinition(rawSecret);
      if (!secret) continue;
      addRequirement(requirements, secret.name, stackId, secret.required);
    }
  }
  return requirements;
}

function collectSecretNames(config, maskedSecrets, requirements) {
  const names = new Set();
  for (const name of Object.keys(config?.secrets || {})) {
    if (SECRET_NAME_RE.test(name)) names.add(name);
  }
  for (const name of Object.keys(maskedSecrets || {})) {
    if (SECRET_NAME_RE.test(name)) names.add(name);
  }
  for (const name of requirements.keys()) {
    names.add(name);
  }
  return [...names].sort();
}

function sourceForSecret(name, metadata, maskedSecrets, storageInfo) {
  const providerSource = normalizeSource(metadata?.provider);
  if (providerSource) return providerSource;
  if (Object.prototype.hasOwnProperty.call(maskedSecrets, name)) {
    return normalizeSource(storageInfo?.backend) || 'unknown';
  }
  return 'unknown';
}

function configuredForSecret(name, metadata, maskedSecrets, env) {
  if (metadata?.provider === 'env') {
    return typeof env?.[name] === 'string' && env[name].length > 0;
  }
  if (!Object.prototype.hasOwnProperty.call(maskedSecrets, name)) {
    return false;
  }
  return maskedSecrets[name] !== '(pending)';
}

export async function listMaskedSecrets(dependencies = defaultDependencies) {
  return dependencies.getMaskedSecrets();
}

export function createSecretStatus(name, options = {}) {
  const nameValidation = validateSecretName(name);
  if (!nameValidation.ok) {
    throw new Error(nameValidation.errors.join('; '));
  }

  const maskedSecrets = isPlainObject(options.maskedSecrets) ? options.maskedSecrets : {};
  const metadata = isPlainObject(options.metadata) ? options.metadata : {};
  const requirements = isPlainObject(options.requirements) ? options.requirements : {};
  const requiredFor = Array.isArray(options.requiredFor)
    ? options.requiredFor
    : [...(requirements.requiredFor || [])].sort();
  const optionalFor = Array.isArray(options.optionalFor)
    ? options.optionalFor
    : [...(requirements.optionalFor || [])].sort();

  return requireValidSecretStatus({
    name,
    configured: configuredForSecret(name, metadata, maskedSecrets, options.env || process.env),
    requiredFor,
    optionalFor,
    source: sourceForSecret(name, metadata, maskedSecrets, options.storageInfo || {}),
    lastCheckedAt: typeof options.checkedAt === 'string' ? options.checkedAt : new Date().toISOString(),
  });
}

export async function listSecretStatuses(options = {}, dependencies = defaultDependencies) {
  const config = Object.prototype.hasOwnProperty.call(options, 'config')
    ? options.config
    : dependencies.readRudiConfig();
  const maskedSecrets = Object.prototype.hasOwnProperty.call(options, 'maskedSecrets')
    ? options.maskedSecrets
    : await dependencies.getMaskedSecrets();
  const storageInfo = Object.prototype.hasOwnProperty.call(options, 'storageInfo')
    ? options.storageInfo
    : dependencies.getStorageInfo();
  const requirements = collectRequirements(config);

  return collectSecretNames(config, maskedSecrets, requirements).map(name => (
    createSecretStatus(name, {
      checkedAt: options.checkedAt,
      env: options.env,
      maskedSecrets,
      metadata: config?.secrets?.[name],
      requirements: requirements.get(name),
      storageInfo,
    })
  ));
}

export async function getSecretsReadiness(options = {}, dependencies = defaultDependencies) {
  const statuses = await listSecretStatuses(options, dependencies);
  const configuredCount = statuses.filter(status => status.configured).length;
  const missingRequired = statuses
    .filter(status => !status.configured && status.requiredFor.length > 0)
    .map(status => status.name);

  return {
    ready: missingRequired.length === 0,
    total: statuses.length,
    configured: configuredCount,
    pending: statuses.length - configuredCount,
    missingRequired,
    statuses,
  };
}
