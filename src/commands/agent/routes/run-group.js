/**
 * Run-group routes: orchestrate parallel main sessions under a shared group.
 *
 * POST   /agent/run-group          create and launch a run group
 * GET    /agent/run-groups         list run groups
 * GET    /agent/run-group/:id      group detail + sessions
 * POST   /agent/run-group/:id/stop stop all active sessions in a group
 */

import os from 'os';
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { execSync, execFileSync } from 'child_process';
import { PATHS } from '@learnrudi/env';
import { getDb } from '@learnrudi/db';
import { transitionSessionStatus } from '../db.js';
import {
  loadProviderConfig,
  resolveProviderBinary,
  buildArgs,
  getPermissionArgs,
  buildEnv,
  hasCapability,
  expandConditional,
} from '../providers/index.js';
import {
  buildPhasePlan,
  normalizeCoordinationMode,
  normalizeExecutionMode,
  normalizeGroupTasks,
} from '../group-spec.js';
import {
  evaluateDependencyExecution,
  evaluatePhaseExecution,
  parseRunGroupConfig,
} from '../group-scheduler.js';
import { buildSystemPrompt } from '../prompts.js';
import { getRepoRoot, createSessionWorktree } from '../worktree.js';
import { spawnAgentProcess } from '../spawn-process.js';
import { countAlive } from '../helpers.js';
import {
  getDependencyArtifacts,
  getTaskArtifactAvailabilityMap,
  getTaskValidationResultMap,
  validateTaskContract,
} from '../contract-validator.js';
import { extractEventSnippet } from '../process-io.js';
import {
  createRunGroupCompletedEvent,
  createRunGroupFailureResult,
  createRunGroupSessionDoneEvent,
  createRunGroupStartedEvent,
  createRunGroupStoppedEvent,
  createRunGroupSuccessResult,
  loadRunGroup,
  refreshRunGroupAggregates,
  runGroupNotFound,
  stopActiveRunGroupSessions,
  withImmediateTransaction,
} from '../run-group-domain.js';
import { SIDECAR_ERROR_CODES } from '../../serve/error-codes.js';
import {
  projectRunGroupDetailSession,
  projectRunGroupLiveSession,
} from '../../../daemon/operations/run-groups.js';

const TERMINAL_GROUP_STATUSES = new Set(['completed', 'partial', 'failed', 'stopped']);
const SPAWN_CHILD_ALLOWED_TOOLS = [
  'mcp__rudi-spawn__spawn_child',
  'mcp__rudi-spawn__list_children',
];

function detectGitContext(workingDir) {
  try {
    execSync('git rev-parse --is-inside-work-tree', { cwd: workingDir, stdio: 'pipe' });
    return {
      isGitRepo: true,
      repoRoot: getRepoRoot(workingDir),
      currentBranch: execSync('git rev-parse --abbrev-ref HEAD', { cwd: workingDir, stdio: 'pipe' })
        .toString().trim(),
    };
  } catch {
    return {
      isGitRepo: false,
      repoRoot: null,
      currentBranch: null,
    };
  }
}

function appendContextArgs(args, providerConfig, contextPaths) {
  const normalized = [...new Set(
    (Array.isArray(contextPaths) ? contextPaths : [])
      .map((entry) => typeof entry === 'string' ? entry.trim() : '')
      .filter(Boolean)
  )];
  if (normalized.length === 0) return;

  const addDirsArgs = expandConditional(providerConfig, 'addDirs', normalized);
  if (addDirsArgs.length > 0) {
    args.push(...addDirsArgs);
    return;
  }

  for (const contextPath of normalized) {
    const addDirArgs = expandConditional(providerConfig, 'addDir', contextPath);
    if (addDirArgs.length > 0) {
      args.push(...addDirArgs);
    }
  }
}

function appendAllowedToolsArgs(args, providerConfig, allowedTools) {
  const normalized = [...new Set(
    (Array.isArray(allowedTools) ? allowedTools : [])
      .map((entry) => typeof entry === 'string' ? entry.trim() : '')
      .filter(Boolean)
  )];
  if (normalized.length === 0) return;
  args.push(...expandConditional(providerConfig, 'allowedTools', normalized));
}

function resolveInputPaths(inputSpecs, workingDir) {
  const resolvedPaths = [];
  const contextPaths = [];

  for (const input of Array.isArray(inputSpecs) ? inputSpecs : []) {
    const resolvedPath = path.isAbsolute(input.path)
      ? input.path
      : path.resolve(workingDir, input.path);
    if (!fs.existsSync(resolvedPath)) {
      if (input.optional) continue;
      throw new Error(`input missing: ${input.path}`);
    }
    const stat = fs.statSync(resolvedPath);
    if (input.type === 'directory' && !stat.isDirectory()) {
      throw new Error(`input is not a directory: ${input.path}`);
    }
    if (input.type === 'file' && !stat.isFile()) {
      throw new Error(`input is not a file: ${input.path}`);
    }
    resolvedPaths.push(resolvedPath);
    if (input.type === 'directory') {
      contextPaths.push(resolvedPath);
    } else {
      contextPaths.push(path.dirname(resolvedPath));
    }
  }

  return { resolvedPaths, contextPaths };
}

function buildTaskPrompt(task, { inputPaths = [], dependencyArtifacts = [] } = {}) {
  const contractLines = [];
  if (task.scope) contractLines.push(`Scope: ${task.scope}`);
  if (task.role) contractLines.push(`Role: ${task.role}`);
  if (task.goal) contractLines.push(`Goal: ${task.goal}`);
  if (task.deliverable) contractLines.push(`Deliverable: ${task.deliverable}`);
  if (Array.isArray(task.filesTouched) && task.filesTouched.length > 0) {
    contractLines.push(`Preferred files: ${task.filesTouched.join(', ')}`);
  }
  if (task.output?.path) {
    contractLines.push(`Write your primary output to: ${task.output.path}`);
  }

  const artifactLines = [];
  for (const artifact of dependencyArtifacts) {
    artifactLines.push(`Dependency artifact: ${artifact.path}`);
  }
  for (const inputPath of inputPaths) {
    artifactLines.push(`Input path: ${inputPath}`);
  }

  const sections = [task.prompt];
  if (contractLines.length > 0) {
    sections.push(`Task contract:\n- ${contractLines.join('\n- ')}`);
  }
  if (artifactLines.length > 0) {
    sections.push(`Available context:\n- ${artifactLines.join('\n- ')}`);
  }
  return sections.join('\n\n');
}

