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
import { spawn, execSync, execFileSync, spawnSync } from 'child_process';
import { PATHS } from '@learnrudi/env';
import { getDb } from '@learnrudi/db';

// ---------------------------------------------------------------------------
// System prompt — two layers:
// 1. RUDI base (hardcoded) — always present, tells agent about the environment
// 2. User file (~/.rudi/system-prompt.md) — optional, user-editable customizations
// ---------------------------------------------------------------------------

const RUDI_BASE_PROMPT = `You are working inside RUDI, an AI-powered development environment.

# Environment

- You are a Claude Code agent spawned by the RUDI sidecar server.
- The user interacts through the RUDI desktop app (Tauri + React).
- Your working directory is the user's project folder.
- Sessions are persisted to ~/.rudi/rudi.db and can be resumed later.

# RUDI CLI

The \`rudi\` CLI manages the development environment. Key commands:
- \`rudi serve\` — Start the sidecar server (HTTP + WebSocket)
- \`rudi install <pkg>\` — Install stacks (MCP servers), prompts, runtimes, binaries, or agents
- \`rudi list [kind]\` — List installed packages (stacks, prompts, runtimes, binaries, agents)
- \`rudi run <stack>\` — Execute an MCP stack
- \`rudi mcp <stack>\` — Run an MCP server with secrets injected
- \`rudi secrets\` — Manage secrets (OS Keychain + encrypted fallback)
- \`rudi db <cmd>\` — Database operations on ~/.rudi/rudi.db
- \`rudi import\` — Import sessions from AI providers
- \`rudi doctor\` — Health check
- \`rudi home\` — Show ~/.rudi structure

# RUDI Directory Structure

- \`~/.rudi/\` — Root directory
- \`~/.rudi/rudi.db\` — SQLite database (sessions, turns, projects, file changes, costs)
- \`~/.rudi/stacks/\` — MCP server stacks (each has manifest.json)
- \`~/.rudi/prompts/\` — Reusable prompt templates (.md files)
- \`~/.rudi/runtimes/\` — Language interpreters (node, python)
- \`~/.rudi/binaries/\` — Utility CLIs (ffmpeg, ripgrep, jq, etc.)
- \`~/.rudi/agents/\` — AI CLI agents (claude, codex, gemini, ollama)
- \`~/.rudi/bins/\` — Shims directory (added to PATH)
- \`~/.rudi/vault/\` — Encrypted secrets store
- \`~/.rudi/config.json\` — Configuration
- \`~/.rudi/system-prompt.md\` — User-editable system prompt (appended to this one)

# Database

SQLite at ~/.rudi/rudi.db. Key tables:
- \`sessions\` — Conversations (title, model, cwd, git_branch, turn_count, total_cost, status)
- \`turns\` — Individual messages (user_message, assistant_response, tokens, cost, tools_used, duration_ms)
- \`projects\` — Project containers (provider, name, settings)
- \`file_changes\` — File operations tracked per session (path, operation, content hashes, diffs)
- \`file_revisions\` — File snapshots/history
- \`secrets_meta\` — Secret key metadata (values in vault, not DB)
- \`packages\` — Installed package metadata
- \`logs\` — Application logs

# UI Features (available to the user, not directly callable by you)

- Git: staging, committing, reverting, branch switching/creating via the UI header
- Diff panel: side-by-side view of file changes you make during a session
- Session management: rename, pin, archive, resume sessions from the sidebar
- Live tail: other windows/users can watch your session output in real time
- Context files: user can drag files into the chat as additional context
- Open-in: one-click open project in VS Code, Cursor, Terminal, Finder, Warp, Xcode

# Best Practices

- Be concise. The user is in a desktop app — keep responses focused.
- Prefer small targeted edits over full file rewrites.
- The user sees your tool calls (reads, edits, bash) streaming live — don't narrate every step.
- If the user's project has a CLAUDE.md, follow its instructions — it takes priority.
- When the user asks about RUDI itself, you can reference the CLI commands and directory structure above.`;

const USER_PROMPT_PATH = path.join(PATHS.home, 'system-prompt.md');

let _cachedUserPrompt = null;
let _userPromptMtime = 0;

function loadUserPrompt() {
  try {
    const stat = fs.statSync(USER_PROMPT_PATH);
    if (stat.mtimeMs === _userPromptMtime && _cachedUserPrompt !== null) return _cachedUserPrompt;
    _cachedUserPrompt = fs.readFileSync(USER_PROMPT_PATH, 'utf-8').trim();
    _userPromptMtime = stat.mtimeMs;
    return _cachedUserPrompt;
  } catch {
    _cachedUserPrompt = null;
    _userPromptMtime = 0;
    return null;
  }
}

const SPAWN_CHILDREN_PROMPT = `# Spawning Child Sessions

You have \`spawn_child\` and \`list_children\` tools available. Use them to spawn and monitor
child agent sessions. Each child gets its own git worktree and runs headlessly with full autonomy.

## When to spawn children

- A task has clearly separable subtasks that can run in parallel
- The user asks you to "start working on X in the background"
- You want to delegate a subtask without leaving the current conversation
- You're planning work and want to kick off execution in parallel sessions

## spawn_child tool

Call the \`spawn_child\` tool directly with these fields:

- **prompt** (required): Full task brief for the child. Be specific — include scope, files to touch, acceptance criteria, and commit message convention. The child has zero other context.
- **description** (optional): Short label (e.g. "login-form", "api-tests"). Used in branch name and sidebar. Auto-generated from prompt if omitted.
- **model** (optional): "haiku" (fast, cheap — great for boilerplate/mechanical tasks), "sonnet" (balanced — good default), "opus" (most capable — complex architecture or reasoning). Defaults to parent's model.
- **provider** (optional): Default "claude". Future-proofs non-Claude routing.
- **baseRef** (optional): Git ref to branch from. Defaults to parent HEAD.

## list_children tool

Call \`list_children\` (no arguments) to check on all your spawned children. Returns status, alive state, branch, description, and model for each child.

## Guidelines

- Spawn children FIRST before doing any file work yourself — let children handle the files
- Each child works in its own isolated git worktree — no merge conflicts possible
- Keep child tasks focused and independent (avoid overlapping file edits)
- Each child should create any directories it needs and commit its work when done
- Children cannot spawn further children
- The user sees all child sessions in the sidebar and can click into any child to review
- Write thorough prompts — the child has zero context beyond what you put in the prompt field
- Choose the right model per task: haiku for boilerplate, sonnet for standard work, opus for complex logic
- Issue one spawn_child call per tool turn (prevents concurrency errors)
- Never issue concurrent spawn_child calls in a single response; spawn one child at a time

## Fallback (only if spawn_child tool is unavailable)

If the spawn_child MCP tool is not available, fall back to curl:

\`\`\`bash
curl -s -X POST "$RUDI_SIDECAR_URL/agent/spawn-child" \\
  -H "X-Rudi-Token: $RUDI_SIDECAR_TOKEN" \\
  -H "X-Rudi-Caller-Session: $RUDI_SESSION_ID" \\
  -H "Content-Type: application/json" \\
  -d '{"parentSessionId":"'$RUDI_SESSION_ID'","prompt":"...","description":"...","model":"sonnet","origin":"bash_curl"}'
\`\`\`

Check children via curl:
\`\`\`bash
curl -s "$RUDI_SIDECAR_URL/agent/children/$RUDI_SESSION_ID" \\
  -H "X-Rudi-Token: $RUDI_SIDECAR_TOKEN" \\
  -H "X-Rudi-Caller-Session: $RUDI_SESSION_ID"
\`\`\``;

function buildSystemPrompt(frontendPrompt, { canSpawnChildren = false } = {}) {
  const parts = [RUDI_BASE_PROMPT];
  const userPrompt = loadUserPrompt();
  if (userPrompt) parts.push(userPrompt);
  if (canSpawnChildren) parts.push(SPAWN_CHILDREN_PROMPT);
  if (frontendPrompt) parts.push(frontendPrompt);
  return parts.join('\n\n---\n\n');
}

// ---------------------------------------------------------------------------

let _db = null;
let _dbReadyChecked = false;
const _dbWriteQueue = [];
let _dbWriteFlushScheduled = false;

function resolveDb() {
  if (_db) return _db;
  if (_dbReadyChecked) return null;
  _dbReadyChecked = true;
  try {
    _db = getDb();
  } catch (err) {
    console.warn('[agent-db] unavailable:', err.message);
    _db = null;
  }
  return _db;
}

