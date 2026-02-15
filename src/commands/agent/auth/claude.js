/**
 * Claude-specific auth checking.
 * Handles OAuth token, API key, macOS keychain, and file-based credentials.
 */

import os from 'os';
import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';
import { PATHS } from '@learnrudi/env';

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

  // 3. ~/.rudi/.env file (load and inject into process.env)
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

  // 4. macOS keychain (Claude Code stores credentials here)
  if (os.platform() === 'darwin') {
    try {
      execSync('security find-generic-password -s "Claude Code-credentials"', { stdio: 'pipe' });
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
