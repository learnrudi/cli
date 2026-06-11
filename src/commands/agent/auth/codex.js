/**
 * Codex-specific auth checking.
 * Handles Codex/OpenAI API keys from environment and RUDI secrets.
 */

import { getAllSecrets } from '@learnrudi/secrets';

const CODEX_API_KEY_SECRET = 'CODEX_API_KEY';
const OPENAI_API_KEY_SECRET = 'OPENAI_API_KEY';

function readStringSecret(secrets, name) {
  const value = secrets?.[name];
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

/**
 * Check if Codex/OpenAI credentials exist.
 * Returns: { authenticated: boolean, method: string }
 */
export function checkCodexCredential() {
  // 1. Codex/OpenAI API key env vars
  if (process.env.CODEX_API_KEY) {
    return { authenticated: true, method: 'api-key' };
  }

  if (process.env.OPENAI_API_KEY) {
    return { authenticated: true, method: 'api-key' };
  }

  // 2. RUDI secrets store
  try {
    const secrets = getAllSecrets();
    const codexApiKey = readStringSecret(secrets, CODEX_API_KEY_SECRET);
    if (codexApiKey) {
      process.env.CODEX_API_KEY = codexApiKey;
      return { authenticated: true, method: 'api-key' };
    }

    const openAiApiKey = readStringSecret(secrets, OPENAI_API_KEY_SECRET);
    if (openAiApiKey) {
      process.env.OPENAI_API_KEY = openAiApiKey;
      return { authenticated: true, method: 'api-key' };
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
      message: 'OPENAI_API_KEY not found. Set it with: rudi secrets set OPENAI_API_KEY',
      command: 'rudi secrets set OPENAI_API_KEY',
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
