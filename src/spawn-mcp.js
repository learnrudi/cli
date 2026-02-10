#!/usr/bin/env node
/**
 * RUDI Spawn MCP Server
 *
 * Lightweight MCP server that exposes spawn_child and list_children tools.
 * Reads sidecar connection from env vars, proxies tool calls to sidecar HTTP API.
 *
 * Pattern: raw JSON-RPC over stdio (same as router-mcp.js) — no SDK, readline + stdin/stdout.
 * Zero external dependencies — uses Node built-in http module.
 */

import * as http from 'http';
import * as readline from 'readline';

// =============================================================================
// CONSTANTS
// =============================================================================

const PROTOCOL_VERSION = '2024-11-05';
const HTTP_TIMEOUT_MS = 30_000;

// =============================================================================
// ENV
// =============================================================================

const SIDECAR_URL = process.env.RUDI_SIDECAR_URL || '';
const SIDECAR_TOKEN = process.env.RUDI_SIDECAR_TOKEN || '';
const SESSION_ID = process.env.RUDI_SESSION_ID || '';

// =============================================================================
// LOGGING (all to stderr to keep stdout clean for MCP protocol)
// =============================================================================

function log(msg) {
  process.stderr.write(`[rudi-spawn] ${msg}\n`);
}

function debug(msg) {
  if (process.env.DEBUG) {
    process.stderr.write(`[rudi-spawn:debug] ${msg}\n`);
  }
}

// =============================================================================
// HTTP HELPER — Node built-in http, 30s timeout, JSON parse
// =============================================================================

function httpRequest(method, urlPath, body) {
  return new Promise((resolve, reject) => {
    if (!SIDECAR_URL) {
      return reject(new Error('RUDI_SIDECAR_URL not set. Spawn MCP server requires sidecar connection env vars.'));
    }
    if (!SIDECAR_TOKEN) {
      return reject(new Error('RUDI_SIDECAR_TOKEN not set.'));
    }

    let parsed;
    try {
      parsed = new URL(urlPath, SIDECAR_URL);
    } catch (e) {
      return reject(new Error(`Invalid URL: ${SIDECAR_URL}${urlPath}`));
    }

    const payload = body ? JSON.stringify(body) : null;

    const options = {
      hostname: parsed.hostname,
      port: parsed.port,
      path: parsed.pathname + parsed.search,
      method,
      headers: {
        'X-Rudi-Token': SIDECAR_TOKEN,
        'X-Rudi-Caller-Session': SESSION_ID,
        ...(payload ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) } : {}),
      },
      timeout: HTTP_TIMEOUT_MS,
    };

    const req = http.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        try {
          const parsed = JSON.parse(data);
          resolve({ status: res.statusCode, body: parsed });
        } catch {
          resolve({ status: res.statusCode, body: { raw: data } });
        }
      });
    });

    req.on('timeout', () => {
      req.destroy();
      reject(new Error(`HTTP request timed out after ${HTTP_TIMEOUT_MS}ms`));
    });

    req.on('error', (err) => {
      reject(new Error(`HTTP request failed: ${err.message}`));
    });

    if (payload) req.write(payload);
    req.end();
  });
}

// =============================================================================
// TOOL DEFINITIONS
// =============================================================================

const TOOLS = [
  {
    name: 'spawn_child',
    description: 'Spawn a child agent session in its own git worktree. The child runs headlessly with full autonomy. Use for parallel subtasks, background work, or delegating focused work.',
    inputSchema: {
      type: 'object',
      properties: {
        prompt: {
          type: 'string',
          description: 'Full task brief for the child. Be specific — include scope, files to touch, acceptance criteria. The child has zero other context.',
        },
        description: {
          type: 'string',
          description: 'Short label (e.g. "login-form", "api-tests"). Used in branch name and sidebar. Auto-generated from prompt if omitted.',
        },
        model: {
          type: 'string',
          description: 'Model for the child: "haiku" (fast/cheap), "sonnet" (balanced), "opus" (most capable). Defaults to parent model.',
        },
        provider: {
          type: 'string',
          description: 'Agent provider. Default: "claude". Future-proofs non-Claude routing.',
        },
        baseRef: {
          type: 'string',
          description: 'Git ref to branch from. Defaults to parent HEAD.',
        },
      },
      required: ['prompt'],
    },
  },
  {
    name: 'list_children',
    description: 'List all child sessions spawned by the current parent session. Returns status, alive state, branch, description, and model for each child.',
    inputSchema: {
      type: 'object',
      properties: {},
    },
  },
];

// =============================================================================
// TOOL HANDLERS
// =============================================================================

