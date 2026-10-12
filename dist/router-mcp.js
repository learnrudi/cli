#!/usr/bin/env node

// src/router-mcp.js
import { spawn } from "child_process";
import * as fs2 from "fs";
import * as path2 from "path";
import * as readline from "readline";
import * as os from "os";

// packages/mcp/src/tool-names.js
import { createHash } from "node:crypto";
var PORTABLE_TOOL_NAME_MAX_LENGTH = 54;
var PORTABLE_TOOL_NAME_PATTERN = /^[a-zA-Z0-9_-]{1,54}$/;
function isPortableToolName(value) {
  return typeof value === "string" && PORTABLE_TOOL_NAME_PATTERN.test(value);
}
function portableBase(canonicalName) {
  return canonicalName.replace(/[^a-zA-Z0-9_-]/g, "_") || "tool";
}
function portableHash(canonicalName) {
  return createHash("sha256").update(canonicalName).digest("hex").slice(0, 8);
}
function hashedAlias(base, canonicalName) {
  const suffix = `_${portableHash(canonicalName)}`;
  return `${base.slice(0, PORTABLE_TOOL_NAME_MAX_LENGTH - suffix.length)}${suffix}`;
}
function buildPortableToolNameMap(canonicalNames) {
  const uniqueNames = [...new Set(canonicalNames)];
  const groupedByBase = /* @__PURE__ */ new Map();
  for (const canonicalName of uniqueNames) {
    const base = portableBase(canonicalName);
    const group = groupedByBase.get(base) || [];
    group.push(canonicalName);
    groupedByBase.set(base, group);
  }
  const canonicalToPortable = /* @__PURE__ */ new Map();
  const portableToCanonical = /* @__PURE__ */ new Map();
  for (const canonicalName of uniqueNames) {
    const base = portableBase(canonicalName);
    const collides = groupedByBase.get(base).length > 1;
    const alias = collides || !isPortableToolName(base) ? hashedAlias(base, canonicalName) : base;
    canonicalToPortable.set(canonicalName, alias);
    portableToCanonical.set(alias, canonicalName);
  }
  return { canonicalToPortable, portableToCanonical };
}

