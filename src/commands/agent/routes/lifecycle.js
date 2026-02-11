/**
 * Simple agent lifecycle endpoints: stop, send, tool-result, status, sessions, kill-all.
 */

import { buildUserContent } from '../helpers.js';

export function buildLifecycleRoutes(ctx) {
  const { json, error, readBody, log, broadcast, agentProcesses, maxConcurrent } = ctx;

  return async (req, res, url) => {
    // POST /agent/stop
    if (req.method === 'POST' && url.pathname === '/agent/stop') {
      const body = await readBody(req);
      const entry = agentProcesses.get(body.sessionId);
      if (entry) {
        entry._terminationReason = 'stopped';
        entry.proc.kill('SIGTERM');
        const killTimer = setTimeout(() => {
          try { entry.proc.kill('SIGKILL'); } catch {}
        }, 3000);
        entry.proc.on('close', () => clearTimeout(killTimer));
        broadcast('agent:stopped', { sessionId: body.sessionId });
      }
      json(res, { ok: true });
      return true;
    }

    // POST /agent/send
    if (req.method === 'POST' && url.pathname === '/agent/send') {
      const body = await readBody(req);
      if (!body.sessionId || (!body.message && (!body.images || body.images.length === 0))) return error(res, 'sessionId and message required');

      const entry = agentProcesses.get(body.sessionId);
      if (!entry || !entry.proc || entry.proc.killed) {
        return error(res, 'No active process for this session — start a new one via /agent/start', 400);
      }

      log('agent', 'info', 'sending follow-up via stdin', {
        sessionId: body.sessionId.slice(0, 8),
        prompt: body.message.slice(0, 80),
      });

      try {
        entry.turnActive = true;
        entry.lastActivityAt = Date.now();
        // Reset per-turn accumulators for the new turn
        entry._turnPrompt = body.message;
        entry._turnInputTokens = 0;
        entry._turnOutputTokens = 0;
        entry._turnCacheReadTokens = 0;
        entry._turnCacheCreationTokens = 0;
        entry._turnToolsUsed = [];
        const inputMsg = JSON.stringify({ type: 'user', message: { role: 'user', content: buildUserContent(body.message, body.images, entry.cwd, log) } }) + '\n';
        entry.proc.stdin.write(inputMsg);
        json(res, { ok: true });
      } catch (err) {
        error(res, `Failed to send message: ${err.message}`, 500);
      }
      return true;
    }

    // POST /agent/tool-result
    if (req.method === 'POST' && url.pathname === '/agent/tool-result') {
      const body = await readBody(req);
      if (!body.sessionId || !body.toolUseId) return error(res, 'sessionId and toolUseId required');

      const entry = agentProcesses.get(body.sessionId);
      if (!entry || !entry.proc || entry.proc.killed) {
        return error(res, 'No active process for this session', 400);
      }

      log('agent', 'info', 'sending tool result via stdin', {
        sessionId: body.sessionId.slice(0, 8),
        toolUseId: body.toolUseId.slice(0, 12),
      });

      try {
        entry.turnActive = true;
        entry.lastActivityAt = Date.now();
        const answerSummary = Object.entries(body.answers || {})
          .map(([question, answer]) => `"${question}"="${answer}"`)
          .join(', ');
        const contentText = answerSummary
          ? `User has answered your questions: ${answerSummary}. You can now continue with the user's answers in mind.`
          : "User has answered your questions. You can now continue with the user's answers in mind.";
        const payload = JSON.stringify({
          type: 'user',
          message: {
            role: 'user',
            content: [
              { type: 'tool_result', tool_use_id: body.toolUseId, content: contentText }
            ]
          },
          toolUseResult: { questions: body.questions, answers: body.answers }
        });
        entry.proc.stdin.write(payload + '\n');
        json(res, { ok: true });
      } catch (err) {
        error(res, `Failed to send tool result: ${err.message}`, 500);
      }
      return true;
    }

    // GET /agent/status/:sessionId
    const statusMatch = url.pathname.match(/^\/agent\/status\/([^/]+)$/);
    if (req.method === 'GET' && statusMatch) {
      const sessionId = decodeURIComponent(statusMatch[1]);
      const entry = agentProcesses.get(sessionId);
      if (entry) {
        json(res, {
          running: true,
          provider: entry.provider,
          providerSessionId: entry.providerSessionId,
        });
      } else {
        json(res, { running: false });
      }
      return true;
    }

    // GET /agent/sessions — list all active processes
    if (req.method === 'GET' && url.pathname === '/agent/sessions') {
      const sessions = [];
      for (const [sessionId, entry] of agentProcesses) {
        const alive = !!(entry.proc && !entry.proc.killed);
        sessions.push({
          sessionId,
          pid: entry.proc?.pid || null,
          startedAt: entry.startedAt || null,
          lastActivityAt: entry.lastActivityAt || null,
          cwd: entry.cwd || null,
          turnActive: !!entry.turnActive,
          alive,
        });
      }
      json(res, { sessions, maxConcurrent });
      return true;
    }

    // POST /agent/kill-all — emergency kill all processes
    if (req.method === 'POST' && url.pathname === '/agent/kill-all') {
      const killed = [];
      for (const [sessionId, entry] of agentProcesses) {
        if (entry.proc && !entry.proc.killed) {
          killed.push(sessionId);
          entry._terminationReason = 'stopped';
          entry.proc.kill('SIGTERM');
          const killTimer = setTimeout(() => {
            try { entry.proc.kill('SIGKILL'); } catch {}
          }, 3000);
          entry.proc.on('close', () => clearTimeout(killTimer));
          broadcast('agent:stopped', { sessionId });
        }
      }
      log('agent', 'warn', `kill-all: terminated ${killed.length} processes`);
      json(res, { ok: true, killed: killed.length });
      return true;
    }

    return false;
  };
}
