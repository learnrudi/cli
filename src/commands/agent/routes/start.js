/**
 * POST /agent/start — spawn a persistent agent process with streaming stdin/stdout.
 * Provider-agnostic: uses declarative configs from providers/*.json.
 */

import os from 'os';
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { execSync } from 'child_process';
import { PATHS } from '@learnrudi/env';
import { loadProviderConfig, resolveProviderBinary, buildArgs, getPermissionArgs, buildEnv, hasCapability, expandConditional } from '../providers/index.js';
import { buildSystemPrompt } from '../prompts.js';
import { dbWrite, resolveDb, transitionSessionStatus } from '../db.js';
import { resolveReusableEntry, countAlive, buildUserInputEvent, dropResumeMappingsForSession } from '../helpers.js';
import { getRepoRoot, createSessionWorktree, restoreSessionWorktree } from '../worktree.js';
import { spawnAgentProcess } from '../spawn-process.js';

const MAX_AGENT_BODY_SIZE = 50 * 1024 * 1024; // allow image attachments
const SPAWN_CHILD_ALLOWED_TOOLS = [
  'mcp__rudi-spawn__spawn_child',
  'mcp__rudi-spawn__list_children',
];

export function buildStartRoute(ctx) {
  const {
    json, error, readBody, log, broadcast,
    agentProcesses, queueSessionsUpdated, resumeSessionIndex,
    maxConcurrent, getSidecarPort, getSidecarToken,
    pendingPermissions, sessionAlwaysAllowed,
  } = ctx;

  // Track in-flight start operations per resumeSessionId to prevent duplicate spawns
  const pendingStarts = new Map(); // resumeSessionId → Promise<response>

  return async (req, res, url) => {
    if (req.method !== 'POST' || url.pathname !== '/agent/start') return false;

    const body = await readBody(req, { maxBodySize: MAX_AGENT_BODY_SIZE });
    log('agent', 'info', 'received /agent/start request', { bodyKeys: Object.keys(body), resumeSessionId: body.resumeSessionId || null });
    const {
      prompt,
      provider: requestedProvider,
      model,
      systemPrompt,
      resumeSessionId,
      cwd,
      permissionMode,
      planMode,
      images,
      useWorktree,
      parentSessionId,
    } = body;
    const provider = requestedProvider || 'claude';
    const isChildSession = Boolean(parentSessionId);

    // Load provider config — fail fast if unknown
    let providerConfig;
    try {
      providerConfig = loadProviderConfig(provider);
    } catch (configErr) {
      return error(res, configErr.message, 400);
    }
    let shouldUseWorktree = useWorktree !== false;
    // Belt-and-suspenders: child sessions are always isolated.
    if (isChildSession) shouldUseWorktree = true;

    if (!prompt && (!images || images.length === 0)) return error(res, 'prompt required');

    // If resuming a session that already has a running process, reuse it
    if (resumeSessionId) {
      const reusable = resolveReusableEntry(resumeSessionId, { agentProcesses, resumeSessionIndex });
      if (reusable) {
        const { sessionId: existingId, entry } = reusable;
        log('agent', 'info', `reusing existing process for resume ${resumeSessionId.slice(0, 8)}`, {
          existingSessionId: existingId.slice(0, 8),
        });
        entry.turnActive = true;
        entry.lastActivityAt = Date.now();
        // Reset per-turn accumulators for the new turn
        entry._turnPrompt = prompt;
        entry._turnInputTokens = 0;
        entry._turnOutputTokens = 0;
        entry._turnCacheReadTokens = 0;
        entry._turnCacheCreationTokens = 0;
        entry._turnToolsUsed = [];
        if (entry._normalizer) entry._normalizer.reset();
        // 4j. Reuse — touch updated_at
        dbWrite((db) => {
          db.prepare(`
            UPDATE session_runtime_state SET updated_at = ? WHERE session_id = ?
          `).run(new Date().toISOString(), existingId);
        });
        const inputMsg = JSON.stringify(buildUserInputEvent(prompt, images, entry.cwd, log)) + '\n';
        if (!entry.proc.stdin.writable) {
          log('agent', 'warn', 'reused process stdin not writable, cannot resume', { sessionId: existingId.slice(0, 8) });
          // Fall through to spawn a new process instead of returning early
        } else {
          entry.proc.stdin.write(inputMsg);
          broadcast('agent:event', {
            sessionId: existingId,
            event: { type: 'system', message: 'Resumed existing process' },
          });
          return json(res, {
            sessionId: existingId,
            provider: entry.provider,
            reused: true,
            cwd: entry.cwd,
            useWorktree: Boolean(entry.worktreePath),
          });
        }
      }
    }

    // If another request is already starting this resumeSessionId, wait for it
    if (resumeSessionId && pendingStarts.has(resumeSessionId)) {
      log('agent', 'info', 'concurrent start for same session, waiting for in-flight request', { resumeSessionId: resumeSessionId.slice(0, 8) });
      try {
        const result = await pendingStarts.get(resumeSessionId);
        return json(res, { ...result, reused: true });
      } catch (err) {
        // In-flight request failed, fall through to start a new one
        log('agent', 'warn', 'in-flight start failed, proceeding with new start', { resumeSessionId: resumeSessionId.slice(0, 8), error: err.message });
      }
    }

    // Enforce max concurrent process limit
    const aliveCount = countAlive(agentProcesses);
    if (aliveCount >= maxConcurrent) {
      log('agent', 'warn', `max concurrent limit reached (${aliveCount}/${maxConcurrent})`);
      json(res, {
        error: `Too many active agent processes (${aliveCount}/${maxConcurrent}). Stop an existing session or wait for one to finish.`,
      }, 429);
      return true;
    }

    const binaryPath = resolveProviderBinary(providerConfig);
    if (!binaryPath) {
      log('agent', 'error', `${providerConfig.name} CLI not found`);
      return error(res, `${providerConfig.name} CLI not found. Run: rudi install agent:${provider}`, 500);
    }

    const sessionId = crypto.randomUUID();
    const shortId = sessionId.slice(0, 8);
    if (resumeSessionId) {
      resumeSessionIndex.set(resumeSessionId, sessionId);
    }

    // Register this start operation to prevent duplicate concurrent spawns
    let resolvePending, rejectPending;
    if (resumeSessionId) {
      const p = new Promise((resolve, reject) => { resolvePending = resolve; rejectPending = reject; });
      pendingStarts.set(resumeSessionId, p);
    }

    // --- Build args from provider config ---
    const canSpawnChildren = getSidecarPort() > 0;
    const fullSystemPrompt = buildSystemPrompt(systemPrompt, { canSpawnChildren });

    // Resolve resume provider session ID from DB
    let resolvedResumeSid = null;
    if (resumeSessionId && hasCapability(providerConfig, 'sessionResume')) {
      const db = resolveDb();
      if (db) {
        try {
          const row = db.prepare(`
            SELECT provider_session_id FROM session_runtime_state
            WHERE session_id = ? OR resume_session_id = ? OR provider_session_id = ?
          `).get(resumeSessionId, resumeSessionId, resumeSessionId);
          resolvedResumeSid = row?.provider_session_id || null;
        } catch (err) {
          log('agent', 'warn', `Failed to look up provider session ID: ${err.message}`, { resumeSessionId: resumeSessionId.slice(0, 8) });
        }
      }
      if (!resolvedResumeSid && resumeSessionId.length > 20) {
        resolvedResumeSid = resumeSessionId;
      }
      if (resolvedResumeSid) {
        log('agent', 'info', `resuming with provider session: ${resolvedResumeSid.slice(0, 8)}`, { resumeSessionId: resumeSessionId.slice(0, 8) });
      } else {
        log('agent', 'warn', `No provider session ID found for resume, starting fresh session`, { resumeSessionId: resumeSessionId.slice(0, 8) });
      }
    }

    // Resolve permission mode to config key
    let permissionModeKey = null;
    if (planMode && hasCapability(providerConfig, 'planMode')) {
      permissionModeKey = 'plan';
    } else if (permissionMode === 'dangerouslySkipPermissions') {
      permissionModeKey = 'agent';
    } else {
      // Map sidecar permission modes to provider config keys
      const modeMap = {
        bypassPermissions: 'bypassPermissions',
        plan: 'plan',
        acceptEdits: 'acceptEdits',
        delegate: 'delegate',
        dontAsk: 'dontAsk',
        default: 'default',
        // Codex equivalents
        fullAuto: 'agent',
        dangerous: 'dangerous',
        approve: 'approve',
        readonly: 'readonly',
        fullAccess: 'fullAccess',
      };
      const requested = permissionMode || 'bypassPermissions';
      permissionModeKey = modeMap[requested] || requested;
    }

    // Build args using provider config
    const argOptions = { prompt, model };
    const stdinMode = providerConfig.headless.stdin;

    // Provider-specific arg options (Claude)
    if (hasCapability(providerConfig, 'systemPrompt') && fullSystemPrompt) {
      argOptions.systemPrompt = fullSystemPrompt;
    }
    if (resolvedResumeSid) {
      argOptions.resumeSessionId = resolvedResumeSid;
    }
    if (stdinMode === 'pipe' && hasCapability(providerConfig, 'inputStreaming')) {
      argOptions.print = true;
      argOptions.inputFormat = 'stream-json';
      // Prompt delivered via stdin, not -p arg
      delete argOptions.prompt;
    }

    const args = buildArgs(providerConfig, argOptions);

    // Permission mode args
    if (permissionModeKey) {
      const modes = providerConfig.headless.permissionModes;
      if (modes[permissionModeKey]) {
        args.push(...getPermissionArgs(providerConfig, permissionModeKey));
      } else {
        // Fall back: use most permissive mode available for this provider
        const fallbackKey = modes.agent ? 'agent' : Object.keys(modes)[0];
        if (fallbackKey) {
          args.push(...getPermissionArgs(providerConfig, fallbackKey));
          log('agent', 'info', `permission mode '${permissionModeKey}' not available for ${provider}, using '${fallbackKey}'`);
        }
      }
    }

    // Pre-allow spawn tools for headless sessions (Claude-specific capability)
    if (canSpawnChildren && hasCapability(providerConfig, 'subagents')) {
      args.push(...expandConditional(providerConfig, 'allowedTools', SPAWN_CHILD_ALLOWED_TOOLS));
    }

    // MCP config injection (only for providers that support it)
    let mcpConfigPath = null;
    if (canSpawnChildren && hasCapability(providerConfig, 'mcpConfig')) {
      const spawnShimPath = path.join(PATHS.home, 'bins', 'rudi-spawn');
      const routerShimPath = path.join(PATHS.home, 'bins', 'rudi-router');
      if (fs.existsSync(spawnShimPath)) {
        try {
          let existingMcpServers = {};
          const claudeJsonPath = path.join(os.homedir(), '.claude.json');
          try {
            const claudeJson = JSON.parse(fs.readFileSync(claudeJsonPath, 'utf-8'));
            existingMcpServers = claudeJson.mcpServers || {};
          } catch {
            // No ~/.claude.json or malformed
          }

          const mergedConfig = {
            mcpServers: {
              ...existingMcpServers,
              'rudi-spawn': { command: spawnShimPath, args: [] },
              ...(fs.existsSync(routerShimPath) ? { 'rudi': { command: routerShimPath, args: [] } } : {}),
            },
          };

          const tmpDir = path.join(PATHS.home, 'tmp');
          fs.mkdirSync(tmpDir, { recursive: true });
          mcpConfigPath = path.join(tmpDir, `spawn-mcp-${shortId}.json`);
          fs.writeFileSync(mcpConfigPath, JSON.stringify(mergedConfig, null, 2), { mode: 0o600 });

          args.push(
            ...expandConditional(providerConfig, 'mcpConfig', mcpConfigPath),
            ...expandConditional(providerConfig, 'strictMcpConfig', true),
          );

          log('agent', 'info', `injected spawn MCP config: ${mcpConfigPath}`, { sessionId: shortId, serverCount: Object.keys(mergedConfig.mcpServers).length });
        } catch (mcpErr) {
          log('agent', 'warn', `MCP config injection failed: ${mcpErr.message}`, { sessionId: shortId });
        }
      }
    }

    // Build env from provider config (merges headless.env + auth env vars)
    const configEnv = buildEnv(providerConfig, process.env);
    const env = {
      ...process.env,
      ...configEnv,
    };
    const port = getSidecarPort();
    if (port > 0) {
      env.RUDI_SIDECAR_URL = `http://127.0.0.1:${port}`;
      env.RUDI_SIDECAR_TOKEN = getSidecarToken();
      env.RUDI_SESSION_ID = sessionId;
      env.RUDI_CAN_SPAWN_CHILDREN = '1';
    }

    const workingDir = cwd || process.env.HOME || os.homedir();

    // Detect git repo + branch
    let currentBranch = null;
    let repoRoot = null;
    let isGitRepo = false;
    try {
      execSync('git rev-parse --is-inside-work-tree', { cwd: workingDir, stdio: 'pipe' });
      repoRoot = getRepoRoot(workingDir);
      currentBranch = execSync('git rev-parse --abbrev-ref HEAD', { cwd: workingDir, stdio: 'pipe' }).toString().trim();
      isGitRepo = true;
    } catch {
      isGitRepo = false;
      repoRoot = null;
      currentBranch = null;
    }

    // Worktree isolation
    let worktreePath = null;
    let worktreeBranch = null;
    let baseBranch = currentBranch;
    let gitignoreWarning = false;
    let effectiveCwd = workingDir;

    if (isGitRepo && repoRoot && currentBranch) {
      if (!resumeSessionId) {
        if (shouldUseWorktree) {
          const wt = createSessionWorktree({ repoRoot, currentBranch, shortId, log });
          if (wt.worktreePath) {
            worktreePath = wt.worktreePath;
            worktreeBranch = wt.worktreeBranch;
            effectiveCwd = wt.worktreePath;
            gitignoreWarning = wt.gitignoreWarning;
          }
        }
      } else {
        const restored = restoreSessionWorktree({ resumeSessionId, repoRoot, currentBranch, shortId, log });
        if (restored.worktreePath) {
          worktreePath = restored.worktreePath;
          worktreeBranch = restored.worktreeBranch;
          baseBranch = restored.baseBranch;
          effectiveCwd = restored.worktreePath;
        }
      }
    }

    const resolvedUseWorktree = Boolean(worktreePath);

    // Validate spawn cwd
    let spawnCwd = effectiveCwd;
    try {
      const st = fs.statSync(spawnCwd);
      if (!st.isDirectory()) throw new Error('not_a_directory');
    } catch {
      const cwdFallbacks = [workingDir, repoRoot, process.env.HOME, os.homedir()]
        .filter((p) => typeof p === 'string' && p.length > 0);
      const fallback = cwdFallbacks.find((p) => {
        try {
          return fs.statSync(p).isDirectory();
        } catch {
          return false;
        }
      });
      if (fallback) {
        log('agent', 'warn', `spawn cwd missing, falling back to: ${fallback}`, {
          sessionId: shortId,
          missingCwd: effectiveCwd,
        });
        spawnCwd = fallback;
        effectiveCwd = fallback;
      }
    }

    log('agent', 'info', `spawning ${provider} agent`, {
      sessionId: shortId,
      provider,
      binary: binaryPath,
      cwd: spawnCwd,
      worktreeBranch,
      prompt: (prompt || '').slice(0, 80),
      resumeSessionId: resumeSessionId || null,
    });

    // 4a. Session start — insert runtime state row before spawn
    dbWrite((db) => {
      const now = new Date().toISOString();
      db.prepare(`
        INSERT INTO session_runtime_state
          (session_id, status, provider, resume_session_id, cwd, started_at, updated_at,
           worktree_path, worktree_branch, project_root, base_branch, use_worktree, execution_mode)
        VALUES (?, 'starting', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(sessionId, provider, resumeSessionId || null, effectiveCwd, now, now,
             worktreePath, worktreeBranch, repoRoot, baseBranch, resolvedUseWorktree ? 1 : 0,
             resolvedUseWorktree ? 'worktree' : 'shared_cwd');
    });

    try {
      spawnAgentProcess(ctx, {
        sessionId,
        prompt,
        provider,
        model,
        permissionMode: permissionMode || null,
        systemPrompt: fullSystemPrompt || null,
        providerConfig,
        binaryPath,
        args,
        env,
        spawnCwd,
        effectiveCwd,
        workingDir,
        repoRoot,
        worktreePath,
        worktreeBranch,
        baseBranch,
        resumeSessionId: resumeSessionId || null,
        images,
        mcpConfigPath,
        sessionRowMode: 'providerSessionId',
        autoNameOnFirstTurn: true,
        setRunningOnCapture: true,
        queueEvent: 'result',
        queueCloseEvent: 'process-close',
      });

      const responsePayload = {
        sessionId,
        provider,
        cwd: effectiveCwd,
        currentBranch,
        repoRoot,
        worktreeBranch: worktreeBranch || undefined,
        projectCwd: worktreePath ? workingDir : undefined,
        baseBranch: baseBranch || undefined,
        gitignoreWarning: gitignoreWarning || undefined,
        useWorktree: resolvedUseWorktree,
      };

      if (resolvePending) resolvePending(responsePayload);
      json(res, responsePayload);
    } catch (err) {
      if (rejectPending) rejectPending(err);
      dropResumeMappingsForSession(sessionId, resumeSessionIndex);
      // 4f. Spawn catch
      dbWrite((db) => {
        transitionSessionStatus(db, sessionId, 'error', {
          lastError: err.message,
          completedAt: new Date().toISOString(),
        });
      });
      log('agent', 'error', `Failed to spawn: ${err.message}`);
      error(res, `Failed to spawn agent: ${err.message}`, 500);
    } finally {
      if (resumeSessionId) pendingStarts.delete(resumeSessionId);
    }
    return true;
  };
}
