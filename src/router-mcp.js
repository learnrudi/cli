#!/usr/bin/env node
/**
 * RUDI Router MCP Server
 *
 * Central MCP dispatcher that:
 * - Reads ~/.rudi/rudi.json
 * - Lists all installed stack tools (namespaced)
 * - Proxies tool calls to correct stack subprocess
 * - Maintains connection pool per stack
 *
 * Design decisions:
 * - Cached tool index: Fast tools/list without spawning all stacks
 * - Lazy spawn: Only spawn stack servers when needed
 * - stdout = protocol only: All logging goes to stderr
 * - Handle null IDs: MCP notifications have id: null
 */

import { spawn } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import * as readline from 'readline';
import * as os from 'os';

// =============================================================================
// CONSTANTS
// =============================================================================

const RUDI_HOME = process.env.RUDI_HOME || path.join(os.homedir(), '.rudi');
const RUDI_JSON_PATH = path.join(RUDI_HOME, 'rudi.json');
const SECRETS_PATH = path.join(RUDI_HOME, 'secrets.json');
const TOOL_INDEX_PATH = path.join(RUDI_HOME, 'cache', 'tool-index.json');

const REQUEST_TIMEOUT_MS = 30000;
const PROTOCOL_VERSION = '2024-11-05';
const DEFAULT_IDLE_TTL_MS = 10 * 60 * 1000;
const DEFAULT_MAX_SERVERS = 8;
const DEFAULT_CLEANUP_INTERVAL_MS = 30000;
const DEFAULT_FORCE_KILL_MS = 2000;

const IDLE_TTL_MS = readIntEnv('RUDI_ROUTER_IDLE_TTL_MS', DEFAULT_IDLE_TTL_MS);
const MAX_SERVERS = readIntEnv('RUDI_ROUTER_MAX_SERVERS', DEFAULT_MAX_SERVERS);
const CLEANUP_INTERVAL_MS = readIntEnv('RUDI_ROUTER_CLEANUP_INTERVAL_MS', DEFAULT_CLEANUP_INTERVAL_MS);
const FORCE_KILL_MS = readIntEnv('RUDI_ROUTER_FORCE_KILL_MS', DEFAULT_FORCE_KILL_MS);
const LIVE_TOOL_LIST = readBoolEnv('RUDI_ROUTER_LIVE_TOOL_LIST', false);

// =============================================================================
// STATE
// =============================================================================

/** @type {Map<string, StackServer>} */
const serverPool = new Map();

/** @type {RudiConfig | null} */
let rudiConfig = null;

/** @type {Object | null} */
let toolIndex = null;
let cleanupTimer = null;

// =============================================================================
// TYPES (JSDoc)
// =============================================================================

/**
 * @typedef {Object} StackServer
 * @property {import('child_process').ChildProcess} process
 * @property {readline.Interface} rl
 * @property {Map<string|number, PendingRequest>} pending
 * @property {string} buffer
 * @property {boolean} initialized
 * @property {string} stackId
 * @property {number} spawnedAt
 * @property {number} lastUsedAt
 * @property {boolean} terminating
 */

/**
 * @typedef {Object} PendingRequest
 * @property {(value: JsonRpcResponse) => void} resolve
 * @property {(error: Error) => void} reject
 * @property {NodeJS.Timeout} timeout
 */

/**
 * @typedef {Object} JsonRpcRequest
 * @property {'2.0'} jsonrpc
 * @property {string|number|null} [id]
 * @property {string} method
 * @property {Object} [params]
 */

/**
 * @typedef {Object} JsonRpcResponse
 * @property {'2.0'} jsonrpc
 * @property {string|number|null} id
 * @property {*} [result]
 * @property {{code: number, message: string, data?: *}} [error]
 */

// =============================================================================
// LOGGING (all to stderr to keep stdout clean for MCP protocol)
// =============================================================================

function log(msg) {
  process.stderr.write(`[rudi-router] ${msg}\n`);
}

function debug(msg) {
  if (process.env.DEBUG) {
    process.stderr.write(`[rudi-router:debug] ${msg}\n`);
  }
}

// =============================================================================
// ENV & PROCESS HELPERS
// =============================================================================

function readIntEnv(name, fallback) {
  const raw = process.env[name];
  if (raw === undefined) return fallback;
  const value = Number(raw);
  return Number.isFinite(value) && value >= 0 ? value : fallback;
}

function readBoolEnv(name, fallback) {
  const raw = process.env[name];
  if (raw === undefined) return fallback;
  return ['1', 'true', 'yes', 'on'].includes(String(raw).toLowerCase());
}

