/**
 * Claude-specific auth checking.
 * Handles OAuth token, API key, macOS keychain, and file-based credentials.
 */

import os from 'os';
import fs from 'fs';
import path from 'path';
import { getAllSecrets } from '@learnrudi/secrets';
import { runCommand } from '../../../utils/subprocess.js';

const CLAUDE_API_KEY_SECRET = 'ANTHROPIC_API_KEY';
const CLAUDE_OAUTH_SECRET = 'CLAUDE_CODE_OAUTH_TOKEN';

function readStringSecret(secrets, name) {
  const value = secrets?.[name];
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

/**
 * Check if Claude credentials exist.
 * Returns: { authenticated: boolean, method: string, details?: string }
 */
export function checkClaudeCredential() {
  // 1. CLAUDE_CODE_OAUTH_TOKEN env var
  if (process.env.CLAUDE_CODE_OAUTH_TOKEN) {
    return { authenticated: true, method: 'oauth-token' };
  }

  // 2. ANTHROPIC_API_KEY env var
  if (process.env.ANTHROPIC_API_KEY) {
    return { authenticated: true, method: 'api-key' };
  }

  // 3. RUDI secrets store
  try {
    const secrets = getAllSecrets();
    const oauthToken = readStringSecret(secrets, CLAUDE_OAUTH_SECRET);
    if (oauthToken) {
      process.env.CLAUDE_CODE_OAUTH_TOKEN = oauthToken;
      return { authenticated: true, method: 'oauth-token' };
    }

    const apiKey = readStringSecret(secrets, CLAUDE_API_KEY_SECRET);
    if (apiKey) {
      process.env.ANTHROPIC_API_KEY = apiKey;
      return { authenticated: true, method: 'api-key' };
    }
  } catch {
    // ignore read errors
  }

  // 4. macOS keychain (Claude Code stores credentials here)
  if (os.platform() === 'darwin') {
    try {
      runCommand('security', ['find-generic-password', '-s', 'Claude Code-credentials'], {
        stdio: 'pipe',
      });
      return { authenticated: true, method: 'keychain' };
    } catch {
      // not in keychain
    }
  }

  // 5. File-based credentials (~/.claude/credentials.json)
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

/**
 * Check full auth status for Claude (binary + credential).
 * Returns standardized auth status object.
 */
export async function checkAuth(providerConfig, binaryPath) {
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

  return {
    provider: 'claude',
    ready,
    runtime,
    credential,
    action,
  };
}
