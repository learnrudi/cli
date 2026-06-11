/**
 * System binary registration
 *
 * Registers system-installed binaries (like git) by creating shims
 * and manifests. This is for infrastructure tools that are:
 * - Pre-installed on 90%+ dev machines
 * - Complex (many files, 50+ MB)
 * - System-integrated (security, networking)
 *
 * Use this ONLY for tools like git, ssh, curl - not for regular binaries.
 */

import fs from 'fs';
import path from 'path';
import { execFileSync } from 'child_process';
import { PATHS, getPackagePath } from '@learnrudi/env';
import { createShimsForTool } from './shims.js';

/**
 * Register a system-installed binary
 * @param {string} name - Binary name (e.g., 'git')
 * @param {Object} options
 * @param {string[]} [options.searchPaths] - Paths to search (defaults to common locations)
 * @param {string[]} [options.bins] - Additional binaries to shim (default: just name)
 * @returns {Promise<{ success: boolean, path?: string, error?: string }>}
 */
export async function registerSystemBinary(name, options = {}) {
  const {
    searchPaths = getDefaultSearchPaths(),
    bins = [name]
  } = options;

  // 1. Probe for system binary
  const systemPath = findSystemBinary(name, searchPaths);

  if (!systemPath) {
    return {
      success: false,
      error: `${name} not found in system paths: ${searchPaths.join(', ')}`
    };
  }

  // 2. Validate it works (catches Xcode CLT stub issue on macOS)
  try {
    execFileSync(systemPath, ['--version'], { stdio: 'pipe' });
  } catch (error) {
    return {
      success: false,
      path: systemPath,
      error: `${name} found at ${systemPath} but is not functional: ${error.message}`
    };
  }

  // 3. Write manifest
  const installPath = getPackagePath(`binary:${name}`);
  fs.mkdirSync(installPath, { recursive: true });

  const manifest = {
    id: `binary:${name}`,
    installType: 'system',
    installedAt: new Date().toISOString(),
    bins,
    source: {
      type: 'system',
      path: systemPath
    }
  };

  fs.writeFileSync(
    path.join(installPath, 'manifest.json'),
    JSON.stringify(manifest, null, 2)
  );

  // 4. Create shims
  try {
    await createShimsForTool({
      id: `binary:${name}`,
      installType: 'system',
      installDir: installPath,
      bins,
      source: { path: systemPath }
    });
  } catch (error) {
    return {
      success: false,
      path: systemPath,
      error: `Failed to create shims: ${error.message}`
    };
  }

  console.log(`[System Registry] Registered ${name} from ${systemPath}`);

  return { success: true, path: systemPath };
}

/**
 * Check if a system binary is registered
 * @param {string} name - Binary name
 * @returns {boolean}
 */
export function isSystemBinaryRegistered(name) {
  const installPath = getPackagePath(`binary:${name}`);
  const manifestPath = path.join(installPath, 'manifest.json');

  if (!fs.existsSync(manifestPath)) {
    return false;
  }

  try {
    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf-8'));
    return manifest.installType === 'system';
  } catch {
    return false;
  }
}

/**
 * Get default search paths for system binaries
 * Prioritizes Homebrew paths over system paths
 * @returns {string[]}
 */
function getDefaultSearchPaths() {
  const paths = [];

  // Homebrew paths (priority - most users have Homebrew)
  if (process.platform === 'darwin') {
    paths.push('/opt/homebrew/bin');  // Apple Silicon
    paths.push('/usr/local/bin');     // Intel Mac
  } else if (process.platform === 'linux') {
    paths.push('/usr/local/bin');     // Custom installs
  }

  // System paths (fallback)
  paths.push('/usr/bin');
  paths.push('/bin');

  return paths;
}

/**
 * Find a binary in search paths
 * @param {string} name - Binary name
 * @param {string[]} searchPaths - Paths to search
 * @returns {string|null} Absolute path to binary, or null if not found
 */
function findSystemBinary(name, searchPaths) {
  for (const searchPath of searchPaths) {
    const binaryPath = path.join(searchPath, name);

    if (fs.existsSync(binaryPath)) {
      try {
        // Check if executable
        fs.accessSync(binaryPath, fs.constants.X_OK);
        return binaryPath;
      } catch {
        // Not executable, continue
        continue;
      }
    }
  }

  return null;
}

/**
 * Unregister a system binary
 * @param {string} name - Binary name
 * @returns {Promise<{ success: boolean, error?: string }>}
 */
export async function unregisterSystemBinary(name) {
  const installPath = getPackagePath(`binary:${name}`);

  if (!fs.existsSync(installPath)) {
    return { success: false, error: `${name} is not registered` };
  }

  try {
    // Read manifest to get bins list
    const manifestPath = path.join(installPath, 'manifest.json');
    let bins = [name];

    if (fs.existsSync(manifestPath)) {
      const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf-8'));
      bins = manifest.bins || [name];
    }

    // Remove shims
    const { removeShims } = await import('./shims.js');
    removeShims(bins);

    // Remove manifest directory
    fs.rmSync(installPath, { recursive: true });

    console.log(`[System Registry] Unregistered ${name}`);

    return { success: true };
  } catch (error) {
    return { success: false, error: error.message };
  }
}

/**
 * Get info about a registered system binary
 * @param {string} name - Binary name
 * @returns {Object|null} Manifest object or null if not registered
 */
export function getSystemBinaryInfo(name) {
  const installPath = getPackagePath(`binary:${name}`);
  const manifestPath = path.join(installPath, 'manifest.json');

  if (!fs.existsSync(manifestPath)) {
    return null;
  }

  try {
    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf-8'));

    if (manifest.installType !== 'system') {
      return null;
    }

    return manifest;
  } catch {
    return null;
  }
}