function hasProcessExited(proc) {
  return proc.exitCode !== null || proc.signalCode !== null;
}

function isProcessUsable(proc) {
  return proc && !hasProcessExited(proc) && !proc.killed;
}

function markServerUsed(server) {
  server.lastUsedAt = Date.now();
}

function rejectPending(server, reason) {
  for (const [, pending] of server.pending) {
    clearTimeout(pending.timeout);
    pending.reject(new Error(reason));
  }
  server.pending.clear();
}

function terminateServer(stackId, server, reason) {
  if (!server || server.terminating) return;

  server.terminating = true;
  serverPool.delete(stackId);

  if (hasProcessExited(server.process)) {
    rejectPending(server, `Stack ${stackId} exited`);
    return;
  }

  log(`Stopping stack ${stackId}: ${reason}`);
  try {
    server.process.kill('SIGTERM');
  } catch {
    // Ignore kill errors; process may already be gone.
  }

  const killTimer = setTimeout(() => {
    if (!hasProcessExited(server.process)) {
      log(`Force killing stack ${stackId}`);
      try {
        server.process.kill('SIGKILL');
      } catch {
        // Ignore kill errors; process may already be gone.
      }
    }
  }, FORCE_KILL_MS);
  if (killTimer.unref) killTimer.unref();
}

function cleanupServerPool() {
  const now = Date.now();

  for (const [stackId, server] of serverPool) {
    if (server.terminating) continue;
    if (!isProcessUsable(server.process)) {
      terminateServer(stackId, server, 'process-not-usable');
      continue;
    }
    if (server.pending.size > 0) continue;
    if (IDLE_TTL_MS > 0 && now - server.lastUsedAt > IDLE_TTL_MS) {
      terminateServer(stackId, server, `idle ${Math.round((now - server.lastUsedAt) / 1000)}s`);
    }
  }

  if (MAX_SERVERS > 0 && serverPool.size > MAX_SERVERS) {
    const evictable = Array.from(serverPool.entries())
      .filter(([, server]) => !server.terminating && server.pending.size === 0)
      .sort((a, b) => a[1].lastUsedAt - b[1].lastUsedAt);

    let index = 0;
    while (serverPool.size > MAX_SERVERS && index < evictable.length) {
      const [stackId, server] = evictable[index++];
      terminateServer(stackId, server, 'pool-limit');
    }
  }
}

// =============================================================================
// CONFIG & SECRETS
// =============================================================================

/**
 * Load rudi.json
 * @returns {Object}
 */
function loadRudiConfig() {
  try {
    const content = fs.readFileSync(RUDI_JSON_PATH, 'utf-8');
    return JSON.parse(content);
  } catch (err) {
    log(`Failed to load rudi.json: ${err.message}`);
    return { stacks: {}, runtimes: {}, binaries: {}, secrets: {} };
  }
}

/**
 * Load tool index from cache file
 * @returns {Object | null}
 */
function loadToolIndex() {
  try {
    const content = fs.readFileSync(TOOL_INDEX_PATH, 'utf-8');
    return JSON.parse(content);
  } catch {
    return null;
  }
}

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
 * @param {string} stackId
 * @returns {Object<string, string>}
 */
function getStackSecrets(stackId) {
  const allSecrets = loadSecrets();
  const stackConfig = rudiConfig?.stacks?.[stackId];
  if (!stackConfig?.secrets) return {};

  const result = {};
  for (const secretDef of stackConfig.secrets) {
    const name = typeof secretDef === 'string' ? secretDef : secretDef.name;
    if (allSecrets[name]) {
      result[name] = allSecrets[name];
    }
  }
  return result;
}

// =============================================================================
// STACK SERVER MANAGEMENT
// =============================================================================

/**
 * Spawn a stack MCP server as subprocess
 * @param {string} stackId
 * @param {Object} stackConfig
 * @returns {StackServer}
 */
