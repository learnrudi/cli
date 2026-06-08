/**
 * Lockfile management for RUDI
 * Ensures reproducible installations
 */

import fs from 'fs';
import path from 'path';
import { stringify as yamlStringify, parse as yamlParse } from 'yaml';
import { PATHS, parsePackageId, getLockfilePath, isPackageInstalled, getPackagePath } from '@learnrudi/env';

/**
 * @typedef {Object} Lockfile
 * @property {string} id - Package ID
 * @property {string} version - Installed version
 * @property {string} installedAt - ISO timestamp
 * @property {string} checksum - Content checksum
 * @property {LockfileDependency[]} dependencies - Locked dependencies
 */

/**
 * @typedef {Object} LockfileDependency
 * @property {string} id - Dependency ID
 * @property {string} version - Locked version
 * @property {string} checksum - Content checksum
 */

/**
 * Write a lockfile for an installed package
 * @param {Object} resolved - Resolved package info
 * @returns {Promise<string>} Path to lockfile
 */
export async function writeLockfile(resolved) {
  // Use getLockfilePath for consistency with read/delete operations
  const lockPath = getLockfilePath(resolved.id);
  const lockDir = path.dirname(lockPath);

  // Ensure lock directory exists
  if (!fs.existsSync(lockDir)) {
    fs.mkdirSync(lockDir, { recursive: true });
  }

  const lockfile = {
    id: resolved.id,
    version: resolved.version,
    name: resolved.name,
    installedAt: new Date().toISOString(),
    checksum: await computeChecksum(resolved),
    dependencies: (resolved.dependencies || []).map(dep => ({
      id: dep.id,
      version: dep.version,
      checksum: '' // Would compute in production
    }))
  };

  const content = yamlStringify(lockfile, {
    lineWidth: 0 // Don't wrap lines
  });

  fs.writeFileSync(lockPath, content);

  return lockPath;
}

/**
 * Read a lockfile
 * @param {string} id - Package ID
 * @returns {Lockfile|null}
 */
export function readLockfile(id) {
  const lockPath = getLockfilePath(id);

  if (!fs.existsSync(lockPath)) {
    return null;
  }

  try {
    const content = fs.readFileSync(lockPath, 'utf-8');
    return yamlParse(content);
  } catch {
    return null;
  }
}

/**
 * Check if a lockfile exists
 * @param {string} id - Package ID
 * @returns {boolean}
 */
export function hasLockfile(id) {
  return fs.existsSync(getLockfilePath(id));
}

/**
 * Delete a lockfile
 * @param {string} id - Package ID
 */
export function deleteLockfile(id) {
  const lockPath = getLockfilePath(id);

  if (fs.existsSync(lockPath)) {
    fs.unlinkSync(lockPath);
  }
}

/**
 * Verify a package installation against its lockfile
 * @param {string} id - Package ID
 * @returns {Promise<{ valid: boolean, errors: string[] }>}
 */
export async function verifyLockfile(id) {
  const lockfile = readLockfile(id);

  if (!lockfile) {
    return { valid: false, errors: ['Lockfile not found'] };
  }

  const errors = [];

  // Check if package is installed
  if (!isPackageInstalled(id)) {
    errors.push('Package not installed');
    return { valid: false, errors };
  }

  // Check dependencies
  for (const dep of lockfile.dependencies || []) {
    if (!isPackageInstalled(dep.id)) {
      errors.push(`Missing dependency: ${dep.id}`);
    }
  }

  // In production, we would also verify checksums

  return {
    valid: errors.length === 0,
    errors
  };
}

/**
 * Compute a checksum for a package
 * @param {Object} pkg - Package info
 * @returns {Promise<string>}
 */
async function computeChecksum(pkg) {
  // In production, this would compute a hash of the package contents
  // For now, we'll use a simple hash of the manifest
  const crypto = await import('crypto');
  const data = JSON.stringify({
    id: pkg.id,
    version: pkg.version,
    name: pkg.name
  });
  return crypto.createHash('sha256').update(data).digest('hex').slice(0, 16);
}

/**
 * Get all lockfiles
 * @returns {Lockfile[]}
 */
export function getAllLockfiles() {
  const lockfiles = [];

  for (const kind of ['stacks', 'skills', 'prompts', 'workflows', 'runtimes', 'binaries', 'agents']) {
    const lockDir = path.join(PATHS.locks, kind);

    if (!fs.existsSync(lockDir)) continue;

    const files = fs.readdirSync(lockDir).filter(f => f.endsWith('.lock.yaml'));

    for (const file of files) {
      try {
        const content = fs.readFileSync(path.join(lockDir, file), 'utf-8');
        lockfiles.push(yamlParse(content));
      } catch {
        // Skip invalid lockfiles
      }
    }
  }

  return lockfiles;
}

/**
 * Clean up orphaned lockfiles (packages that are no longer installed)
 * @returns {string[]} Removed lockfile paths
 */
export async function cleanOrphanedLockfiles() {
  const removed = [];

  for (const kind of ['stacks', 'skills', 'prompts', 'workflows', 'runtimes', 'binaries', 'agents']) {
    const lockDir = path.join(PATHS.locks, kind);

    if (!fs.existsSync(lockDir)) continue;

    const files = fs.readdirSync(lockDir).filter(f => f.endsWith('.lock.yaml'));

    for (const file of files) {
      const lockPath = path.join(lockDir, file);

      try {
        const content = fs.readFileSync(lockPath, 'utf-8');
        const lockfile = yamlParse(content);

        if (!isPackageInstalled(lockfile.id)) {
          fs.unlinkSync(lockPath);
          removed.push(lockPath);
        }
      } catch {
        // Remove invalid lockfiles
        fs.unlinkSync(lockPath);
        removed.push(lockPath);
      }
    }
  }

  return removed;
}
