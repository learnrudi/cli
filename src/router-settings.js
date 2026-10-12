import fs from 'node:fs';
import path from 'node:path';

function invalid(detail) {
  // Never include user-supplied values: this file is non-secret configuration,
  // but a misplaced credential must not become an error message.
  throw new Error(`Invalid router-settings.json: ${detail}`);
}

function isObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function allowedKeys(value, keys) {
  return Object.keys(value).every((key) => keys.includes(key));
}

function validateEnvironment(env) {
  if (!isObject(env)) invalid('env must be an object');
  for (const [name, value] of Object.entries(env)) {
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)
      || typeof value !== 'string' || value.includes('\0')) {
      invalid('env requires valid variable names and string values without NUL bytes');
    }
  }
}

function validateTimeouts(timeouts) {
  if (!isObject(timeouts)) invalid('toolTimeoutMs must be an object');
  for (const [name, value] of Object.entries(timeouts)) {
    if (!name.trim() || /[\u0000-\u001f\u007f]/.test(name)
      || !Number.isSafeInteger(value) || value < 1 || value > 900000) {
      invalid('toolTimeoutMs requires tool names and integer milliseconds from 1 to 900000');
    }
  }
}

/** Local stdio-router settings live outside installer-owned stack metadata. */
export function loadRouterSettings(rudiHome) {
  const file = path.join(rudiHome, 'router-settings.json');
  let raw;
  try {
    if (fs.statSync(file).size > 1024 * 1024) invalid('file exceeds 1 MiB');
    raw = fs.readFileSync(file, 'utf8');
  } catch (error) {
    if (error.code === 'ENOENT') return {};
    if (error.message.startsWith('Invalid router-settings.json:')) throw error;
    throw new Error('Cannot read router-settings.json');
  }
  let settings;
  try {
    settings = JSON.parse(raw);
  } catch {
    invalid('expected valid JSON');
  }
  if (!isObject(settings) || settings.schemaVersion !== 1
    || !allowedKeys(settings, ['schemaVersion', 'stacks']) || !isObject(settings.stacks)) {
    invalid('expected schemaVersion 1 and a stacks object');
  }
  for (const [id, stack] of Object.entries(settings.stacks)) {
    if (!/^stack:[a-z0-9][a-z0-9_-]*$/.test(id) || !isObject(stack)
      || !allowedKeys(stack, ['env', 'toolTimeoutMs'])) {
      invalid('expected stack:<id> entries with supported settings');
    }
    if (Object.hasOwn(stack, 'env')) validateEnvironment(stack.env);
    if (Object.hasOwn(stack, 'toolTimeoutMs')) validateTimeouts(stack.toolTimeoutMs);
  }
  return settings.stacks;
}