function flushDbWrites() {
  _dbWriteFlushScheduled = false;
  const db = resolveDb();
  if (!db) {
    _dbWriteQueue.length = 0;
    return;
  }
  while (_dbWriteQueue.length > 0) {
    const fn = _dbWriteQueue.shift();
    try {
      fn(db);
    } catch (err) {
      console.error('[agent-db] write failed:', err.message);
    }
  }
}

function dbWrite(fn) {
  _dbWriteQueue.push(fn);
  if (_dbWriteFlushScheduled) return;
  _dbWriteFlushScheduled = true;
  setImmediate(flushDbWrites);
}

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

// ---------------------------------------------------------------------------
// Idle reaper — kills processes that have been idle too long
// ---------------------------------------------------------------------------

export function createIdleReaper({
  agentProcesses,
  broadcast,
  log,
  idleTimeoutMs = 10 * 60 * 1000, // 10 min default
  maxConcurrent = 6,
}) {
  const interval = setInterval(() => {
    const now = Date.now();
    for (const [sessionId, entry] of agentProcesses.entries()) {
      if (!entry.proc || entry.proc.killed) continue;
      if (entry.turnActive) continue; // actively processing a turn
      const idle = now - (entry.lastActivityAt || entry.startedAt || now);
      if (idle > idleTimeoutMs) {
        log('agent', 'warn', `idle reaper: killing session ${sessionId.slice(0, 8)} (idle ${Math.round(idle / 1000)}s)`);
        entry._terminationReason = 'stopped';
        entry.proc.kill('SIGTERM');
        const killTimer = setTimeout(() => {
          try { entry.proc.kill('SIGKILL'); } catch {}
        }, 3000);
        entry.proc.on('close', () => clearTimeout(killTimer));
        broadcast('agent:stopped', { sessionId });
      }
    }
  }, 30_000);

  return () => clearInterval(interval);
}

// ---------------------------------------------------------------------------
// Auto-name: fire-and-forget Haiku call after first turn
// ---------------------------------------------------------------------------

