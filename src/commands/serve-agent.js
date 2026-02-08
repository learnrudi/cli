/**
 * Agent route handler — extracted from serve.js
 *
 * Binary resolution, credential checking, and provider auth are module-level exports.
 * The route handler is created via createAgentHandler() with injected deps.
 */

import os from 'os';
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { spawn, execSync } from 'child_process';
import { PATHS } from '@learnrudi/env';

// ---------------------------------------------------------------------------
// Binary resolution + credential checking (module-level, no deps needed)
// ---------------------------------------------------------------------------

let _cachedClaudeBinary = null;

/**
 * Resolve the Claude binary path.
 * Returns the path or null if not found.
 */
export function resolveClaudeBinary() {
  if (_cachedClaudeBinary) return _cachedClaudeBinary;

  const nativePath = path.join(os.homedir(), '.local', 'bin', 'claude');
  if (fs.existsSync(nativePath)) {
    _cachedClaudeBinary = nativePath;
    return nativePath;
  }

  const nodeRoot = path.join(PATHS.runtimes, 'node');
  const arch = os.arch() === 'arm64' ? 'arm64' : 'x64';
  const candidates = [
    path.join(nodeRoot, arch, 'bin', 'claude'),
    path.join(nodeRoot, 'bin', 'claude'),
  ];
  for (const p of candidates) {
    if (fs.existsSync(p)) {
      _cachedClaudeBinary = p;
      return p;
    }
  }

  try {
    const which = execSync('which claude', { encoding: 'utf-8' }).trim();
    if (which && fs.existsSync(which)) {
      _cachedClaudeBinary = which;
      return which;
    }
  } catch {
    // not in PATH
  }

  return null;
}

/**
 * Check if Claude credentials exist (macOS keychain or API key).
 */
export function checkClaudeCredential() {
  if (process.env.CLAUDE_CODE_OAUTH_TOKEN) {
    return { authenticated: true, method: 'oauth-token' };
  }
  if (process.env.ANTHROPIC_API_KEY) {
    return { authenticated: true, method: 'api-key' };
  }

  try {
    const envPath = path.join(PATHS.home, '.env');
    if (fs.existsSync(envPath)) {
      const content = fs.readFileSync(envPath, 'utf-8');
      const oauthMatch = content.match(/^CLAUDE_CODE_OAUTH_TOKEN=(.+)$/m);
      if (oauthMatch && oauthMatch[1].trim()) {
        process.env.CLAUDE_CODE_OAUTH_TOKEN = oauthMatch[1].trim();
        return { authenticated: true, method: 'oauth-token' };
      }
      const apiMatch = content.match(/^ANTHROPIC_API_KEY=(.+)$/m);
      if (apiMatch && apiMatch[1].trim()) {
        process.env.ANTHROPIC_API_KEY = apiMatch[1].trim();
        return { authenticated: true, method: 'api-key' };
      }
    }
  } catch {
    // ignore read errors
  }

  if (os.platform() === 'darwin') {
    try {
      execSync('security find-generic-password -s "Claude Code-credentials"', { stdio: 'pipe' });
      return { authenticated: true, method: 'keychain' };
    } catch {
      // not in keychain
    }
  }

  const credPaths = [
    path.join(os.homedir(), '.claude', 'credentials.json'),
    path.join(os.homedir(), '.claude', '.credentials.json'),
  ];
  for (const p of credPaths) {
    if (fs.existsSync(p)) {
      return { authenticated: true, method: 'file' };
    }
  }

  return { authenticated: false, method: 'none' };
}

export async function checkProviderAuth(provider) {
  if (provider !== 'claude') {
    return {
      provider,
      ready: false,
      runtime: { installed: false },
      credential: { authenticated: false, method: 'none' },
      action: { type: 'install', message: `Provider '${provider}' not supported yet` },
    };
  }

  const binaryPath = resolveClaudeBinary();
  const runtime = { installed: !!binaryPath, path: binaryPath || undefined };
  const credential = checkClaudeCredential();
  const ready = runtime.installed && credential.authenticated;

  let action = { type: 'none', message: 'Ready' };
  if (!runtime.installed) {
    action = {
      type: 'install',
      message: 'Claude CLI not found. Install it with: rudi install agent:claude',
      command: 'rudi install agent:claude',
    };
  } else if (!credential.authenticated) {
    action = {
      type: 'login',
      message: 'Not authenticated. Run: claude login',
      command: 'claude login',
    };
  }

  return { provider: 'claude', ready, runtime, credential, action };
}

// ---------------------------------------------------------------------------
// Route handler factory
// ---------------------------------------------------------------------------

