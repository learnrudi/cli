/**
 * Permission management — helpers, project-level persistence, and route handlers.
 */

import os from 'os';
import fs from 'fs';
import path from 'path';
import { PATHS } from '@learnrudi/env';

// ---------------------------------------------------------------------------
// Pure helpers
// ---------------------------------------------------------------------------

/** Derive a batch ID from (session + tool + 500ms time bucket). */
export function deriveBatchId(rudiSessionId, toolName, createdAt) {
  const bucket = Math.floor(createdAt / 500);
  return `${rudiSessionId}:${toolName || ''}:${bucket}`;
}

/** Resolve a single pending permission entry. */
export function resolvePermission(reqId, entry, decision) {
  if (entry.status !== 'pending') return; // idempotent
  entry.status = 'decided';
  entry.decision = decision;
  if (entry.resolve) {
    entry.resolve(decision);
    entry.resolve = null;
  }
  if (entry.timer) {
    clearTimeout(entry.timer);
    entry.timer = null;
  }
}

// ---------------------------------------------------------------------------
// Project-level permission persistence (.claude/settings.local.json)
// ---------------------------------------------------------------------------

/** Load allowed tool patterns from a project's .claude/settings.local.json */
export function loadProjectPermissions(projectCwd) {
  try {
    const settingsPath = path.join(projectCwd, '.claude', 'settings.local.json');
    if (!fs.existsSync(settingsPath)) return [];
    const settings = JSON.parse(fs.readFileSync(settingsPath, 'utf-8'));
    return settings?.permissions?.allow || [];
  } catch {
    return [];
  }
}

/** Check if a tool call matches a Claude CLI permission pattern */
export function toolMatchesPattern(toolName, toolInput, pattern) {
  // Simple match: "Edit", "Read", "WebSearch", etc.
  if (pattern === toolName) return true;

  // Parameterized match: "Bash(prefix:*)" or "WebFetch(domain:x)"
  const m = pattern.match(/^(\w+)\((.+)\)$/);
  if (!m) return false;
  const [, patternTool, patternArgs] = m;
  if (patternTool !== toolName) return false;

  if (toolName === 'Bash' && toolInput?.command) {
    const command = String(toolInput.command).trim();
    if (patternArgs.endsWith(':*')) {
      const prefix = patternArgs.slice(0, -2);
      return command.startsWith(prefix);
    }
    return command === patternArgs;
  }
  return false;
}

/** Check if a tool call is allowed by project settings */
export function isToolAllowedByProject(projectCwd, toolName, toolInput) {
  if (!projectCwd) return false;
  const patterns = loadProjectPermissions(projectCwd);
  return patterns.some((p) => toolMatchesPattern(toolName, toolInput, p));
}

/** Generate a Claude CLI permission pattern for a tool call */
export function generatePermissionPattern(toolName, toolInput) {
  if (toolName === 'Bash' && toolInput?.command) {
    const cmd = String(toolInput.command).trim();
    const tokens = cmd.split(/\s+/);
    const compound = ['git', 'npm', 'npx', 'pnpm', 'cargo', 'docker', 'kubectl', 'yarn', 'bun'];
    const prefix = (tokens.length >= 2 && compound.includes(tokens[0]))
      ? tokens.slice(0, 2).join(' ')
      : tokens[0];
    return `Bash(${prefix}:*)`;
  }
  return toolName;
}

/** Append a permission pattern to a project's .claude/settings.local.json */
export function saveToolPermission(projectCwd, pattern, log) {
  try {
    const settingsPath = path.join(projectCwd, '.claude', 'settings.local.json');
    let settings = {};
    if (fs.existsSync(settingsPath)) {
      settings = JSON.parse(fs.readFileSync(settingsPath, 'utf-8'));
    }
    if (!settings.permissions) settings.permissions = {};
    if (!Array.isArray(settings.permissions.allow)) settings.permissions.allow = [];
    if (settings.permissions.allow.includes(pattern)) return; // already exists
    settings.permissions.allow.push(pattern);
    fs.mkdirSync(path.dirname(settingsPath), { recursive: true });
    fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2) + '\n');
    log('agent', 'info', 'saved tool permission to settings.local.json', { pattern, path: settingsPath });
  } catch (err) {
    log('agent', 'warn', `failed to save tool permission: ${err.message}`);
  }
}