function resolvePermissionModeKey(permissionMode, providerConfig) {
  const modeMap = {
    bypassPermissions: 'bypassPermissions',
    plan: 'plan',
    acceptEdits: 'acceptEdits',
    delegate: 'delegate',
    dontAsk: 'dontAsk',
    default: 'default',
    fullAuto: 'agent',
    dangerous: 'dangerous',
    approve: 'approve',
    readonly: 'readonly',
    fullAccess: 'fullAccess',
  };
  const requested = permissionMode || 'bypassPermissions';
  const mapped = modeMap[requested] || requested;
  const modes = providerConfig?.headless?.permissionModes || {};
  if (modes[mapped]) return mapped;
  return modes.agent ? 'agent' : Object.keys(modes)[0];
}

function defaultPermissionModeForExecution(executionMode, providerConfig) {
  const modes = providerConfig?.headless?.permissionModes || {};
  if (executionMode === 'read_only') {
    if (modes.readonly) return 'readonly';
    if (modes.plan) return 'plan';
    if (modes.default) return 'default';
  }
  return null;
}

function createTaskRuntimeStatusMap(db, groupId) {
  const rows = db.prepare(`
    SELECT s.id AS session_id, srs.status AS runtime_status
    FROM sessions s
    LEFT JOIN session_runtime_state srs ON srs.session_id = s.id
    WHERE s.run_group_id = ?
  `).all(groupId);

  return new Map(rows
    .filter((row) => row.runtime_status)
    .map((row) => [row.session_id, row.runtime_status]));
}

export function readLastRunGroupRuntimeProgress(db, sessionId) {
  if (!db || !sessionId) return null;

  try {
    const rows = db.prepare(`
      SELECT type, payload_json, ts
      FROM session_runtime_events
      WHERE session_id = ?
        AND type IN ('assistant', 'result', 'system', 'error')
      ORDER BY seq DESC
      LIMIT 10
    `).all(sessionId);

    for (const row of rows || []) {
      if (!row?.payload_json) continue;
      let payload;
      try {
        payload = JSON.parse(row.payload_json);
      } catch {
        continue;
      }
      const snippet = extractEventSnippet(payload);
      if (!snippet) continue;
      return {
        snippet,
        type: row.type || payload.type || null,
        ts: row.ts || null,
        source: 'runtime_event',
      };
    }
  } catch {
    return null;
  }

  return null;
}

export function resolveRunGroupSessionProgress(liveEntry, persistedProgress = null) {
  if (liveEntry?.lastProgressSnippet) {
    return {
      snippet: liveEntry.lastProgressSnippet,
      type: liveEntry.lastProgressType || null,
      ts: liveEntry.lastProgressAt || null,
      source: 'live',
    };
  }

  if (persistedProgress?.snippet) {
    return {
      snippet: persistedProgress.snippet,
      type: persistedProgress.type || null,
      ts: persistedProgress.ts || null,
      source: persistedProgress.source || 'runtime_event',
    };
  }

  return {
    snippet: null,
    type: null,
    ts: null,
    source: null,
  };
}

export function emitRunGroupRouteLog(logFn, level, message, data = undefined) {
  if (typeof logFn !== 'function') return false;
  try {
    logFn('agent', level, message, data);
    return true;
  } catch {
    return false;
  }
}

