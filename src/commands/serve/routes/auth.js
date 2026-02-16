/**
 * Auth — status check + login (API key / OAuth / CLI login helper).
 */

import fs from 'fs';
import path from 'path';
import os from 'os';
import { execSync } from 'child_process';
import { PATHS } from '@learnrudi/env';
import { resolveClaudeBinary, checkProviderAuth } from '../agent.js';

export function buildAuthRoutes(ctx) {
  const { json, error, readBody, log } = ctx;

  async function handle(req, res, url) {
    // GET /auth/status?provider=
    if (req.method === 'GET' && url.pathname === '/auth/status') {
      const provider = url.searchParams.get('provider') || 'claude';
      try {
        const status = await checkProviderAuth(provider);
        json(res, status);
      } catch (err) {
        json(res, {
          provider,
          ready: false,
          runtime: { installed: false },
          credential: { authenticated: false, method: 'none' },
          action: { type: 'install', message: err.message },
        });
      }
      return true;
    }

    // POST /auth/login {provider, apiKey?}
    if (req.method === 'POST' && url.pathname === '/auth/login') {
      const body = await readBody(req);

      if (body.apiKey || body.oauthToken) {
        try {
          const envPath = path.join(PATHS.home, '.env');
          let content = '';
          if (fs.existsSync(envPath)) {
            content = fs.readFileSync(envPath, 'utf-8');
          }
          if (body.oauthToken) {
            content = content.replace(/^CLAUDE_CODE_OAUTH_TOKEN=.*$/m, '').trim();
            content += `\nCLAUDE_CODE_OAUTH_TOKEN=${body.oauthToken}\n`;
            process.env.CLAUDE_CODE_OAUTH_TOKEN = body.oauthToken;
            log('auth', 'info', 'OAuth token saved to .env');
          } else {
            content = content.replace(/^ANTHROPIC_API_KEY=.*$/m, '').trim();
            content += `\nANTHROPIC_API_KEY=${body.apiKey}\n`;
            process.env.ANTHROPIC_API_KEY = body.apiKey;
            log('auth', 'info', 'API key saved to .env');
          }
          fs.writeFileSync(envPath, content.trim() + '\n');
          json(res, { ok: true });
        } catch (err) {
          log('auth', 'error', `Failed to save credential: ${err.message}`);
          error(res, `Failed to save credential: ${err.message}`, 500);
        }
      } else {
        const binaryPath = resolveClaudeBinary();
        if (binaryPath && os.platform() === 'darwin') {
          try {
            const helperPath = path.join(PATHS.home, '.login-helper.sh');
            const envPath = path.join(PATHS.home, '.env');
            const captureFile = path.join(PATHS.home, '.setup-token-output');
            const script = [
              '#!/bin/bash',
              `CAPTURE="${captureFile}"`,
              `ENV_FILE="${envPath}"`,
              `script -q "$CAPTURE" "${binaryPath}" setup-token`,
              `CLEAN=$(sed 's/\\x1b\\[[0-9;]*[a-zA-Z]//g; s/\\x1b\\[[?][0-9]*[a-z]//g' "$CAPTURE" | tr -d '\\r')`,
              `TOKEN=$(echo "$CLEAN" | sed -n '/^sk-ant-oat/{N;s/\\n//;p;}' | grep -oE 'sk-ant-oat[A-Za-z0-9_-]+' | head -1)`,
              '# Reject placeholders and short matches (real tokens are 80+ chars)',
              'if [ -n "$TOKEN" ] && [ ${#TOKEN} -gt 30 ]; then',
              '  touch "$ENV_FILE"',
              '  sed -i \'\' \'/^CLAUDE_CODE_OAUTH_TOKEN=/d\' "$ENV_FILE"',
              '  echo "CLAUDE_CODE_OAUTH_TOKEN=$TOKEN" >> "$ENV_FILE"',
              '  rm -f "$CAPTURE"',
              '  echo ""',
              '  echo "✓ Token saved to RUDI. You can close this window."',
              'else',
              '  echo ""',
              '  echo "Could not detect a valid token. Capture file kept for debugging:"',
              '  echo "  $CAPTURE"',
              'fi',
            ].join('\n');
            fs.writeFileSync(helperPath, script, { mode: 0o755 });

            execSync(`osascript -e 'tell application "Terminal" to do script "${helperPath}"'`, { stdio: 'pipe' });
            log('auth', 'info', 'Launched login helper in Terminal.app');
            json(res, { ok: true, launched: true });
          } catch (err) {
            log('auth', 'warn', `Failed to launch login helper: ${err.message}`);
            json(res, { ok: true, message: `Run 'claude setup-token' in a terminal to authenticate` });
          }
        } else {
          json(res, { ok: true, message: `Run 'claude setup-token' in a terminal to authenticate` });
        }
      }
      return true;
    }

    return false;
  }

  return { handle };
}
