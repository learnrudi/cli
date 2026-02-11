/**
 * Agent route handler factory — builds shared context and composes all route modules.
 */

import { ensurePermissionHook } from './permissions.js';
import { buildPermissionRoutes } from './permissions.js';
import { buildStartRoute } from './routes/start.js';
import { buildLifecycleRoutes } from './routes/lifecycle.js';
import { buildSpawnChildRoutes } from './routes/spawn-child.js';
import { buildWorktreeRoutes } from './routes/worktree-routes.js';

export function createAgentHandler({
  log,
  broadcast,
  json,
  error,
  readBody,
  agentProcesses,
  queueSessionsUpdated,
  resumeSessionIndex = new Map(),
  maxConcurrent = 6,
  getSidecarPort = () => 0,
  getSidecarToken = () => '',
}) {
  // Rate limit tracking for spawn-child (per parent, in-memory)
  const spawnRateMap = new Map();
  const MAX_SPAWNS_PER_WINDOW = 3;
  const SPAWN_RATE_WINDOW_MS = 10_000;
  const MAX_CHILDREN_PER_PARENT = 5;

  // Permission state (shared across all routes)
  const pendingPermissions = new Map();
  const sessionAlwaysAllowed = new Map();

  // Shared context object passed to all route builders
  const ctx = {
    log, broadcast, json, error, readBody,
    agentProcesses, queueSessionsUpdated, resumeSessionIndex,
    maxConcurrent, getSidecarPort, getSidecarToken,
    pendingPermissions, sessionAlwaysAllowed,
    spawnRateMap, MAX_SPAWNS_PER_WINDOW, SPAWN_RATE_WINDOW_MS, MAX_CHILDREN_PER_PARENT,
  };

  // Install permission hook on handler creation
  try { ensurePermissionHook(log); } catch (err) {
    log('agent', 'warn', `ensurePermissionHook failed: ${err.message}`);
  }

  // Build route handlers
  const routeStart = buildStartRoute(ctx);
  const routeLifecycle = buildLifecycleRoutes(ctx);
  const routePermissions = buildPermissionRoutes(ctx);
  const routeSpawnChild = buildSpawnChildRoutes(ctx);
  const routeWorktree = buildWorktreeRoutes(ctx);

  return async function handleAgent(req, res, url) {
    return await routeStart(req, res, url)
      || await routeLifecycle(req, res, url)
      || await routePermissions(req, res, url)
      || await routeWorktree(req, res, url)
      || await routeSpawnChild(req, res, url)
      || false;
  };
}