// packages/mcp/src/router-core.js
function nonEmptyString(value, label) {
  if (typeof value !== "string" || value.trim() === "") {
    throw new Error(`${label} must be a non-empty string`);
  }
  return value;
}
function canonicalToolName(stackId, toolName) {
  const stack = nonEmptyString(stackId, "stackId");
  const tool = nonEmptyString(toolName, "toolName");
  if (stack.includes(".")) throw new Error("stackId cannot contain a dot");
  return `${stack}.${tool}`;
}
function parseCanonicalToolName(value) {
  const name = nonEmptyString(value, "tool name");
  const dotIndex = name.indexOf(".");
  if (dotIndex <= 0 || dotIndex === name.length - 1) {
    throw new Error(`Invalid tool name format: ${name} (expected: stack.tool_name)`);
  }
  return {
    stackId: name.slice(0, dotIndex),
    toolName: name.slice(dotIndex + 1)
  };
}
function namespaceTools(discovered) {
  if (!Array.isArray(discovered)) {
    throw new Error("discoverStackTools must return an array");
  }
  const names = /* @__PURE__ */ new Set();
  const tools = [];
  for (const entry of discovered) {
    const stackId = nonEmptyString(entry?.stackId, "stackId");
    if (!Array.isArray(entry?.tools)) {
      throw new Error(`tools for ${stackId} must be an array`);
    }
    for (const tool of entry.tools) {
      const name = canonicalToolName(stackId, tool?.name);
      if (names.has(name)) throw new Error(`Duplicate tool name: ${name}`);
      names.add(name);
      tools.push({
        name,
        description: `[${stackId}] ${tool.description || tool.name}`,
        inputSchema: tool.inputSchema || { type: "object", properties: {} }
      });
    }
  }
  return tools;
}
function createRouterDispatcher(options) {
  if (typeof options?.discoverStackTools !== "function") {
    throw new Error("discoverStackTools adapter is required");
  }
  if (typeof options?.executeStackTool !== "function") {
    throw new Error("executeStackTool adapter is required");
  }
  const protocolVersion = options.protocolVersion || "2024-11-05";
  const serverInfo = options.serverInfo || { name: "rudi-router", version: "1.0.0" };
  const toolNameStyle = options.toolNameStyle === "portable" ? "portable" : "canonical";
  const callPolicy = options.callPolicy === "adapter-authoritative" ? "adapter-authoritative" : "discovered-only";
  let canonicalNames = /* @__PURE__ */ new Set();
  let portableToCanonical = /* @__PURE__ */ new Map();
  async function listTools() {
    const tools = namespaceTools(await options.discoverStackTools());
    canonicalNames = new Set(tools.map((tool) => tool.name));
    if (toolNameStyle !== "portable") return tools;
    const mapping = buildPortableToolNameMap(tools.map((tool) => tool.name));
    portableToCanonical = mapping.portableToCanonical;
    return tools.map((tool) => ({
      ...tool,
      name: mapping.canonicalToPortable.get(tool.name)
    }));
  }
  async function callTool(requestedName, arguments_ = {}) {
    let name = requestedName;
    let parsed;
    if (toolNameStyle === "portable") {
      if (portableToCanonical.size === 0) await listTools();
      name = portableToCanonical.get(requestedName);
      if (!name) throw new Error(`Unknown portable tool name: ${requestedName}`);
    } else if (callPolicy === "discovered-only") {
      parsed = parseCanonicalToolName(requestedName);
      if (canonicalNames.size === 0) await listTools();
      if (!canonicalNames.has(requestedName)) {
        throw new Error(`Unknown canonical tool name: ${requestedName}`);
      }
    }
    parsed ||= parseCanonicalToolName(name);
    return options.executeStackTool({
      stackId: parsed.stackId,
      toolName: parsed.toolName,
      arguments: arguments_
    });
  }
  async function handleRequest2(request) {
    const response = { jsonrpc: "2.0", id: request.id ?? null };
    try {
      switch (request.method) {
        case "initialize":
          response.result = {
            protocolVersion,
            capabilities: { tools: {} },
            serverInfo
          };
          break;
        case "notifications/initialized":
          return null;
        case "tools/list":
          response.result = { tools: await listTools() };
          break;
        case "tools/call":
          response.result = await callTool(
            request.params.name,
            request.params.arguments || {}
          );
          break;
        case "ping":
          response.result = {};
          break;
        default:
          if (request.id === null || request.id === void 0) return null;
          response.error = {
            code: -32601,
            message: `Method not found: ${request.method}`
          };
      }
    } catch (error) {
      response.error = {
        code: -32603,
        message: error instanceof Error ? error.message : "Internal error"
      };
    }
    return response;
  }
  return Object.freeze({ listTools, callTool, handleRequest: handleRequest2 });
}

// src/router-settings.js
import fs from "node:fs";
import path from "node:path";
function invalid(detail) {
  throw new Error(`Invalid router-settings.json: ${detail}`);
}
function isObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
function allowedKeys(value, keys) {
  return Object.keys(value).every((key) => keys.includes(key));
}
function validateEnvironment(env) {
  if (!isObject(env)) invalid("env must be an object");
  for (const [name, value] of Object.entries(env)) {
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name) || typeof value !== "string" || value.includes("\0")) {
      invalid("env requires valid variable names and string values without NUL bytes");
    }
  }
}
function validateTimeouts(timeouts) {
  if (!isObject(timeouts)) invalid("toolTimeoutMs must be an object");
  for (const [name, value] of Object.entries(timeouts)) {
    if (!name.trim() || /[\u0000-\u001f\u007f]/.test(name) || !Number.isSafeInteger(value) || value < 1 || value > 9e5) {
      invalid("toolTimeoutMs requires tool names and integer milliseconds from 1 to 900000");
    }
  }
}
function loadRouterSettings(rudiHome) {
  const file = path.join(rudiHome, "router-settings.json");
  let raw;
  try {
    if (fs.statSync(file).size > 1024 * 1024) invalid("file exceeds 1 MiB");
    raw = fs.readFileSync(file, "utf8");
  } catch (error) {
    if (error.code === "ENOENT") return {};
    if (error.message.startsWith("Invalid router-settings.json:")) throw error;
    throw new Error("Cannot read router-settings.json");
  }
  let settings;
  try {
    settings = JSON.parse(raw);
  } catch {
    invalid("expected valid JSON");
  }
  if (!isObject(settings) || settings.schemaVersion !== 1 || !allowedKeys(settings, ["schemaVersion", "stacks"]) || !isObject(settings.stacks)) {
    invalid("expected schemaVersion 1 and a stacks object");
  }
  for (const [id, stack] of Object.entries(settings.stacks)) {
    if (!/^stack:[a-z0-9][a-z0-9_-]*$/.test(id) || !isObject(stack) || !allowedKeys(stack, ["env", "toolTimeoutMs"])) {
      invalid("expected stack:<id> entries with supported settings");
    }
    if (Object.hasOwn(stack, "env")) validateEnvironment(stack.env);
    if (Object.hasOwn(stack, "toolTimeoutMs")) validateTimeouts(stack.toolTimeoutMs);
  }
  return settings.stacks;
}

