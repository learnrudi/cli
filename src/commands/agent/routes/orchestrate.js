/**
 * Orchestration routes: natural language → plan → run group.
 *
 * POST   /agent/orchestrate                Start a planning session
 * GET    /agent/orchestration/:id          Get plan status + data
 * POST   /agent/orchestration/:id/execute  Execute an approved plan as a run group
 * POST   /agent/orchestration/:id/cancel   Cancel a planning session
 */

import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { getDb } from '@learnrudi/db';
import { PATHS } from '@learnrudi/env';
import {
  loadProviderConfig,
  resolveProviderBinary,
  buildArgs,
  getPermissionArgs,
  buildEnv,
  hasCapability,
  expandConditional,
} from '../providers/index.js';
import { buildOrchestratorPrompt } from '../prompts.js';
import { spawnAgentProcess } from '../spawn-process.js';
import { createRunGroupFromRequest } from './run-group.js';

const ORCHESTRATION_PLAN_SCHEMA = JSON.stringify({
  type: 'object',
  required: ['tasks', 'summary'],
  properties: {
    summary: { type: 'string', description: '1-2 sentence description of the plan' },
    tasks: {
      type: 'array',
      minItems: 2,
      maxItems: 8,
      items: {
        type: 'object',
        required: ['name', 'prompt'],
        properties: {
          name: { type: 'string', description: "Short task label (e.g. 'auth-middleware')" },
          prompt: { type: 'string', description: 'Full task brief for the agent' },
          provider: { type: 'string', enum: ['claude', 'codex'], default: 'claude' },
          model: { type: 'string', description: 'Model alias (opus, sonnet, haiku)' },
          files_touched: { type: 'array', items: { type: 'string' }, description: 'Files this task will modify' },
          rationale: { type: 'string', description: 'Why this task exists and why this provider/model' },
        },
      },
    },
    sequential_phases: {
      type: 'array',
      description: 'Optional phase ordering. Each phase is an array of task indices that run in parallel.',
      items: {
        type: 'array',
        items: { type: 'integer' },
      },
    },
  },
});