function spawnStackServer(stackId, stackConfig) {
  const launch = stackConfig.launch;
  if (!launch || !launch.bin) {
    throw new Error(`Stack ${stackId} has no launch configuration`);
  }

  // Validate binary exists before attempting spawn
  if (stackConfig.runtime === 'binary') {
    if (!fs.existsSync(launch.bin)) {
      throw new Error(`Binary not found for stack ${stackId}: ${launch.bin}`);
    }
  }

  const secrets = getStackSecrets(stackId);
  const env = { ...process.env, ...secrets };

  // Add bundled runtimes to PATH
  const nodeBin = path.join(RUDI_HOME, 'runtimes', 'node', 'bin');
  const pythonBin = path.join(RUDI_HOME, 'runtimes', 'python', 'bin');
  if (fs.existsSync(nodeBin) || fs.existsSync(pythonBin)) {
    const runtimePaths = [];
    if (fs.existsSync(nodeBin)) runtimePaths.push(nodeBin);
    if (fs.existsSync(pythonBin)) runtimePaths.push(pythonBin);
    env.PATH = runtimePaths.join(path.delimiter) + path.delimiter + (env.PATH || '');
  }

  debug(`Spawning stack ${stackId}: ${launch.bin} ${launch.args?.join(' ')}`);

  const childProcess = spawn(launch.bin, launch.args || [], {
    cwd: launch.cwd || stackConfig.path,
    stdio: ['pipe', 'pipe', 'pipe'],
    env
  });

  const rl = readline.createInterface({
    input: childProcess.stdout,
    terminal: false
  });

  /** @type {StackServer} */
  const server = {
    process: childProcess,
    rl,
    pending: new Map(),
    buffer: '',
    initialized: false,
    stackId,
    spawnedAt: Date.now(),
    lastUsedAt: Date.now(),
    terminating: false
  };

  // Handle responses from stack
  rl.on('line', (line) => {
    try {
      const response = JSON.parse(line);
      debug(`<< ${stackId}: ${line.slice(0, 200)}`);

      // Handle notifications (id is null or missing)
      if (response.id === null || response.id === undefined) {
        debug(`Notification from ${stackId}: ${response.method || 'unknown'}`);
        return;
      }

      const pending = server.pending.get(response.id);
      if (pending) {
        clearTimeout(pending.timeout);
        server.pending.delete(response.id);
        markServerUsed(server);
        pending.resolve(response);
      }
    } catch (err) {
      debug(`Failed to parse response from ${stackId}: ${err.message}`);
    }
  });

  // Pipe stack stderr to our stderr
  childProcess.stderr?.on('data', (data) => {
    process.stderr.write(`[${stackId}] ${data}`);
  });

  childProcess.on('error', (err) => {
    log(`Stack process error (${stackId}): ${err.message}`);
    rejectPending(server, `Stack ${stackId} error: ${err.message}`);
    serverPool.delete(stackId);
  });

  childProcess.on('exit', (code, signal) => {
    debug(`Stack ${stackId} exited: code=${code}, signal=${signal}`);
    rejectPending(server, `Stack ${stackId} exited (code=${code}, signal=${signal || 'none'})`);
    rl.close();
    serverPool.delete(stackId);
  });

  return server;
}

/**
 * Get or spawn a stack server
 * @param {string} stackId
 * @returns {StackServer}
 */
function getOrSpawnServer(stackId) {
  const existing = serverPool.get(stackId);
  if (existing && isProcessUsable(existing.process) && !existing.terminating) {
    markServerUsed(existing);
    return existing;
  }
  if (existing) {
    terminateServer(stackId, existing, 'stale');
  }

  const stackConfig = rudiConfig?.stacks?.[stackId];
  if (!stackConfig) {
    throw new Error(`Stack not found: ${stackId}`);
  }

  if (!stackConfig.installed) {
    throw new Error(`Stack not installed: ${stackId}`);
  }

  const server = spawnStackServer(stackId, stackConfig);
  serverPool.set(stackId, server);
  return server;
}

/**
 * Send JSON-RPC request to stack server
 * @param {StackServer} server
 * @param {JsonRpcRequest} request
 * @param {number} [timeoutMs]
 * @returns {Promise<JsonRpcResponse>}
 */
async function sendToStack(server, request, timeoutMs = REQUEST_TIMEOUT_MS) {
  return new Promise((resolve, reject) => {
    if (!isProcessUsable(server.process) || server.terminating) {
      reject(new Error(`Stack ${server.stackId} is not available`));
      return;
    }

    const timeout = setTimeout(() => {
      server.pending.delete(request.id);
      reject(new Error(`Request timeout: ${request.method}`));
    }, timeoutMs);

    server.pending.set(request.id, { resolve, reject, timeout });

    const line = JSON.stringify(request) + '\n';
    debug(`>> ${line.slice(0, 200)}`);
    markServerUsed(server);
    server.process.stdin?.write(line);
  });
}

/**
 * Initialize a stack server (MCP handshake)
 * @param {StackServer} server
 * @param {string} stackId
 */
