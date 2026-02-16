import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join, dirname, basename } from 'node:path';
import { homedir } from 'node:os';
import { execSync } from 'node:child_process';

// Static provider configs — inlined for compatibility with bundled/compiled builds
// where import.meta.url and filesystem scanning are unavailable.
import claudeConfig from './claude.json' with { type: 'json' };
import codexConfig from './codex.json' with { type: 'json' };

const PROVIDER_CONFIGS = {
  claude: claudeConfig,
  codex: codexConfig,
};

/**
 * List available provider IDs.
 */
export function listProviders() {
  return Object.keys(PROVIDER_CONFIGS);
}

/**
 * Load and parse a provider config by ID.
 */
export function loadProviderConfig(providerId) {
  const config = PROVIDER_CONFIGS[providerId];
  if (!config) {
    const available = listProviders().join(', ');
    throw new Error(`Unknown agent provider: ${providerId}. Available: ${available}`);
  }
  return config;
}

/**
 * Resolve the binary path for a provider config.
 * Checks each path in config.binary.resolvePaths (expanding ~ to homedir),
 * then falls back to `which` if configured.
 */
export function resolveProviderBinary(config) {
  const home = homedir();
  const arch = process.arch;

  for (const rawPath of config.binary.resolvePaths) {
    const resolved = rawPath
      .replace(/^~/, home)
      .replace(/\{arch\}/g, arch);
    if (existsSync(resolved)) {
      return resolved;
    }
  }

  if (config.binary.fallback === 'which') {
    try {
      return execSync(`which ${config.binary.name}`, { encoding: 'utf-8' }).trim();
    } catch {
      // which failed — binary not found
    }
  }

  return null;
}

/**
 * Resolve a model alias (e.g. "haiku") or full ID to the canonical model ID.
 * Returns the full ID if found, or the input string as-is if no match.
 */
export function resolveModel(config, aliasOrId) {
  if (!aliasOrId) return config.models.default;
  for (const m of config.models.available) {
    if (m.alias === aliasOrId || m.id === aliasOrId) return m.id;
  }
  return aliasOrId;
}

/**
 * Get the model definition object for an alias or ID.
 */
export function getModelDef(config, aliasOrId) {
  const id = resolveModel(config, aliasOrId);
  return config.models.available.find(m => m.id === id) || null;
}

/**
 * Build the full args array from a config and user-supplied options.
 * Expands base args and evaluates conditionals.
 */
export function buildArgs(config, options = {}) {
  const args = [];

  // Expand base args with template substitution
  for (const arg of config.headless.args.base) {
    args.push(expandTemplate(arg, options));
  }

  // Evaluate conditionals
  for (const cond of config.headless.args.conditionals) {
    const key = cond.if;
    if (options[key] == null) continue;

    for (const arg of cond.args) {
      const expanded = expandTemplate(arg, options);
      if (expanded !== arg || !arg.includes('{{')) {
        args.push(expanded);
      }
    }
  }

  return args;
}

/**
 * Get the args array for a given permission mode.
 */
export function getPermissionArgs(config, mode) {
  const modes = config.headless.permissionModes;
  if (!modes[mode]) {
    throw new Error(`Unknown permission mode: ${mode}. Available: ${Object.keys(modes).join(', ')}`);
  }
  return modes[mode];
}

/**
 * Build the environment object for spawning the agent process.
 * Merges headless.env with auth env vars pulled from the secrets map.
 */
export function buildEnv(config, secrets = {}) {
  const env = { ...config.headless.env };
  for (const key of config.headless.authEnvVars) {
    if (secrets[key]) env[key] = secrets[key];
  }
  return env;
}

/**
 * Get the args array for a given approval mode (codex-specific).
 * Returns null if the provider doesn't support approval modes.
 */
export function getApprovalArgs(config, mode) {
  const modes = config.headless.approvalModes;
  if (!modes) return null;
  if (!modes[mode]) {
    throw new Error(`Unknown approval mode: ${mode}. Available: ${Object.keys(modes).join(', ')}`);
  }
  return modes[mode];
}

/**
 * Build args for a subcommand (e.g. codex "resume" or "review").
 * Returns null if the provider doesn't support subcommands.
 */
export function buildSubcommandArgs(config, subcommand, options = {}) {
  const subs = config.headless.subcommands;
  if (!subs) return null;
  if (!subs[subcommand]) {
    throw new Error(`Unknown subcommand: ${subcommand}. Available: ${Object.keys(subs).join(', ')}`);
  }
  const sub = subs[subcommand];
  const args = [...sub.args];
  for (const cond of sub.conditionals) {
    const key = cond.if;
    if (options[key] == null) continue;
    for (const arg of cond.args) {
      args.push(expandTemplate(arg, options));
    }
  }
  return args;
}

/**
 * Check if a provider supports a given capability.
 */
export function hasCapability(config, name) {
  const val = config.capabilities[name];
  if (val == null) return false;
  if (typeof val === 'boolean') return val;
  if (typeof val === 'object') return true; // e.g. systemPrompt: { append, replace, fromFile }
  return !!val;
}

/**
 * Expand a single conditional from the provider config.
 * Returns the expanded args array, or [] if the conditional doesn't exist.
 * Use this instead of hardcoding CLI flags (e.g. '--mcp-config') that vary per provider.
 */
export function expandConditional(config, key, value) {
  const conditionals = config.headless.args.conditionals || [];
  const cond = conditionals.find(c => c.if === key);
  if (!cond) return [];
  const options = { [key]: value };
  return cond.args.map(arg => expandTemplate(arg, options));
}

/**
 * Expand a template string like "{{model}}" or "{{tools|join:,}}" with values from options.
 */
function expandTemplate(str, options) {
  return str.replace(/\{\{(\w+)(?:\|join:(.+?))?\}\}/g, (_, key, joinSep) => {
    const val = options[key];
    if (val == null) return '';
    if (Array.isArray(val) && joinSep != null) return val.join(joinSep);
    if (Array.isArray(val)) return val.join(' ');
    return String(val);
  });
}
