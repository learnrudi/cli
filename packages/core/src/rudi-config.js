/**
 * @learnrudi/core/rudi-config
 *
 * RUDI Configuration Schema + Atomic Read/Write Helpers
 *
 * Single source of truth for all installed stacks, runtimes, binaries.
 * This file is read by the router MCP server at runtime.
 *
 * Key design decisions:
 * - File permissions: 0600 (no world-readable to avoid leaking tool metadata)
 * - Atomic writes: write to .tmp then rename (avoid corruption)
 * - Unified launch config: router doesn't guess how to spawn
 * - Cached tool index: fast tools/list without spawning all stacks
 */

import * as fs from 'fs';
import * as path from 'path';
import { RUDI_HOME, PATHS, getPlatform } from '@learnrudi/env';

// =============================================================================
// SCHEMA TYPES (JSDoc for runtime validation hints)
// =============================================================================

/**
 * @typedef {Object} LaunchConfig
 * @property {string} bin - Binary to execute (node, python, npx, etc.)
 * @property {string[]} args - Arguments including entry point
 * @property {string} [cwd] - Working directory (defaults to stack path)
 */

/**
 * @typedef {Object} SecretRef
 * @property {string} name - Secret name (e.g., SLACK_BOT_TOKEN)
 * @property {boolean} required - Whether this secret is required
 */

/**
 * @typedef {Object} CachedTool
 * @property {string} name - Tool name (without namespace prefix)
 * @property {string} description - Tool description
 * @property {Object} inputSchema - JSON Schema for tool inputs
 */

/**
 * @typedef {Object} StackConfig
 * @property {string} path - Absolute path to installed stack
 * @property {'node' | 'python' | 'deno' | 'bun'} runtime - Runtime type
 * @property {LaunchConfig} launch - Normalized launch configuration
 * @property {SecretRef[]} secrets - Required/optional secrets
 * @property {CachedTool[]} [tools] - Cached tool definitions (populated by `rudi index`)
 * @property {boolean} installed - Whether stack is installed
 * @property {string} installedAt - ISO timestamp
 * @property {string} [version] - Stack version
 */

/**
 * @typedef {Object} RuntimeConfig
 * @property {string} path - Path to runtime directory
 * @property {string} bin - Path to main binary (e.g., bin/node)
 * @property {string} version - Runtime version
 */

/**
 * @typedef {Object} BinaryConfig
 * @property {string} path - Path to binary directory
 * @property {string} bin - Path to executable
 * @property {string} version - Binary version
 * @property {boolean} installed - Whether binary is installed
 * @property {string} installedAt - ISO timestamp
 */

/**
 * @typedef {Object} SecretMetadata
 * @property {boolean} configured - Whether secret has a value
 * @property {'keychain' | 'secrets.json' | 'vault' | 'env'} provider - Where secret is stored
 * @property {string} [stack] - Which stack requires this secret
 * @property {boolean} required - Whether secret is required
 * @property {string} [lastUpdated] - ISO timestamp of last update
 */

/**
 * @typedef {Object} RudiConfig
 * @property {'1.0.0'} version - Config version
 * @property {number} schemaVersion - Schema version for migrations
 * @property {boolean} installed - Whether RUDI is fully initialized
 * @property {string} installedAt - ISO timestamp
 * @property {string} updatedAt - ISO timestamp of last update
 * @property {Object.<string, RuntimeConfig>} runtimes - Installed runtimes
 * @property {Object.<string, StackConfig>} stacks - Installed stacks
 * @property {Object.<string, BinaryConfig>} binaries - Installed binaries
 * @property {Object.<string, SecretMetadata>} secrets - Secret metadata
 */

// =============================================================================
// PATHS
// =============================================================================

const RUDI_JSON_PATH = path.join(RUDI_HOME, 'rudi.json');
const RUDI_JSON_TMP = path.join(RUDI_HOME, 'rudi.json.tmp');
const RUDI_JSON_LOCK = path.join(RUDI_HOME, 'rudi.json.lock');

