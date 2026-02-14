import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join, dirname, basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import { homedir } from 'node:os';
import { execSync } from 'node:child_process';

const __dirname = dirname(fileURLToPath(import.meta.url));

/**
 * List available provider IDs by scanning *.json files in the providers directory.
 */
export function listProviders() {
  return readdirSync(__dirname)
    .filter(f => f.endsWith('.json'))
    .map(f => basename(f, '.json'));
}

/**
 * Load and parse a provider config by ID.
 */
export function loadProviderConfig(providerId) {
  const configPath = join(__dirname, `${providerId}.json`);
  if (!existsSync(configPath)) {
    const available = listProviders().join(', ');
    throw new Error(`Unknown agent provider: ${providerId}. Available: ${available}`);
  }
  return JSON.parse(readFileSync(configPath, 'utf-8'));
}

/**
 * Resolve the binary path for a provider config.
 * Checks each path in config.binary.resolvePaths (expanding ~ to homedir),
 * then falls back to `which` if configured.
 */
export function resolveProviderBinary(config) {
  const home = homedir();
  const arch = process.arch;

  for (const rawPath of config.binary.resolvePaths) {
    const resolved = rawPath
      .replace(/^~/, home)
      .replace(/\{arch\}/g, arch);
    if (existsSync(resolved)) {
      return resolved;
    }
  }

  if (config.binary.fallback === 'which') {
    try {
      return execSync(`which ${config.binary.name}`, { encoding: 'utf-8' }).trim();
    } catch {
      // which failed — binary not found
    }
  }

  return null;
}