// ---------------------------------------------------------------------------
// ensurePermissionHook — install/update the hook script + settings.json entry
// ---------------------------------------------------------------------------

export function ensurePermissionHook(log) {
  const hookBinPath = path.join(PATHS.home, 'bins', 'permission-hook');
  const hookScriptPath = path.join(PATHS.home, 'router', 'permission-hook.js');
  const settingsPath = path.join(os.homedir(), '.claude', 'settings.json');

  // 1. Shell shim
  if (!fs.existsSync(hookBinPath)) {
    const nodeBin = path.join(PATHS.home, 'runtimes', 'node', 'bin', 'node');
    const shim = [
      '#!/bin/sh',
      '# RUDI Permission Hook - Routes CLI tool approvals through RUDI sidecar',
      `RUDI_HOME="$HOME/.rudi"`,
      `NODE_BIN="${nodeBin}"`,
      'if [ -x "$NODE_BIN" ]; then',
      '  exec "$NODE_BIN" "$RUDI_HOME/router/permission-hook.js" "$@"',
      'else',
      '  exec node "$RUDI_HOME/router/permission-hook.js" "$@"',
      'fi',
      '',
    ].join('\n');
    fs.writeFileSync(hookBinPath, shim, { mode: 0o755 });
    log('agent', 'info', 'installed permission hook shim', { path: hookBinPath });
  }

  // 2. Settings.json — add hooks.PreToolUse entry if not present
  try {
    let settings = {};
    if (fs.existsSync(settingsPath)) {
      settings = JSON.parse(fs.readFileSync(settingsPath, 'utf-8'));
    }
    if (!settings.hooks) settings.hooks = {};

    // Clean up old PermissionRequest entry if present
    if (settings.hooks.PermissionRequest) {
      delete settings.hooks.PermissionRequest;
    }

    const existing = settings.hooks.PreToolUse;
    const alreadyInstalled = Array.isArray(existing) && existing.some((entry) =>
      entry.hooks?.some((h) => h.command && h.command.includes('permission-hook')),
    );
    if (!alreadyInstalled) {
      settings.hooks.PreToolUse = [
        ...(Array.isArray(existing) ? existing : []),
        {
          matcher: '',
          hooks: [{
            type: 'command',
            command: hookBinPath,
            timeout: 600,
          }],
        },
      ];
      fs.mkdirSync(path.dirname(settingsPath), { recursive: true });
      fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2) + '\n');
      log('agent', 'info', 'installed PreToolUse hook in Claude settings', { path: settingsPath });
      log('agent', 'warn', 'Permission hook installed — you may need to approve it via /hooks in Claude CLI on first use');
    }
  } catch (err) {
    log('agent', 'warn', `failed to update Claude settings for permission hook: ${err.message}`);
  }
}

// ---------------------------------------------------------------------------
// Route handlers
// ---------------------------------------------------------------------------