async function initializeStack(server, stackId) {
  if (server.initialized) return;
  markServerUsed(server);

  const initRequest = {
    jsonrpc: '2.0',
    id: `init-${stackId}-${Date.now()}`,
    method: 'initialize',
    params: {
      protocolVersion: PROTOCOL_VERSION,
      capabilities: {},
      clientInfo: {
        name: 'rudi-router',
        version: '1.0.0'
      }
    }
  };

  try {
    const response = await sendToStack(server, initRequest);
    if (!response.error) {
      server.initialized = true;
      debug(`Stack ${stackId} initialized`);

      // Send initialized notification
      server.process.stdin?.write(JSON.stringify({
        jsonrpc: '2.0',
        method: 'notifications/initialized'
      }) + '\n');
    }
  } catch (err) {
    debug(`Failed to initialize ${stackId}: ${err.message}`);
  }
}

// =============================================================================
// MCP HANDLERS
// =============================================================================

/**
 * List all tools from all installed stacks (namespaced)
 * Priority: 1. tool-index.json cache, 2. rudi.json inline tools, 3. live query
 * @returns {Promise<Array<{name: string, description: string, inputSchema: Object}>>}
 */
async function listTools() {
  const tools = [];
  const skippedStacks = [];

  for (const [stackId, stackConfig] of Object.entries(rudiConfig?.stacks || {})) {
    if (!stackConfig.installed) continue;

    // 1. Check tool-index.json cache (from `rudi index` command)
    const indexEntry = toolIndex?.byStack?.[stackId];
    if (indexEntry?.tools && indexEntry.tools.length > 0 && !indexEntry.error) {
      tools.push(...indexEntry.tools.map(t => ({
        name: `${stackId}.${t.name}`,
        description: `[${stackId}] ${t.description || t.name}`,
        inputSchema: t.inputSchema || { type: 'object', properties: {} }
      })));
      continue;
    }

    // 2. Check inline tools in rudi.json (legacy/fallback)
    if (stackConfig.tools && stackConfig.tools.length > 0) {
      tools.push(...stackConfig.tools.map(t => ({
        name: `${stackId}.${t.name}`,
        description: `[${stackId}] ${t.description || t.name}`,
        inputSchema: t.inputSchema || { type: 'object', properties: {} }
      })));
      continue;
    }

    // 3. Fall back to querying the stack (slow, spawns server)
    if (!LIVE_TOOL_LIST) {
      skippedStacks.push(stackId);
      continue;
    }
    try {
      const server = getOrSpawnServer(stackId);
      await initializeStack(server, stackId);

      const response = await sendToStack(server, {
        jsonrpc: '2.0',
        id: `list-${stackId}-${Date.now()}`,
        method: 'tools/list'
      });

      if (response.result?.tools) {
        tools.push(...response.result.tools.map(t => ({
          name: `${stackId}.${t.name}`,
          description: `[${stackId}] ${t.description || t.name}`,
          inputSchema: t.inputSchema || { type: 'object', properties: {} }
        })));
      }
    } catch (err) {
      log(`Failed to list tools from ${stackId}: ${err.message}`);
      // Continue with other stacks
    }
  }

  if (skippedStacks.length > 0) {
    log(`Skipped live tools/list for ${skippedStacks.length} stacks (enable RUDI_ROUTER_LIVE_TOOL_LIST=1 or run "rudi index")`);
  }

  return tools;
}

/**
 * Call a tool on the appropriate stack
 * @param {string} toolName - Namespaced tool name (e.g., "slack.send_message")
 * @param {Object} arguments_
 * @returns {Promise<*>}
 */