// src/router-mcp.js
var RUDI_HOME = process.env.RUDI_HOME || path2.join(os.homedir(), ".rudi");
var RUDI_JSON_PATH = path2.join(RUDI_HOME, "rudi.json");
var SECRETS_PATH = path2.join(RUDI_HOME, "secrets.json");
var TOOL_INDEX_PATH = path2.join(RUDI_HOME, "cache", "tool-index.json");
var REQUEST_TIMEOUT_MS = 3e4;
var PROTOCOL_VERSION = "2024-11-05";
var DEFAULT_IDLE_TTL_MS = 10 * 60 * 1e3;
var DEFAULT_MAX_SERVERS = 8;
var DEFAULT_CLEANUP_INTERVAL_MS = 3e4;
var DEFAULT_FORCE_KILL_MS = 2e3;
var IDLE_TTL_MS = readIntEnv("RUDI_ROUTER_IDLE_TTL_MS", DEFAULT_IDLE_TTL_MS);
var MAX_SERVERS = readIntEnv("RUDI_ROUTER_MAX_SERVERS", DEFAULT_MAX_SERVERS);
var CLEANUP_INTERVAL_MS = readIntEnv("RUDI_ROUTER_CLEANUP_INTERVAL_MS", DEFAULT_CLEANUP_INTERVAL_MS);
var FORCE_KILL_MS = readIntEnv("RUDI_ROUTER_FORCE_KILL_MS", DEFAULT_FORCE_KILL_MS);
var LIVE_TOOL_LIST = readBoolEnv("RUDI_ROUTER_LIVE_TOOL_LIST", false);
var TOOL_NAME_STYLE = process.env.RUDI_ROUTER_TOOL_NAMES === "portable" ? "portable" : "canonical";
var serverPool = /* @__PURE__ */ new Map();
var rudiConfig = null;
var routerSettings = {};
var toolIndex = null;
var cleanupTimer = null;
function log(msg) {
  process.stderr.write(`[rudi-router] ${msg}
`);
}
function debug(msg) {
  if (process.env.DEBUG) {
    process.stderr.write(`[rudi-router:debug] ${msg}
`);
  }
}
function readIntEnv(name, fallback) {
  const raw = process.env[name];
  if (raw === void 0) return fallback;
  const value = Number(raw);
  return Number.isFinite(value) && value >= 0 ? value : fallback;
}
function readBoolEnv(name, fallback) {
  const raw = process.env[name];
  if (raw === void 0) return fallback;
  return ["1", "true", "yes", "on"].includes(String(raw).toLowerCase());
}
function hasProcessExited(proc) {
  return proc.exitCode !== null || proc.signalCode !== null;
}
function existingDirectory(dirPath) {
  return typeof dirPath === "string" && fs2.existsSync(dirPath) && fs2.statSync(dirPath).isDirectory();
}
function getRudiExecutionPathEntries() {
  const entries = [path2.join(RUDI_HOME, "bins")];
  for (const runtimeBin of [
    path2.join(RUDI_HOME, "runtimes", "node", "bin"),
    path2.join(RUDI_HOME, "runtimes", "python", "bin")
  ]) {
    if (existingDirectory(runtimeBin)) {
      entries.push(runtimeBin);
    }
  }
  const binariesRoot = path2.join(RUDI_HOME, "binaries");
  if (existingDirectory(binariesRoot)) {
    for (const entry of fs2.readdirSync(binariesRoot, { withFileTypes: true })) {
      if (entry.isDirectory()) {
        entries.push(path2.join(binariesRoot, entry.name));
      }
    }
  }
  return entries;
}
function prependRudiExecutionPath(env) {
  const seen = /* @__PURE__ */ new Set();
  const entries = [];
  for (const entry of [...getRudiExecutionPathEntries(), ...(env.PATH || "").split(path2.delimiter)]) {
    if (!entry || seen.has(entry)) continue;
    seen.add(entry);
    entries.push(entry);
  }
  env.PATH = entries.join(path2.delimiter);
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
    server.process.kill("SIGTERM");
  } catch {
  }
  const killTimer = setTimeout(() => {
    if (!hasProcessExited(server.process)) {
      log(`Force killing stack ${stackId}`);
      try {
        server.process.kill("SIGKILL");
      } catch {
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
      terminateServer(stackId, server, "process-not-usable");
      continue;
    }
    if (server.pending.size > 0) continue;
    if (IDLE_TTL_MS > 0 && now - server.lastUsedAt > IDLE_TTL_MS) {
      terminateServer(stackId, server, `idle ${Math.round((now - server.lastUsedAt) / 1e3)}s`);
    }
  }
  if (MAX_SERVERS > 0 && serverPool.size > MAX_SERVERS) {
    const evictable = Array.from(serverPool.entries()).filter(([, server]) => !server.terminating && server.pending.size === 0).sort((a, b) => a[1].lastUsedAt - b[1].lastUsedAt);
    let index = 0;
    while (serverPool.size > MAX_SERVERS && index < evictable.length) {
      const [stackId, server] = evictable[index++];
      terminateServer(stackId, server, "pool-limit");
    }
  }
}
function loadRudiConfig() {
  try {
    const content = fs2.readFileSync(RUDI_JSON_PATH, "utf-8");
    return JSON.parse(content);
  } catch (err) {
    log(`Failed to load rudi.json: ${err.message}`);
    return { stacks: {}, runtimes: {}, binaries: {}, secrets: {} };
  }
}
function loadToolIndex() {
  try {
    const content = fs2.readFileSync(TOOL_INDEX_PATH, "utf-8");
    return JSON.parse(content);
  } catch {
    return null;
  }
}
function loadSecrets() {
  try {
    const content = fs2.readFileSync(SECRETS_PATH, "utf-8");
    return JSON.parse(content);
  } catch {
    return {};
  }
}
function getStackSecrets(stackId) {
  const allSecrets = loadSecrets();
  const stackConfig = rudiConfig?.stacks?.[stackId];
  if (!stackConfig?.secrets) return {};
  const result = {};
  for (const secretDef of stackConfig.secrets) {
    const name = typeof secretDef === "string" ? secretDef : secretDef.name || secretDef.key;
    if (!name) continue;
    if (allSecrets[name]) {
      result[name] = allSecrets[name];
    }
  }
  return result;
}
function spawnStackServer(stackId, stackConfig) {
  const launch = stackConfig.launch;
  if (!launch || !launch.bin) {
    throw new Error(`Stack ${stackId} has no launch configuration`);
  }
  if (stackConfig.runtime === "binary") {
    if (!fs2.existsSync(launch.bin)) {
      throw new Error(`Binary not found for stack ${stackId}: ${launch.bin}`);
    }
  }
  const secrets = getStackSecrets(stackId);
  const env = { ...process.env, ...routerSettings[stackId]?.env, ...secrets };
  prependRudiExecutionPath(env);
  debug(`Spawning stack ${stackId}: ${launch.bin} ${launch.args?.join(" ")}`);
  const childProcess = spawn(launch.bin, launch.args || [], {
    cwd: launch.cwd || stackConfig.path,
    stdio: ["pipe", "pipe", "pipe"],
    env
  });
  const rl = readline.createInterface({
    input: childProcess.stdout,
    terminal: false
  });
  const server = {
    process: childProcess,
    rl,
    pending: /* @__PURE__ */ new Map(),
    buffer: "",
    initialized: false,
    stackId,
    spawnedAt: Date.now(),
    lastUsedAt: Date.now(),
    terminating: false
  };
  rl.on("line", (line) => {
    try {
      const response = JSON.parse(line);
      debug(`<< ${stackId}: ${line.slice(0, 200)}`);
      if (response.id === null || response.id === void 0) {
        debug(`Notification from ${stackId}: ${response.method || "unknown"}`);
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
  childProcess.stderr?.on("data", (data) => {
    process.stderr.write(`[${stackId}] ${data}`);
  });
  childProcess.on("error", (err) => {
    log(`Stack process error (${stackId}): ${err.message}`);
    rejectPending(server, `Stack ${stackId} error: ${err.message}`);
    serverPool.delete(stackId);
  });
  childProcess.on("exit", (code, signal) => {
    debug(`Stack ${stackId} exited: code=${code}, signal=${signal}`);
    rejectPending(server, `Stack ${stackId} exited (code=${code}, signal=${signal || "none"})`);
    rl.close();
    serverPool.delete(stackId);
  });
  return server;
}
function getOrSpawnServer(stackId) {
  const existing = serverPool.get(stackId);
  if (existing && isProcessUsable(existing.process) && !existing.terminating) {
    markServerUsed(existing);
    return existing;
  }
  if (existing) {
    terminateServer(stackId, existing, "stale");
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
async function sendToStack(server, request, timeoutMs = REQUEST_TIMEOUT_MS) {
  return new Promise((resolve, reject) => {
    if (!isProcessUsable(server.process) || server.terminating) {
      reject(new Error(`Stack ${server.stackId} is not available`));
      return;
    }
    const timeout = setTimeout(() => {
      server.pending.delete(request.id);
      if (request.method === "tools/call") {
        const label = `${server.stackId}.${request.params.name}`;
        log(`Tool timeout: ${label}, deadline=${timeoutMs}ms, request=${request.id}`);
        reject(new Error(`Tool ${label} timed out after ${timeoutMs} ms; downstream work may still be running. Inspect its status or outputs before retrying.`));
      } else {
        reject(new Error(`Request timeout: ${request.method}`));
      }
    }, timeoutMs);
    server.pending.set(request.id, { resolve, reject, timeout });
    const line = JSON.stringify(request) + "\n";
    debug(`>> ${line.slice(0, 200)}`);
    markServerUsed(server);
    server.process.stdin?.write(line);
  });
}
async function initializeStack(server, stackId) {
  if (server.initialized) return;
  markServerUsed(server);
  const initRequest = {
    jsonrpc: "2.0",
    id: `init-${stackId}-${Date.now()}`,
    method: "initialize",
    params: {
      protocolVersion: PROTOCOL_VERSION,
      capabilities: {},
      clientInfo: {
        name: "rudi-router",
        version: "1.0.0"
      }
    }
  };
  try {
    const response = await sendToStack(server, initRequest);
    if (!response.error) {
      server.initialized = true;
      debug(`Stack ${stackId} initialized`);
      server.process.stdin?.write(JSON.stringify({
        jsonrpc: "2.0",
        method: "notifications/initialized"
      }) + "\n");
    }
  } catch (err) {
    debug(`Failed to initialize ${stackId}: ${err.message}`);
  }
}
async function discoverStackTools() {
  const stacks = [];
  const skippedStacks = [];
  for (const [stackId, stackConfig] of Object.entries(rudiConfig?.stacks || {})) {
    if (!stackConfig.installed) continue;
    const indexEntry = toolIndex?.byStack?.[stackId];
    if (indexEntry?.tools && indexEntry.tools.length > 0 && !indexEntry.error) {
      stacks.push({ stackId, tools: indexEntry.tools });
      continue;
    }
    if (stackConfig.tools && stackConfig.tools.length > 0) {
      stacks.push({ stackId, tools: stackConfig.tools });
      continue;
    }
    if (!LIVE_TOOL_LIST) {
      skippedStacks.push(stackId);
      continue;
    }
    try {
      const server = getOrSpawnServer(stackId);
      await initializeStack(server, stackId);
      const response = await sendToStack(server, {
        jsonrpc: "2.0",
        id: `list-${stackId}-${Date.now()}`,
        method: "tools/list"
      });
      if (!Array.isArray(response.result?.tools)) {
        throw new Error("tools/list result.tools must be an array");
      }
      stacks.push({ stackId, tools: response.result.tools });
    } catch (err) {
      log(`Failed to list tools from ${stackId}: ${err.message}`);
    }
  }
  if (skippedStacks.length > 0) {
    log(`Skipped live tools/list for ${skippedStacks.length} stacks (enable RUDI_ROUTER_LIVE_TOOL_LIST=1 or run "rudi index")`);
  }
  return stacks;
}
async function executeStackTool({ stackId, toolName, arguments: arguments_ }) {
  if (!rudiConfig?.stacks?.[stackId]) {
    throw new Error(`Stack not found: ${stackId}`);
  }
  const server = getOrSpawnServer(stackId);
  await initializeStack(server, stackId);
  const deadlines = routerSettings[stackId]?.toolTimeoutMs;
  const timeoutMs = deadlines && Object.hasOwn(deadlines, toolName) ? deadlines[toolName] : REQUEST_TIMEOUT_MS;
  const response = await sendToStack(server, {
    jsonrpc: "2.0",
    id: `call-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    method: "tools/call",
    params: {
      name: toolName,
      arguments: arguments_
    }
  }, timeoutMs);
  if (response.error) {
    throw new Error(`Tool error: ${response.error.message}`);
  }
  return response.result;
}
var dispatcher = createRouterDispatcher({
  protocolVersion: PROTOCOL_VERSION,
  serverInfo: { name: "rudi-router", version: "1.0.0" },
  toolNameStyle: TOOL_NAME_STYLE,
  // Local stdio historically permits direct calls to installed stack tools
  // even when discovery is unavailable. Hosted consumers keep the shared
  // core's fail-closed discovered-only default.
  callPolicy: "adapter-authoritative",
  discoverStackTools,
  executeStackTool
});
var { handleRequest } = dispatcher;
async function main() {
  log("Starting RUDI Router MCP Server");
  log(`Pool config: max=${MAX_SERVERS <= 0 ? "unlimited" : MAX_SERVERS}, idleTTL=${IDLE_TTL_MS}ms, cleanup=${CLEANUP_INTERVAL_MS}ms`);
  log(`Live tools/list: ${LIVE_TOOL_LIST ? "enabled" : "disabled"}`);
  log(`Tool name style: ${TOOL_NAME_STYLE}`);
  rudiConfig = loadRudiConfig();
  routerSettings = loadRouterSettings(RUDI_HOME);
  const stackCount = Object.keys(rudiConfig.stacks || {}).length;
  log(`Loaded ${stackCount} stacks from rudi.json`);
  toolIndex = loadToolIndex();
  if (toolIndex) {
    const cachedStacks = Object.keys(toolIndex.byStack || {}).length;
    log(`Loaded tool index (${cachedStacks} stacks cached)`);
  } else {
    log("No tool index cache found (run: rudi index)");
  }
  const rl = readline.createInterface({
    input: process.stdin,
    terminal: false
  });
  rl.on("line", async (line) => {
    try {
      const request = JSON.parse(line);
      debug(`Received: ${line.slice(0, 200)}`);
      const response = await handleRequest(request);
      if (response !== null) {
        const responseStr = JSON.stringify(response);
        debug(`Sending: ${responseStr.slice(0, 200)}`);
        process.stdout.write(responseStr + "\n");
      }
    } catch (err) {
      const errorResponse = {
        jsonrpc: "2.0",
        id: null,
        error: {
          code: -32700,
          message: `Parse error: ${err.message}`
        }
      };
      process.stdout.write(JSON.stringify(errorResponse) + "\n");
    }
  });
  rl.on("close", () => {
    log("stdin closed, shutting down");
    for (const [stackId, server] of serverPool) {
      debug(`Killing stack ${stackId}`);
      terminateServer(stackId, server, "stdin-closed");
    }
    if (cleanupTimer) clearInterval(cleanupTimer);
    process.exit(0);
  });
  process.on("SIGTERM", () => {
    log("SIGTERM received, shutting down");
    for (const [stackId, server] of serverPool) {
      terminateServer(stackId, server, "sigterm");
    }
    if (cleanupTimer) clearInterval(cleanupTimer);
    process.exit(0);
  });
  process.on("SIGINT", () => {
    log("SIGINT received, shutting down");
    for (const [stackId, server] of serverPool) {
      terminateServer(stackId, server, "sigint");
    }
    if (cleanupTimer) clearInterval(cleanupTimer);
    process.exit(0);
  });
  cleanupTimer = setInterval(cleanupServerPool, CLEANUP_INTERVAL_MS);
  if (cleanupTimer.unref) cleanupTimer.unref();
}
main().catch((err) => {
  log(`Fatal error: ${err.message}`);
  process.exit(1);
});