function markRunGroupTasksStopped(db, group, tasks, reason) {
  if (!Array.isArray(tasks) || tasks.length === 0) return [];

  const now = new Date().toISOString();
  const insertRuntime = db.prepare(`
    INSERT OR IGNORE INTO session_runtime_state
      (session_id, status, provider, cwd, started_at, updated_at, completed_at,
       last_error, project_root, base_branch, use_worktree, execution_mode)
    VALUES (?, 'stopped', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const updateSession = db.prepare(`
    UPDATE sessions
    SET ended_at = COALESCE(ended_at, ?),
        error_code = COALESCE(error_code, 'GROUP_BLOCKED'),
        error_message = COALESCE(error_message, ?)
    WHERE id = ?
  `);

  const blockedSessionIds = [];
  for (const task of tasks) {
    const runtimeResult = insertRuntime.run(
      task.sessionId,
      task.provider || group.provider,
      group.project_path || group.workspace_root || process.cwd(),
      now,
      now,
      now,
      reason,
      group.workspace_root || group.project_path || process.cwd(),
      group.base_branch || null,
      group.execution_mode === 'worktree' ? 1 : 0,
      group.execution_mode || 'shared_cwd',
    );
    if (runtimeResult.changes > 0) {
      blockedSessionIds.push(task.sessionId);
    }
    updateSession.run(now, reason, task.sessionId);
  }

  return blockedSessionIds;
}

function findTaskBySessionId(tasks, sessionId) {
  return (Array.isArray(tasks) ? tasks : []).find((task) => task.sessionId === sessionId) || null;
}

function validateTaskDependencies(tasks) {
  for (const [taskIndex, task] of tasks.entries()) {
    for (const dependency of Array.isArray(task.dependencies) ? task.dependencies : []) {
      if (!Number.isInteger(dependency.taskIndex) || dependency.taskIndex < 0 || dependency.taskIndex >= tasks.length) {
        return `task ${taskIndex + 1}: dependency task index out of range (${dependency.taskIndex})`;
      }
      if (dependency.taskIndex === taskIndex) {
        return `task ${taskIndex + 1}: task cannot depend on itself`;
      }
    }
  }
  return null;
}

function launchRunGroupTask(ctx, group, task, settledFn) {
  const {
    log,
    broadcast,
    getSidecarPort,
    getSidecarToken,
  } = ctx;
  const db = getDb();
  const now = new Date().toISOString();
  const workingDir = group.project_path || process.cwd();
  const repoRoot = group.workspace_root || workingDir;
  const baseBranch = group.base_branch || null;
  const sessionId = task.sessionId;
  const shortId = sessionId.slice(0, 8);
  const allowValidationCommands = group.config.allowValidationCommands === true;
  const runtimeInsert = db.prepare(`
    INSERT OR IGNORE INTO session_runtime_state
      (session_id, status, provider, cwd, started_at, updated_at,
       project_root, base_branch, use_worktree, execution_mode)
    VALUES (?, 'starting', ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    sessionId,
    task.provider,
    workingDir,
    now,
    now,
    repoRoot,
    baseBranch,
    group.execution_mode === 'worktree' ? 1 : 0,
    group.execution_mode,
  );

  if (runtimeInsert.changes === 0) {
    return { started: false, skipped: true, sessionId };
  }

  let providerConfig;
  let binaryPath;
  let worktreePath = null;
  let worktreeBranch = null;
  let effectiveCwd = workingDir;
  let spawnCwd = workingDir;
  let gitignoreWarning = false;
  let mcpConfigPath = null;

  try {
    providerConfig = loadProviderConfig(task.provider || group.provider || 'claude');
    binaryPath = resolveProviderBinary(providerConfig);
    if (!binaryPath) {
      throw new Error(`${providerConfig.name} CLI not found. Run: rudi install agent:${task.provider}`);
    }

    if (group.execution_mode === 'worktree') {
      const wt = createSessionWorktree({
        repoRoot,
        currentBranch: baseBranch,
        shortId,
        log,
      });
      if (wt.worktreePath) {
        worktreePath = wt.worktreePath;
        worktreeBranch = wt.worktreeBranch;
        effectiveCwd = wt.worktreePath;
        spawnCwd = wt.worktreePath;
        gitignoreWarning = Boolean(wt.gitignoreWarning);
      }
    }

    try {
      const st = fs.statSync(spawnCwd);
      if (!st.isDirectory()) throw new Error('not_a_directory');
    } catch {
      spawnCwd = workingDir;
      effectiveCwd = workingDir;
    }

    db.prepare(`
      UPDATE session_runtime_state
      SET cwd = ?,
          updated_at = ?,
          worktree_path = ?,
          worktree_branch = ?,
          project_root = ?,
          base_branch = ?,
          use_worktree = ?,
          execution_mode = ?
      WHERE session_id = ?
    `).run(
      effectiveCwd,
      now,
      worktreePath,
      worktreeBranch,
      repoRoot,
      baseBranch,
      worktreePath ? 1 : 0,
      group.execution_mode,
      sessionId,
    );

    db.prepare(`
      UPDATE sessions
      SET cwd = ?,
          project_path = ?,
          git_branch = ?,
          model = COALESCE(?, model),
          started_at = COALESCE(started_at, ?),
          last_active_at = ?,
          ended_at = NULL,
          error_code = NULL,
          error_message = NULL
      WHERE id = ?
    `).run(
      effectiveCwd,
      workingDir,
      worktreeBranch || baseBranch || null,
      task.model,
      now,
      now,
      sessionId,
    );

    const { resolvedPaths: inputPaths, contextPaths: inputContextPaths } = resolveInputPaths(task.inputs, effectiveCwd);
    const dependencyArtifacts = [];
    const dependencyContextPaths = [];
    for (const dependency of Array.isArray(task.dependencies) ? task.dependencies : []) {
      const artifacts = getDependencyArtifacts(db, group.id, dependency);
      for (const artifact of artifacts) {
        dependencyArtifacts.push(artifact);
        dependencyContextPaths.push(
          artifact.kind === 'directory'
            ? artifact.path
            : path.dirname(artifact.path),
        );
      }
    }

    const canSpawnChildren = getSidecarPort() > 0;
    const fullSystemPrompt = buildSystemPrompt(group.config.systemPrompt, { canSpawnChildren });
    const taskPrompt = buildTaskPrompt(task, {
      inputPaths,
      dependencyArtifacts,
    });
    const argOptions = { prompt: taskPrompt, model: task.model };

    if (hasCapability(providerConfig, 'systemPrompt') && fullSystemPrompt) {
      argOptions.systemPrompt = fullSystemPrompt;
    }
    argOptions.outputFormat = 'stream-json';

    const args = buildArgs(providerConfig, argOptions);
    appendContextArgs(args, providerConfig, [
      ...task.contextPaths,
      ...inputContextPaths,
      ...dependencyContextPaths,
    ]);
    const effectivePermissionMode = group.permission_mode || defaultPermissionModeForExecution(group.execution_mode, providerConfig);
    const permissionModeKey = resolvePermissionModeKey(effectivePermissionMode, providerConfig);
    if (permissionModeKey) {
      args.push(...getPermissionArgs(providerConfig, permissionModeKey));
    }

    const allowedTools = [...task.tools];
    if (canSpawnChildren && hasCapability(providerConfig, 'subagents')) {
      allowedTools.push(...SPAWN_CHILD_ALLOWED_TOOLS);
    }
    appendAllowedToolsArgs(args, providerConfig, allowedTools);

    if (canSpawnChildren && hasCapability(providerConfig, 'mcpConfig')) {
      const spawnShimPath = path.join(PATHS.home, 'bins', 'rudi-spawn');
      const routerShimPath = path.join(PATHS.home, 'bins', 'rudi-router');
      if (fs.existsSync(spawnShimPath)) {
        let existingMcpServers = {};
        const claudeJsonPath = path.join(os.homedir(), '.claude.json');
        try {
          const claudeJson = JSON.parse(fs.readFileSync(claudeJsonPath, 'utf-8'));
          existingMcpServers = claudeJson.mcpServers || {};
        } catch {}

        const mergedConfig = {
          mcpServers: {
            ...existingMcpServers,
            'rudi-spawn': { command: spawnShimPath, args: [] },
            ...(fs.existsSync(routerShimPath) ? { 'rudi': { command: routerShimPath, args: [] } } : {}),
          },
        };

        const tmpDir = path.join(PATHS.home, 'tmp');
        fs.mkdirSync(tmpDir, { recursive: true });
        mcpConfigPath = path.join(tmpDir, `run-group-mcp-${shortId}.json`);
        fs.writeFileSync(mcpConfigPath, JSON.stringify(mergedConfig, null, 2), { mode: 0o600 });

        args.push(
          ...expandConditional(providerConfig, 'mcpConfig', mcpConfigPath),
          ...expandConditional(providerConfig, 'strictMcpConfig', true),
        );
      }
    }

    const configEnv = buildEnv(providerConfig, process.env);
    const env = { ...process.env, ...configEnv };
    if (getSidecarPort() > 0) {
      env.RUDI_SIDECAR_URL = `http://127.0.0.1:${getSidecarPort()}`;
      env.RUDI_SIDECAR_TOKEN = getSidecarToken();
      env.RUDI_SESSION_ID = sessionId;
      env.RUDI_CAN_SPAWN_CHILDREN = '1';
    }

    spawnAgentProcess(ctx, {
      sessionId,
      prompt: taskPrompt,
      provider: task.provider,
      model: task.model,
      permissionMode: effectivePermissionMode,
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
      runGroupId: group.id,
      mcpConfigPath,
      stdinModeOverride: 'close',
      sessionRowMode: 'existingSession',
      existingSessionId: sessionId,
      taskSpec: task,
      autoNameOnFirstTurn: false,
      queueEvent: 'run-group-result',
      queueCloseEvent: 'run-group-close',
      onProcessClose: async ({ finalStatus }) => {
        let contractValidation = null;
        if (finalStatus === 'completed') {
          contractValidation = await validateTaskContract({
            db,
            sessionId,
            runGroupId: group.id,
            task,
            cwd: effectiveCwd,
            log,
            allowValidationCommands,
          });
        }
        await settledFn(group.id, sessionId, finalStatus, { contractValidation });
      },
      onProcessError: () => {
        return settledFn(group.id, sessionId, 'error', { contractValidation: null });
      },
    });

    if (gitignoreWarning) {
      log('agent', 'warn', 'run-group worktree created but .rudi/ is not in .gitignore', {
        groupId: group.id,
        sessionId: shortId,
      });
    }

    return { started: true, sessionId };
  } catch (spawnErr) {
    const errIso = new Date().toISOString();
    transitionSessionStatus(db, sessionId, 'error', {
      lastError: spawnErr.message,
      completedAt: errIso,
    });
    db.prepare(`
      UPDATE sessions
      SET error_code = 'SPAWN_FAILED', error_message = ?, ended_at = ?
      WHERE id = ?
    `).run(spawnErr.message, errIso, sessionId);
    if (mcpConfigPath) {
      try { fs.unlinkSync(mcpConfigPath); } catch {}
    }
    broadcast('run-group:session-done', createRunGroupSessionDoneEvent({
      groupId: group.id,
      sessionId,
      status: 'error',
    }));
    return { started: false, sessionId, error: spawnErr.message };
  }
}

function maybeAdvanceRunGroup(ctx, groupId, { settledFn } = {}) {
  const db = getDb();
  const log = ctx.log || (() => {});
  const startedSessionIds = [];
  const blockedSessionIds = [];
  const errors = [];
  let startedPhaseIndex = null;

  for (let iteration = 0; iteration < 8; iteration += 1) {
    const group = loadRunGroup(db, groupId);
    if (!group) break;
    const runtimeStatusBySessionId = createTaskRuntimeStatusMap(db, groupId);
    const validationBySessionId = group.coordination_mode === 'dependency'
      ? getTaskValidationResultMap(db, groupId)
      : new Map();
    const artifactAvailabilityByTask = group.coordination_mode === 'dependency'
      ? getTaskArtifactAvailabilityMap(db, groupId)
      : new Map();

    if (group.status === 'stopped') {
      const pendingTasks = group.config.tasks.filter((task) => !runtimeStatusBySessionId.has(task.sessionId));
      const blocked = markRunGroupTasksStopped(db, group, pendingTasks, 'Blocked after group stop');
      blockedSessionIds.push(...blocked);
      refreshRunGroupAggregates(db, groupId);
      break;
    }

    const evaluation = group.coordination_mode === 'dependency'
      ? evaluateDependencyExecution({
        tasks: group.config.tasks,
        runtimeStatusBySessionId,
        validationBySessionId,
        artifactAvailabilityByTask,
      })
      : evaluatePhaseExecution({
        coordinationMode: group.coordination_mode,
        tasks: group.config.tasks,
        phasePlan: group.config.phasePlan,
        runtimeStatusBySessionId,
      });

    if (evaluation.action === 'launch') {
      const launchedThisPass = [];
      for (const task of evaluation.tasks) {
        const result = launchRunGroupTask(ctx, group, task, settledFn);
        if (result.started) {
          launchedThisPass.push(result.sessionId);
          startedSessionIds.push(result.sessionId);
        } else if (result.error) {
          errors.push({ sessionId: result.sessionId, message: result.error });
        }
      }
      refreshRunGroupAggregates(db, groupId);
      if (launchedThisPass.length > 0) {
        startedPhaseIndex = evaluation.phaseIndex;
        if (group.coordination_mode === 'phased') {
          // Internal event only. Lite does not consume this today and the payload
          // is intentionally outside the public WS contract until it is covered.
          ctx.broadcast('run-group:phase-started', {
            groupId,
            phaseIndex: evaluation.phaseIndex,
            sessionIds: launchedThisPass,
          });
        }
        break;
      }
      continue;
    }

    if (evaluation.action === 'block') {
      const reason = evaluation.reason === 'phase_stopped'
        ? `Blocked after phase ${evaluation.phaseIndex + 1} stopped`
        : evaluation.reason === 'dependency_failed'
          ? 'Blocked after dependency failure'
          : `Blocked after phase ${evaluation.phaseIndex + 1} failed`;
      const blocked = markRunGroupTasksStopped(db, group, evaluation.tasks, reason);
      blockedSessionIds.push(...blocked);
      refreshRunGroupAggregates(db, groupId);
      if (blocked.length > 0) {
        log('agent', 'warn', 'blocked downstream run-group phase after upstream failure', {
          groupId,
          phaseIndex: evaluation.phaseIndex,
          blockedCount: blocked.length,
        });
      }
      continue;
    }

    if (evaluation.action === 'deadlock') {
      const blocked = markRunGroupTasksStopped(db, group, evaluation.tasks, 'Blocked by dependency deadlock');
      blockedSessionIds.push(...blocked);
      refreshRunGroupAggregates(db, groupId);
      if (blocked.length > 0) {
        log('agent', 'warn', 'blocked run-group tasks due to dependency deadlock', {
          groupId,
          blockedCount: blocked.length,
        });
      }
      continue;
    }

    break;
  }

  const refreshedGroup = refreshRunGroupAggregates(db, groupId);
  return {
    group: refreshedGroup,
    startedSessionIds,
    blockedSessionIds,
    errors,
    startedPhaseIndex,
  };
}

/**
 * Core run-group creation logic. Shared by POST /agent/run-group and
 * POST /agent/orchestration/:id/execute.
 *
 * @param {object} ctx  - Route context
 * @param {object} body - Request body (tasks, name, provider, model, cwd, etc.)
 * @param {object} [opts] - Optional overrides
 * @param {function} [opts.onGroupSessionSettled] - Override settled callback
 * @returns {{ ok: true, groupId: string, status: string, sessionIds: string[], startedSessionIds: string[], errors: object[] } | { ok: false, error: string, statusCode: number, code?: string | null, message?: string | null }}
 */
export async function createRunGroupFromRequest(ctx, body, opts = {}) {
  const {
    log, broadcast,
    agentProcesses, maxConcurrent,
  } = ctx;

  const requestedProvider = typeof body.provider === 'string' ? body.provider : 'claude';
  const requestedModel = typeof body.model === 'string' ? body.model : null;
  const requestedPermissionMode = typeof body.permissionMode === 'string' ? body.permissionMode : null;
  const requestedSystemPrompt = typeof body.systemPrompt === 'string' ? body.systemPrompt : null;
  const requestedAllowValidationCommands = body.allowValidationCommands === true;
  const requestedName = typeof body.name === 'string' && body.name.trim().length > 0
    ? body.name.trim()
    : null;
  const requestedCoordinationMode = normalizeCoordinationMode(body.coordinationMode ?? body.coordination_mode);
  const executionMode = normalizeExecutionMode(body.executionMode ?? body.execution_mode, {
    useWorktree: body.useWorktree,
  });
  const useWorktree = executionMode === 'worktree';

  const tasks = normalizeGroupTasks(body, {
    provider: requestedProvider,
    model: requestedModel,
  }).map((task) => ({
    ...task,
    provider: task.provider || requestedProvider,
    model: task.model || requestedModel,
  }));
  const rawPhasePlan = buildPhasePlan(tasks, body.sequentialPhases ?? body.sequential_phases);
  const coordinationMode = requestedCoordinationMode === 'supervisor'
    ? 'flat'
    : requestedCoordinationMode;
  const phasePlan = coordinationMode === 'phased'
    ? rawPhasePlan
    : (tasks.length > 0 ? [Array.from({ length: tasks.length }, (_, idx) => idx)] : []);

  if (tasks.length < 2 || tasks.length > 10) {
    return createRunGroupFailureResult({
      error: 'run-group requires between 2 and 10 tasks',
      statusCode: 400,
    });
  }

  if (countAlive(agentProcesses) + tasks.length > maxConcurrent) {
    return createRunGroupFailureResult({
      error: 'MAX_CONCURRENT_REACHED',
      message: `Too many active agent processes for requested group (${countAlive(agentProcesses)} + ${tasks.length} > ${maxConcurrent})`,
      statusCode: 429,
    });
  }

  const workingDir = body.cwd || process.env.PWD || process.cwd();
  const gitContext = detectGitContext(workingDir);
  const repoRoot = gitContext.repoRoot;
  const currentBranch = gitContext.currentBranch;
  const requestedBaseBranch = typeof body.baseBranch === 'string' && body.baseBranch.trim().length > 0
    ? body.baseBranch.trim()
    : null;

  if (useWorktree && !gitContext.isGitRepo) {
    return createRunGroupFailureResult({
      error: 'worktree execution_mode requires a git repository cwd',
      statusCode: 400,
    });
  }

  if (requestedBaseBranch && !gitContext.isGitRepo) {
    return createRunGroupFailureResult({
      error: 'baseBranch requires a git repository cwd',
      statusCode: 400,
    });
  }

  if (executionMode === 'read_only' && tasks.some((task) => task.requiresWrite === true)) {
    return createRunGroupFailureResult({
      error: 'read_only execution_mode cannot include tasks with requires_write=true',
      statusCode: 400,
    });
  }

  const dependencyValidationError = validateTaskDependencies(tasks);
  if (dependencyValidationError) {
    return createRunGroupFailureResult({
      error: dependencyValidationError,
      statusCode: 400,
    });
  }

  const baseBranch = requestedBaseBranch || currentBranch || null;

  for (const [idx, task] of tasks.entries()) {
    let providerConfig;
    try {
      providerConfig = loadProviderConfig(task.provider);
    } catch (configErr) {
      return createRunGroupFailureResult({
        error: `task ${idx + 1}: ${configErr.message}`,
        statusCode: 400,
      });
    }

    const binaryPath = resolveProviderBinary(providerConfig);
    if (!binaryPath) {
      return createRunGroupFailureResult({
        error: `task ${idx + 1}: ${providerConfig.name} CLI not found. Run: rudi install agent:${task.provider}`,
        statusCode: 500,
      });
    }
  }

  const groupId = crypto.randomUUID();
  const nowIso = new Date().toISOString();
  const db = getDb();

  if (requestedCoordinationMode === 'supervisor') {
    log('agent', 'warn', 'supervisor coordination requested; falling back to flat execution for this run-group', {
      groupId,
    });
  }

  async function onGroupSessionSettled(gId, sId, status, { contractValidation = null } = {}) {
    let updated = null;
    let stopAllLog = null;
    let escalateLog = null;
    try {
      updated = withImmediateTransaction(db, () => {
        const groupForPolicy = loadRunGroup(db, gId);
        const settledTask = findTaskBySessionId(groupForPolicy?.config?.tasks, sId);
        const failedValidation = contractValidation && contractValidation.passed === false;
        const failedRuntime = status === 'error' || status === 'crashed' || status === 'stopped';
        const failurePolicy = settledTask?.failurePolicy || 'stop-downstream';

        if (groupForPolicy && settledTask && (failedValidation || failedRuntime)) {
          if (failurePolicy === 'stop-all') {
            db.prepare(`
              UPDATE run_groups
              SET status = 'stopped',
                  updated_at = ?
              WHERE id = ?
            `).run(new Date().toISOString(), gId);
            const stoppedCount = stopActiveRunGroupSessions(db, ctx.agentProcesses, gId, sId);
            stopAllLog = {
              groupId: gId,
              sessionId: sId.slice(0, 8),
              stoppedCount,
              failedValidation,
              status,
            };
          } else if (failurePolicy === 'escalate') {
            escalateLog = {
              groupId: gId,
              sessionId: sId.slice(0, 8),
              failedValidation,
              status,
              validationErrors: contractValidation?.errors || [],
            };
          }
        }

        return maybeAdvanceRunGroup(ctx, gId, { settledFn }).group;
      });
    } catch (err) {
      log('agent', 'warn', `run-group aggregate refresh failed: ${err.message}`, { groupId: gId });
      return;
    }

    if (stopAllLog) {
      log('agent', 'warn', 'run-group stop-all failure policy triggered', stopAllLog);
    } else if (escalateLog) {
      log('agent', 'warn', 'run-group task escalated for review', escalateLog);
    }

    broadcast('run-group:session-done', createRunGroupSessionDoneEvent({
      groupId: gId,
      sessionId: sId,
      status,
      contractValidation,
    }));
    if (updated?.completed_at && TERMINAL_GROUP_STATUSES.has(updated.status)) {
      broadcast('run-group:completed', createRunGroupCompletedEvent({
        groupId: gId,
        status: updated.status,
        completedCount: updated.completed_count,
        failedCount: updated.failed_count,
      }));
    }
  }

  const settledFn = opts.onGroupSessionSettled || onGroupSessionSettled;

  db.prepare(`
    INSERT INTO run_groups (
      id, name, status, project_path, base_branch, execution_mode, coordination_mode, requires_git, workspace_root,
      provider, model, permission_mode,
      session_count, completed_count, failed_count, total_cost, total_tokens,
      config_json, created_at, started_at, completed_at, updated_at
    ) VALUES (?, ?, 'pending', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, 0, 0, 0, ?, ?, NULL, NULL, ?)
  `).run(
    groupId,
    requestedName,
    workingDir,
    baseBranch,
    executionMode,
    coordinationMode,
    useWorktree ? 1 : 0,
    repoRoot || workingDir,
    requestedProvider,
    requestedModel,
    requestedPermissionMode,
    tasks.length,
    JSON.stringify({
      tasks: tasks.map((task, taskIndex) => ({
        sessionId: crypto.randomUUID(),
        taskIndex,
        phaseIndex: phasePlan.findIndex((phase) => phase.includes(taskIndex)),
        name: task.name,
        provider: task.provider,
        model: task.model,
        prompt: task.prompt,
        role: task.role,
        goal: task.goal,
        deliverable: task.deliverable,
        rationale: task.rationale,
        scope: task.scope,
        inputs: task.inputs,
        tools: task.tools,
        evidence: task.evidence,
        output: task.output,
        dependencies: task.dependencies,
        failurePolicy: task.failurePolicy,
        mergePolicy: task.mergePolicy,
        validation: task.validation,
        filesTouched: task.filesTouched,
        dependsOn: task.dependsOn,
        requiresWrite: task.requiresWrite,
        contextPaths: task.contextPaths,
        artifactsIn: task.artifactsIn,
        artifactsOut: task.artifactsOut,
        metadata: task.metadata,
      })),
      executionMode,
      coordinationMode,
      requestedCoordinationMode,
      phasePlan,
      systemPrompt: requestedSystemPrompt,
      allowValidationCommands: requestedAllowValidationCommands,
    }),
    nowIso,
    nowIso,
  );

  const groupConfig = parseRunGroupConfig(
    db.prepare('SELECT config_json FROM run_groups WHERE id = ?').get(groupId)?.config_json
  );
  const plannedSessionIds = groupConfig.tasks.map((task) => task.sessionId);

  for (const [index, task] of groupConfig.tasks.entries()) {
    const taskName = task.name || task.role || `Task ${index + 1}`;
    const createdAt = new Date(Date.now() + index).toISOString();
    db.prepare(`
      INSERT INTO sessions (
        id, provider, provider_session_id, project_id, run_group_id,
        origin, title, title_override, snippet, status, model,
        cwd, project_path, git_branch,
        created_at, last_active_at, started_at,
        session_type, turn_count, total_cost, total_input_tokens, total_output_tokens, total_duration_ms
      ) VALUES (
        ?, ?, NULL, NULL, ?,
        'rudi', ?, ?, '', 'active', ?,
        ?, ?, ?,
        ?, ?, NULL,
        'main', 0, 0, 0, 0, 0
      )
    `).run(
      task.sessionId,
      task.provider,
      groupId,
      taskName,
      taskName,
      task.model,
      workingDir,
      workingDir,
      baseBranch,
      createdAt,
      createdAt,
    );
  }

  db.prepare(`
    UPDATE run_groups
    SET session_count = ?, started_at = ?, updated_at = ?
    WHERE id = ?
  `).run(tasks.length, nowIso, nowIso, groupId);

  const launchResult = maybeAdvanceRunGroup(ctx, groupId, { settledFn });
  const refreshed = launchResult.group || refreshRunGroupAggregates(db, groupId);
  if (launchResult.startedSessionIds.length > 0) {
    broadcast('run-group:started', createRunGroupStartedEvent({
      groupId,
      sessionIds: plannedSessionIds,
      activeSessionIds: launchResult.startedSessionIds,
    }));
  } else if (refreshed?.completed_at && TERMINAL_GROUP_STATUSES.has(refreshed.status)) {
    broadcast('run-group:completed', createRunGroupCompletedEvent({
      groupId,
      status: refreshed.status,
      completedCount: refreshed.completed_count,
      failedCount: refreshed.failed_count,
    }));
  }

  return createRunGroupSuccessResult({
    groupId,
    status: refreshed?.status || 'pending',
    sessionIds: plannedSessionIds,
    startedSessionIds: launchResult.startedSessionIds,
    errors: launchResult.errors,
  });
}

export function buildRunGroupRoutes(ctx) {
  const { json, error, errorCode, readBody, agentProcesses, broadcast, log } = ctx;

  return async (req, res, url) => {
    if (req.method === 'POST' && url.pathname === '/agent/run-group') {
      const body = await readBody(req);
      const result = await createRunGroupFromRequest(ctx, body);

      if (!result.ok) {
        if (result.statusCode === 429) {
          return json(res, { error: result.error, message: result.message }, 429);
        }
        return error(res, result.error, result.statusCode || 400);
      }

      json(res, {
        groupId: result.groupId,
        status: result.status,
        sessionIds: result.sessionIds,
        startedSessionIds: result.startedSessionIds,
        errors: result.errors,
      }, result.sessionIds.length > 0 ? 200 : 500);
      return true;
    }

    if (req.method === 'GET' && url.pathname === '/agent/run-groups') {
      const db = getDb();
      let sql = 'SELECT * FROM run_groups WHERE 1=1';
      const params = [];

      const projectPath = url.searchParams.get('projectPath');
      const status = url.searchParams.get('status');
      const limit = Number.parseInt(url.searchParams.get('limit') || '', 10);
      const offset = Number.parseInt(url.searchParams.get('offset') || '', 10);

      if (projectPath) {
        sql += ' AND project_path = ?';
        params.push(projectPath);
      }
      if (status) {
        sql += ' AND status = ?';
        params.push(status);
      }
      sql += ' ORDER BY created_at DESC';
      if (Number.isFinite(limit) && limit > 0) {
        sql += ' LIMIT ?';
        params.push(limit);
      }
      if (Number.isFinite(offset) && offset > 0) {
        sql += ' OFFSET ?';
        params.push(offset);
      }

      const groups = db.prepare(sql).all(...params);
      json(res, { groups });
      return true;
    }

    const stopMatch = url.pathname.match(/^\/agent\/run-group\/([^/]+)\/stop$/);
    if (req.method === 'POST' && stopMatch) {
      const groupId = decodeURIComponent(stopMatch[1]);
      const db = getDb();
      const group = db.prepare('SELECT id FROM run_groups WHERE id = ?').get(groupId);
      if (!group) {
        const result = runGroupNotFound();
        return errorCode(res, SIDECAR_ERROR_CODES[result.code], { message: result.message, status: result.statusCode });
      }
      const { stopped, refreshed } = withImmediateTransaction(db, () => {
        const stopped = stopActiveRunGroupSessions(db, ctx.agentProcesses, groupId);
        db.prepare(`
          UPDATE run_groups
          SET status = 'stopped',
              updated_at = ?
          WHERE id = ?
        `).run(new Date().toISOString(), groupId);
        const refreshed = maybeAdvanceRunGroup(ctx, groupId, {
          settledFn: () => {},
        }).group || refreshRunGroupAggregates(db, groupId);
        return { stopped, refreshed };
      });

      broadcast('run-group:stopped', createRunGroupStoppedEvent({ groupId }));
      json(res, {
        ok: true,
        groupId,
        stopped,
        status: refreshed?.status || 'stopped',
      });
      return true;
    }

    const detailMatch = url.pathname.match(/^\/agent\/run-group\/([^/]+)$/);
    if (req.method === 'GET' && detailMatch) {
      const groupId = decodeURIComponent(detailMatch[1]);
      const db = getDb();
      const refreshed = refreshRunGroupAggregates(db, groupId);
      if (!refreshed) {
        const result = runGroupNotFound();
        return errorCode(res, SIDECAR_ERROR_CODES[result.code], { message: result.message, status: result.statusCode });
      }

      const sessions = db.prepare(`
        SELECT
          s.id,
          s.provider,
          s.provider_session_id,
          s.title,
          s.title_override,
          s.model,
          s.cwd,
          s.status AS session_status,
          s.started_at,
          s.ended_at,
          s.exit_code,
          s.error_code,
          s.error_message,
          s.created_at,
          s.last_active_at,
          s.turn_count,
          s.total_cost,
          srs.status AS runtime_status,
          srs.turn_count AS runtime_turn_count,
          srs.cost_total AS runtime_cost_total,
          srs.tokens_total AS runtime_tokens_total,
          srs.last_error AS runtime_last_error,
          srs.worktree_path,
          srs.worktree_branch,
          srs.base_branch,
          srs.completed_at,
          tvr.passed AS validation_passed,
          tvr.errors_json AS validation_errors_json,
          tvr.warnings_json AS validation_warnings_json,
          tvr.validated_at
        FROM sessions s
        LEFT JOIN session_runtime_state srs ON srs.session_id = s.id
        LEFT JOIN task_validation_results tvr ON tvr.session_id = s.id
        WHERE s.run_group_id = ?
        ORDER BY s.created_at ASC
      `).all(groupId);

      const sessionDetails = sessions.map((row) => {
        const live = agentProcesses.get(row.id);
        const progress = resolveRunGroupSessionProgress(
          live,
          readLastRunGroupRuntimeProgress(db, row.id),
        );
        return projectRunGroupDetailSession(row, {
          liveEntry: live,
          progress,
          groupStatus: refreshed.status,
        });
      });

      json(res, { group: refreshed, sessions: sessionDetails });
      return true;
    }

    // GET /agent/run-group/:id/live — live session activity for dashboard
    const liveMatch = url.pathname.match(/^\/agent\/run-group\/([^/]+)\/live$/);
    if (req.method === 'GET' && liveMatch) {
      const groupId = decodeURIComponent(liveMatch[1]);
      const db = getDb();

      const group = refreshRunGroupAggregates(db, groupId);
      if (!group) {
        const result = runGroupNotFound();
        return errorCode(res, SIDECAR_ERROR_CODES[result.code], { message: result.message, status: result.statusCode });
      }

      const sessions = db.prepare(`
        SELECT
          s.id,
          s.title,
          s.title_override,
          s.status AS session_status,
          srs.status AS runtime_status,
          srs.turn_count AS runtime_turn_count,
          srs.cost_total AS runtime_cost_total,
          srs.tokens_total AS runtime_tokens_total,
          srs.last_error AS runtime_last_error,
          srs.worktree_branch,
          tvr.passed AS validation_passed
        FROM sessions s
        LEFT JOIN session_runtime_state srs ON srs.session_id = s.id
        LEFT JOIN task_validation_results tvr ON tvr.session_id = s.id
        WHERE s.run_group_id = ?
        ORDER BY s.created_at ASC
      `).all(groupId);

      const liveData = sessions.map((row) => {
        const entry = agentProcesses.get(row.id);
        const progress = resolveRunGroupSessionProgress(
          entry,
          readLastRunGroupRuntimeProgress(db, row.id),
        );

        return projectRunGroupLiveSession(row, {
          liveEntry: entry,
          progress,
          groupStatus: group.status,
        });
      });

      json(res, {
        groupId,
        status: group.status,
        sessions: liveData,
      });
      return true;
    }

    // GET /agent/run-group/:id/diffs — per-session diff stats
    const diffsMatch = url.pathname.match(/^\/agent\/run-group\/([^/]+)\/diffs$/);
    if (req.method === 'GET' && diffsMatch) {
      const groupId = decodeURIComponent(diffsMatch[1]);
      const db = getDb();
      const group = db.prepare('SELECT * FROM run_groups WHERE id = ?').get(groupId);
      if (!group) {
        const result = runGroupNotFound();
        return errorCode(res, SIDECAR_ERROR_CODES[result.code], { message: result.message, status: result.statusCode });
      }
      if (group.execution_mode !== 'worktree') {
        return error(res, 'Diffs are only available for worktree execution_mode', 400);
      }

      const sessions = db.prepare(`
        SELECT s.id, srs.worktree_branch, srs.base_branch, srs.project_root
        FROM sessions s
        LEFT JOIN session_runtime_state srs ON srs.session_id = s.id
        WHERE s.run_group_id = ?
      `).all(groupId);

      const diffs = [];
      for (const row of sessions) {
        if (!row.worktree_branch || !row.base_branch || !row.project_root) {
          diffs.push({
            sessionId: row.id,
            branch: row.worktree_branch || 'unknown',
            files: 0,
            insertions: 0,
            deletions: 0,
            error: 'Missing branch or project root info',
          });
          continue;
        }

        try {
          const stat = execFileSync(
            'git',
            ['diff', '--stat', `${row.base_branch}...${row.worktree_branch}`],
            { cwd: row.project_root, stdio: 'pipe' },
          ).toString().trim();

          let files = 0;
          let insertions = 0;
          let deletions = 0;

          // Parse the last line: " N files changed, M insertions(+), K deletions(-)"
          const summaryLine = stat.split('\n').pop() || '';
          const filesMatch = summaryLine.match(/(\d+)\s+files?\s+changed/);
          const insertionsMatch = summaryLine.match(/(\d+)\s+insertions?\(\+\)/);
          const deletionsMatch = summaryLine.match(/(\d+)\s+deletions?\(-\)/);
          if (filesMatch) files = parseInt(filesMatch[1], 10);
          if (insertionsMatch) insertions = parseInt(insertionsMatch[1], 10);
          if (deletionsMatch) deletions = parseInt(deletionsMatch[1], 10);

          diffs.push({
            sessionId: row.id,
            branch: row.worktree_branch,
            files,
            insertions,
            deletions,
          });
        } catch (diffErr) {
          diffs.push({
            sessionId: row.id,
            branch: row.worktree_branch,
            files: 0,
            insertions: 0,
            deletions: 0,
            error: diffErr.message,
          });
        }
      }

      json(res, { diffs });
      return true;
    }

    // POST /agent/run-group/:id/merge — sequential merge of selected sessions
    const mergeMatch = url.pathname.match(/^\/agent\/run-group\/([^/]+)\/merge$/);
    if (req.method === 'POST' && mergeMatch) {
      const groupId = decodeURIComponent(mergeMatch[1]);
      const body = await readBody(req);
      const sessionIds = Array.isArray(body.sessionIds) ? body.sessionIds : [];
      const targetBranch = typeof body.targetBranch === 'string' ? body.targetBranch.trim() : null;

      if (sessionIds.length === 0) {
        return error(res, 'sessionIds required', 400);
      }

      const db = getDb();
      const group = db.prepare('SELECT * FROM run_groups WHERE id = ?').get(groupId);
      if (!group) {
        const result = runGroupNotFound();
        return errorCode(res, SIDECAR_ERROR_CODES[result.code], { message: result.message, status: result.statusCode });
      }
      if (group.execution_mode !== 'worktree') {
        return error(res, 'Merge is only available for worktree execution_mode', 400);
      }

      const mergeTo = targetBranch || group.base_branch || 'main';
      const results = [];

      for (const sessionId of sessionIds) {
        const row = db.prepare(`
          SELECT srs.worktree_branch, srs.project_root
          FROM session_runtime_state srs
          WHERE srs.session_id = ?
        `).get(sessionId);

        if (!row?.worktree_branch || !row?.project_root) {
          results.push({ sessionId, branch: row?.worktree_branch || 'unknown', ok: false, error: 'Missing branch info' });
          continue;
        }

        try {
          // Ensure we're on the target branch
          execFileSync('git', ['checkout', mergeTo], { cwd: row.project_root, stdio: 'pipe' });

          // Attempt no-ff merge
          execFileSync(
            'git',
            ['merge', '--no-ff', '-m', `Merge run-group session ${sessionId.slice(0, 8)} (${row.worktree_branch})`, row.worktree_branch],
            { cwd: row.project_root, stdio: 'pipe' },
          );

          results.push({ sessionId, branch: row.worktree_branch, ok: true });
          emitRunGroupRouteLog(log, 'info', `merged ${row.worktree_branch} into ${mergeTo}`, {
            groupId,
            sessionId: sessionId.slice(0, 8),
          });
        } catch (mergeErr) {
          // Attempt to detect conflict files
          let conflictFiles = [];
          try {
            const status = execFileSync('git', ['status', '--porcelain'], { cwd: row.project_root, stdio: 'pipe' }).toString();
            conflictFiles = status
              .split('\n')
              .filter((line) => line.startsWith('UU') || line.startsWith('AA') || line.startsWith('DD'))
              .map((line) => line.slice(3).trim());
          } catch {}

          // Abort the failed merge
          try {
            execFileSync('git', ['merge', '--abort'], { cwd: row.project_root, stdio: 'pipe' });
          } catch {}

          results.push({
            sessionId,
            branch: row.worktree_branch,
            ok: false,
            error: mergeErr.message,
            conflictFiles,
          });
          emitRunGroupRouteLog(log, 'warn', `merge conflict for ${row.worktree_branch}`, {
            groupId,
            sessionId: sessionId.slice(0, 8),
            conflictFiles,
          });
        }
      }

      json(res, { results });
      return true;
    }

    // POST /agent/run-group/:id/cleanup — remove worktrees + optionally delete branches
    const cleanupMatch = url.pathname.match(/^\/agent\/run-group\/([^/]+)\/cleanup$/);
    if (req.method === 'POST' && cleanupMatch) {
      const groupId = decodeURIComponent(cleanupMatch[1]);
      const body = await readBody(req);
      const deleteBranches = body.deleteBranches === true;

      const db = getDb();
      const group = db.prepare('SELECT * FROM run_groups WHERE id = ?').get(groupId);
      if (!group) {
        const result = runGroupNotFound();
        return errorCode(res, SIDECAR_ERROR_CODES[result.code], { message: result.message, status: result.statusCode });
      }
      if (group.execution_mode !== 'worktree') {
        return error(res, 'Cleanup is only available for worktree execution_mode', 400);
      }
      const sessions = db.prepare(`
        SELECT s.id, srs.worktree_path, srs.worktree_branch, srs.project_root
        FROM sessions s
        LEFT JOIN session_runtime_state srs ON srs.session_id = s.id
        WHERE s.run_group_id = ?
      `).all(groupId);

      let cleaned = 0;
      const errors = [];

      for (const row of sessions) {
        if (!row.worktree_path) continue;

        try {
          const repoDir = row.project_root || path.dirname(path.dirname(path.dirname(row.worktree_path)));

          if (fs.existsSync(row.worktree_path)) {
            execFileSync('git', ['worktree', 'remove', '--force', row.worktree_path], {
              cwd: repoDir,
              stdio: 'pipe',
            });
          }

          if (deleteBranches && row.worktree_branch && !row.worktree_branch.startsWith('-')) {
            try {
              execFileSync('git', ['branch', '-D', '--', row.worktree_branch], {
                cwd: repoDir,
                stdio: 'pipe',
              });
            } catch {
              // Branch might already be deleted or not exist
            }
          }

          db.prepare('UPDATE session_runtime_state SET worktree_path = NULL WHERE session_id = ?').run(row.id);
          cleaned++;
        } catch (cleanErr) {
          errors.push({ sessionId: row.id, error: cleanErr.message });
        }
      }

      json(res, { ok: errors.length === 0, cleaned, errors });
      emitRunGroupRouteLog(log, 'info', `run-group cleanup: ${cleaned} worktrees`, {
        groupId,
        errors: errors.length,
      });
      return true;
    }

    return false;
  };
}
