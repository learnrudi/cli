/**
 * Shell operations — open in VSCode, Finder, Terminal, etc.
 */

import { spawn } from 'child_process';

export function buildShellRoutes(ctx) {
  const { json, error, readBody } = ctx;

  async function handle(req, res, url) {
    // POST /shell/reveal
    if (req.method === 'POST' && url.pathname === '/shell/reveal') {
      const body = await readBody(req);
      if (!body.path) { error(res, 'path required'); return true; }
      const child = spawn('open', ['-R', body.path], { detached: true, stdio: 'ignore' });
      child.unref();
      json(res, { ok: true });
      return true;
    }

    // POST /shell/open
    if (req.method === 'POST' && url.pathname === '/shell/open') {
      const body = await readBody(req);
      if (!body.path) { error(res, 'path required'); return true; }
      if (!body.app) { error(res, 'app required'); return true; }

      const p = body.path;
      let cmd, args;
      switch (body.app) {
        case 'vscode':      cmd = 'code';       args = [p]; break;
        case 'cursor':      cmd = 'cursor';     args = [p]; break;
        case 'finder':      cmd = 'open';       args = [p]; break;
        case 'xcode':       cmd = 'open';       args = ['-a', 'Xcode', p]; break;
        case 'antigravity': cmd = 'open';       args = ['-a', 'Antigravity', p]; break;
        case 'warp':        cmd = 'open';       args = ['-a', 'Warp', p]; break;
        case 'terminal': {
          const script = [
            'tell application "Terminal"',
            '  activate',
            `  do script "cd ${p.replace(/"/g, '\\"')}"`,
            'end tell',
          ].join('\n');
          cmd = 'osascript';
          args = ['-e', script];
          break;
        }
        default: error(res, `unknown app: ${body.app}`); return true;
      }

      console.log(`[shell/open] ${cmd} ${args.join(' ')}`);
      const child = spawn(cmd, args, { detached: true, stdio: 'pipe' });
      child.stderr.on('data', (d) => console.error(`[shell/open] stderr: ${d}`));
      child.on('error', (err) => console.error(`[shell/open] spawn error:`, err));
      child.unref();
      json(res, { ok: true });
      return true;
    }

    return false;
  }

  return { handle };
}
