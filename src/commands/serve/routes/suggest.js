/**
 * Suggestion chips, session naming, and branch name generation.
 * All use headless Haiku calls via the Claude CLI.
 *
 * Owns: _activeSuggestProcess.
 */

import os from 'os';
import { spawn } from 'child_process';
import { resolveClaudeBinary } from '../agent.js';
import { runGit } from '../../../utils/subprocess.js';

export function buildSuggestRoutes(ctx) {
  const { json, error, readBody, log } = ctx;

  let _activeSuggestProcess = null;

  // POST /agent/suggest
  async function handleSuggest(req, res, url) {
    if (req.method !== 'POST' || url.pathname !== '/agent/suggest') return false;

    const body = await readBody(req);
    const lastMessage = typeof body.lastMessage === 'string' ? body.lastMessage.slice(0, 2000) : '';
    if (!lastMessage) { json(res, { suggestions: [] }); return true; }

    const binaryPath = resolveClaudeBinary();
    if (!binaryPath) { json(res, { suggestions: [] }); return true; }

    // Kill any in-flight suggestion process
    if (_activeSuggestProcess) {
      try { _activeSuggestProcess.kill(); } catch {}
      _activeSuggestProcess = null;
    }

    // Gather git context if a project cwd was provided
    let gitContext = '';
    const cwd = typeof body.cwd === 'string' ? body.cwd : null;
    if (cwd) {
      try {
        const gitOptions = { stdio: 'pipe', timeout: 3000 };
        const statusOut = runGit(cwd, ['status', '--porcelain'], gitOptions).toString().trim();
        const logOut = runGit(cwd, ['log', '--oneline', '-5'], gitOptions).toString().trim();
        const branchOut = runGit(cwd, ['branch', '--show-current'], gitOptions).toString().trim();
        const parts = [];
        if (branchOut) parts.push(`Branch: ${branchOut}`);
        if (statusOut) parts.push(`Uncommitted changes:\n${statusOut}`);
        else parts.push('Working tree is clean (no uncommitted changes).');
        if (logOut) parts.push(`Recent commits:\n${logOut}`);
        if (parts.length) gitContext = `\n\nGit context for this project:\n${parts.join('\n')}`;
      } catch { /* not a git repo or git not available */ }
    }

    const prompt = `Given this assistant message from a coding assistant, suggest 2-3 short follow-up prompts (3-8 words each) the user might send next. Consider the git context if provided — if there are uncommitted changes, one suggestion could be about committing. If the message asks a yes/no question, include an affirmative variant. Return ONLY a JSON array of strings like ["suggestion 1","suggestion 2"]. No other text.\n\nAssistant message:\n${lastMessage}${gitContext}`;

    try {
      const child = spawn(binaryPath, [
        '-p', prompt,
        '--model', 'haiku',
        '--no-session-persistence',
        '--max-turns', '1',
        '--output-format', 'json',
      ], { stdio: ['ignore', 'pipe', 'pipe'], timeout: 10000, cwd: cwd || os.tmpdir() });

      _activeSuggestProcess = child;

      let stdout = '';
      child.stdout.on('data', (chunk) => { stdout += chunk; });

      const exitCode = await new Promise((resolve) => {
        const timer = setTimeout(() => { try { child.kill(); } catch {} }, 10000);
        child.on('close', (code) => { clearTimeout(timer); resolve(code); });
        child.on('error', () => { clearTimeout(timer); resolve(1); });
      });

      _activeSuggestProcess = null;

      if (exitCode !== 0 || !stdout) { json(res, { suggestions: [] }); return true; }

      const parsed = JSON.parse(stdout);
      const resultStr = parsed.result || '';
      const arrayMatch = resultStr.match(/\[[\s\S]*\]/);
      if (!arrayMatch) { json(res, { suggestions: [] }); return true; }
      const suggestions = JSON.parse(arrayMatch[0]);
      if (!Array.isArray(suggestions) || !suggestions.every(s => typeof s === 'string')) {
        json(res, { suggestions: [] });
        return true;
      }
      json(res, { suggestions: suggestions.slice(0, 4) });
    } catch (err) {
      log('suggest', 'warn', `suggestion failed: ${err.message}`);
      _activeSuggestProcess = null;
      json(res, { suggestions: [] });
    }
    return true;
  }

  // POST /agent/name-session
  async function handleNameSession(req, res, url) {
    if (req.method !== 'POST' || url.pathname !== '/agent/name-session') return false;

    const body = await readBody(req);
    const firstMessage = typeof body.firstMessage === 'string' ? body.firstMessage.slice(0, 1000) : '';
    if (!firstMessage) { json(res, { title: '' }); return true; }

    const binaryPath = resolveClaudeBinary();
    if (!binaryPath) { json(res, { title: '' }); return true; }

    const projectName = typeof body.projectName === 'string' ? body.projectName : 'unknown';
    const prompt = `You are a title generator. Your ENTIRE response must be a short title (3-7 words) for a coding session. No greeting, no explanation, no quotes, no trailing punctuation. Just the title.\n\nProject: ${projectName}\nUser request: ${firstMessage}\n\nTitle:`;

    try {
      const child = spawn(binaryPath, [
        '-p', prompt,
        '--model', 'haiku',
        '--no-session-persistence',
        '--max-turns', '1',
        '--output-format', 'json',
      ], { stdio: ['ignore', 'pipe', 'pipe'], timeout: 10000, cwd: os.tmpdir() });

      let stdout = '';
      child.stdout.on('data', (chunk) => { stdout += chunk; });

      const exitCode = await new Promise((resolve) => {
        const timer = setTimeout(() => { try { child.kill(); } catch {} }, 10000);
        child.on('close', (code) => { clearTimeout(timer); resolve(code); });
        child.on('error', () => { clearTimeout(timer); resolve(1); });
      });

      if (exitCode !== 0 || !stdout) { json(res, { title: '' }); return true; }

      const parsed = JSON.parse(stdout);
      const title = (parsed.result || '').trim();
      json(res, { title });
    } catch (err) {
      log('name-session', 'warn', `naming failed: ${err.message}`);
      json(res, { title: '' });
    }
    return true;
  }

  // POST /agent/generate-branch-name
  async function handleGenerateBranchName(req, res, url) {
    if (req.method !== 'POST' || url.pathname !== '/agent/generate-branch-name') return false;

    const body = await readBody(req);
    const prompt = typeof body.prompt === 'string' ? body.prompt.slice(0, 1000) : '';
    if (!prompt) { json(res, { branchName: '' }); return true; }

    const binaryPath = resolveClaudeBinary();
    if (!binaryPath) { json(res, { branchName: '' }); return true; }

    const projectName = typeof body.projectName === 'string' ? body.projectName : '';
    const systemPrompt = `Generate a single kebab-case git branch name (max 40 chars) for the following task. Rules: lowercase letters, numbers, and hyphens only. No leading/trailing hyphens. No branch prefixes like "feature/" or "fix/". Your ENTIRE response must be just the branch name, nothing else.${projectName ? `\n\nProject: ${projectName}` : ''}\n\nTask: ${prompt}\n\nBranch name:`;

    try {
      const child = spawn(binaryPath, [
        '-p', systemPrompt,
        '--model', 'haiku',
        '--no-session-persistence',
        '--max-turns', '1',
        '--output-format', 'json',
      ], { stdio: ['ignore', 'pipe', 'pipe'], timeout: 10000, cwd: os.tmpdir() });

      let stdout = '';
      let stderr = '';
      child.stdout.on('data', (chunk) => { stdout += chunk; });
      child.stderr.on('data', (chunk) => { stderr += chunk; });

      const exitCode = await new Promise((resolve) => {
        const timer = setTimeout(() => { log('generate-branch-name', 'warn', 'timeout — killing process'); try { child.kill(); } catch {} }, 10000);
        child.on('close', (code) => { clearTimeout(timer); resolve(code); });
        child.on('error', (e) => { clearTimeout(timer); log('generate-branch-name', 'warn', `spawn error: ${e.message}`); resolve(1); });
      });

      log('generate-branch-name', 'info', `exit=${exitCode} stdout=${stdout.length}b stderr=${stderr.slice(0, 200)}`);

      if (exitCode !== 0 || !stdout) { json(res, { branchName: '' }); return true; }

      const parsed = JSON.parse(stdout);
      const raw = (parsed.result || '').trim();
      log('generate-branch-name', 'info', `raw="${raw}"`);
      const branchName = raw
        .toLowerCase()
        .replace(/[^a-z0-9-]/g, '-')
        .replace(/-+/g, '-')
        .replace(/^-|-$/g, '')
        .slice(0, 40);
      json(res, { branchName });
    } catch (err) {
      log('generate-branch-name', 'warn', `generation failed: ${err.message}`);
      json(res, { branchName: '' });
    }
    return true;
  }

  async function handle(req, res, url) {
    if (await handleSuggest(req, res, url)) return true;
    if (await handleNameSession(req, res, url)) return true;
    if (await handleGenerateBranchName(req, res, url)) return true;
    return false;
  }

  function cleanup() {
    if (_activeSuggestProcess) {
      try { _activeSuggestProcess.kill(); } catch {}
      _activeSuggestProcess = null;
    }
  }

  return { handle, cleanup };
}