// File permissions
const CONFIG_MODE = 0o600; // Owner read/write only
const LOCK_TIMEOUT_MS = 5000; // Max time to wait for lock

// =============================================================================
// FACTORY
// =============================================================================

/**
 * Create a new empty RudiConfig
 * @returns {RudiConfig}
 */
export function createRudiConfig() {
  const now = new Date().toISOString();
  return {
    version: '1.0.0',
    schemaVersion: 1,
    installed: false,
    installedAt: now,
    updatedAt: now,
    runtimes: {},
    stacks: {},
    binaries: {},
    secrets: {}
  };
}

/**
 * Create a LaunchConfig from manifest command array
 * @param {string[]} command - Command array from manifest (e.g., ["npx", "tsx", "src/index.ts"])
 * @param {string} runtime - Runtime type ('node', 'python', or 'binary')
 * @param {string} stackPath - Absolute path to stack directory
 * @returns {LaunchConfig}
 */
export function createLaunchConfig(command, runtime, stackPath) {
  // Binary runtime: command[0] is relative path within stack directory
  if (runtime === 'binary') {
    if (!command || command.length === 0) {
      throw new Error('Binary runtime requires a command');
    }
    const bin = command[0].replace(/^\.\//, '');
    const binaryPath = path.isAbsolute(command[0]) ? command[0] : path.join(stackPath, bin);
    return { bin: binaryPath, args: command.slice(1), cwd: stackPath };
  }

  if (!command || command.length === 0) {
    // Default based on runtime
    if (runtime === 'python') {
      return {
        bin: getDefaultRuntimeBin('python'),
        args: ['-u', 'src/server.py'],
        cwd: stackPath
      };
    }
    return {
      bin: getDefaultRuntimeBin('node'),
      args: ['dist/index.js'],
      cwd: stackPath
    };
  }

  // Parse command array into bin + args
  const [bin, ...args] = command;

  // Resolve bin to bundled runtime if it's a runtime command
  let resolvedBin = bin;
  if (bin === 'node' || bin === 'python' || bin === 'python3') {
    resolvedBin = getDefaultRuntimeBin(bin === 'python3' ? 'python' : bin);
  } else if (bin === 'npx') {
    // npx uses bundled node's npx
    resolvedBin = getDefaultNpxBin();
  }

  return {
    bin: resolvedBin,
    args,
    cwd: stackPath
  };
}

/**
 * Get default runtime binary path
 * @param {'node' | 'python'} runtime
 * @returns {string}
 */
export function getDefaultRuntimeBin(runtime) {
  const platform = getPlatform();

  if (runtime === 'node') {
    return platform === 'win32'
      ? path.join(PATHS.runtimes, 'node', 'node.exe')
      : path.join(PATHS.runtimes, 'node', 'bin', 'node');
  }

  if (runtime === 'python') {
    return platform === 'win32'
      ? path.join(PATHS.runtimes, 'python', 'python.exe')
      : path.join(PATHS.runtimes, 'python', 'bin', 'python3');
  }

  return runtime;
}

/**
 * Get default npx binary path
 * @returns {string}
 */
export function getDefaultNpxBin() {
  const platform = getPlatform();
  return platform === 'win32'
    ? path.join(PATHS.runtimes, 'node', 'npx.cmd')
    : path.join(PATHS.runtimes, 'node', 'bin', 'npx');
}

// =============================================================================
// LOCKING (Simple file-based lock)
// =============================================================================

/**
 * Acquire lock for rudi.json writes
 * @param {number} [timeoutMs=5000] - Max time to wait
 * @returns {boolean} Whether lock was acquired
 */
function acquireLock(timeoutMs = LOCK_TIMEOUT_MS) {
  const startTime = Date.now();

  while (Date.now() - startTime < timeoutMs) {
    try {
      // O_EXCL fails if file exists
      fs.writeFileSync(RUDI_JSON_LOCK, String(process.pid), { flag: 'wx' });
      return true;
    } catch (err) {
      if (err.code === 'EEXIST') {
        // Check if holding process is still alive
        try {
          const pid = parseInt(fs.readFileSync(RUDI_JSON_LOCK, 'utf-8'), 10);
          try {
            process.kill(pid, 0); // Test if process exists
          } catch {
            // Process doesn't exist, stale lock
            fs.unlinkSync(RUDI_JSON_LOCK);
            continue;
          }
        } catch {
          // Can't read lock file, try again
        }

        // Wait 50ms and retry
        const delay = Math.min(50, timeoutMs - (Date.now() - startTime));
        if (delay > 0) {
          Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, delay);
        }
      } else {
        throw err;
      }
    }
  }

  return false;
}

