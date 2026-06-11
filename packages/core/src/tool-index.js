/**
 * @learnrudi/core/tool-index
 *
 * Tool discovery and indexing for RUDI stacks.
 * Used by both `rudi index` command and router lazy-cache.
 *
 * Design decisions:
 * - Separate cache file: ~/.rudi/cache/tool-index.json
 * - Doesn't pollute main rudi.json with volatile data
 * - Easy to invalidate (just delete)
 * - Router reads this, falls back to live query if missing
 */

import { spawn } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import * as readline from 'readline';
import { RUDI_HOME, PATHS } from '@learnrudi/env';
import { readRudiConfig } from './rudi-config.js';

// =============================================================================
// PATHS
// =============================================================================

const TOOL_INDEX_PATH = path.join(RUDI_HOME, 'cache', 'tool-index.json');
const TOOL_INDEX_TMP = path.join(RUDI_HOME, 'cache', 'tool-index.json.tmp');
const SECRETS_PATH = path.join(RUDI_HOME, 'secrets.json');

const REQUEST_TIMEOUT_MS = 15000;
const PROTOCOL_VERSION = '2024-11-05';

// =============================================================================
// TYPES (JSDoc)
// =============================================================================

/**
 * @typedef {Object} CachedTool
 * @property {string} name - Tool name (without namespace)
 * @property {string} description - Tool description
 * @property {Object} inputSchema - JSON Schema for inputs
 */

/**
 * @typedef {Object} StackIndexEntry
 * @property {string} indexedAt - ISO timestamp
 * @property {CachedTool[]} tools - Discovered tools
 * @property {string|null} error - Error message if indexing failed
 * @property {string[]} [missingSecrets] - Secrets needed but not configured
 */

/**
 * @typedef {Object} ToolIndex
 * @property {number} version - Index schema version
 * @property {string} updatedAt - ISO timestamp of last update
 * @property {Object.<string, StackIndexEntry>} byStack - Per-stack index data
 */

// =============================================================================
// SECRETS
// =============================================================================

/**
 * Load secrets.json
 * @returns {Object<string, string>}
 */
function loadSecrets() {
  try {
    const content = fs.readFileSync(SECRETS_PATH, 'utf-8');
    return JSON.parse(content);
  } catch {
    return {};
  }
}

/**
 * Get secrets for a specific stack
 * @param {Object} stackConfig - Stack config from rudi.json
 * @returns {{ secrets: Object<string, string>, missing: string[] }}
 */
function getStackSecrets(stackConfig) {
  const allSecrets = loadSecrets();
  const secrets = {};
  const missing = [];

  for (const secretDef of stackConfig.secrets || []) {
    const name = typeof secretDef === 'string' ? secretDef : (secretDef?.name || secretDef?.key);
    const required = typeof secretDef === 'object' ? secretDef.required !== false : true;
    if (!name) continue;

    if (allSecrets[name] && allSecrets[name].trim() !== '') {
      secrets[name] = allSecrets[name];
    } else if (required) {
      missing.push(name);
    }
  }

  return { secrets, missing };
}

function existingDirectory(dirPath) {
  return typeof dirPath === 'string' && fs.existsSync(dirPath) && fs.statSync(dirPath).isDirectory();
}

function getRudiExecutionPathEntries() {
  const entries = [PATHS.bins];

  for (const runtimeBin of [
    path.join(RUDI_HOME, 'runtimes', 'node', 'bin'),
    path.join(RUDI_HOME, 'runtimes', 'python', 'bin'),
  ]) {
    if (existingDirectory(runtimeBin)) {
      entries.push(runtimeBin);
    }
  }

  const binariesRoot = path.join(RUDI_HOME, 'binaries');
  if (existingDirectory(binariesRoot)) {
    for (const entry of fs.readdirSync(binariesRoot, { withFileTypes: true })) {
      if (entry.isDirectory()) {
        entries.push(path.join(binariesRoot, entry.name));
      }
    }
  }

  return entries;
}

function prependRudiExecutionPath(env) {
  const seen = new Set();
  const entries = [];
  for (const entry of [...getRudiExecutionPathEntries(), ...(env.PATH || '').split(path.delimiter)]) {
    if (!entry || seen.has(entry)) continue;
    seen.add(entry);
    entries.push(entry);
  }
  env.PATH = entries.join(path.delimiter);
}

