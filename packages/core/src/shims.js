/**
 * Shim manager for RUDI binaries
 *
 * Installed tools can be exposed via shims in ~/.rudi/bins/ (opt-in).
 *
 * This provides a unified execution contract:
 * - PATH only needs to include ~/.rudi/bins
 * - All tools resolve consistently via shims
 * - Easy uninstall (delete shim + payload)
 * - Works with `which <tool>`
 *
 * Ownership tracking:
 * - Each shim records which package owns it in ~/.rudi/shim-registry.json
 * - Enables collision detection and clean uninstall
 */

import fs from 'fs';
import path from 'path';
import { PATHS, resolveNodeRuntimeBin } from '@learnrudi/env';

/**
 * @typedef {Object} ShimOwnership
 * @property {string} owner - Package ID that owns this shim
 * @property {string} type - 'symlink' or 'wrapper'
 * @property {string} target - Absolute path to target binary
 * @property {string} createdAt - ISO timestamp
 */

/**
 * Get path to shim registry file
 * @returns {string}
 */
function getShimRegistryPath() {
  return path.join(PATHS.home, 'shim-registry.json');
}

/**
 * Load shim registry
 * @returns {Record<string, ShimOwnership>}
 */
function loadShimRegistry() {
  const registryPath = getShimRegistryPath();
  try {
    if (fs.existsSync(registryPath)) {
      return JSON.parse(fs.readFileSync(registryPath, 'utf-8'));
    }
  } catch {
    // Ignore corrupted registry
  }
  return {};
}

/**
 * Save shim registry
 * @param {Record<string, ShimOwnership>} registry
 */
