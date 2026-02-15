/**
 * Provider-agnostic auth dispatcher.
 * Routes to provider-specific auth modules (claude.js, codex.js, etc).
 */

import os from 'os';
import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';
import { PATHS } from '@learnrudi/env';
import { loadProviderConfig, resolveProviderBinary } from './providers/index.js';

// Provider-specific auth modules
import * as claudeAuth from './auth/claude.js';
import * as codexAuth from './auth/codex.js';

// Registry of provider-specific auth checkers
const AUTH_MODULES = {
  claude: claudeAuth,
  codex: codexAuth,
};

// --- Legacy Claude-specific exports (for backward compat) ---

let _cachedClaudeBinary = null;

/**
 * @deprecated Use resolveProviderBinary(loadProviderConfig('claude')) instead.
 * Kept for backward compatibility with existing code.
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
 * @deprecated Use checkProviderAuth('claude') instead.
 */
export function checkClaudeCredential() {
  return claudeAuth.checkClaudeCredential();
}

// --- Generic provider auth ---

/**
 * Check auth status for any provider.
 * Routes to provider-specific auth module if available,
 * otherwise returns generic env-var-based check.
 */
export async function checkProviderAuth(provider) {
  // Load provider config
  let providerConfig;
  try {
    providerConfig = loadProviderConfig(provider);
  } catch (err) {
    return {
      provider,
      ready: false,
      runtime: { installed: false },
      credential: { authenticated: false, method: 'none' },
      action: { type: 'error', message: err.message },
    };
  }

  // Resolve binary
  const binaryPath = resolveProviderBinary(providerConfig);

  // Route to provider-specific auth module if available
  const authModule = AUTH_MODULES[provider];
  if (authModule && typeof authModule.checkAuth === 'function') {
    return authModule.checkAuth(providerConfig, binaryPath);
  }

  // Generic fallback: check if required env vars are present
  const runtime = { installed: !!binaryPath, path: binaryPath || undefined };
  const requiredEnvVars = providerConfig.headless.authEnvVars || [];
  const missingVars = requiredEnvVars.filter(v => !process.env[v]);
  const authenticated = missingVars.length === 0;

  const credential = {
    authenticated,
    method: authenticated ? 'env' : 'none',
    missing: missingVars.length > 0 ? missingVars : undefined,
  };

  const ready = runtime.installed && credential.authenticated;

  let action = { type: 'none', message: 'Ready' };
  if (!runtime.installed) {
    action = {
      type: 'install',
      message: `${providerConfig.name} CLI not found. Install it with: rudi install agent:${provider}`,
      command: `rudi install agent:${provider}`,
    };
  } else if (!credential.authenticated) {
    action = {
      type: 'login',
      message: `Missing environment variables: ${missingVars.join(', ')}`,
      command: missingVars.map(v => `export ${v}=...`).join('\n'),
    };
  }

  return {
    provider,
    ready,
    runtime,
    credential,
    action,
  };
}
