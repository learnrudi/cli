/**
 * Codex-specific auth checking.
 * Handles OPENAI_API_KEY env var and ~/.rudi/.env file.
 */

import fs from 'fs';
import path from 'path';
import { PATHS } from '@learnrudi/env';

/**
 * Check if Codex/OpenAI credentials exist.
 * Returns: { authenticated: boolean, method: string }
 */
export function checkCodexCredential() {
  // 1. OPENAI_API_KEY env var
  if (process.env.OPENAI_API_KEY) {
    return { authenticated: true, method: 'api-key' };
  }

  // 2. ~/.rudi/.env file (load and inject into process.env)
  try {
    const envPath = path.join(PATHS.home, '.env');
    if (fs.existsSync(envPath)) {
      const content = fs.readFileSync(envPath, 'utf-8');
      const apiMatch = content.match(/^OPENAI_API_KEY=(.+)$/m);
      if (apiMatch && apiMatch[1].trim()) {
        process.env.OPENAI_API_KEY = apiMatch[1].trim();
        return { authenticated: true, method: 'api-key' };
      }
    }
  } catch {
    // ignore read errors
  }

  return { authenticated: false, method: 'none' };
}

/**
 * Check full auth status for Codex (binary + credential).
 * Returns standardized auth status object.
 */
export async function checkAuth(providerConfig, binaryPath) {
  const runtime = { installed: !!binaryPath, path: binaryPath || undefined };
  const credential = checkCodexCredential();
  const ready = runtime.installed && credential.authenticated;

  let action = { type: 'none', message: 'Ready' };
  if (!runtime.installed) {
    action = {
      type: 'install',
      message: 'Codex CLI not found. Install it with: rudi install agent:codex',
      command: 'rudi install agent:codex',
    };
  } else if (!credential.authenticated) {
    action = {
      type: 'login',
      message: 'OPENAI_API_KEY not found. Set it in ~/.rudi/.env or export it',
      command: 'echo "OPENAI_API_KEY=sk-..." >> ~/.rudi/.env',
    };
  }

  return {
    provider: 'codex',
    ready,
    runtime,
    credential,
    action,
  };
}