function saveShimRegistry(registry) {
  const registryPath = getShimRegistryPath();
  const dir = path.dirname(registryPath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  fs.writeFileSync(registryPath, JSON.stringify(registry, null, 2));
}

/**
 * Register shim ownership
 * @param {string} bin - Binary name
 * @param {string} owner - Package ID
 * @param {string} type - 'symlink' or 'wrapper'
 * @param {string} target - Target path
 * @returns {{ collision: boolean, previousOwner?: string }}
 */
function registerShim(bin, owner, type, target) {
  const registry = loadShimRegistry();
  const existing = registry[bin];

  let collision = false;
  let previousOwner = undefined;

  if (existing && existing.owner !== owner) {
    collision = true;
    previousOwner = existing.owner;
  }

  registry[bin] = {
    owner,
    type,
    target,
    createdAt: new Date().toISOString()
  };

  saveShimRegistry(registry);
  return { collision, previousOwner };
}

/**
 * Unregister shim ownership
 * @param {string} bin - Binary name
 */
function unregisterShim(bin) {
  const registry = loadShimRegistry();
  delete registry[bin];
  saveShimRegistry(registry);
}

/**
 * Get shim owner
 * @param {string} bin - Binary name
 * @returns {ShimOwnership|null}
 */
export function getShimOwner(bin) {
  const registry = loadShimRegistry();
  return registry[bin] || null;
}

/**
 * Get all shim ownerships
 * @returns {Record<string, ShimOwnership>}
 */
export function getAllShimOwners() {
  return loadShimRegistry();
}

/**
 * Create shims for an installed tool
 * @param {Object} manifest - Installed tool manifest
 * @param {string} manifest.id - Package ID
 * @param {string} manifest.installType - Type: 'binary', 'npm', 'npm-global', 'pip', 'system'
 * @param {string} manifest.installDir - Installation directory
 * @param {string[]} manifest.bins - Executable names
 * @param {Object} [manifest.source] - Source info (for system type)
 * @returns {{ created: string[], collisions: Array<{ bin: string, previousOwner: string }> }}
 */
export async function createShimsForTool(manifest) {
  const bins = manifest.bins || [manifest.name || manifest.id.split(':')[1]];
  const created = [];
  const collisions = [];

  for (const bin of bins) {
    const target = resolveBinTarget(manifest, bin);

    // Validate target exists
    if (!fs.existsSync(target)) {
      console.warn(`[Shims] Warning: Binary target does not exist: ${target}`);
      continue;
    }

    // Use wrapper for npm/pip/system, symlink for upstream binaries
    const shimType = manifest.installType === 'binary' ? 'symlink' : 'wrapper';

    if (manifest.installType === 'binary') {
      createSymlinkShim(bin, target, PATHS.bins);
    } else {
      createWrapperShim(bin, target, PATHS.bins);
    }

    // Register ownership and detect collisions
    const { collision, previousOwner } = registerShim(bin, manifest.id, shimType, target);
    if (collision) {
      collisions.push({ bin, previousOwner });
      console.warn(`[Shims] Warning: '${bin}' was owned by ${previousOwner}, now owned by ${manifest.id}`);
    }

    created.push(bin);
  }

  return { created, collisions };
}

/**
 * Resolve the absolute path to a binary based on install type
 * @param {Object} manifest - Installed tool manifest
 * @param {string} bin - Binary name
 * @returns {string} Absolute path to binary
 */
function resolveBinTarget(manifest, bin) {
  switch (manifest.installType) {
    case 'binary':
      // Upstream binary: directly in install dir
      return path.join(manifest.installDir, bin);

    case 'npm':
      // npm package: in node_modules/.bin/
      return path.join(manifest.installDir, 'node_modules', '.bin', bin);

    case 'npm-global':
      // npm global (RUDI-managed Node runtime)
      return resolveNodeRuntimeBin(bin);

    case 'pip':
      // pip package: in venv/bin/
      return path.join(manifest.installDir, 'venv', 'bin', bin);

    case 'system':
      // System binary: use absolute path from manifest
      return manifest.source?.path || manifest.systemPath;

    default:
      throw new Error(`Unknown installType: ${manifest.installType}`);
  }
}

/**
 * Create a wrapper script shim (for npm/pip/system tools)
 * Wrapper scripts are more portable than symlinks and work on Windows
 * @param {string} name - Command name
 * @param {string} targetAbs - Absolute path to target executable
 * @param {string} binsDir - Shims directory
 */
function createWrapperShim(name, targetAbs, binsDir) {
  fs.mkdirSync(binsDir, { recursive: true });
  const shimPath = path.join(binsDir, name);

  // Create bash wrapper that execs the target
  const script = `#!/usr/bin/env bash
set -euo pipefail
exec "${targetAbs}" "$@"
`;

  // Atomic write: write to temp file, then rename
  const tempPath = `${shimPath}.tmp`;
  fs.writeFileSync(tempPath, script, 'utf8');
  fs.chmodSync(tempPath, 0o755);

  // Atomic rename (overwrites existing)
  fs.renameSync(tempPath, shimPath);

  console.log(`[Shims] Created wrapper shim: ${name} → ${targetAbs}`);
}

/**
 * Create a symlink shim (for upstream binaries)
 * Symlinks are fast and simple for true binaries
 * @param {string} name - Command name
 * @param {string} targetAbs - Absolute path to target executable
 * @param {string} binsDir - Shims directory
 */
function createSymlinkShim(name, targetAbs, binsDir) {
  fs.mkdirSync(binsDir, { recursive: true });
  const shimPath = path.join(binsDir, name);

  // Remove existing shim if present
  try {
    fs.unlinkSync(shimPath);
  } catch (err) {
    // Ignore - file doesn't exist
  }

  // Use relative symlink so it survives if home path changes (e.g., containers)
  const relTarget = path.relative(binsDir, targetAbs);
  fs.symlinkSync(relTarget, shimPath);

  console.log(`[Shims] Created symlink shim: ${name} → ${targetAbs}`);
}

/**
 * Remove shims for a tool
 * @param {string[]} bins - Binary names to remove
 * @returns {{ removed: string[], notFound: string[] }}
 */
export function removeShims(bins) {
  const removed = [];
  const notFound = [];

  for (const bin of bins) {
    const shimPath = path.join(PATHS.bins, bin);
    try {
      fs.unlinkSync(shimPath);
      unregisterShim(bin);
      removed.push(bin);
      console.log(`[Shims] Removed shim: ${bin}`);
    } catch (err) {
      notFound.push(bin);
      // Still unregister from ownership even if file was already gone
      unregisterShim(bin);
    }
  }

  return { removed, notFound };
}

/**
 * List all shims
 * @returns {string[]} Array of shim names
 */
export function listShims() {
  if (!fs.existsSync(PATHS.bins)) {
    return [];
  }

  return fs.readdirSync(PATHS.bins).filter(name => {
    const shimPath = path.join(PATHS.bins, name);
    try {
      const stat = fs.statSync(shimPath);
      // Include both files (wrappers) and symlinks
      return stat.isFile() || stat.isSymbolicLink();
    } catch {
      return false;
    }
  });
}

/**
 * Validate a shim (check if target exists)
 * @param {string} bin - Binary name
 * @returns {{ valid: boolean, target?: string, error?: string }}
 */
export function validateShim(bin) {
  const shimPath = path.join(PATHS.bins, bin);

  if (!fs.existsSync(shimPath)) {
    return { valid: false, error: 'Shim does not exist' };
  }

  try {
    const stat = fs.lstatSync(shimPath);

    if (stat.isSymbolicLink()) {
      // For symlinks, check if target exists
      const target = fs.readlinkSync(shimPath);
      const targetAbs = path.isAbsolute(target)
        ? target
        : path.resolve(path.dirname(shimPath), target);

      if (!fs.existsSync(targetAbs)) {
        return { valid: false, target: targetAbs, error: 'Symlink target does not exist' };
      }

      return { valid: true, target: targetAbs };
    } else if (stat.isFile()) {
      // For wrappers, extract target from script
      const content = fs.readFileSync(shimPath, 'utf8');
      const match = content.match(/exec "([^"]+)"/);
      const target = match?.[1];

      if (!target) {
        return { valid: false, error: 'Cannot parse wrapper script' };
      }

      if (!fs.existsSync(target)) {
        return { valid: false, target, error: 'Wrapper target does not exist' };
      }

      return { valid: true, target };
    }

    return { valid: false, error: 'Unknown shim type' };
  } catch (err) {
    return { valid: false, error: err.message };
  }
}