export function buildPermissionRoutes(ctx) {
  const { json, error, readBody, log, broadcast, agentProcesses, pendingPermissions, sessionAlwaysAllowed } = ctx;

  return async (req, res, url) => {
    // POST /agent/permission-request (called by PreToolUse hook script)
    if (req.method === 'POST' && url.pathname === '/agent/permission-request') {
      const body = await readBody(req);
      const { rudiSessionId, claudeSessionId, requestId, toolName, toolInput } = body;
      if (!requestId || !rudiSessionId) return error(res, 'requestId and rudiSessionId required');

      const createdAt = Date.now();
      const batchId = deriveBatchId(rudiSessionId, toolName, createdAt);

      log('agent', 'info', 'permission request from hook', {
        requestId: requestId.slice(0, 8),
        rudiSessionId: rudiSessionId.slice(0, 8),
        toolName,
        batchId: batchId.slice(-12),
      });

      // Check if this tool is auto-allowed for this session (in-memory "Always")
      const allowed = sessionAlwaysAllowed.get(rudiSessionId);
      if (allowed && allowed.has(toolName)) {
        log('agent', 'debug', 'auto-allowing tool (session always-allowed)', { toolName, sessionId: rudiSessionId.slice(0, 8) });
        pendingPermissions.set(requestId, {
          rudiSessionId,
          claudeSessionId,
          toolName,
          toolInput,
          batchId,
          status: 'decided',
          decision: { permissionDecision: 'allow', reason: 'Auto-allowed by user in RUDI' },
          resolve: null,
          timer: null,
          createdAt,
        });
        json(res, { ok: true });
        return true;
      }

      // Check project-level .claude/settings.local.json permissions
      const processEntry = agentProcesses.get(rudiSessionId);
      const projectCwd = processEntry?.cwd;
      if (projectCwd && isToolAllowedByProject(projectCwd, toolName, toolInput)) {
        log('agent', 'debug', 'auto-allowing tool (project settings)', { toolName, sessionId: rudiSessionId.slice(0, 8) });
        pendingPermissions.set(requestId, {
          rudiSessionId,
          claudeSessionId,
          toolName,
          toolInput,
          batchId,
          status: 'decided',
          decision: { permissionDecision: 'allow', reason: 'Allowed by project settings' },
          resolve: null,
          timer: null,
          createdAt,
        });
        json(res, { ok: true });
        return true;
      }

      // Format a human-readable message
      let message = `Allow **${toolName || 'tool'}**?`;
      if (toolInput) {
        if (toolName === 'Bash' && toolInput.command) {
          message = `Allow **Bash**: \`${String(toolInput.command).slice(0, 200)}\`?`;
        } else if ((toolName === 'Write' || toolName === 'Edit') && toolInput.file_path) {
          message = `Allow **${toolName}**: \`${toolInput.file_path}\`?`;
        } else if (toolName === 'Read' && toolInput.file_path) {
          message = `Allow **Read**: \`${toolInput.file_path}\`?`;
        }
      }

      pendingPermissions.set(requestId, {
        rudiSessionId,
        claudeSessionId,
        toolName,
        toolInput,
        batchId,
        status: 'pending',
        decision: null,
        resolve: null,
        timer: null,
        createdAt,
      });

      // Broadcast to frontend
      broadcast('agent:event', {
        sessionId: rudiSessionId,
        event: {
          type: 'system',
          subtype: 'permission_request',
          requestId,
          batchId,
          toolName: toolName || 'unknown',
          toolInput: toolInput || {},
          message,
        },
      });

      json(res, { ok: true });
      return true;
    }

    // GET /agent/permission-decision/:requestId (long-poll, called by hook script)
    const permDecisionMatch = url.pathname.match(/^\/agent\/permission-decision\/([^/]+)$/);
    if (req.method === 'GET' && permDecisionMatch) {
      const requestId = decodeURIComponent(permDecisionMatch[1]);
      const entry = pendingPermissions.get(requestId);

      if (!entry) {
        json(res, { permissionDecision: 'deny', reason: 'Unknown permission request' });
        return true;
      }

      // Already decided (idempotent — hook can retry safely)
      if (entry.status === 'decided' && entry.decision) {
        const decision = entry.decision;
        pendingPermissions.delete(requestId);
        json(res, decision);
        return true;
      }

      // Already expired
      if (entry.status === 'expired') {
        pendingPermissions.delete(requestId);
        json(res, { permissionDecision: 'deny', reason: 'Request expired' });
        return true;
      }

      // Hold connection open until decision arrives or timeout
      const TIMEOUT_MS = 590_000; // Just under CLI's 600s hook timeout
      const timer = setTimeout(() => {
        entry.status = 'expired';
        entry.resolve = null;
        pendingPermissions.delete(requestId);
        json(res, { permissionDecision: 'deny', reason: 'Timed out waiting for user decision' });
      }, TIMEOUT_MS);

      entry.timer = timer;
      entry.resolve = (decision) => {
        clearTimeout(timer);
        pendingPermissions.delete(requestId);
        json(res, decision);
      };

      // Handle client disconnect
      req.on('close', () => {
        clearTimeout(timer);
        if (entry.resolve) entry.resolve = null;
      });

      return true;
    }

    // POST /agent/permission-response (called by frontend)
    if (req.method === 'POST' && url.pathname === '/agent/permission-response') {
      const body = await readBody(req);
      const { sessionId, response, requestId } = body;
      if (!response) return error(res, 'response required');

      // Hook-based flow: resolve via requestId
      if (requestId) {
        const entry = pendingPermissions.get(requestId);

        // Already resolved or expired — idempotent 200
        if (!entry || entry.status !== 'pending') {
          json(res, { ok: true, status: entry?.status || 'unknown' });
          return true;
        }

        let decision;
        if (response === 'y') {
          decision = { permissionDecision: 'allow', reason: 'Approved by user in RUDI' };
        } else if (response === 'a') {
          decision = { permissionDecision: 'allow', reason: 'Always allowed by user in RUDI' };
          // Record policy for this session (in-memory fast path)
          if (entry.toolName) {
            if (!sessionAlwaysAllowed.has(entry.rudiSessionId)) {
              sessionAlwaysAllowed.set(entry.rudiSessionId, new Set());
            }
            sessionAlwaysAllowed.get(entry.rudiSessionId).add(entry.toolName);
            log('agent', 'info', 'added to always-allowed', { toolName: entry.toolName, sessionId: entry.rudiSessionId.slice(0, 8) });

            // Persist to project .claude/settings.local.json
            const proc = agentProcesses.get(entry.rudiSessionId);
            if (proc?.cwd) {
              const pattern = generatePermissionPattern(entry.toolName, entry.toolInput);
              saveToolPermission(proc.cwd, pattern, log);
            }
          }
        } else {
          decision = { permissionDecision: 'deny', reason: 'Denied by user in RUDI' };
        }

        log('agent', 'info', 'permission response via hook', {
          requestId: requestId.slice(0, 8),
          response,
          permissionDecision: decision.permissionDecision,
          batchId: (entry.batchId || '').slice(-12),
        });

        // Resolve the target request
        resolvePermission(requestId, entry, decision);

        // Batch resolution: also resolve siblings in the same batch.
        if (decision.permissionDecision === 'allow' && entry.batchId) {
          let batchResolved = 0;
          for (const [otherId, other] of pendingPermissions) {
            if (otherId === requestId) continue;
            if (other.status !== 'pending') continue;
            const sameBatch = other.batchId === entry.batchId;
            const samePolicy = response === 'a'
              && other.rudiSessionId === entry.rudiSessionId
              && other.toolName === entry.toolName;
            if (sameBatch || samePolicy) {
              const batchDecision = { permissionDecision: 'allow', reason: 'Batch-resolved' };
              resolvePermission(otherId, other, batchDecision);
              batchResolved++;
            }
          }
          if (batchResolved > 0) {
            log('agent', 'info', `batch-resolved ${batchResolved} sibling(s)`, {
              batchId: entry.batchId.slice(-12),
            });
          }
        }

        json(res, { ok: true });
        return true;
      }

      // Legacy fallback: stdin-based (kept for backwards compat but unlikely to fire)
      if (!sessionId) return error(res, 'sessionId or requestId required');
      const agentEntry = agentProcesses.get(sessionId);
      if (!agentEntry || !agentEntry.proc || agentEntry.proc.killed) {
        return error(res, 'No active process for this session', 400);
      }

      log('agent', 'info', 'sending permission response (legacy stdin)', { sessionId: sessionId.slice(0, 8), response });
      try {
        agentEntry.lastActivityAt = Date.now();
        agentEntry.proc.stdin.write(response + '\n');
        json(res, { ok: true });
      } catch (err) {
        error(res, `Failed to send permission response: ${err.message}`, 500);
      }
      return true;
    }

    // GET /agent/permissions?sessionId=... — pending permission state for UI resync
    if (req.method === 'GET' && url.pathname === '/agent/permissions') {
      const sessionId = url.searchParams.get('sessionId');
      const pending = [];
      for (const [reqId, entry] of pendingPermissions) {
        if (entry.status !== 'pending') continue;
        if (sessionId && entry.rudiSessionId !== sessionId) continue;
        pending.push({
          requestId: reqId,
          batchId: entry.batchId,
          toolName: entry.toolName,
          toolInput: entry.toolInput,
          createdAt: entry.createdAt,
          rudiSessionId: entry.rudiSessionId,
        });
      }
      json(res, { pending });
      return true;
    }

    return false;
  };
}
