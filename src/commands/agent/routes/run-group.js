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
import {
  loadProviderConfig,
  resolveProviderBinary,
  buildArgs,
  getPermissionArgs,
  buildEnv,
  hasCapability,
  expandConditional,
} from '../providers/index.js';
import { buildSystemPrompt } from '../prompts.js';
import { getRepoRoot, createSessionWorktree } from '../worktree.js';
import { spawnAgentProcess } from '../spawn-process.js';
import { countAlive } from '../helpers.js';

const TERMINAL_RUNTIME_STATUSES = new Set(['completed', 'error', 'stopped', 'crashed']);

function normalizeTasks(body) {
  const rawTasks = Array.isArray(body?.tasks)
    ? body.tasks
    : (Array.isArray(body?.prompts) ? body.prompts : []);

  return rawTasks
    .map((task, idx) => {
      if (typeof task === 'string') {
        return { prompt: task.trim(), name: null, provider: null, model: null };
      }
      if (task && typeof task === 'object') {
        return {
          prompt: typeof task.prompt === 'string' ? task.prompt.trim() : '',
          name: typeof task.name === 'string' ? task.name.trim() : null,
          provider: typeof task.provider === 'string' ? task.provider.trim() : null,
          model: typeof task.model === 'string' ? task.model.trim() : null,
        };
      }
      return { prompt: '', name: `Task ${idx + 1}`, provider: null, model: null };
    })
    .filter((task) => task.prompt.length > 0);
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

function normalizeGroupStatus(row, doneCount) {
  if (!row) return 'failed';
  if (row.status === 'stopped') return 'stopped';
  if (doneCount < row.session_count) return 'running';
  if (row.failed_count > 0 && row.completed_count > 0) return 'partial';
  if (row.failed_count > 0) return 'failed';
  return 'completed';
}

function refreshRunGroupAggregates(db, groupId) {
  const stats = db.prepare(`
    SELECT
      COUNT(*) AS session_count,
      SUM(CASE WHEN COALESCE(srs.status, '') = 'completed' THEN 1 ELSE 0 END) AS completed_count,
      SUM(CASE WHEN COALESCE(srs.status, '') IN ('error', 'crashed') THEN 1 ELSE 0 END) AS failed_count,
      SUM(CASE WHEN COALESCE(srs.status, '') IN ('completed', 'error', 'stopped', 'crashed') THEN 1 ELSE 0 END) AS done_count,
      COALESCE(SUM(COALESCE(srs.cost_total, s.total_cost, 0)), 0) AS total_cost,
      COALESCE(SUM(COALESCE(
        srs.tokens_total,
        (COALESCE(s.total_input_tokens, 0) + COALESCE(s.total_output_tokens, 0)),
        0
      )), 0) AS total_tokens
    FROM sessions s
    LEFT JOIN session_runtime_state srs ON srs.session_id = s.id
    WHERE s.run_group_id = ?
  `).get(groupId) || {
    session_count: 0,
    completed_count: 0,
    failed_count: 0,
    done_count: 0,
    total_cost: 0,
    total_tokens: 0,
  };

  const now = new Date().toISOString();
  db.prepare(`
    UPDATE run_groups
    SET session_count = ?,
        completed_count = ?,
        failed_count = ?,
        total_cost = ?,
        total_tokens = ?,
        updated_at = ?
    WHERE id = ?
  `).run(
    Number(stats.session_count || 0),
    Number(stats.completed_count || 0),
    Number(stats.failed_count || 0),
    Number(stats.total_cost || 0),
    Number(stats.total_tokens || 0),
    now,
    groupId,
  );

  const group = db.prepare('SELECT * FROM run_groups WHERE id = ?').get(groupId);
  if (!group) return null;

  const finalStatus = normalizeGroupStatus(group, Number(stats.done_count || 0));
  if (TERMINAL_RUNTIME_STATUSES.has(finalStatus) || ['completed', 'partial', 'failed', 'stopped'].includes(finalStatus)) {
    const isDone = Number(stats.done_count || 0) >= Number(group.session_count || 0) && Number(group.session_count || 0) > 0;
    if (isDone) {
      const completedAt = group.completed_at || now;
      db.prepare(`
        UPDATE run_groups
        SET status = ?,
            completed_at = ?,
            updated_at = ?
        WHERE id = ?
      `).run(finalStatus, completedAt, now, groupId);
      return db.prepare('SELECT * FROM run_groups WHERE id = ?').get(groupId);
    }
  }

  return group;
}

export function buildRunGroupRoutes(ctx) {
  const {
    json, error, readBody, log, broadcast,
    agentProcesses, maxConcurrent,
    getSidecarPort, getSidecarToken,
  } = ctx;

  function onGroupSessionSettled(groupId, sessionId, status) {
    let updated = null;
    try {
      const db = getDb();
      updated = refreshRunGroupAggregates(db, groupId);
    } catch (err) {
      log('agent', 'warn', `run-group aggregate refresh failed: ${err.message}`, { groupId });
      return;
    }

    broadcast('run-group:session-done', { groupId, sessionId, status });
    if (updated?.completed_at && ['completed', 'partial', 'failed', 'stopped'].includes(updated.status)) {
      broadcast('run-group:completed', {
        groupId,
        status: updated.status,
        completedCount: Number(updated.completed_count || 0),
        failedCount: Number(updated.failed_count || 0),
      });
    }
  }

  return async (req, res, url) => {
    if (req.method === 'POST' && url.pathname === '/agent/run-group') {
      const body = await readBody(req);
      const requestedProvider = typeof body.provider === 'string' ? body.provider : 'claude';
      const requestedModel = typeof body.model === 'string' ? body.model : null;
      const requestedPermissionMode = typeof body.permissionMode === 'string' ? body.permissionMode : null;
      const requestedSystemPrompt = typeof body.systemPrompt === 'string' ? body.systemPrompt : null;
      const requestedName = typeof body.name === 'string' && body.name.trim().length > 0
        ? body.name.trim()
        : null;
      const useWorktree = body.useWorktree !== false;

      const tasks = normalizeTasks(body).map((task) => ({
        ...task,
        provider: task.provider || requestedProvider,
        model: task.model || requestedModel,
      }));

      if (tasks.length < 2 || tasks.length > 10) {
        return error(res, 'run-group requires between 2 and 10 tasks', 400);
      }

      if (countAlive(agentProcesses) + tasks.length > maxConcurrent) {
        return json(res, {
          error: 'MAX_CONCURRENT_REACHED',
          message: `Too many active agent processes for requested group (${countAlive(agentProcesses)} + ${tasks.length} > ${maxConcurrent})`,
        }, 429);
      }

      const workingDir = body.cwd || process.env.PWD || process.cwd();

      let repoRoot = null;
      let currentBranch = null;
      try {
        execSync('git rev-parse --is-inside-work-tree', { cwd: workingDir, stdio: 'pipe' });
        repoRoot = getRepoRoot(workingDir);
        currentBranch = execSync('git rev-parse --abbrev-ref HEAD', { cwd: workingDir, stdio: 'pipe' })
          .toString().trim();
      } catch {
        return error(res, 'run-group requires a git repository cwd', 400);
      }

      const baseBranch = typeof body.baseBranch === 'string' && body.baseBranch.trim().length > 0
        ? body.baseBranch.trim()
        : currentBranch;

      const preparedTasks = [];
      for (const [idx, task] of tasks.entries()) {
        let providerConfig;
        try {
          providerConfig = loadProviderConfig(task.provider);
        } catch (configErr) {
          return error(res, `task ${idx + 1}: ${configErr.message}`, 400);
        }

        const binaryPath = resolveProviderBinary(providerConfig);
        if (!binaryPath) {
          return error(res, `task ${idx + 1}: ${providerConfig.name} CLI not found. Run: rudi install agent:${task.provider}`, 500);
        }

        preparedTasks.push({
          ...task,
          providerConfig,
          binaryPath,
        });
      }

      const groupId = crypto.randomUUID();
      const nowIso = new Date().toISOString();
      const db = getDb();

      db.prepare(`
        INSERT INTO run_groups (
          id, name, status, project_path, base_branch, provider, model, permission_mode,
          session_count, completed_count, failed_count, total_cost, total_tokens,
          config_json, created_at, started_at, completed_at, updated_at
        ) VALUES (?, ?, 'pending', ?, ?, ?, ?, ?, ?, 0, 0, 0, 0, ?, ?, NULL, NULL, ?)
      `).run(
        groupId,
        requestedName,
        workingDir,
        baseBranch,
        requestedProvider,
        requestedModel,
        requestedPermissionMode,
        preparedTasks.length,
        JSON.stringify({
          tasks: preparedTasks.map((task) => ({
            name: task.name,
            provider: task.provider,
            model: task.model,
            prompt: task.prompt.slice(0, 300),
          })),
          useWorktree,
        }),
        nowIso,
        nowIso,
      );

      const sessionIds = [];
      const spawnErrors = [];

      for (const [index, task] of preparedTasks.entries()) {
        const sessionId = crypto.randomUUID();
        const shortId = sessionId.slice(0, 8);
        let worktreePath = null;
        let worktreeBranch = null;
        let effectiveCwd = workingDir;
        let spawnCwd = workingDir;
        let gitignoreWarning = false;

        if (useWorktree) {
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

        const taskName = task.name || `Task ${index + 1}`;
        const createdAt = new Date().toISOString();
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
            ?, ?, ?,
            'main', 0, 0, 0, 0, 0
          )
        `).run(
          sessionId,
          task.provider,
          groupId,
          taskName,
          taskName,
          task.model,
          effectiveCwd,
          workingDir,
          worktreeBranch || baseBranch,
          createdAt,
          createdAt,
          createdAt,
        );

        db.prepare(`
          INSERT INTO session_runtime_state
            (session_id, status, provider, cwd, started_at, updated_at,
             worktree_path, worktree_branch, project_root, base_branch, use_worktree)
          VALUES (?, 'starting', ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(
          sessionId,
          task.provider,
          effectiveCwd,
          createdAt,
          createdAt,
          worktreePath,
          worktreeBranch,
          repoRoot,
          baseBranch,
          worktreePath ? 1 : 0,
        );

        const canSpawnChildren = getSidecarPort() > 0;
        const fullSystemPrompt = buildSystemPrompt(requestedSystemPrompt, { canSpawnChildren });
        const argOptions = { prompt: task.prompt, model: task.model };

        if (hasCapability(task.providerConfig, 'systemPrompt') && fullSystemPrompt) {
          argOptions.systemPrompt = fullSystemPrompt;
        }
        // Run-group sessions run autonomously — keep prompt in args (not stdin),
        // use output-format stream-json for observability, close stdin so process exits.
        argOptions.outputFormat = 'stream-json';

        const args = buildArgs(task.providerConfig, argOptions);
        const permissionModeKey = resolvePermissionModeKey(requestedPermissionMode, task.providerConfig);
        if (permissionModeKey) {
          args.push(...getPermissionArgs(task.providerConfig, permissionModeKey));
        }

        if (canSpawnChildren && hasCapability(task.providerConfig, 'subagents')) {
          args.push('--allowed-tools', 'mcp__rudi-spawn__spawn_child,mcp__rudi-spawn__list_children');
        }

        let mcpConfigPath = null;
        if (canSpawnChildren && hasCapability(task.providerConfig, 'mcpConfig')) {
          const spawnShimPath = path.join(PATHS.home, 'bins', 'rudi-spawn');
          if (fs.existsSync(spawnShimPath)) {
            try {
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
                },
              };

              const tmpDir = path.join(PATHS.home, 'tmp');
              fs.mkdirSync(tmpDir, { recursive: true });
              mcpConfigPath = path.join(tmpDir, `run-group-mcp-${shortId}.json`);
              fs.writeFileSync(mcpConfigPath, JSON.stringify(mergedConfig, null, 2), { mode: 0o600 });

              args.push(
                ...expandConditional(task.providerConfig, 'mcpConfig', mcpConfigPath),
                ...expandConditional(task.providerConfig, 'strictMcpConfig', true),
              );
            } catch (mcpErr) {
              log('agent', 'warn', `run-group MCP config injection failed: ${mcpErr.message}`, {
                groupId,
                sessionId: shortId,
              });
            }
          }
        }

        const configEnv = buildEnv(task.providerConfig, process.env);
        const env = { ...process.env, ...configEnv };
        if (getSidecarPort() > 0) {
          env.RUDI_SIDECAR_URL = `http://127.0.0.1:${getSidecarPort()}`;
          env.RUDI_SIDECAR_TOKEN = getSidecarToken();
          env.RUDI_SESSION_ID = sessionId;
          env.RUDI_CAN_SPAWN_CHILDREN = '1';
        }

        try {
          spawnAgentProcess(ctx, {
            sessionId,
            prompt: task.prompt,
            provider: task.provider,
            model: task.model,
            permissionMode: requestedPermissionMode,
            systemPrompt: fullSystemPrompt || null,
            providerConfig: task.providerConfig,
            binaryPath: task.binaryPath,
            args,
            env,
            spawnCwd,
            effectiveCwd,
            workingDir,
            repoRoot,
            worktreePath,
            worktreeBranch,
            baseBranch,
            runGroupId: groupId,
            mcpConfigPath,
            stdinModeOverride: 'close', // autonomous mode: prompt via args, close stdin so process exits
            sessionRowMode: 'existingSession',
            existingSessionId: sessionId,
            autoNameOnFirstTurn: false,
            queueEvent: 'run-group-result',
            queueCloseEvent: 'run-group-close',
            onProcessClose: ({ finalStatus }) => {
              onGroupSessionSettled(groupId, sessionId, finalStatus);
            },
            onProcessError: () => {
              onGroupSessionSettled(groupId, sessionId, 'error');
            },
          });
          sessionIds.push(sessionId);
          if (gitignoreWarning) {
            log('agent', 'warn', 'run-group worktree created but .rudi/ is not in .gitignore', { groupId, sessionId: shortId });
          }
        } catch (spawnErr) {
          spawnErrors.push({ sessionId, message: spawnErr.message });
          const errIso = new Date().toISOString();
          db.prepare(`
            UPDATE session_runtime_state
            SET status = 'error', last_error = ?, updated_at = ?, completed_at = ?
            WHERE session_id = ?
          `).run(spawnErr.message, errIso, errIso, sessionId);
          db.prepare(`
            UPDATE sessions
            SET error_code = 'SPAWN_FAILED', error_message = ?, ended_at = ?
            WHERE id = ?
          `).run(spawnErr.message, errIso, sessionId);
          if (mcpConfigPath) {
            try { fs.unlinkSync(mcpConfigPath); } catch {}
          }
        }
      }

      const startIso = new Date().toISOString();
      const groupStatus = sessionIds.length === 0
        ? 'failed'
        : (spawnErrors.length > 0 ? 'partial' : 'running');
      db.prepare(`
        UPDATE run_groups
        SET status = ?, session_count = ?, started_at = ?, completed_at = ?, updated_at = ?
        WHERE id = ?
      `).run(
        groupStatus,
        preparedTasks.length,
        startIso,
        groupStatus === 'failed' ? startIso : null,
        startIso,
        groupId,
      );

      const refreshed = refreshRunGroupAggregates(db, groupId);
      if (sessionIds.length > 0) {
        broadcast('run-group:started', { groupId, sessionIds });
      } else {
        broadcast('run-group:completed', {
          groupId,
          status: 'failed',
          completedCount: 0,
          failedCount: preparedTasks.length,
        });
      }

      json(res, {
        groupId,
        status: refreshed?.status || groupStatus,
        sessionIds,
        errors: spawnErrors,
      }, sessionIds.length > 0 ? 200 : 500);
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
      const sessions = db.prepare(`
        SELECT id FROM sessions WHERE run_group_id = ?
      `).all(groupId);

      let stopped = 0;
      for (const row of sessions) {
        const entry = agentProcesses.get(row.id);
        if (!entry || !entry.proc || entry.proc.killed) continue;
        entry._terminationReason = 'stopped';
        entry.proc.kill('SIGTERM');
        const killTimer = setTimeout(() => {
          try { entry.proc.kill('SIGKILL'); } catch {}
        }, 3000);
        entry.proc.on('close', () => clearTimeout(killTimer));
        stopped++;
      }

      db.prepare(`
        UPDATE run_groups
        SET status = 'stopped',
            updated_at = ?
        WHERE id = ?
      `).run(new Date().toISOString(), groupId);
      const refreshed = refreshRunGroupAggregates(db, groupId);

      broadcast('run-group:stopped', { groupId });
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
      if (!refreshed) return error(res, 'Run group not found', 404);

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
          srs.completed_at
        FROM sessions s
        LEFT JOIN session_runtime_state srs ON srs.session_id = s.id
        WHERE s.run_group_id = ?
        ORDER BY s.created_at ASC
      `).all(groupId);

      const sessionDetails = sessions.map((row) => {
        const live = agentProcesses.get(row.id);
        const alive = Boolean(live?.proc && !live.proc.killed);
        return {
          ...row,
          status: alive ? 'running' : (row.runtime_status || row.session_status || 'unknown'),
          alive,
          turn_active: Boolean(live?.turnActive),
          pid: live?.proc?.pid || null,
        };
      });

      json(res, { group: refreshed, sessions: sessionDetails });
      return true;
    }

    // GET /agent/run-group/:id/live — live session activity for dashboard
    const liveMatch = url.pathname.match(/^\/agent\/run-group\/([^/]+)\/live$/);
    if (req.method === 'GET' && liveMatch) {
      const groupId = decodeURIComponent(liveMatch[1]);
      const db = getDb();

      const group = db.prepare('SELECT * FROM run_groups WHERE id = ?').get(groupId);
      if (!group) return error(res, 'Run group not found', 404);

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
          srs.worktree_branch
        FROM sessions s
        LEFT JOIN session_runtime_state srs ON srs.session_id = s.id
        WHERE s.run_group_id = ?
        ORDER BY s.created_at ASC
      `).all(groupId);

      const liveData = sessions.map((row) => {
        const entry = agentProcesses.get(row.id);
        const alive = Boolean(entry?.proc && !entry.proc.killed);
        const status = alive ? 'running' : (row.runtime_status || row.session_status || 'unknown');

        // Get last assistant message snippet from runtime events if available
        let lastSnippet = null;
        try {
          const lastEvent = db.prepare(`
            SELECT payload FROM session_runtime_events
            WHERE session_id = ? AND event_type IN ('assistant', 'result')
            ORDER BY seq DESC LIMIT 1
          `).get(row.id);
          if (lastEvent?.payload) {
            const parsed = JSON.parse(lastEvent.payload);
            // Extract text content from the event
            const textBlocks = (parsed.content || []).filter(b => b.type === 'text');
            if (textBlocks.length > 0) {
              lastSnippet = textBlocks[textBlocks.length - 1].text?.slice(0, 200) || null;
            }
          }
        } catch {
          // Runtime events table may not exist or be empty
        }

        return {
          sessionId: row.id,
          name: row.title_override || row.title || row.id.slice(0, 8),
          status,
          alive,
          turnCount: Number(row.runtime_turn_count || 0),
          costTotal: Number(row.runtime_cost_total || 0),
          tokensTotal: Number(row.runtime_tokens_total || 0),
          lastError: row.runtime_last_error || null,
          lastSnippet,
          worktreeBranch: row.worktree_branch || null,
        };
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
      if (!group) return error(res, 'Run group not found', 404);

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
          log('agent', 'info', `merged ${row.worktree_branch} into ${mergeTo}`, { groupId, sessionId: sessionId.slice(0, 8) });
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
          log('agent', 'warn', `merge conflict for ${row.worktree_branch}`, { groupId, sessionId: sessionId.slice(0, 8), conflictFiles });
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
      log('agent', 'info', `run-group cleanup: ${cleaned} worktrees`, { groupId, errors: errors.length });
      return true;
    }

    return false;
  };
}
