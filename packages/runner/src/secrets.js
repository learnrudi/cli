/**
 * Secrets management for RUDI runners
 * Handles loading, validating, and redacting secrets
 */

import {
  loadSecrets as loadSharedSecrets,
  saveSecrets as saveSharedSecrets
} from '@learnrudi/secrets';

/**
 * @typedef {Object} SecretDefinition
 * @property {string} name - Secret name
 * @property {boolean} [required] - Whether required
 * @property {string} [description] - Description
 * @property {string} [link] - Setup URL
 * @property {string} [hint] - Value hint
 */

/**
 * Load secrets from storage
 * @returns {Object} Secrets object (name -> value)
 */
export function loadSecrets() {
  return loadSharedSecrets();
}

/**
 * Save secrets to storage
 * @param {Object} secrets - Secrets object
 */
export function saveSecrets(secrets) {
  saveSharedSecrets(secrets);
}

/**
 * Get secrets for a stack run
 * @param {(string | SecretDefinition)[]} required - Required secret names or definitions
 * @returns {Promise<Object>} Secrets object (name -> value)
 */
export async function getSecrets(required) {
  const allSecrets = loadSecrets();
  const result = {};

  for (const req of required || []) {
    const name = typeof req === 'string' ? req : req.name;
    const isRequired = typeof req === 'string' ? true : req.required !== false;

    if (allSecrets[name]) {
      result[name] = allSecrets[name];
    } else if (isRequired) {
      throw new Error(`Missing required secret: ${name}`);
    }
  }

  return result;
}

/**
 * Check if all required secrets are available
 * @param {(string | SecretDefinition)[]} required
 * @returns {{ satisfied: boolean, missing: string[] }}
 */
export function checkSecrets(required) {
  const allSecrets = loadSecrets();
  const missing = [];

  for (const req of required || []) {
    const name = typeof req === 'string' ? req : req.name;
    const isRequired = typeof req === 'string' ? true : req.required !== false;

    if (isRequired && !allSecrets[name]) {
      missing.push(name);
    }
  }

  return {
    satisfied: missing.length === 0,
    missing
  };
}

/**
 * Set a secret
 * @param {string} name - Secret name
 * @param {string} value - Secret value
 */
export function setSecret(name, value) {
  const secrets = loadSecrets();
  secrets[name] = value;
  saveSecrets(secrets);
}

/**
 * Remove a secret
 * @param {string} name - Secret name
 */
export function removeSecret(name) {
  const secrets = loadSecrets();
  delete secrets[name];
  saveSecrets(secrets);
}

/**
 * List all secret names (not values)
 * @returns {string[]}
 */
export function listSecretNames() {
  const secrets = loadSecrets();
  return Object.keys(secrets).sort();
}

/**
 * Get masked secret values for display
 * @returns {Object} Object with masked values
 */
export function getMaskedSecrets() {
  const secrets = loadSecrets();
  const masked = {};

  for (const [name, value] of Object.entries(secrets)) {
    if (typeof value === 'string' && value.length > 8) {
      masked[name] = value.slice(0, 4) + '...' + value.slice(-4);
    } else {
      masked[name] = '***';
    }
  }

  return masked;
}

/**
 * Redact secrets from a string (for logging)
 * @param {string} text - Text to redact
 * @param {Object} [secrets] - Secrets to redact (defaults to all)
 * @returns {string} Redacted text
 */
export function redactSecrets(text, secrets) {
  const allSecrets = secrets || loadSecrets();

  let result = text;

  for (const value of Object.values(allSecrets)) {
    if (typeof value === 'string' && value.length > 3) {
      // Escape special regex characters
      const escaped = value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      result = result.replace(new RegExp(escaped, 'g'), '[REDACTED]');
    }
  }

  return result;
}

/**
 * Import secrets from environment variables
 * @param {string[]} names - Secret names to import
 * @returns {number} Number of secrets imported
 */
export function importFromEnv(names) {
  const secrets = loadSecrets();
  let imported = 0;

  for (const name of names) {
    if (process.env[name] && !secrets[name]) {
      secrets[name] = process.env[name];
      imported++;
    }
  }

  if (imported > 0) {
    saveSecrets(secrets);
  }

  return imported;
}

/**
 * Export secrets to environment format
 * @returns {string} Export commands
 */
export function exportToEnv() {
  const secrets = loadSecrets();
  const lines = [];

  for (const [name, value] of Object.entries(secrets)) {
    // Escape single quotes in value
    const escaped = String(value).replace(/'/g, "'\\''");
    lines.push(`export ${name}='${escaped}'`);
  }

  return lines.join('\n');
}

/**
 * Validate a secret value format
 * @param {string} name - Secret name
 * @param {string} value - Secret value
 * @param {string} [hint] - Expected format hint
 * @returns {{ valid: boolean, error?: string }}
 */
export function validateSecretFormat(name, value, hint) {
  if (!value || value.trim() === '') {
    return { valid: false, error: 'Secret value cannot be empty' };
  }

  // Check common patterns
  if (hint) {
    const hintLower = hint.toLowerCase();

    if (hintLower.includes('starts with')) {
      const match = hint.match(/starts with ['"]?([^'"]+)['"]?/i);
      if (match && !value.startsWith(match[1])) {
        return { valid: false, error: `Expected value starting with '${match[1]}'` };
      }
    }
  }

  return { valid: true };
}
