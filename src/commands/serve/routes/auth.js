/**
 * Auth — status check + login (API key / OAuth / CLI login helper).
 */

import fs from 'fs';
import path from 'path';
import os from 'os';
import { execFileSync } from 'child_process';
import { PATHS } from '@learnrudi/env';
import { setSecret } from '@learnrudi/secrets';
import { resolveClaudeBinary, checkProviderAuth } from '../agent.js';

const CLAUDE_API_KEY_SECRET = 'ANTHROPIC_API_KEY';
const CLAUDE_OAUTH_SECRET = 'CLAUDE_CODE_OAUTH_TOKEN';
const CODEX_API_KEY_SECRET = 'OPENAI_API_KEY';

function shellQuote(value) {
  return `'${String(value).replace(/'/g, `'\\''`)}'`;
}

function appleScriptString(value) {
  return `"${String(value).replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
}

async function saveCredential(name, value) {
  await setSecret(name, value);
  process.env[name] = value;
}

function normalizeAuthProvider(provider) {
  return typeof provider === 'string' && provider.trim()
    ? provider.trim().toLowerCase()
    : 'claude';
}

function getApiKeySecretForProvider(provider) {
  if (provider === 'claude') return CLAUDE_API_KEY_SECRET;
  if (provider === 'codex') return CODEX_API_KEY_SECRET;
  return null;
}

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
      const provider = normalizeAuthProvider(body.provider);

      if (body.apiKey || body.oauthToken) {
        if (body.oauthToken && provider !== 'claude') {
          return error(res, 'oauthToken is only supported for Claude auth', 400);
        }

        const apiKeySecret = body.apiKey ? getApiKeySecretForProvider(provider) : null;
        if (body.apiKey && !apiKeySecret) {
          return error(res, `Unsupported auth provider '${provider}'`, 400);
        }

        try {
          if (body.oauthToken) {
            await saveCredential(CLAUDE_OAUTH_SECRET, body.oauthToken);
            log('auth', 'info', 'OAuth token saved to RUDI secrets store');
          } else {
            await saveCredential(apiKeySecret, body.apiKey);
            log('auth', 'info', `${provider} API key saved to RUDI secrets store`);
          }
          json(res, { ok: true });
        } catch (err) {
          log('auth', 'error', `Failed to save credential: ${err.message}`);
          error(res, `Failed to save credential: ${err.message}`, 500);
        }
      } else {
        if (provider === 'codex') {
          json(res, { ok: true, message: `Run 'codex login' in a terminal to authenticate` });
          return true;
        }

        const binaryPath = resolveClaudeBinary();
        if (binaryPath && os.platform() === 'darwin') {
          try {
            fs.mkdirSync(PATHS.home, { recursive: true });
            const helperPath = path.join(PATHS.home, '.login-helper.sh');
            const captureFile = path.join(PATHS.home, '.setup-token-output');
            const cliEntryPath = process.argv[1];
            if (!cliEntryPath) {
              throw new Error('Unable to resolve RUDI CLI entrypoint for login helper');
            }
            const script = [
              '#!/bin/bash',
              'set -euo pipefail',
              `CAPTURE=${shellQuote(captureFile)}`,
              `CLAUDE_BIN=${shellQuote(binaryPath)}`,
              `NODE_BIN=${shellQuote(process.execPath)}`,
              `RUDI_CLI=${shellQuote(cliEntryPath)}`,
              `script -q "$CAPTURE" "$CLAUDE_BIN" setup-token`,
              `CLEAN=$(sed 's/\\x1b\\[[0-9;]*[a-zA-Z]//g; s/\\x1b\\[[?][0-9]*[a-z]//g' "$CAPTURE" | tr -d '\\r')`,
              `TOKEN=$(echo "$CLEAN" | sed -n '/^sk-ant-oat/{N;s/\\n//;p;}' | grep -oE 'sk-ant-oat[A-Za-z0-9_-]+' | head -1)`,
              '# Reject placeholders and short matches (real tokens are 80+ chars)',
              'if [ -n "$TOKEN" ] && [ ${#TOKEN} -gt 30 ]; then',
              `  "$NODE_BIN" "$RUDI_CLI" secrets set ${CLAUDE_OAUTH_SECRET} "$TOKEN" >/dev/null`,
              '  rm -f "$CAPTURE"',
              '  echo ""',
              '  echo "Token saved to RUDI. You can close this window."',
              'else',
              '  rm -f "$CAPTURE"',
              '  echo ""',
              '  echo "Could not detect a valid token."',
              'fi',
            ].join('\n');
            fs.writeFileSync(helperPath, script, { mode: 0o755 });

            execFileSync('osascript', [
              '-e',
              `tell application "Terminal" to do script ${appleScriptString(helperPath)}`,
            ], { stdio: 'pipe' });
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
