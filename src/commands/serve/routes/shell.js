/**
 * Shell operations — open in VSCode, Finder, Terminal, etc.
 */

import fs from 'fs';
import { spawn as defaultSpawn } from 'child_process';
import { rejectInvalidPathField } from '../validation.js';

function appleScriptString(value) {
  return `"${String(value).replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
}

function buildTerminalOpenScript(targetPath) {
  return [
    'tell application "Terminal"',
    '  activate',
    `  do script "cd " & quoted form of POSIX path of (POSIX file ${appleScriptString(targetPath)})`,
    'end tell',
  ].join('\n');
}

export function buildShellRoutes(ctx, deps = {}) {
  const { json, error, readBody, requiredField, invalidField, log } = ctx;
  const spawnProcess = deps.spawn || defaultSpawn;

  function rejectShellPath(value, res) {
    if (rejectInvalidPathField({ value, res, invalidField, error })) {
      return true;
    }

    if (!fs.existsSync(value)) {
      invalidField(res, 'path', 'path must reference an existing filesystem path', {
        reason: 'path_not_found',
      });
      return true;
    }

    return false;
  }

  function spawnDetached(command, args, app) {
    const child = spawnProcess(command, args, { detached: true, stdio: 'ignore' });
    if (typeof child?.on === 'function') {
      child.on('error', (err) => {
        log?.('shell', 'error', 'failed to open host application', {
          app,
          message: err?.message || 'spawn failed',
        });
      });
    }
    child?.unref?.();
  }

  async function handle(req, res, url) {
    // POST /shell/reveal
    if (req.method === 'POST' && url.pathname === '/shell/reveal') {
      const body = await readBody(req);
      if (!body.path) { requiredField(res, 'path'); return true; }
      if (rejectShellPath(body.path, res)) return true;
      spawnDetached('open', ['-R', body.path], 'finder');
      json(res, { ok: true });
      return true;
    }

    // POST /shell/open
    if (req.method === 'POST' && url.pathname === '/shell/open') {
      const body = await readBody(req);
      if (!body.path) { requiredField(res, 'path'); return true; }
      if (!body.app) { requiredField(res, 'app'); return true; }
      if (rejectShellPath(body.path, res)) return true;

      const p = body.path;
      let cmd, args;
      switch (body.app) {
        case 'vscode':      cmd = 'code';       args = [p]; break;
        case 'cursor':      cmd = 'cursor';     args = [p]; break;
        case 'finder':      cmd = 'open';       args = ['-R', p]; break;
        case 'xcode':       cmd = 'open';       args = ['-a', 'Xcode', p]; break;
        case 'antigravity': cmd = 'open';       args = ['-a', 'Antigravity', p]; break;
        case 'warp':        cmd = 'open';       args = ['-a', 'Warp', p]; break;
        case 'terminal': {
          const script = buildTerminalOpenScript(p);
          cmd = 'osascript';
          args = ['-e', script];
          break;
        }
        default:
          invalidField(res, 'app', `unknown app: ${body.app}`, {
            reason: 'unsupported_value',
            details: { value: body.app },
          });
          return true;
      }

      log?.('shell', 'info', 'opening host application', { app: body.app });
      spawnDetached(cmd, args, body.app);
      json(res, { ok: true });
      return true;
    }

    return false;
  }

  return { handle };
}