/**
 * Release lock
 */
function releaseLock() {
  try {
    fs.unlinkSync(RUDI_JSON_LOCK);
  } catch {
    // Ignore errors releasing lock
  }
}

// =============================================================================
// READ / WRITE
// =============================================================================

/**
 * Check if rudi.json exists
 * @returns {boolean}
 */
export function rudiConfigExists() {
  return fs.existsSync(RUDI_JSON_PATH);
}

/**
 * Read rudi.json
 * @returns {RudiConfig | null}
 */
export function readRudiConfig() {
  try {
    const content = fs.readFileSync(RUDI_JSON_PATH, 'utf-8');
    return JSON.parse(content);
  } catch (err) {
    if (err.code === 'ENOENT') {
      return null;
    }
    throw new Error(`Failed to read rudi.json: ${err.message}`);
  }
}

/**
 * Write rudi.json atomically
 * @param {RudiConfig} config
 * @throws {Error} If lock cannot be acquired or write fails
 */
export function writeRudiConfig(config) {
  // Update timestamp
  config.updatedAt = new Date().toISOString();

  // Acquire lock
  if (!acquireLock()) {
    throw new Error('Failed to acquire lock for rudi.json (another process may be writing)');
  }

  try {
    // Write to temp file
    const content = JSON.stringify(config, null, 2);
    fs.writeFileSync(RUDI_JSON_TMP, content, { mode: CONFIG_MODE });

    // Atomic rename
    fs.renameSync(RUDI_JSON_TMP, RUDI_JSON_PATH);

    // Ensure permissions (rename may not preserve them on some systems)
    fs.chmodSync(RUDI_JSON_PATH, CONFIG_MODE);
  } finally {
    releaseLock();
  }
}

/**
 * Initialize rudi.json if it doesn't exist
 * @returns {RudiConfig} The config (existing or newly created)
 */
export function initRudiConfig() {
  if (rudiConfigExists()) {
    return readRudiConfig();
  }

  const config = createRudiConfig();
  writeRudiConfig(config);
  return config;
}

/**
 * Update rudi.json with a modifier function
 * @param {(config: RudiConfig) => void} modifier - Function that modifies config in place
 * @returns {RudiConfig} The updated config
 */
export function updateRudiConfig(modifier) {
  const config = readRudiConfig() || createRudiConfig();
  modifier(config);
  writeRudiConfig(config);
  return config;
}

// =============================================================================
// STACK HELPERS
// =============================================================================

/**
 * Add or update a stack in the config
 * @param {string} stackId - Stack identifier (e.g., 'slack')
 * @param {Object} stackInfo - Stack information from manifest
 * @param {string} stackInfo.path - Absolute path to stack
 * @param {string} stackInfo.runtime - Runtime type
 * @param {string[]} stackInfo.command - Command array from manifest
 * @param {Array<string | {name?: string, key?: string, required?: boolean}>} [stackInfo.secrets] - Required secrets
 * @param {string} [stackInfo.version] - Stack version
 */