function autoNameSession(entry, providerSessionId, firstMessage, cwd, broadcast, log) {
  setImmediate(async () => {
    try {
      const binaryPath = resolveClaudeBinary();
      if (!binaryPath) return;

      const projectName = path.basename(cwd || '');
      const prompt = `Generate a short title (3-7 words) for this coding session based on the user's request. The title should describe what work is being done. Return ONLY the title text, no quotes, no punctuation at the end.\n\nProject: ${projectName}\nUser request: ${(firstMessage || '').slice(0, 1000)}`;

      const child = spawn(binaryPath, [
        '-p', prompt,
        '--model', 'haiku',
        '--no-session-persistence',
        '--max-turns', '1',
        '--output-format', 'json',
      ], { stdio: ['ignore', 'pipe', 'pipe'], timeout: 15000 });

      let stdout = '';
      child.stdout.on('data', (chunk) => { stdout += chunk; });

      const exitCode = await new Promise((resolve) => {
        const timer = setTimeout(() => { try { child.kill(); } catch {} }, 15000);
        child.on('close', (code) => { clearTimeout(timer); resolve(code); });
        child.on('error', () => { clearTimeout(timer); resolve(1); });
      });

      if (exitCode !== 0 || !stdout) return;

      const parsed = JSON.parse(stdout);
      const title = (parsed.result || '').trim();
      if (!title) return;

      // Write to DB: sessions.title (not title_override — that's for user renames)
      dbWrite((db) => {
        db.prepare(`
          UPDATE sessions SET title = ? WHERE id = ? AND title_override IS NULL
        `).run(title, providerSessionId);
      });

      // Broadcast so frontends can refresh
      broadcast('session:titled', { sessionId: providerSessionId, title });
      log('agent', 'info', `auto-named session ${providerSessionId.slice(0, 8)}: "${title}"`);
    } catch (err) {
      log('agent', 'warn', `auto-name failed: ${err.message}`);
    }
  });
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
  maxConcurrent = 6,
  getSidecarPort = () => 0,
  getSidecarToken = () => '',
}) {
  // Rate limit tracking for spawn-child (per parent, in-memory)
  const spawnRateMap = new Map(); // parentSessionId -> [timestamp, ...]
  const MAX_SPAWNS_PER_WINDOW = 3;
  const SPAWN_RATE_WINDOW_MS = 10_000;
  const MAX_CHILDREN_PER_PARENT = 5;
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

  /** Count alive (non-killed) processes. */
  const countAlive = () => {
    let count = 0;
    for (const [, entry] of agentProcesses) {
      if (entry.proc && !entry.proc.killed) count++;
    }
    return count;
  };

  /** Broadcast current process count to all WS clients. */
  const broadcastProcessCount = () => {
    broadcast('agent:process-count', {
      count: countAlive(),
      maxConcurrent,
    });
  };

  /** Normalize an HTTP header value to a single string (Node may return string[]). */
  const normalizeHeader = (val) => Array.isArray(val) ? val[0] : val || '';

  /**
   * Get the actual repository root, even when called from inside a worktree.
   * git rev-parse --show-toplevel returns the worktree root (wrong for our purposes).
   * git rev-parse --git-common-dir returns the shared .git dir → parent = real repo root.
   */
  function getRepoRoot(cwd) {
    const gitCommonDir = execFileSync('git', ['rev-parse', '--git-common-dir'], {
      cwd, stdio: 'pipe',
    }).toString().trim();
    // Resolve relative path (e.g., ".git" → absolute)
    const absGitDir = path.resolve(cwd, gitCommonDir);
    return path.dirname(absGitDir);
  }

  /** Save pasted images to .rudi/images/ and return augmented prompt text. */
  function buildUserContent(text, images, cwd) {
    if (!images || images.length === 0) return text;
    const imgDir = path.join(cwd || os.homedir(), '.rudi', 'images');
    fs.mkdirSync(imgDir, { recursive: true });
    const paths = [];
    for (const img of images) {
      const ext = img.mediaType === 'image/jpeg' ? '.jpg'
        : img.mediaType === 'image/gif' ? '.gif'
        : img.mediaType === 'image/webp' ? '.webp'
        : '.png';
      const filename = `paste-${Date.now()}-${crypto.randomUUID().slice(0, 8)}${ext}`;
      const filePath = path.join(imgDir, filename);
      fs.writeFileSync(filePath, Buffer.from(img.data, 'base64'));
      paths.push(filePath);
      log('agent', 'info', `saved pasted image to ${filePath}`, { size: img.data.length, mediaType: img.mediaType });
    }
    const imageRefs = paths.map((p) => `[Pasted image: ${p}]`).join('\n');
    return text ? `${imageRefs}\n\n${text}` : imageRefs;
  }

  return async function handleAgent(req, res, url) {
    // POST /agent/start — spawn persistent process with streaming stdin/stdout
    if (req.method === 'POST' && url.pathname === '/agent/start') {
      const body = await readBody(req);
      log('agent', 'info', 'received /agent/start request', { bodyKeys: Object.keys(body), resumeSessionId: body.resumeSessionId || null });
      const {
        prompt,
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
      const isChildSession = Boolean(parentSessionId);
      let shouldUseWorktree = useWorktree !== false;
      // Belt-and-suspenders: child sessions are always isolated.
      if (isChildSession) shouldUseWorktree = true;

      if (!prompt && (!images || images.length === 0)) return error(res, 'prompt required');

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
          entry.lastActivityAt = Date.now();
          // Reset per-turn accumulators for the new turn
          entry._turnPrompt = prompt;
          entry._turnInputTokens = 0;
          entry._turnOutputTokens = 0;
          entry._turnCacheReadTokens = 0;
          entry._turnCacheCreationTokens = 0;
          entry._turnToolsUsed = [];
          // 4j. Reuse — touch updated_at
          dbWrite((db) => {
            db.prepare(`
              UPDATE session_runtime_state SET updated_at = ? WHERE session_id = ?
            `).run(new Date().toISOString(), existingId);
          });
          const inputMsg = JSON.stringify({ type: 'user', message: { role: 'user', content: buildUserContent(prompt, images, entry.cwd) } }) + '\n';
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

      // Enforce max concurrent process limit
      const aliveCount = countAlive();
      if (aliveCount >= maxConcurrent) {
        log('agent', 'warn', `max concurrent limit reached (${aliveCount}/${maxConcurrent})`);
        json(res, {
          error: `Too many active agent processes (${aliveCount}/${maxConcurrent}). Stop an existing session or wait for one to finish.`,
        }, 429);
        return true;
      }

      const binaryPath = resolveClaudeBinary();
      if (!binaryPath) {
        log('agent', 'error', 'Claude CLI not found');
        return error(res, 'Claude CLI not found. Run: rudi install agent:claude', 500);
      }

      const sessionId = crypto.randomUUID();
      const shortId = sessionId.slice(0, 8);
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

      // Build system prompt: RUDI base + user file + frontend override + spawn section for main sessions
      const canSpawnChildren = getSidecarPort() > 0;
      const fullSystemPrompt = buildSystemPrompt(systemPrompt, { canSpawnChildren });
      if (fullSystemPrompt) args.push('--append-system-prompt', fullSystemPrompt);
      if (resumeSessionId) args.push('--resume', resumeSessionId);
      if (planMode) {
        args.push('--permission-mode', 'plan');
      } else if (permissionMode && permissionMode !== 'default') {
        args.push('--permission-mode', permissionMode);
      }

      // Headless sessions cannot interactively approve MCP tool prompts.
      // Pre-allow spawn tools so parent agents can delegate without blocking.
      if (canSpawnChildren) {
        args.push(
          '--allowed-tools',
          'mcp__rudi-spawn__spawn_child,mcp__rudi-spawn__list_children'
        );
      }

      // MCP config injection: merge user's MCP servers with rudi-spawn for child spawning
      let mcpConfigPath = null;
      if (canSpawnChildren) {
        const spawnShimPath = path.join(PATHS.home, 'bins', 'rudi-spawn');
        if (fs.existsSync(spawnShimPath)) {
          try {
            // Read user's existing MCP servers from ~/.claude.json
            let existingMcpServers = {};
            const claudeJsonPath = path.join(os.homedir(), '.claude.json');
            try {
              const claudeJson = JSON.parse(fs.readFileSync(claudeJsonPath, 'utf-8'));
              existingMcpServers = claudeJson.mcpServers || {};
            } catch {
              // No ~/.claude.json or malformed — use empty
            }

            // Merge in rudi-spawn
            const mergedConfig = {
              mcpServers: {
                ...existingMcpServers,
                'rudi-spawn': { command: spawnShimPath, args: [] },
              },
            };

            // Write to temp file
            const tmpDir = path.join(PATHS.home, 'tmp');
            fs.mkdirSync(tmpDir, { recursive: true });
            mcpConfigPath = path.join(tmpDir, `spawn-mcp-${shortId}.json`);
            fs.writeFileSync(mcpConfigPath, JSON.stringify(mergedConfig, null, 2), { mode: 0o600 });

            args.push('--mcp-config', mcpConfigPath, '--strict-mcp-config');

            log('agent', 'info', `injected spawn MCP config: ${mcpConfigPath}`, { sessionId: shortId, serverCount: Object.keys(mergedConfig.mcpServers).length });
          } catch (mcpErr) {
            log('agent', 'warn', `MCP config injection failed: ${mcpErr.message}`, { sessionId: shortId });
          }
        }
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
      // Inject sidecar connection env vars for child spawning
      const port = getSidecarPort();
      if (port > 0) {
        env.RUDI_SIDECAR_URL = `http://127.0.0.1:${port}`;
        env.RUDI_SIDECAR_TOKEN = getSidecarToken();
        env.RUDI_SESSION_ID = sessionId;
        env.RUDI_CAN_SPAWN_CHILDREN = '1';
      }

      const workingDir = cwd || process.env.HOME || os.homedir();

      // Detect git repo + branch for drift detection and worktree isolation
      let currentBranch = null;
      let repoRoot = null;
      let isGitRepo = false;
      try {
        execSync('git rev-parse --is-inside-work-tree', { cwd: workingDir, stdio: 'pipe' });
        // Use getRepoRoot() to get the actual repo root, not worktree root
        repoRoot = getRepoRoot(workingDir);
        currentBranch = execSync('git rev-parse --abbrev-ref HEAD', { cwd: workingDir, stdio: 'pipe' }).toString().trim();
        isGitRepo = true;
      } catch {
        // Not a usable git repo context for branch-attached worktree creation.
        // Keep isGitRepo=false so we fall back to shared cwd instead of 500.
        isGitRepo = false;
        repoRoot = null;
        currentBranch = null;
      }

      // Worktree isolation: branch-attached, named after the current branch
      let worktreePath = null;
      let worktreeBranch = null;
      let baseBranch = currentBranch;
      let gitignoreWarning = false;
      let effectiveCwd = workingDir;

      if (isGitRepo && repoRoot && currentBranch) {
        if (!resumeSessionId) {
          if (shouldUseWorktree) {
            // New session — create worktree named after the branch
            // Sanitize branch for use as directory name (replace / with -)
            const safeBranchDir = (currentBranch || 'detached').replace(/\//g, '-');
            const worktreesBase = path.join(repoRoot, '.rudi', 'worktrees');

            // Find unique directory name: branch, branch-2, branch-3, ...
            let worktreeDir = path.join(worktreesBase, safeBranchDir);
            if (fs.existsSync(worktreeDir)) {
              let suffix = 2;
              while (fs.existsSync(path.join(worktreesBase, `${safeBranchDir}-${suffix}`))) suffix++;
              worktreeDir = path.join(worktreesBase, `${safeBranchDir}-${suffix}`);
            }

            try {
              fs.mkdirSync(worktreesBase, { recursive: true });

              // Try the current branch directly first (works if not checked out elsewhere)
              let branchName = currentBranch;
              try {
                execSync(
                  `git worktree add ${JSON.stringify(worktreeDir)} ${branchName}`,
                  { cwd: repoRoot, stdio: 'pipe' }
                );
              } catch {
                // Branch already checked out (expected — main repo is on it)
                // Clean up any partial directory from the failed attempt
                try { fs.rmSync(worktreeDir, { recursive: true, force: true }); } catch {}
                // Collision fallback: sanitize slashes to dashes to avoid git ref conflict
                // (git can't have both refs/heads/foo and refs/heads/foo/bar)
                const safeBase = currentBranch.replace(/\//g, '-');
                branchName = `${safeBase}-session-${shortId}`;
                execSync(
                  `git worktree add -b ${branchName} ${JSON.stringify(worktreeDir)}`,
                  { cwd: repoRoot, stdio: 'pipe' }
                );
              }

              // Verify worktree directory actually exists before using it
              if (fs.existsSync(worktreeDir)) {
                worktreePath = worktreeDir;
                worktreeBranch = branchName;
                effectiveCwd = worktreeDir;
              } else {
                log('agent', 'warn', `worktree dir missing after creation, using shared cwd`, { sessionId: shortId });
              }
              log('agent', 'info', `worktree created on branch ${branchName}: ${worktreeDir}`, { sessionId: shortId });

              // Check if .rudi/ is in .gitignore
              try {
                const gitignorePath = path.join(repoRoot, '.gitignore');
                const gitignoreContent = fs.existsSync(gitignorePath)
                  ? fs.readFileSync(gitignorePath, 'utf-8')
                  : '';
                if (!gitignoreContent.split('\n').some(line => line.trim() === '.rudi/' || line.trim() === '.rudi')) {
                  gitignoreWarning = true;
                }
              } catch {
                gitignoreWarning = true;
              }
            } catch (wtErr) {
              log('agent', 'warn', `worktree creation failed, using shared cwd: ${wtErr.message}`, { sessionId: shortId });
              // Non-fatal — fall back to shared cwd
            }
          }
        } else {
          // Resume — check DB for existing worktree
          try {
            const db = getDb();
            const row = db.prepare(
              'SELECT worktree_path, worktree_branch, base_branch FROM session_runtime_state WHERE session_id = ? OR resume_session_id = ?'
            ).get(resumeSessionId, resumeSessionId);

            if (row?.worktree_path && fs.existsSync(row.worktree_path)) {
              worktreePath = row.worktree_path;
              worktreeBranch = row.worktree_branch;
              baseBranch = row.base_branch || currentBranch;
              effectiveCwd = row.worktree_path;
              log('agent', 'info', `resumed into existing worktree: ${worktreePath}`, { sessionId: shortId });
            } else if (row?.worktree_branch) {
              // Worktree dir missing but branch exists — try recreating
              const recreateName = row.worktree_branch.replace(/\//g, '-');
              const worktreeDir = path.join(repoRoot, '.rudi', 'worktrees', recreateName);
              try {
                fs.mkdirSync(path.join(repoRoot, '.rudi', 'worktrees'), { recursive: true });
                execSync(
                  `git worktree add ${JSON.stringify(worktreeDir)} ${row.worktree_branch}`,
                  { cwd: repoRoot, stdio: 'pipe' }
                );
                worktreePath = worktreeDir;
                worktreeBranch = row.worktree_branch;
                baseBranch = row.base_branch || currentBranch;
                effectiveCwd = worktreeDir;
                log('agent', 'info', `recreated worktree from existing branch: ${worktreeDir}`, { sessionId: shortId });
              } catch (recreateErr) {
                log('agent', 'warn', `worktree recreate failed: ${recreateErr.message}`, { sessionId: shortId });
              }
            }
          } catch (dbErr) {
            log('agent', 'warn', `worktree DB lookup failed: ${dbErr.message}`, { sessionId: shortId });
          }
        }
      }

      // Persist/echo the resolved mode (actual behavior), not just requested preference.
      const resolvedUseWorktree = Boolean(worktreePath);

      // Node spawn can throw ENOENT when cwd doesn't exist. Validate and
      // fall back before spawning so binary-not-found and cwd-not-found are distinct.
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

      log('agent', 'info', 'spawning persistent agent', {
        sessionId: shortId,
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
             worktree_path, worktree_branch, project_root, base_branch, use_worktree)
          VALUES (?, 'starting', 'claude', ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(sessionId, resumeSessionId || null, effectiveCwd, now, now,
               worktreePath, worktreeBranch, repoRoot, baseBranch, resolvedUseWorktree ? 1 : 0);
      });

      try {
        const proc = spawn(binaryPath, args, {
          cwd: spawnCwd,
          env,
          stdio: ['pipe', 'pipe', 'pipe'],
        });

        const entry = {
          proc,
          provider: 'claude',
          providerSessionId: null,
          resumeSessionId: resumeSessionId || null,
          parentSessionId: null, // main sessions have no parent
          stdoutBuffer: '',
          turnActive: true,
          startedAt: Date.now(),
          lastActivityAt: Date.now(),
          cwd: effectiveCwd,
          repoRoot,
          worktreePath,
          worktreeBranch,
          baseBranch,
          _terminationReason: null,
          // Per-turn metric accumulators (reset after each result event)
          _turnPrompt: prompt,
          _turnNumber: 1,
          _turnInputTokens: 0,
          _turnOutputTokens: 0,
          _turnCacheReadTokens: 0,
          _turnCacheCreationTokens: 0,
          _turnModel: model || null,
          _turnToolsUsed: [],
        };
        agentProcesses.set(sessionId, entry);

        log('agent', 'info', `process spawned pid=${proc.pid}`, { sessionId: sessionId.slice(0, 8) });

        const inputMsg = JSON.stringify({ type: 'user', message: { role: 'user', content: buildUserContent(prompt, images, effectiveCwd) } }) + '\n';
        proc.stdin.write(inputMsg);
        log('agent', 'debug', 'wrote first prompt to stdin', { sessionId: sessionId.slice(0, 8) });

        proc.stdout.on('data', (chunk) => {
          entry.lastActivityAt = Date.now();
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
                // 4b. Provider ID captured — mark running
                dbWrite((db) => {
                  db.prepare(`
                    UPDATE session_runtime_state
                    SET status = 'running', provider_session_id = ?, updated_at = ?
                    WHERE session_id = ?
                  `).run(event.session_id, new Date().toISOString(), sessionId);
                });
              }
              // Accumulate per-turn metrics from assistant events
              if (event.type === 'assistant' && event.message?.usage) {
                const u = event.message.usage;
                entry._turnInputTokens += u.input_tokens || 0;
                entry._turnOutputTokens += u.output_tokens || 0;
                entry._turnCacheReadTokens += u.cache_read_input_tokens || 0;
                entry._turnCacheCreationTokens += u.cache_creation_input_tokens || 0;
                if (event.message.model) entry._turnModel = event.message.model;
              }
              if (event.type === 'assistant' && Array.isArray(event.message?.content)) {
                for (const block of event.message.content) {
                  if (block.type === 'tool_use' && block.name) {
                    entry._turnToolsUsed.push(block.name);
                  }
                }
              }

              log('agent', 'debug', `stdout event: ${event.type}`, { sessionId: sessionId.slice(0, 8) });
              broadcast('agent:event', { sessionId, event });

              if (event.type === 'result') {
                entry.turnActive = false;
                const costUsd = typeof event.total_cost_usd === 'number' ? event.total_cost_usd : null;
                const turnNumber = entry._turnNumber;
                const turnPrompt = entry._turnPrompt || '';
                const turnModel = entry._turnModel || null;
                const turnInputTokens = entry._turnInputTokens;
                const turnOutputTokens = entry._turnOutputTokens;
                const turnCacheRead = entry._turnCacheReadTokens;
                const turnCacheCreation = entry._turnCacheCreationTokens;
                const turnToolsUsed = entry._turnToolsUsed.length > 0
                  ? JSON.stringify([...new Set(entry._turnToolsUsed)])
                  : null;
                const providerSid = entry.providerSessionId;

                // 4c. Turn complete — runtime state + sessions/turns DB write
                dbWrite((db) => {
                  const now = new Date().toISOString();
                  const nowMs = Date.now();

                  // Update session_runtime_state (existing)
                  if (costUsd !== null) {
                    db.prepare(`
                      UPDATE session_runtime_state
                      SET turn_count = turn_count + 1, cost_total = ?, updated_at = ?
                      WHERE session_id = ?
                    `).run(costUsd, now, sessionId);
                  } else {
                    db.prepare(`
                      UPDATE session_runtime_state
                      SET turn_count = turn_count + 1, updated_at = ?
                      WHERE session_id = ?
                    `).run(now, sessionId);
                  }

                  if (!providerSid) return; // can't write to sessions without a provider id

                  // Ensure session row exists (idempotent — first turn creates, rest skip)
                  db.prepare(`
                    INSERT OR IGNORE INTO sessions
                      (id, provider, provider_session_id, origin, cwd, model, status, created_at, last_active_at,
                       turn_count, total_cost, total_input_tokens, total_output_tokens)
                    VALUES (?, 'claude', ?, 'rudi', ?, ?, 'active', ?, ?, 0, 0, 0, 0)
                  `).run(providerSid, providerSid, workingDir, turnModel, now, now);

                  // Insert turn
                  const turnId = crypto.randomUUID();
                  db.prepare(`
                    INSERT INTO turns
                      (id, session_id, provider, provider_session_id, turn_number,
                       user_message, model, cost, input_tokens, output_tokens,
                       cache_read_tokens, cache_creation_tokens, tools_used, ts, ts_ms)
                    VALUES (?, ?, 'claude', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                  `).run(
                    turnId, providerSid, providerSid, turnNumber,
                    turnPrompt, turnModel, costUsd,
                    turnInputTokens, turnOutputTokens,
                    turnCacheRead, turnCacheCreation,
                    turnToolsUsed, now, nowMs,
                  );

                  // Increment session aggregates
                  const turnCost = costUsd !== null ? costUsd : 0;
                  db.prepare(`
                    UPDATE sessions
                    SET turn_count = turn_count + 1,
                        total_cost = total_cost + ?,
                        total_input_tokens = total_input_tokens + ?,
                        total_output_tokens = total_output_tokens + ?,
                        last_active_at = ?
                    WHERE id = ?
                  `).run(turnCost, turnInputTokens, turnOutputTokens, now, providerSid);
                });

                // Auto-name after first turn completes (fire-and-forget)
                if (turnNumber === 1 && providerSid) {
                  autoNameSession(entry, providerSid, turnPrompt, workingDir, broadcast, log);
                }

                // Advance turn counter & reset accumulators
                entry._turnNumber++;
                entry._turnPrompt = '';
                entry._turnInputTokens = 0;
                entry._turnOutputTokens = 0;
                entry._turnCacheReadTokens = 0;
                entry._turnCacheCreationTokens = 0;
                entry._turnToolsUsed = [];

                broadcast('agent:done', { sessionId, exitCode: 0, providerSessionId: entry.providerSessionId });
                queueSessionsUpdated({
                  source: 'agent',
                  event: 'result',
                  sessionId: entry.providerSessionId || null,
                });
              }
            } catch {
              log('agent', 'debug', `stdout non-json: ${line.slice(0, 120)}`, { sessionId: sessionId.slice(0, 8) });
              const trimmed = line.trim();
              const isPermissionPrompt =
                // Standard tool permission prompts (Allow Bash? y/n/a)
                (/allow|deny|permission|approve/i.test(trimmed) && /\b(y|n|a|yes|no|always)\b/i.test(trimmed)) ||
                // Catch-all: any short non-JSON line ending with "?" is likely
                // an interactive CLI prompt (plan mode, workspace trust, etc.)
                (trimmed.length < 200 && trimmed.endsWith('?'));
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
                // 4b2. Provider ID captured in close-buffer path
                dbWrite((db) => {
                  db.prepare(`
                    UPDATE session_runtime_state
                    SET provider_session_id = ?, updated_at = ?
                    WHERE session_id = ?
                  `).run(event.session_id, new Date().toISOString(), sessionId);
                });
              }
              broadcast('agent:event', { sessionId, event });
            } catch {
              // ignore
            }
          }
          // 4d. Process close — finalize status (respects _terminationReason)
          dbWrite((db) => {
            const now = new Date().toISOString();
            const finalStatus = entry._terminationReason || (exitCode === 0 ? 'completed' : 'error');
            db.prepare(`
              UPDATE session_runtime_state
              SET status = ?, completed_at = ?, updated_at = ?
              WHERE session_id = ?
            `).run(finalStatus, now, now, sessionId);
          });
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
          broadcastProcessCount();
          // Cleanup temp MCP config file
          if (mcpConfigPath) { try { fs.unlinkSync(mcpConfigPath); } catch {} }
        });

        proc.on('exit', () => {
          // Cleanup temp MCP config file (symmetric with close/error)
          if (mcpConfigPath) { try { fs.unlinkSync(mcpConfigPath); } catch {} }
        });

        proc.on('error', (err) => {
          log('agent', 'error', `spawn error: ${err.message}`, { sessionId: sessionId.slice(0, 8) });
          broadcast('agent:error', { sessionId, error: err.message });
          // 4e. Spawn error
          dbWrite((db) => {
            db.prepare(`
              UPDATE session_runtime_state
              SET status = 'error', last_error = ?, updated_at = ?
              WHERE session_id = ?
            `).run(err.message, new Date().toISOString(), sessionId);
          });
          dropResumeMappingsForSession(sessionId);
          agentProcesses.delete(sessionId);
          // Cleanup temp MCP config file
          if (mcpConfigPath) { try { fs.unlinkSync(mcpConfigPath); } catch {} }
        });

        json(res, {
          sessionId,
          provider: 'claude',
          cwd: effectiveCwd,
          currentBranch,
          repoRoot,
          worktreeBranch: worktreeBranch || undefined,
          projectCwd: worktreePath ? workingDir : undefined,
          baseBranch: baseBranch || undefined,
          gitignoreWarning: gitignoreWarning || undefined,
          useWorktree: resolvedUseWorktree,
        });
        broadcastProcessCount();
      } catch (err) {
        dropResumeMappingsForSession(sessionId);
        // 4f. Spawn catch
        dbWrite((db) => {
          db.prepare(`
            UPDATE session_runtime_state
            SET status = 'error', last_error = ?, updated_at = ?
            WHERE session_id = ?
          `).run(err.message, new Date().toISOString(), sessionId);
        });
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
        const inputMsg = JSON.stringify({ type: 'user', message: { role: 'user', content: buildUserContent(body.message, body.images, entry.cwd) } }) + '\n';
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
        entry.lastActivityAt = Date.now();
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

    // POST /agent/cleanup-worktree — safely remove a session's worktree
    if (req.method === 'POST' && url.pathname === '/agent/cleanup-worktree') {
      const body = await readBody(req);
      if (!body.sessionId) return error(res, 'sessionId required');

      try {
        const db = getDb();
        const row = db.prepare(
          'SELECT worktree_path, worktree_branch, base_branch, project_root FROM session_runtime_state WHERE session_id = ?'
        ).get(body.sessionId);

        if (!row?.worktree_path) {
          return json(res, { ok: false, reason: 'no_worktree', details: 'No worktree associated with this session' });
        }

        if (!fs.existsSync(row.worktree_path)) {
          // Worktree dir already gone — clean up DB
          db.prepare('UPDATE session_runtime_state SET worktree_path = NULL WHERE session_id = ?').run(body.sessionId);
          return json(res, { ok: true });
        }

        const repoDir = row.project_root || path.dirname(path.dirname(path.dirname(row.worktree_path)));

        // Check for uncommitted changes
        let uncommitted = '';
        try {
          uncommitted = execFileSync('git', ['status', '--porcelain'], { cwd: row.worktree_path, stdio: 'pipe' }).toString().trim();
        } catch {}

        // Check for unmerged commits
        let unmerged = '';
        if (row.worktree_branch && row.base_branch) {
          try {
            unmerged = execFileSync(
              'git', ['log', `${row.base_branch}..${row.worktree_branch}`, '--oneline'],
              { cwd: repoDir, stdio: 'pipe' }
            ).toString().trim();
          } catch {}
        }

        if ((uncommitted || unmerged) && !body.force) {
          const reason = uncommitted ? 'uncommitted_changes' : 'unmerged_commits';
          const details = uncommitted
            ? `Uncommitted changes:\n${uncommitted}`
            : `Unmerged commits:\n${unmerged}`;
          return json(res, { ok: false, reason, details });
        }

        // Remove worktree
        try {
          const removeArgs = body.force
            ? ['worktree', 'remove', '--force', row.worktree_path]
            : ['worktree', 'remove', row.worktree_path];
          execFileSync('git', removeArgs, { cwd: repoDir, stdio: 'pipe' });
        } catch (wtErr) {
          return json(res, { ok: false, reason: 'remove_failed', details: wtErr.message });
        }

        // Try to delete the branch (only with -d, fails if unmerged)
        let branchRetained = false;
        if (row.worktree_branch && !row.worktree_branch.startsWith('-') && !body.force) {
          try {
            execFileSync('git', ['branch', '-d', '--', row.worktree_branch], { cwd: repoDir, stdio: 'pipe' });
          } catch {
            branchRetained = true; // Branch has unmerged commits, keep it
          }
        } else if (row.worktree_branch && body.force) {
          // Force mode: worktree removed but branch always retained
          branchRetained = true;
        }

        // Update DB
        db.prepare('UPDATE session_runtime_state SET worktree_path = NULL WHERE session_id = ?').run(body.sessionId);

        json(res, { ok: true, branchRetained, branch: branchRetained ? row.worktree_branch : null });
        log('agent', 'info', `worktree cleaned up for session ${body.sessionId.slice(0, 8)}`, { branchRetained });
      } catch (err) {
        error(res, `Cleanup failed: ${err.message}`, 500);
      }
      return true;
    }

    // POST /agent/delete-worktree-branch — explicitly delete a retained worktree branch
    if (req.method === 'POST' && url.pathname === '/agent/delete-worktree-branch') {
      const body = await readBody(req);
      if (!body.sessionId) return error(res, 'sessionId required');

      try {
        const db = getDb();
        const row = db.prepare(
          'SELECT worktree_branch, project_root FROM session_runtime_state WHERE session_id = ?'
        ).get(body.sessionId);

        if (!row?.worktree_branch) {
          return json(res, { ok: false, reason: 'no_branch', details: 'No worktree branch for this session' });
        }

        const repoDir = row.project_root;
        if (!repoDir) {
          return json(res, { ok: false, reason: 'no_repo', details: 'No project root recorded' });
        }

        try {
          // Use -d (lowercase) — fails safely if unmerged
          if (row.worktree_branch.startsWith('-')) {
            return json(res, { ok: false, reason: 'invalid_branch', details: 'Branch name starts with dash' });
          }
          execFileSync('git', ['branch', '-d', '--', row.worktree_branch], { cwd: repoDir, stdio: 'pipe' });
        } catch (brErr) {
          return json(res, { ok: false, reason: 'branch_unmerged', details: brErr.message });
        }

        db.prepare('UPDATE session_runtime_state SET worktree_branch = NULL WHERE session_id = ?').run(body.sessionId);
        json(res, { ok: true });
        log('agent', 'info', `worktree branch deleted for session ${body.sessionId.slice(0, 8)}`, { branch: row.worktree_branch });
      } catch (err) {
        error(res, `Branch delete failed: ${err.message}`, 500);
      }
      return true;
    }

    // POST /agent/spawn-child — spawn a child session in its own worktree
    if (req.method === 'POST' && url.pathname === '/agent/spawn-child') {
      // Guard: sidecar must be fully initialized
      if (getSidecarPort() === 0) {
        return json(res, { error: 'SIDECAR_NOT_READY', message: 'Sidecar server is still initializing' }, 503);
      }

      const body = await readBody(req);
      const { parentSessionId, prompt: childPrompt, description, model: childModel, baseRef, provider: childProvider, origin: childOrigin } = body;
      const callerSession = normalizeHeader(req.headers['x-rudi-caller-session']);
      const provider = childProvider || 'claude';
      const origin = childOrigin || 'unknown';

      // --- Validation ---
      if (!childPrompt || typeof childPrompt !== 'string' || !childPrompt.trim()) {
        return error(res, 'prompt required', 400);
      }
      if (childPrompt.length > 25000) {
        return error(res, 'prompt too long (max 25000 chars)', 400);
      }
      if (!parentSessionId || typeof parentSessionId !== 'string') {
        return error(res, 'parentSessionId required', 400);
      }
      // UUID format check (loose)
      if (!/^[0-9a-f-]{36}$/i.test(parentSessionId)) {
        return error(res, 'parentSessionId must be a valid UUID', 400);
      }
      if (!callerSession || callerSession !== parentSessionId) {
        return error(res, 'X-Rudi-Caller-Session must match parentSessionId', 403);
      }
      if (description && description.length > 64) {
        return error(res, 'description too long (max 64 chars)', 400);
      }
      // Model: free-form string — validated by Claude API at runtime
      if (childModel && typeof childModel !== 'string') {
        return error(res, 'model must be a string', 400);
      }

      // Rate limit: max 3 spawns per 10s per parent
      const now = Date.now();
      const parentTimestamps = spawnRateMap.get(parentSessionId) || [];
      const recentTimestamps = parentTimestamps.filter(t => now - t < SPAWN_RATE_WINDOW_MS);
      if (recentTimestamps.length >= MAX_SPAWNS_PER_WINDOW) {
        return json(res, { error: 'SPAWN_RATE_LIMITED', message: `Max ${MAX_SPAWNS_PER_WINDOW} spawns per ${SPAWN_RATE_WINDOW_MS / 1000}s` }, 429);
      }

      // --- Parent eligibility: must be a main session with no parent ---
      // Memory fast-path
      const parentEntry = agentProcesses.get(parentSessionId);
      if (parentEntry?.parentSessionId) {
        return json(res, { error: 'NESTED_CHILD_SPAWN_NOT_SUPPORTED', message: 'Children cannot spawn further children' }, 400);
      }
      // DB authoritative check: require session_type='main' and parent_session_id IS NULL
      try {
        const db = getDb();
        const parentRow = db.prepare('SELECT parent_session_id, session_type FROM sessions WHERE id = ?').get(parentSessionId);
        if (parentRow?.parent_session_id) {
          return json(res, { error: 'NESTED_CHILD_SPAWN_NOT_SUPPORTED', message: 'Children cannot spawn further children' }, 400);
        }
        if (parentRow && parentRow.session_type && parentRow.session_type !== 'main') {
          return json(res, { error: 'SPAWN_NOT_ALLOWED', message: `Only main sessions can spawn children (this session is '${parentRow.session_type}')` }, 403);
        }
      } catch {
        // DB check is best-effort on new sessions (row may not exist yet); memory check is primary
      }

      // --- Per-parent child limit ---
      let childCount = 0;
      for (const [, entry] of agentProcesses) {
        if (entry.parentSessionId === parentSessionId && entry.proc && !entry.proc.killed) {
          childCount++;
        }
      }
      if (childCount >= MAX_CHILDREN_PER_PARENT) {
        return json(res, { error: 'CHILD_LIMIT_REACHED', message: `Max ${MAX_CHILDREN_PER_PARENT} children per parent`, max: MAX_CHILDREN_PER_PARENT }, 429);
      }

      // --- Global concurrency ---
      const aliveCount = countAlive();
      if (aliveCount >= maxConcurrent) {
        return json(res, { error: 'MAX_CONCURRENT_REACHED', message: `Too many active agent processes (${aliveCount}/${maxConcurrent})` }, 429);
      }

      // --- Resolve parent context ---
      let parentCwd = null;
      let parentRepoRoot = null;
      let parentModel = null;
      let parentBaseBranch = null;

      if (parentEntry) {
        parentCwd = parentEntry.cwd;
        parentRepoRoot = parentEntry.repoRoot || null;
        parentModel = parentEntry._turnModel || null;
        parentBaseBranch = parentEntry.baseBranch || null;
      }

      // DB fallback for cwd / repo root
      if (!parentCwd || !parentRepoRoot) {
        try {
          const db = getDb();
          const runtimeRow = db.prepare(`
            SELECT cwd, project_root, base_branch FROM session_runtime_state WHERE session_id = ?
          `).get(parentSessionId);
          if (runtimeRow) {
            if (!parentCwd) parentCwd = runtimeRow.cwd;
            if (!parentRepoRoot) parentRepoRoot = runtimeRow.project_root;
            if (!parentBaseBranch) parentBaseBranch = runtimeRow.base_branch;
          }
        } catch {
          // best effort
        }
      }

      if (!parentCwd) {
        return json(res, { error: 'PARENT_CONTEXT_UNAVAILABLE', message: 'Parent session has ended and required runtime context is missing.' }, 409);
      }

      // Detect/verify repo root — ensure it's the actual repo root, not a worktree root.
      // Re-resolve even if we have a value, since stale DB entries may have worktree paths.
      try {
        const resolvedRoot = getRepoRoot(parentCwd);
        if (!parentRepoRoot || parentRepoRoot !== resolvedRoot) {
          log('agent', 'debug', `repo root resolved: ${parentRepoRoot} → ${resolvedRoot}`, { sessionId: shortId });
          parentRepoRoot = resolvedRoot;
        }
      } catch {
        if (!parentRepoRoot) {
          return json(res, { error: 'NOT_A_GIT_REPO', message: 'Parent cwd is not inside a git repository' }, 400);
        }
      }

      // Resolve baseRef (default to parent HEAD)
      let resolvedBaseRef = baseRef || null;
      if (!resolvedBaseRef) {
        try {
          resolvedBaseRef = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: parentCwd, stdio: 'pipe' }).toString().trim();
        } catch {
          resolvedBaseRef = 'HEAD';
        }
      }
      // Validate baseRef: block option injection and invalid chars
      if (resolvedBaseRef.startsWith('-') || resolvedBaseRef === '--') {
        return json(res, { error: 'INVALID_BASE_REF', message: 'baseRef must not start with -' }, 400);
      }
      if (!/^[a-zA-Z0-9_.\/\-~^{}@]+$/.test(resolvedBaseRef)) {
        return json(res, { error: 'INVALID_BASE_REF', message: 'baseRef contains invalid characters' }, 400);
      }
      // Verify the ref actually resolves in the parent repo
      try {
        execFileSync('git', ['rev-parse', '--verify', `${resolvedBaseRef}^{commit}`], { cwd: parentRepoRoot, stdio: 'pipe' });
      } catch {
        return json(res, { error: 'INVALID_BASE_REF', message: `baseRef '${resolvedBaseRef}' does not resolve to a valid commit` }, 400);
      }

      // --- Sanitize description for branch name ---
      // Auto-generate from prompt if description not provided (first few words, slugified)
      const rawDesc = description || childPrompt.trim().split(/\s+/).slice(0, 5).join(' ');
      const sanitizedDesc = rawDesc
        .toLowerCase()
        .replace(/[^a-z0-9-]/g, '-')
        .replace(/-+/g, '-')
        .replace(/^-|-$/g, '')
        .slice(0, 32) || 'child';

      // --- Binary ---
      const binaryPath = resolveClaudeBinary();
      if (!binaryPath) {
        return error(res, 'Claude CLI not found', 500);
      }

      const childSessionId = crypto.randomUUID();
      const shortId = childSessionId.slice(0, 8);

      // --- Worktree creation with collision loop ---
      const worktreesBase = path.join(parentRepoRoot, '.rudi', 'worktrees');
      let worktreeBranch = null;
      let worktreePath = null;

      fs.mkdirSync(worktreesBase, { recursive: true });

      for (let attempt = 0; attempt < 5; attempt++) {
        const suffix = crypto.randomUUID().slice(0, 8);
        const branchName = `child-${sanitizedDesc}-${suffix}`;
        const wtDir = path.join(worktreesBase, branchName);

        try {
          execFileSync('git', ['worktree', 'add', '-b', branchName, wtDir, resolvedBaseRef], {
            cwd: parentRepoRoot, stdio: 'pipe',
          });
          worktreeBranch = branchName;
          worktreePath = wtDir;
          break;
        } catch (wtErr) {
          // Clean up partial dir and any partially-created branch
          try { fs.rmSync(wtDir, { recursive: true, force: true }); } catch {}
          try { execFileSync('git', ['branch', '-D', '--', branchName], { cwd: parentRepoRoot, stdio: 'pipe' }); } catch {}
          if (attempt === 4) {
            log('agent', 'error', `worktree creation failed after 5 attempts: ${wtErr.message}`, { sessionId: shortId });
            return json(res, { error: 'WORKTREE_BRANCH_COLLISION', message: 'Could not create worktree after 5 attempts' }, 500);
          }
        }
      }

      // --- Insert session row ---
      const nowIso = new Date().toISOString();
      log('agent', 'info', `spawn-child request`, { origin, provider, parentSessionId: parentSessionId.slice(0, 8) });
      dbWrite((db) => {
        db.prepare(`
          INSERT INTO sessions
            (id, provider, origin, cwd, model, status, session_type, parent_session_id,
             title_override, started_at, created_at, last_active_at)
          VALUES (?, ?, 'rudi', ?, ?, 'active', 'child', ?, ?, ?, ?, ?)
        `).run(childSessionId, provider, worktreePath, childModel || parentModel, parentSessionId, sanitizedDesc, nowIso, nowIso, nowIso);
      });

      // --- Insert runtime state ---
      dbWrite((db) => {
        db.prepare(`
          INSERT INTO session_runtime_state
            (session_id, status, provider, cwd, started_at, updated_at,
             worktree_path, worktree_branch, project_root, base_branch, use_worktree)
          VALUES (?, 'starting', ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(childSessionId, provider, worktreePath, nowIso, nowIso,
               worktreePath, worktreeBranch, parentRepoRoot, parentBaseBranch, 1);
      });

      // --- Build args ---
      // Children use -p (print mode): process prompt and exit.
      // stream-json output lets us capture events, but no stream-json input needed.
      const childArgs = [
        '--output-format', 'stream-json',
        '--verbose',
        '-p', childPrompt,
      ];
      if (childModel) childArgs.push('--model', childModel);

      const childSystemPrompt = buildSystemPrompt(null, { canSpawnChildren: false });
      if (childSystemPrompt) childArgs.push('--append-system-prompt', childSystemPrompt);

      // Children run headlessly with full permissions (isolated in their own worktree)
      childArgs.push('--dangerously-skip-permissions');

      // Skip MCP servers for children — they don't need them and they add 15-20s startup
      const emptyMcpPath = path.join(os.tmpdir(), 'rudi-empty-mcp.json');
      if (!fs.existsSync(emptyMcpPath)) {
        fs.writeFileSync(emptyMcpPath, '{"mcpServers":{}}', { mode: 0o600 });
      }
      childArgs.push('--mcp-config', emptyMcpPath, '--strict-mcp-config');

      // --- Build env ---
      const childEnv = {
        ...process.env,
        TERM: 'xterm-256color',
        CLAUDE_NO_UPDATE_CHECK: 'true',
        DISABLE_AUTOUPDATE: '1',
        NO_COLOR: '1',
        CI: 'true',
      };
      const port = getSidecarPort();
      if (port > 0) {
        childEnv.RUDI_SIDECAR_URL = `http://127.0.0.1:${port}`;
        childEnv.RUDI_SIDECAR_TOKEN = getSidecarToken();
        childEnv.RUDI_SESSION_ID = childSessionId;
        childEnv.RUDI_CAN_SPAWN_CHILDREN = '0';
      }

      // --- Spawn ---
      try {
        const proc = spawn(binaryPath, childArgs, {
          cwd: worktreePath,
          env: childEnv,
          stdio: ['pipe', 'pipe', 'pipe'],
        });

        // Close stdin immediately — child is in -p mode and doesn't read stdin.
        // Some CLIs hang waiting for stdin EOF.
        proc.stdin.end();

        const entry = {
          proc,
          provider,
          providerSessionId: null,
          resumeSessionId: null,
          parentSessionId,
          stdoutBuffer: '',
          turnActive: true,
          startedAt: Date.now(),
          lastActivityAt: Date.now(),
          cwd: worktreePath,
          repoRoot: parentRepoRoot,
          worktreePath,
          worktreeBranch,
          baseBranch: parentBaseBranch,
          _terminationReason: null,
          _turnPrompt: childPrompt,
          _turnNumber: 1,
          _turnInputTokens: 0,
          _turnOutputTokens: 0,
          _turnCacheReadTokens: 0,
          _turnCacheCreationTokens: 0,
          _turnModel: childModel || parentModel || null,
          _turnToolsUsed: [],
          _isChild: true,
          _description: sanitizedDesc,
        };
        agentProcesses.set(childSessionId, entry);

        // Mark running
        dbWrite((db) => {
          db.prepare(`
            UPDATE session_runtime_state SET status = 'running', updated_at = ? WHERE session_id = ?
          `).run(new Date().toISOString(), childSessionId);
          db.prepare(`
            UPDATE sessions SET started_at = ? WHERE id = ?
          `).run(new Date().toISOString(), childSessionId);
        });

        log('agent', 'info', `child process spawned pid=${proc.pid}`, {
          sessionId: shortId,
          parentSessionId: parentSessionId.slice(0, 8),
          worktreeBranch,
          cwd: worktreePath,
          binary: binaryPath,
          origin,
          provider,
          argsCount: childArgs.length,
          promptLen: childPrompt.length,
          args: childArgs.filter(a => a !== childPrompt && (a.length < 60 || a.startsWith('--'))).join(' '),
        });

        // --- Helper: SIGTERM then SIGKILL after 5s ---
        const killWithFallback = (p) => {
          try { p.kill('SIGTERM'); } catch {}
          setTimeout(() => { try { if (!p.killed) p.kill('SIGKILL'); } catch {} }, 5000);
        };

        // --- Startup watchdog: if no stdout/stderr within 120s, mark as stalled ---
        const STARTUP_TIMEOUT_MS = 120_000;
        let startupTimer = setTimeout(() => {
          if (entry.turnActive && entry.lastActivityAt === entry.startedAt) {
            log('agent', 'error', `child startup stall — no output in ${STARTUP_TIMEOUT_MS / 1000}s`, { sessionId: shortId });
            entry._terminationReason = 'startup_stall';
            killWithFallback(proc);
          }
        }, STARTUP_TIMEOUT_MS);

        // --- Hard runtime timeout: 15 minutes max ---
        const RUNTIME_TIMEOUT_MS = 15 * 60 * 1000;
        const runtimeTimer = setTimeout(() => {
          if (entry.proc && !entry.proc.killed) {
            log('agent', 'warn', `child runtime timeout (${RUNTIME_TIMEOUT_MS / 1000}s)`, { sessionId: shortId });
            entry._terminationReason = 'timeout';
            killWithFallback(proc);
          }
        }, RUNTIME_TIMEOUT_MS);

        // --- stdout handler ---
        let _childStdoutBytes = 0;
        proc.stdout.on('data', (chunk) => {
          _childStdoutBytes += chunk.length;
          entry.lastActivityAt = Date.now();
          if (startupTimer) { clearTimeout(startupTimer); startupTimer = null; }
          // Log first few chunks for debugging child startup
          if (_childStdoutBytes <= 2000) {
            log('agent', 'debug', `child stdout (${chunk.length}b, total=${_childStdoutBytes}): ${chunk.toString().slice(0, 200)}`, { sessionId: shortId });
          }
          entry.stdoutBuffer += chunk.toString();
          const lines = entry.stdoutBuffer.split('\n');
          entry.stdoutBuffer = lines.pop() || '';

          for (const line of lines) {
            if (!line.trim()) continue;
            try {
              const event = JSON.parse(line);
              if (event.session_id && entry.providerSessionId !== event.session_id) {
                entry.providerSessionId = event.session_id;
                resumeSessionIndex.set(event.session_id, childSessionId);
                dbWrite((db) => {
                  db.prepare(`
                    UPDATE session_runtime_state SET provider_session_id = ?, updated_at = ? WHERE session_id = ?
                  `).run(event.session_id, new Date().toISOString(), childSessionId);
                });
              }
              if (event.type === 'assistant' && event.message?.usage) {
                const u = event.message.usage;
                entry._turnInputTokens += u.input_tokens || 0;
                entry._turnOutputTokens += u.output_tokens || 0;
                entry._turnCacheReadTokens += u.cache_read_input_tokens || 0;
                entry._turnCacheCreationTokens += u.cache_creation_input_tokens || 0;
                if (event.message.model) entry._turnModel = event.message.model;
              }
              if (event.type === 'assistant' && Array.isArray(event.message?.content)) {
                for (const block of event.message.content) {
                  if (block.type === 'tool_use' && block.name) {
                    entry._turnToolsUsed.push(block.name);
                  }
                }
              }

              broadcast('agent:event', { sessionId: childSessionId, event });

              if (event.type === 'result') {
                entry.turnActive = false;
                const costUsd = typeof event.total_cost_usd === 'number' ? event.total_cost_usd : null;
                const providerSid = entry.providerSessionId;
                dbWrite((db) => {
                  const now = new Date().toISOString();
                  if (costUsd !== null) {
                    db.prepare(`
                      UPDATE session_runtime_state SET turn_count = turn_count + 1, cost_total = ?, updated_at = ? WHERE session_id = ?
                    `).run(costUsd, now, childSessionId);
                  } else {
                    db.prepare(`
                      UPDATE session_runtime_state SET turn_count = turn_count + 1, updated_at = ? WHERE session_id = ?
                    `).run(now, childSessionId);
                  }
                  if (providerSid) {
                    db.prepare(`
                      UPDATE sessions SET provider_session_id = ?, last_active_at = ?, total_cost = ? WHERE id = ?
                    `).run(providerSid, now, costUsd || 0, childSessionId);
                  }
                });
                broadcast('agent:done', { sessionId: childSessionId, exitCode: 0, providerSessionId: entry.providerSessionId });
                queueSessionsUpdated({ source: 'agent', event: 'child-result', sessionId: entry.providerSessionId || null });
              }
            } catch {
              broadcast('agent:event', { sessionId: childSessionId, event: { type: 'system', message: line } });
            }
          }
        });

        let _childStderrBytes = 0;
        proc.stderr.on('data', (chunk) => {
          _childStderrBytes += chunk.length;
          entry.lastActivityAt = Date.now();
          if (startupTimer) { clearTimeout(startupTimer); startupTimer = null; }
          const text = chunk.toString().trim();
          if (text) {
            // Log all stderr for debugging (not just first 200 chars)
            log('agent', 'warn', `child stderr (${_childStderrBytes}b): ${text.slice(0, 500)}`, { sessionId: shortId });
            if (entry.turnActive) {
              broadcast('agent:error', { sessionId: childSessionId, error: text });
            }
          }
        });

        // Shared cleanup — called from both 'close' and the 'exit' safety net.
        // Guard against double-fire (close + exit can both trigger).
        let _childCleanedUp = false;
        const cleanupChild = (exitCode, source) => {
          if (_childCleanedUp) return;
          _childCleanedUp = true;
          if (startupTimer) { clearTimeout(startupTimer); startupTimer = null; }
          clearTimeout(runtimeTimer);
          try {
            log('agent', 'info', `child process exited code=${exitCode} (${source})`, { sessionId: shortId });
            const finalStatus = entry._terminationReason || (exitCode === 0 ? 'completed' : 'error');
            dbWrite((db) => {
              const now = new Date().toISOString();
              db.prepare(`
                UPDATE session_runtime_state SET status = ?, completed_at = ?, updated_at = ? WHERE session_id = ?
              `).run(finalStatus, now, now, childSessionId);
              db.prepare(`
                UPDATE sessions SET ended_at = ?, exit_code = ? WHERE id = ?
              `).run(now, exitCode, childSessionId);
            });
            if (entry.turnActive) {
              broadcast('agent:done', { sessionId: childSessionId, exitCode, providerSessionId: entry.providerSessionId });
            }
            broadcast('sessions:updated', { source: 'agent', event: 'child-completed', sessionId: childSessionId });
          } catch (cleanupErr) {
            log('agent', 'error', `child cleanup error: ${cleanupErr.message}`, { sessionId: shortId });
          }
          agentProcesses.delete(childSessionId);
          broadcastProcessCount();
        };

        proc.on('close', (exitCode) => cleanupChild(exitCode, 'close'));
        proc.on('exit', (exitCode) => cleanupChild(exitCode, 'exit'));

        proc.on('error', (err) => {
          log('agent', 'error', `child spawn error: ${err.message}`, { sessionId: shortId });
          if (startupTimer) { clearTimeout(startupTimer); startupTimer = null; }
          clearTimeout(runtimeTimer);
          try {
            dbWrite((db) => {
              const now = new Date().toISOString();
              db.prepare(`
                UPDATE session_runtime_state SET status = 'error', last_error = ?, updated_at = ? WHERE session_id = ?
              `).run(err.message, now, childSessionId);
              db.prepare(`
                UPDATE sessions SET error_code = 'SPAWN_ERROR', error_message = ?, ended_at = ? WHERE id = ?
              `).run(err.message, now, childSessionId);
            });
          } catch (dbErr) {
            log('agent', 'error', `child error handler DB write failed: ${dbErr.message}`, { sessionId: shortId });
          }
          broadcast('agent:error', { sessionId: childSessionId, error: err.message });
          agentProcesses.delete(childSessionId);
        });

        // Track rate limit
        recentTimestamps.push(now);
        spawnRateMap.set(parentSessionId, recentTimestamps);

        broadcastProcessCount();
        broadcast('sessions:updated', { source: 'agent', event: 'child-spawned', sessionId: childSessionId });

        json(res, {
          sessionId: childSessionId,
          worktreeBranch,
          worktreePath,
          status: 'spawned',
        });
      } catch (spawnErr) {
        // Compensating transaction: clean up worktree on spawn failure
        log('agent', 'error', `child spawn failed: ${spawnErr.message}`, { sessionId: shortId });
        try {
          execFileSync('git', ['worktree', 'remove', '--force', worktreePath], { cwd: parentRepoRoot, stdio: 'pipe' });
          try { execFileSync('git', ['branch', '-D', '--', worktreeBranch], { cwd: parentRepoRoot, stdio: 'pipe' }); } catch {}
        } catch {}
        dbWrite((db) => {
          const now = new Date().toISOString();
          db.prepare(`
            UPDATE session_runtime_state SET status = 'error', last_error = ?, updated_at = ? WHERE session_id = ?
          `).run(spawnErr.message, now, childSessionId);
          db.prepare(`
            UPDATE sessions SET error_code = 'SPAWN_FAILED', error_message = ?, ended_at = ? WHERE id = ?
          `).run(spawnErr.message, now, childSessionId);
        });
        return error(res, `Failed to spawn child: ${spawnErr.message}`, 500);
      }
      return true;
    }

    // GET /agent/children/:parentSessionId — list child sessions
    const childrenMatch = url.pathname.match(/^\/agent\/children\/([^/]+)$/);
    if (req.method === 'GET' && childrenMatch) {
      const parentId = decodeURIComponent(childrenMatch[1]);

      // Caller binding: require X-Rudi-Caller-Session to match parentId
      const callerSession = normalizeHeader(req.headers['x-rudi-caller-session']);
      if (!callerSession || callerSession !== parentId) {
        return json(res, { error: 'CALLER_SESSION_MISMATCH', message: 'X-Rudi-Caller-Session header required and must match parentSessionId' }, 403);
      }

      // Build from DB + overlay live status from agentProcesses
      const children = [];

      try {
        const db = getDb();
        const rows = db.prepare(`
          SELECT s.id, s.status, s.model, s.started_at, s.ended_at, s.exit_code, s.title_override,
                 srs.worktree_branch, srs.worktree_path, srs.status as runtime_status
          FROM sessions s
          LEFT JOIN session_runtime_state srs ON srs.session_id = s.id
          WHERE s.parent_session_id = ?
          ORDER BY s.created_at DESC
        `).all(parentId);

        for (const row of rows) {
          const liveEntry = agentProcesses.get(row.id);
          const alive = !!(liveEntry?.proc && !liveEntry.proc.killed);
          children.push({
            sessionId: row.id,
            status: alive ? 'running' : (row.runtime_status || row.status || 'unknown'),
            alive,
            worktreeBranch: row.worktree_branch || liveEntry?.worktreeBranch || null,
            description: liveEntry?._description || row.title_override || null,
            turnActive: liveEntry?.turnActive || false,
            model: row.model,
            startedAt: row.started_at,
            endedAt: row.ended_at,
            exitCode: row.exit_code,
          });
        }
      } catch (dbErr) {
        // Fall back to memory only
        for (const [sessionId, entry] of agentProcesses) {
          if (entry.parentSessionId === parentId) {
            children.push({
              sessionId,
              status: entry.proc && !entry.proc.killed ? 'running' : 'completed',
              alive: !!(entry.proc && !entry.proc.killed),
              worktreeBranch: entry.worktreeBranch || null,
              description: entry._description || null,
              turnActive: entry.turnActive || false,
            });
          }
        }
      }

      json(res, { children });
      return true;
    }

    return false;
  };
}