async function callTool(toolName, arguments_) {
  // Parse namespace: "slack.send_message" → stackId="slack", actualTool="send_message"
  const dotIndex = toolName.indexOf('.');
  if (dotIndex === -1) {
    throw new Error(`Invalid tool name format: ${toolName} (expected: stack.tool_name)`);
  }

  const stackId = toolName.slice(0, dotIndex);
  const actualToolName = toolName.slice(dotIndex + 1);

  if (!rudiConfig?.stacks?.[stackId]) {
    throw new Error(`Stack not found: ${stackId}`);
  }

  const server = getOrSpawnServer(stackId);
  await initializeStack(server, stackId);

  const response = await sendToStack(server, {
    jsonrpc: '2.0',
    id: `call-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    method: 'tools/call',
    params: {
      name: actualToolName,
      arguments: arguments_
    }
  });

  if (response.error) {
    throw new Error(`Tool error: ${response.error.message}`);
  }

  return response.result;
}

// =============================================================================
// MAIN MCP PROTOCOL LOOP
// =============================================================================

/**
 * Handle incoming JSON-RPC request
 * @param {JsonRpcRequest} request
 * @returns {Promise<JsonRpcResponse>}
 */
async function handleRequest(request) {
  /** @type {JsonRpcResponse} */
  const response = {
    jsonrpc: '2.0',
    id: request.id ?? null
  };

  try {
    switch (request.method) {
      case 'initialize':
        response.result = {
          protocolVersion: PROTOCOL_VERSION,
          capabilities: {
            tools: {}
          },
          serverInfo: {
            name: 'rudi-router',
            version: '1.0.0'
          }
        };
        break;

      case 'notifications/initialized':
        // Client acknowledges initialization - no response needed for notifications
        return null;

      case 'tools/list': {
        const tools = await listTools();
        response.result = { tools };
        break;
      }

      case 'tools/call': {
        const params = request.params;
        const result = await callTool(params.name, params.arguments || {});
        response.result = result;
        break;
      }

      case 'ping':
        response.result = {};
        break;

      default:
        // Unknown method
        if (request.id !== null && request.id !== undefined) {
          response.error = {
            code: -32601,
            message: `Method not found: ${request.method}`
          };
        } else {
          // It's a notification, don't respond
          return null;
        }
    }
  } catch (err) {
    response.error = {
      code: -32603,
      message: err.message || 'Internal error'
    };
  }

  return response;
}

/**
 * Main entry point
 */
async function main() {
  log('Starting RUDI Router MCP Server');
  log(`Pool config: max=${MAX_SERVERS <= 0 ? 'unlimited' : MAX_SERVERS}, idleTTL=${IDLE_TTL_MS}ms, cleanup=${CLEANUP_INTERVAL_MS}ms`);
  log(`Live tools/list: ${LIVE_TOOL_LIST ? 'enabled' : 'disabled'}`);

  // Load config
  rudiConfig = loadRudiConfig();
  const stackCount = Object.keys(rudiConfig.stacks || {}).length;
  log(`Loaded ${stackCount} stacks from rudi.json`);

  // Load tool index cache
  toolIndex = loadToolIndex();
  if (toolIndex) {
    const cachedStacks = Object.keys(toolIndex.byStack || {}).length;
    log(`Loaded tool index (${cachedStacks} stacks cached)`);
  } else {
    log('No tool index cache found (run: rudi index)');
  }

  // Set up stdin/stdout for MCP protocol
  const rl = readline.createInterface({
    input: process.stdin,
    terminal: false
  });

  rl.on('line', async (line) => {
    try {
      const request = JSON.parse(line);
      debug(`Received: ${line.slice(0, 200)}`);

      const response = await handleRequest(request);

      // Don't respond to notifications
      if (response !== null) {
        const responseStr = JSON.stringify(response);
        debug(`Sending: ${responseStr.slice(0, 200)}`);
        process.stdout.write(responseStr + '\n');
      }
    } catch (err) {
      // Parse error
      const errorResponse = {
        jsonrpc: '2.0',
        id: null,
        error: {
          code: -32700,
          message: `Parse error: ${err.message}`
        }
      };
      process.stdout.write(JSON.stringify(errorResponse) + '\n');
    }
  });

  rl.on('close', () => {
    log('stdin closed, shutting down');
    // Clean up all spawned servers
    for (const [stackId, server] of serverPool) {
      debug(`Killing stack ${stackId}`);
      terminateServer(stackId, server, 'stdin-closed');
    }
    if (cleanupTimer) clearInterval(cleanupTimer);
    process.exit(0);
  });

  // Handle process termination
  process.on('SIGTERM', () => {
    log('SIGTERM received, shutting down');
    for (const [stackId, server] of serverPool) {
      terminateServer(stackId, server, 'sigterm');
    }
    if (cleanupTimer) clearInterval(cleanupTimer);
    process.exit(0);
  });

  process.on('SIGINT', () => {
    log('SIGINT received, shutting down');
    for (const [stackId, server] of serverPool) {
      terminateServer(stackId, server, 'sigint');
    }
    if (cleanupTimer) clearInterval(cleanupTimer);
    process.exit(0);
  });

  // Periodic pool cleanup (idle eviction, LRU capping)
  cleanupTimer = setInterval(cleanupServerPool, CLEANUP_INTERVAL_MS);
  if (cleanupTimer.unref) cleanupTimer.unref();
}

// Run
main().catch(err => {
  log(`Fatal error: ${err.message}`);
  process.exit(1);
});