export function addStack(stackId, stackInfo) {
  updateRudiConfig(config => {
    const launch = createLaunchConfig(
      stackInfo.command,
      stackInfo.runtime || 'node',
      stackInfo.path
    );

    const secrets = (stackInfo.secrets || [])
      .map(s => {
        const name = typeof s === 'string' ? s : (s?.name || s?.key);
        if (!name) return null;
        return {
          name,
          required: typeof s === 'object' ? s.required !== false : true
        };
      })
      .filter(Boolean);

    config.stacks[stackId] = {
      path: stackInfo.path,
      runtime: stackInfo.runtime || 'node',
      launch,
      secrets,
      installed: true,
      installedAt: new Date().toISOString(),
      version: stackInfo.version
    };

    // Add secret metadata
    for (const secret of secrets) {
      if (!config.secrets[secret.name]) {
        config.secrets[secret.name] = {
          configured: false,
          provider: getDefaultSecretProvider(),
          stack: stackId,
          required: secret.required
        };
      }
    }
  });
}

/**
 * Remove a stack from the config
 * @param {string} stackId
 */
export function removeStack(stackId) {
  updateRudiConfig(config => {
    delete config.stacks[stackId];

    // Remove orphaned secret metadata
    for (const [secretName, meta] of Object.entries(config.secrets)) {
      if (meta.stack === stackId) {
        // Check if any other stack needs this secret
        const stillNeeded = Object.values(config.stacks).some(stack =>
          (stack.secrets || []).some(s => {
            const name = typeof s === 'string' ? s : (s?.name || s?.key);
            return name === secretName;
          })
        );
        if (!stillNeeded) {
          delete config.secrets[secretName];
        }
      }
    }
  });
}

/**
 * Update cached tools for a stack
 * @param {string} stackId
 * @param {CachedTool[]} tools
 */
export function updateStackTools(stackId, tools) {
  updateRudiConfig(config => {
    if (config.stacks[stackId]) {
      config.stacks[stackId].tools = tools;
    }
  });
}

// =============================================================================
// RUNTIME HELPERS
// =============================================================================

/**
 * Add or update a runtime in the config
 * @param {string} runtimeId - Runtime identifier (e.g., 'node', 'python')
 * @param {Object} runtimeInfo
 * @param {string} runtimeInfo.path - Path to runtime directory
 * @param {string} runtimeInfo.version - Runtime version
 */
export function addRuntime(runtimeId, runtimeInfo) {
  updateRudiConfig(config => {
    const platform = getPlatform();
    let bin;

    if (runtimeId === 'node') {
      bin = platform === 'win32' ? 'node.exe' : 'bin/node';
    } else if (runtimeId === 'python') {
      bin = platform === 'win32' ? 'python.exe' : 'bin/python3';
    } else {
      bin = runtimeId;
    }

    config.runtimes[runtimeId] = {
      path: runtimeInfo.path,
      bin: path.join(runtimeInfo.path, bin),
      version: runtimeInfo.version
    };
  });
}

// =============================================================================
// SECRET HELPERS
// =============================================================================

/**
 * Get default secret provider based on platform
 * @returns {'keychain' | 'secrets.json'}
 */
export function getDefaultSecretProvider() {
  const platform = getPlatform();
  // macOS: keychain, others: secrets.json for now
  // TODO: Add Windows credential manager, Linux libsecret
  return platform === 'darwin' ? 'keychain' : 'secrets.json';
}

/**
 * Mark a secret as configured
 * @param {string} secretName
 * @param {boolean} configured
 * @param {'keychain' | 'secrets.json' | 'vault' | 'env'} [provider]
 */
export function updateSecretStatus(secretName, configured, provider) {
  updateRudiConfig(config => {
    if (config.secrets[secretName]) {
      config.secrets[secretName].configured = configured;
      if (provider) {
        config.secrets[secretName].provider = provider;
      }
      config.secrets[secretName].lastUpdated = new Date().toISOString();
    }
  });
}

// =============================================================================
// EXPORTS
// =============================================================================

export {
  RUDI_JSON_PATH,
  CONFIG_MODE
};