export function createAgentHandler({
  log,
  broadcast,
  json,
  error,
  readBody,
  agentProcesses,
  queueSessionsUpdated,
  resumeSessionIndex = new Map(),
}) {
  const dropResumeMappingsForSession = (targetSessionId) => {
    for (const [resumeId, mappedSessionId] of resumeSessionIndex.entries()) {
      if (mappedSessionId === targetSessionId) {
        resumeSessionIndex.delete(resumeId);
      }
    }
  };

  const resolveReusableEntry = (resumeSessionId) => {
    const mappedSessionId = resumeSessionIndex.get(resumeSessionId);
    if (mappedSessionId) {
      const mappedEntry = agentProcesses.get(mappedSessionId);
      if (mappedEntry?.proc && !mappedEntry.proc.killed) {
        return { sessionId: mappedSessionId, entry: mappedEntry };
      }
      resumeSessionIndex.delete(resumeSessionId);
    }

    for (const [existingId, entry] of agentProcesses.entries()) {
      const matchesProvider = entry.providerSessionId === resumeSessionId;
      const matchesResume = entry.resumeSessionId === resumeSessionId;
      if ((matchesProvider || matchesResume) && entry.proc && !entry.proc.killed) {
        resumeSessionIndex.set(resumeSessionId, existingId);
        if (entry.providerSessionId) {
          resumeSessionIndex.set(entry.providerSessionId, existingId);
        }
        return { sessionId: existingId, entry };
      }
    }

    return null;
  };

  return async function handleAgent(req, res, url) {
    // POST /agent/start — spawn persistent process with streaming stdin/stdout
    if (req.method === 'POST' && url.pathname === '/agent/start') {
      const body = await readBody(req);
      log('agent', 'info', 'received /agent/start request', { bodyKeys: Object.keys(body), resumeSessionId: body.resumeSessionId || null });
      const { prompt, model, systemPrompt, resumeSessionId, cwd, permissionMode, planMode } = body;

      if (!prompt) return error(res, 'prompt required');

      // If resuming a session that already has a running process, reuse it
      // instead of spawning a duplicate (which would corrupt the JSONL file).
      if (resumeSessionId) {
        const reusable = resolveReusableEntry(resumeSessionId);
        if (reusable) {
          const { sessionId: existingId, entry } = reusable;
          log('agent', 'info', `reusing existing process for resume ${resumeSessionId.slice(0, 8)}`, {
            existingSessionId: existingId.slice(0, 8),
          });
          entry.turnActive = true;
          const inputMsg = JSON.stringify({ type: 'user', message: { role: 'user', content: prompt } }) + '\n';
          entry.proc.stdin.write(inputMsg);
          broadcast('agent:event', {
            sessionId: existingId,
            event: { type: 'system', message: 'Resumed existing process' },
          });
          return json(res, { sessionId: existingId, provider: entry.provider, reused: true });
        }
      }

      const binaryPath = resolveClaudeBinary();
      if (!binaryPath) {
        log('agent', 'error', 'Claude CLI not found');
        return error(res, 'Claude CLI not found. Run: rudi install agent:claude', 500);
      }

      const sessionId = crypto.randomUUID();
      if (resumeSessionId) {
        // Pre-index the requested resume id to avoid near-simultaneous duplicates.
        resumeSessionIndex.set(resumeSessionId, sessionId);
      }

      const args = [
        '--output-format', 'stream-json',
        '--input-format', 'stream-json',
        '--verbose',
      ];
      if (model) args.push('--model', model);
      if (systemPrompt) args.push('--append-system-prompt', systemPrompt);
      if (resumeSessionId) args.push('--resume', resumeSessionId);
      if (planMode) {
        args.push('--permission-mode', 'plan');
      } else if (permissionMode && permissionMode !== 'default') {
        args.push('--permission-mode', permissionMode);
      }

      const env = {
        ...process.env,
        TERM: 'xterm-256color',
        CLAUDE_NO_UPDATE_CHECK: 'true',
        DISABLE_AUTOUPDATE: '1',
        NO_COLOR: '1',
      };
      if (permissionMode && permissionMode !== 'default') {
        env.CI = 'true';
      }

      const workingDir = cwd || process.env.HOME || os.homedir();

      log('agent', 'info', 'spawning persistent agent', {
        sessionId: sessionId.slice(0, 8),
        binary: binaryPath,
        cwd: workingDir,
        prompt: prompt.slice(0, 80),
        resumeSessionId: resumeSessionId || null,
      });

      try {
        const proc = spawn(binaryPath, args, {
          cwd: workingDir,
          env,
          stdio: ['pipe', 'pipe', 'pipe'],
        });

        const entry = {
          proc,
          provider: 'claude',
          providerSessionId: null,
          resumeSessionId: resumeSessionId || null,
          stdoutBuffer: '',
          turnActive: true,
        };
        agentProcesses.set(sessionId, entry);

        log('agent', 'info', `process spawned pid=${proc.pid}`, { sessionId: sessionId.slice(0, 8) });

        const inputMsg = JSON.stringify({ type: 'user', message: { role: 'user', content: prompt } }) + '\n';
        proc.stdin.write(inputMsg);
        log('agent', 'debug', 'wrote first prompt to stdin', { sessionId: sessionId.slice(0, 8) });

        proc.stdout.on('data', (chunk) => {
          entry.stdoutBuffer += chunk.toString();
          const lines = entry.stdoutBuffer.split('\n');
          entry.stdoutBuffer = lines.pop() || '';

          for (const line of lines) {
            if (!line.trim()) continue;
            try {
              const event = JSON.parse(line);
              if (event.session_id && entry.providerSessionId !== event.session_id) {
                entry.providerSessionId = event.session_id;
                resumeSessionIndex.set(event.session_id, sessionId);
              }
              log('agent', 'debug', `stdout event: ${event.type}`, { sessionId: sessionId.slice(0, 8) });
              broadcast('agent:event', { sessionId, event });

              if (event.type === 'result') {
                entry.turnActive = false;
                broadcast('agent:done', { sessionId, exitCode: 0, providerSessionId: entry.providerSessionId });
                queueSessionsUpdated({
                  source: 'agent',
                  event: 'result',
                  sessionId: entry.providerSessionId || null,
                });
              }
            } catch {
              log('agent', 'debug', `stdout non-json: ${line.slice(0, 120)}`, { sessionId: sessionId.slice(0, 8) });
              const isPermissionPrompt = /allow|deny|permission|approve/i.test(line) &&
                /\b(y|n|a|yes|no|always)\b/i.test(line);
              if (isPermissionPrompt) {
                log('agent', 'info', 'detected permission prompt', { sessionId: sessionId.slice(0, 8), line: line.slice(0, 200) });
                broadcast('agent:event', {
                  sessionId,
                  event: { type: 'system', subtype: 'permission_request', message: line },
                });
              } else {
                broadcast('agent:event', {
                  sessionId,
                  event: { type: 'system', message: line },
                });
              }
            }
          }
        });

        proc.stderr.on('data', (chunk) => {
          const text = chunk.toString().trim();
          if (text) {
            log('agent', 'warn', `stderr: ${text.slice(0, 200)}`, { sessionId: sessionId.slice(0, 8) });
            if (entry.turnActive) {
              broadcast('agent:error', { sessionId, error: text });
            }
          }
        });

        proc.on('close', (exitCode) => {
          log('agent', 'info', `process exited code=${exitCode}`, { sessionId: sessionId.slice(0, 8) });
          if (entry.stdoutBuffer.trim()) {
            try {
              const event = JSON.parse(entry.stdoutBuffer);
              if (event.session_id && entry.providerSessionId !== event.session_id) {
                entry.providerSessionId = event.session_id;
                resumeSessionIndex.set(event.session_id, sessionId);
              }
              broadcast('agent:event', { sessionId, event });
            } catch {
              // ignore
            }
          }
          if (entry.turnActive) {
            broadcast('agent:done', { sessionId, exitCode, providerSessionId: entry.providerSessionId });
            queueSessionsUpdated({
              source: 'agent',
              event: 'process-close',
              sessionId: entry.providerSessionId || null,
            });
          }
          dropResumeMappingsForSession(sessionId);
          agentProcesses.delete(sessionId);
        });

        proc.on('error', (err) => {
          log('agent', 'error', `spawn error: ${err.message}`, { sessionId: sessionId.slice(0, 8) });
          broadcast('agent:error', { sessionId, error: err.message });
          dropResumeMappingsForSession(sessionId);
          agentProcesses.delete(sessionId);
        });

        json(res, { sessionId, provider: 'claude' });
      } catch (err) {
        dropResumeMappingsForSession(sessionId);
        log('agent', 'error', `Failed to spawn: ${err.message}`);
        error(res, `Failed to spawn agent: ${err.message}`, 500);
      }
      return true;
    }

    // POST /agent/stop
    if (req.method === 'POST' && url.pathname === '/agent/stop') {
      const body = await readBody(req);
      const entry = agentProcesses.get(body.sessionId);
      if (entry) {
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
      if (!body.sessionId || !body.message) return error(res, 'sessionId and message required');

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
        const inputMsg = JSON.stringify({ type: 'user', message: { role: 'user', content: body.message } }) + '\n';
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

    // POST /agent/permission-response
    if (req.method === 'POST' && url.pathname === '/agent/permission-response') {
      const body = await readBody(req);
      if (!body.sessionId || !body.response) return error(res, 'sessionId and response required');

      const entry = agentProcesses.get(body.sessionId);
      if (!entry || !entry.proc || entry.proc.killed) {
        return error(res, 'No active process for this session', 400);
      }

      const answer = body.response;
      log('agent', 'info', 'sending permission response', { sessionId: body.sessionId.slice(0, 8), answer });
      try {
        entry.proc.stdin.write(answer + '\n');
        json(res, { ok: true });
      } catch (err) {
        error(res, `Failed to send permission response: ${err.message}`, 500);
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

    return false;
  };
}