export function buildOrchestrateRoutes(ctx) {
  const {
    json, error, readBody, log, broadcast,
    agentProcesses, getSidecarPort, getSidecarToken,
  } = ctx;

  return async (req, res, url) => {
    // POST /agent/orchestrate — start a planning session
    if (req.method === 'POST' && url.pathname === '/agent/orchestrate') {
      const body = await readBody(req);
      const prompt = typeof body.prompt === 'string' ? body.prompt.trim() : '';
      if (!prompt) {
        return error(res, 'prompt is required', 400);
      }

      const requestedProvider = typeof body.provider === 'string' ? body.provider : 'claude';
      const requestedModel = typeof body.model === 'string' ? body.model : null;
      const workingDir = body.cwd || process.env.PWD || process.cwd();

      // Validate provider
      let providerConfig;
      try {
        providerConfig = loadProviderConfig(requestedProvider);
      } catch (configErr) {
        return error(res, configErr.message, 400);
      }

      const binaryPath = resolveProviderBinary(providerConfig);
      if (!binaryPath) {
        return error(res, `${providerConfig.name} CLI not found. Run: rudi install agent:${requestedProvider}`, 500);
      }

      // Create orchestration row
      const orchestrationId = crypto.randomUUID();
      const plannerSessionId = crypto.randomUUID();
      const now = new Date().toISOString();
      const db = getDb();

      db.prepare(`
        INSERT INTO orchestration_plans (
          id, status, prompt, provider, model, plan_json, planner_session_id,
          run_group_id, project_path, created_at, completed_at, updated_at
        ) VALUES (?, 'planning', ?, ?, ?, NULL, ?, NULL, ?, ?, NULL, ?)
      `).run(
        orchestrationId,
        prompt,
        requestedProvider,
        requestedModel,
        plannerSessionId,
        workingDir,
        now,
        now,
      );

      // Build planner agent args
      const orchestratorPrompt = buildOrchestratorPrompt(prompt);
      const argOptions = {
        prompt: prompt,
        model: requestedModel,
        outputFormat: 'stream-json',
        maxTurns: 20,
        jsonSchema: ORCHESTRATION_PLAN_SCHEMA,
      };

      if (hasCapability(providerConfig, 'systemPrompt') && orchestratorPrompt) {
        argOptions.systemPrompt = orchestratorPrompt;
      }

      const args = buildArgs(providerConfig, argOptions);

      // Use bypassPermissions for planner (read-only analysis)
      const modes = providerConfig?.headless?.permissionModes || {};
      const permKey = modes.bypassPermissions ? 'bypassPermissions' : (modes.agent ? 'agent' : Object.keys(modes)[0]);
      if (permKey) {
        args.push(...getPermissionArgs(providerConfig, permKey));
      }

      const configEnv = buildEnv(providerConfig, process.env);
      const env = { ...process.env, ...configEnv };
      if (getSidecarPort() > 0) {
        env.RUDI_SIDECAR_URL = `http://127.0.0.1:${getSidecarPort()}`;
        env.RUDI_SIDECAR_TOKEN = getSidecarToken();
        env.RUDI_SESSION_ID = plannerSessionId;
      }

      // Create a minimal session row for the planner
      db.prepare(`
        INSERT INTO sessions (
          id, provider, provider_session_id, project_id, run_group_id,
          origin, title, title_override, snippet, status, model,
          cwd, project_path, git_branch,
          created_at, last_active_at, started_at,
          session_type, turn_count, total_cost, total_input_tokens, total_output_tokens, total_duration_ms
        ) VALUES (
          ?, ?, NULL, NULL, NULL,
          'rudi', ?, ?, '', 'active', ?,
          ?, ?, NULL,
          ?, ?, ?,
          'main', 0, 0, 0, 0, 0
        )
      `).run(
        plannerSessionId,
        requestedProvider,
        `Orchestrator: ${prompt.slice(0, 80)}`,
        `Orchestrator: ${prompt.slice(0, 80)}`,
        requestedModel,
        workingDir,
        workingDir,
        now,
        now,
        now,
      );

      db.prepare(`
        INSERT INTO session_runtime_state
          (session_id, status, provider, cwd, started_at, updated_at)
        VALUES (?, 'starting', ?, ?, ?, ?)
      `).run(plannerSessionId, requestedProvider, workingDir, now, now);

      // Track the last structured output from the planner
      let capturedStructuredOutput = null;

      try {
        spawnAgentProcess(ctx, {
          sessionId: plannerSessionId,
          prompt,
          provider: requestedProvider,
          model: requestedModel,
          permissionMode: 'bypassPermissions',
          systemPrompt: orchestratorPrompt,
          providerConfig,
          binaryPath,
          args,
          env,
          spawnCwd: workingDir,
          effectiveCwd: workingDir,
          workingDir,
          stdinModeOverride: 'close',
          sessionRowMode: 'existingSession',
          existingSessionId: plannerSessionId,
          autoNameOnFirstTurn: false,
          queueEvent: 'orchestrate-result',
          queueCloseEvent: 'orchestrate-close',
          onTurnResult: (event) => {
            // Capture structured_output from result events
            if (event.structuredOutput) {
              capturedStructuredOutput = event.structuredOutput;
            }
          },
          onProcessClose: ({ finalStatus }) => {
            const closeNow = new Date().toISOString();
            const db2 = getDb();

            if (finalStatus === 'completed' && capturedStructuredOutput) {
              // Plan extraction succeeded
              const planJson = typeof capturedStructuredOutput === 'string'
                ? capturedStructuredOutput
                : JSON.stringify(capturedStructuredOutput);

              db2.prepare(`
                UPDATE orchestration_plans
                SET status = 'ready', plan_json = ?, updated_at = ?, completed_at = ?
                WHERE id = ?
              `).run(planJson, closeNow, closeNow, orchestrationId);

              broadcast('orchestration:plan-ready', {
                orchestrationId,
                plannerSessionId,
                plan: capturedStructuredOutput,
              });

              log('agent', 'info', 'orchestration plan ready', {
                orchestrationId: orchestrationId.slice(0, 8),
              });
            } else {
              // Plan extraction failed
              db2.prepare(`
                UPDATE orchestration_plans
                SET status = 'failed', updated_at = ?, completed_at = ?
                WHERE id = ?
              `).run(closeNow, closeNow, orchestrationId);

              broadcast('orchestration:plan-failed', {
                orchestrationId,
                plannerSessionId,
                reason: finalStatus,
              });

              log('agent', 'warn', 'orchestration planning failed', {
                orchestrationId: orchestrationId.slice(0, 8),
                finalStatus,
              });
            }
          },
          onProcessError: () => {
            const errNow = new Date().toISOString();
            const db2 = getDb();
            db2.prepare(`
              UPDATE orchestration_plans
              SET status = 'failed', updated_at = ?, completed_at = ?
              WHERE id = ?
            `).run(errNow, errNow, orchestrationId);

            broadcast('orchestration:plan-failed', {
              orchestrationId,
              plannerSessionId,
              reason: 'process_error',
            });
          },
        });
      } catch (spawnErr) {
        const errIso = new Date().toISOString();
        db.prepare(`
          UPDATE orchestration_plans
          SET status = 'failed', updated_at = ?, completed_at = ?
          WHERE id = ?
        `).run(errIso, errIso, orchestrationId);

        return error(res, `Failed to spawn planner: ${spawnErr.message}`, 500);
      }

      json(res, {
        orchestrationId,
        plannerSessionId,
        status: 'planning',
      });
      return true;
    }

    // GET /agent/orchestration/:id — get plan status + data
    const detailMatch = url.pathname.match(/^\/agent\/orchestration\/([^/]+)$/);
    if (req.method === 'GET' && detailMatch) {
      const id = decodeURIComponent(detailMatch[1]);
      const db = getDb();
      const row = db.prepare('SELECT * FROM orchestration_plans WHERE id = ?').get(id);
      if (!row) return error(res, 'Orchestration not found', 404);

      // Parse plan_json for the response
      let parsedPlan = null;
      if (row.plan_json) {
        try {
          parsedPlan = JSON.parse(row.plan_json);
        } catch {
          parsedPlan = null;
        }
      }

      json(res, {
        orchestration: {
          ...row,
          parsed_plan: parsedPlan,
        },
      });
      return true;
    }

    // POST /agent/orchestration/:id/execute — execute approved plan
    const executeMatch = url.pathname.match(/^\/agent\/orchestration\/([^/]+)\/execute$/);
    if (req.method === 'POST' && executeMatch) {
      const id = decodeURIComponent(executeMatch[1]);
      const body = await readBody(req);
      const db = getDb();
      const row = db.prepare('SELECT * FROM orchestration_plans WHERE id = ?').get(id);

      if (!row) return error(res, 'Orchestration not found', 404);
      if (row.status !== 'ready') {
        return error(res, `Cannot execute: orchestration status is '${row.status}', expected 'ready'`, 400);
      }

      // Use tasks from body override, or from the stored plan
      let tasks;
      if (Array.isArray(body.tasks) && body.tasks.length > 0) {
        tasks = body.tasks;
      } else if (row.plan_json) {
        try {
          const plan = JSON.parse(row.plan_json);
          tasks = plan.tasks;
        } catch {
          return error(res, 'Failed to parse stored plan', 500);
        }
      } else {
        return error(res, 'No tasks available to execute', 400);
      }

      if (!Array.isArray(tasks) || tasks.length < 2) {
        return error(res, 'At least 2 tasks required', 400);
      }

      // Update status to executing
      const execNow = new Date().toISOString();
      db.prepare(`
        UPDATE orchestration_plans SET status = 'executing', updated_at = ? WHERE id = ?
      `).run(execNow, id);

      // Build run-group body from the orchestration tasks
      const runGroupBody = {
        name: `Orchestration: ${row.prompt.slice(0, 60)}`,
        provider: row.provider || 'claude',
        model: row.model,
        cwd: row.project_path || process.env.PWD || process.cwd(),
        tasks: tasks.map((t) => ({
          prompt: t.prompt,
          name: t.name || null,
          provider: t.provider || row.provider || 'claude',
          model: t.model || row.model || null,
        })),
      };

      const result = await createRunGroupFromRequest(ctx, runGroupBody);

      if (result.error) {
        const failNow = new Date().toISOString();
        db.prepare(`
          UPDATE orchestration_plans SET status = 'failed', updated_at = ? WHERE id = ?
        `).run(failNow, id);

        if (result.statusCode === 429) {
          return json(res, { error: result.error, message: result.message }, 429);
        }
        return error(res, result.error, result.statusCode || 500);
      }

      // Link orchestration to the run group
      const linkNow = new Date().toISOString();
      db.prepare(`
        UPDATE orchestration_plans
        SET run_group_id = ?, status = 'executing', updated_at = ?
        WHERE id = ?
      `).run(result.groupId, linkNow, id);

      json(res, {
        groupId: result.groupId,
        sessionIds: result.sessionIds,
        status: result.status,
      });
      return true;
    }

    // POST /agent/orchestration/:id/cancel — cancel planning
    const cancelMatch = url.pathname.match(/^\/agent\/orchestration\/([^/]+)\/cancel$/);
    if (req.method === 'POST' && cancelMatch) {
      const id = decodeURIComponent(cancelMatch[1]);
      const db = getDb();
      const row = db.prepare('SELECT * FROM orchestration_plans WHERE id = ?').get(id);
      if (!row) return error(res, 'Orchestration not found', 404);

      if (row.status === 'planning' && row.planner_session_id) {
        // Kill the planner process if still running
        const entry = agentProcesses.get(row.planner_session_id);
        if (entry?.proc && !entry.proc.killed) {
          entry._terminationReason = 'cancelled';
          entry.proc.kill('SIGTERM');
          setTimeout(() => {
            try { entry.proc.kill('SIGKILL'); } catch {}
          }, 3000);
        }
      }

      const cancelNow = new Date().toISOString();
      db.prepare(`
        UPDATE orchestration_plans
        SET status = 'cancelled', updated_at = ?, completed_at = ?
        WHERE id = ?
      `).run(cancelNow, cancelNow, id);

      json(res, { ok: true });
      return true;
    }

    return false;
  };
}