// =============================================================================
// STACK TOOL DISCOVERY
// =============================================================================

/**
 * Discover tools from a single stack by spawning and querying it
 * @param {string} stackId - Stack identifier
 * @param {Object} stackConfig - Stack config from rudi.json
 * @param {Object} [options]
 * @param {number} [options.timeout=15000] - Timeout in ms
 * @param {(msg: string) => void} [options.log] - Log function
 * @returns {Promise<{ tools: CachedTool[], error: string|null, missingSecrets: string[] }>}
 */
export async function discoverStackTools(stackId, stackConfig, options = {}) {
  const { timeout = REQUEST_TIMEOUT_MS, log = () => {} } = options;

  // Check launch config
  const launch = stackConfig.launch;
  if (!launch || !launch.bin) {
    return {
      tools: [],
      error: 'No launch configuration',
      missingSecrets: []
    };
  }

  // Check secrets
  const { secrets, missing } = getStackSecrets(stackConfig);
  if (missing.length > 0) {
    return {
      tools: [],
      error: `Missing required secrets: ${missing.join(', ')}`,
      missingSecrets: missing
    };
  }

  // Build environment
  const env = { ...process.env, ...secrets };
  prependRudiExecutionPath(env);

  log(`  Spawning ${stackId}...`);

  return new Promise((resolve) => {
    let resolved = false;
    let childProcess;

    const cleanup = () => {
      if (childProcess && !childProcess.killed) {
        childProcess.kill();
      }
    };

    // Timeout
    const timeoutId = setTimeout(() => {
      if (!resolved) {
        resolved = true;
        cleanup();
        resolve({
          tools: [],
          error: `Timeout after ${timeout}ms`,
          missingSecrets: []
        });
      }
    }, timeout);

    try {
      childProcess = spawn(launch.bin, launch.args || [], {
        cwd: launch.cwd || stackConfig.path,
        stdio: ['pipe', 'pipe', 'pipe'],
        env
      });

      const rl = readline.createInterface({
        input: childProcess.stdout,
        terminal: false
      });

      let requestId = 0;
      const pending = new Map();

      // Send JSON-RPC request
      const send = (method, params = {}) => {
        return new Promise((resolveReq, rejectReq) => {
          const id = ++requestId;
          pending.set(id, { resolve: resolveReq, reject: rejectReq });

          const msg = JSON.stringify({
            jsonrpc: '2.0',
            id,
            method,
            params
          }) + '\n';

          childProcess.stdin.write(msg);
        });
      };

      // Handle responses
      rl.on('line', (line) => {
        try {
          const response = JSON.parse(line);
          if (response.id !== null && response.id !== undefined) {
            const p = pending.get(response.id);
            if (p) {
              pending.delete(response.id);
              if (response.error) {
                p.reject(new Error(response.error.message || 'RPC error'));
              } else {
                p.resolve(response.result);
              }
            }
          }
        } catch {
          // Ignore parse errors
        }
      });

      // Handle errors
      childProcess.on('error', (err) => {
        if (!resolved) {
          resolved = true;
          clearTimeout(timeoutId);
          cleanup();
          resolve({
            tools: [],
            error: `Spawn error: ${err.message}`,
            missingSecrets: []
          });
        }
      });

      childProcess.on('exit', (code) => {
        if (!resolved && code !== 0) {
          resolved = true;
          clearTimeout(timeoutId);
          resolve({
            tools: [],
            error: `Process exited with code ${code}`,
            missingSecrets: []
          });
        }
      });

      // Run MCP handshake and query tools
      (async () => {
        try {
          // Initialize
          await send('initialize', {
            protocolVersion: PROTOCOL_VERSION,
            capabilities: {},
            clientInfo: { name: 'rudi-index', version: '1.0.0' }
          });

          // Send initialized notification
          childProcess.stdin.write(JSON.stringify({
            jsonrpc: '2.0',
            method: 'notifications/initialized'
          }) + '\n');

          // Query tools
          const result = await send('tools/list');
          const tools = (result?.tools || []).map(t => ({
            name: t.name,
            description: t.description || t.name,
            inputSchema: t.inputSchema || { type: 'object', properties: {} }
          }));

          if (!resolved) {
            resolved = true;
            clearTimeout(timeoutId);
            cleanup();
            resolve({
              tools,
              error: null,
              missingSecrets: []
            });
          }
        } catch (err) {
          if (!resolved) {
            resolved = true;
            clearTimeout(timeoutId);
            cleanup();
            resolve({
              tools: [],
              error: err.message,
              missingSecrets: []
            });
          }
        }
      })();

    } catch (err) {
      if (!resolved) {
        resolved = true;
        clearTimeout(timeoutId);
        resolve({
          tools: [],
          error: `Failed to spawn: ${err.message}`,
          missingSecrets: []
        });
      }
    }
  });
}