async function handleSpawnChild(args) {
  if (!SESSION_ID) {
    return { isError: true, content: [{ type: 'text', text: 'RUDI_SESSION_ID not set. Cannot spawn children without a parent session ID.' }] };
  }

  const { prompt, description, model, provider, baseRef } = args;

  if (!prompt || typeof prompt !== 'string' || !prompt.trim()) {
    return { isError: true, content: [{ type: 'text', text: 'prompt is required and must be a non-empty string.' }] };
  }

  const body = {
    parentSessionId: SESSION_ID,
    prompt: prompt.trim(),
    origin: 'mcp_spawn_tool',
  };
  if (description) body.description = description;
  if (model) body.model = model;
  if (provider) body.provider = provider;
  if (baseRef) body.baseRef = baseRef;

  try {
    const resp = await httpRequest('POST', '/agent/spawn-child', body);

    if (resp.status >= 400) {
      const errMsg = resp.body?.message || resp.body?.error || JSON.stringify(resp.body);
      return { isError: true, content: [{ type: 'text', text: `Spawn failed (HTTP ${resp.status}): ${errMsg}` }] };
    }

    return { content: [{ type: 'text', text: JSON.stringify(resp.body, null, 2) }] };
  } catch (err) {
    return { isError: true, content: [{ type: 'text', text: `spawn_child error: ${err.message}` }] };
  }
}

async function handleListChildren() {
  if (!SESSION_ID) {
    return { isError: true, content: [{ type: 'text', text: 'RUDI_SESSION_ID not set. Cannot list children without a session ID.' }] };
  }

  try {
    const resp = await httpRequest('GET', `/agent/children/${SESSION_ID}`);

    if (resp.status >= 400) {
      const errMsg = resp.body?.message || resp.body?.error || JSON.stringify(resp.body);
      return { isError: true, content: [{ type: 'text', text: `List children failed (HTTP ${resp.status}): ${errMsg}` }] };
    }

    return { content: [{ type: 'text', text: JSON.stringify(resp.body, null, 2) }] };
  } catch (err) {
    return { isError: true, content: [{ type: 'text', text: `list_children error: ${err.message}` }] };
  }
}

// =============================================================================
// JSON-RPC HANDLER
// =============================================================================

async function handleRequest(request) {
  const response = {
    jsonrpc: '2.0',
    id: request.id ?? null,
  };

  try {
    switch (request.method) {
      case 'initialize':
        response.result = {
          protocolVersion: PROTOCOL_VERSION,
          capabilities: { tools: {} },
          serverInfo: { name: 'rudi-spawn', version: '1.0.0' },
        };
        break;

      case 'notifications/initialized':
        return null; // no response for notifications

      case 'tools/list':
        response.result = { tools: TOOLS };
        break;

      case 'tools/call': {
        const { name, arguments: args } = request.params || {};
        if (name === 'spawn_child') {
          response.result = await handleSpawnChild(args || {});
        } else if (name === 'list_children') {
          response.result = await handleListChildren();
        } else {
          response.error = { code: -32602, message: `Unknown tool: ${name}` };
        }
        break;
      }

      case 'ping':
        response.result = {};
        break;

      default:
        if (request.id !== null && request.id !== undefined) {
          response.error = { code: -32601, message: `Method not found: ${request.method}` };
        } else {
          return null; // notification — no response
        }
    }
  } catch (err) {
    response.error = { code: -32603, message: err.message || 'Internal error' };
  }

  return response;
}

// =============================================================================
// MAIN — readline loop on stdin, write JSON + \n to stdout
// =============================================================================

async function main() {
  log('Starting RUDI Spawn MCP Server');
  log(`Sidecar URL: ${SIDECAR_URL || '(not set)'}`);
  log(`Session ID: ${SESSION_ID ? SESSION_ID.slice(0, 8) + '...' : '(not set)'}`);

  if (!SIDECAR_URL || !SIDECAR_TOKEN || !SESSION_ID) {
    log('WARNING: Missing env vars — tools will return errors on call');
  }

  const rl = readline.createInterface({ input: process.stdin, terminal: false });

  rl.on('line', async (line) => {
    try {
      const request = JSON.parse(line);
      debug(`Received: ${line.slice(0, 200)}`);

      const response = await handleRequest(request);

      if (response !== null) {
        const responseStr = JSON.stringify(response);
        debug(`Sending: ${responseStr.slice(0, 200)}`);
        process.stdout.write(responseStr + '\n');
      }
    } catch (err) {
      const errorResponse = {
        jsonrpc: '2.0',
        id: null,
        error: { code: -32700, message: `Parse error: ${err.message}` },
      };
      process.stdout.write(JSON.stringify(errorResponse) + '\n');
    }
  });

  rl.on('close', () => {
    log('stdin closed, shutting down');
    process.exit(0);
  });

  process.on('SIGTERM', () => {
    log('SIGTERM received, shutting down');
    process.exit(0);
  });

  process.on('SIGINT', () => {
    log('SIGINT received, shutting down');
    process.exit(0);
  });
}

main().catch((err) => {
  log(`Fatal error: ${err.message}`);
  process.exit(1);
});
