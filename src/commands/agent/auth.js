/**
 * Binary resolution + credential checking for Claude CLI.
 */

import os from 'os';
import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';
import { PATHS } from '@learnrudi/env';

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