// =============================================================================
// TOOL INDEX READ/WRITE
// =============================================================================

/**
 * Read tool index from cache file
 * @returns {ToolIndex | null}
 */
export function readToolIndex() {
  try {
    const content = fs.readFileSync(TOOL_INDEX_PATH, 'utf-8');
    return JSON.parse(content);
  } catch {
    return null;
  }
}

/**
 * Write tool index atomically
 * @param {ToolIndex} index
 */
export function writeToolIndex(index) {
  // Ensure cache directory exists
  const cacheDir = path.dirname(TOOL_INDEX_PATH);
  if (!fs.existsSync(cacheDir)) {
    fs.mkdirSync(cacheDir, { recursive: true });
  }

  index.updatedAt = new Date().toISOString();
  const content = JSON.stringify(index, null, 2);

  // Atomic write
  fs.writeFileSync(TOOL_INDEX_TMP, content, { mode: 0o600 });
  fs.renameSync(TOOL_INDEX_TMP, TOOL_INDEX_PATH);
}

/**
 * Create empty tool index
 * @returns {ToolIndex}
 */
export function createToolIndex() {
  return {
    version: 1,
    updatedAt: new Date().toISOString(),
    byStack: {}
  };
}

/**
 * Remove one stack entry from the cached tool index.
 * @param {string} stackId - Stack identifier, e.g. "stack:slack"
 * @returns {boolean} Whether a cached entry was removed
 */
export function removeStackFromToolIndex(stackId) {
  const normalizedStackId = typeof stackId === 'string' ? stackId.trim() : '';
  if (!normalizedStackId) {
    throw new Error('stackId is required to remove a stack from the tool index');
  }

  const index = readToolIndex();
  if (!index?.byStack || !Object.prototype.hasOwnProperty.call(index.byStack, normalizedStackId)) {
    return false;
  }

  delete index.byStack[normalizedStackId];
  writeToolIndex(index);
  return true;
}

// =============================================================================
// INDEX ALL STACKS
// =============================================================================

/**
 * Index all installed stacks
 * @param {Object} [options]
 * @param {string[]} [options.stacks] - Specific stacks to index (default: all)
 * @param {(msg: string) => void} [options.log] - Log function
 * @param {number} [options.timeout] - Per-stack timeout
 * @returns {Promise<{ indexed: number, failed: number, index: ToolIndex }>}
 */
export async function indexAllStacks(options = {}) {
  const { stacks: stackFilter, log = console.log, timeout } = options;

  const config = readRudiConfig();
  if (!config) {
    throw new Error('rudi.json not found');
  }

  const index = readToolIndex() || createToolIndex();
  let indexed = 0;
  let failed = 0;

  const stackIds = stackFilter || Object.keys(config.stacks || {});

  for (const stackId of stackIds) {
    const stackConfig = config.stacks[stackId];
    if (!stackConfig) {
      log(`  ⚠ Stack not found: ${stackId}`);
      failed++;
      continue;
    }

    if (!stackConfig.installed) {
      log(`  ⚠ Stack not installed: ${stackId}`);
      failed++;
      continue;
    }

    log(`Indexing ${stackId}...`);

    const result = await discoverStackTools(stackId, stackConfig, { timeout, log });

    index.byStack[stackId] = {
      indexedAt: new Date().toISOString(),
      tools: result.tools,
      error: result.error,
      missingSecrets: result.missingSecrets.length > 0 ? result.missingSecrets : undefined
    };

    if (result.error) {
      log(`  ✗ ${result.error}`);
      failed++;
    } else {
      log(`  ✓ ${result.tools.length} tools`);
      indexed++;
    }
  }

  // Write updated index
  writeToolIndex(index);

  return { indexed, failed, index };
}

// =============================================================================
// EXPORTS
// =============================================================================

export { TOOL_INDEX_PATH };
