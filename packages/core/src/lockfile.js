/**
 * Lockfile management for RUDI
 * Ensures reproducible installations
 */

import fs from 'fs';
import path from 'path';
import crypto from 'node:crypto';
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
export async function writeLockfile(resolved, options = {}) {
  // Use getLockfilePath for consistency with read/delete operations
  const lockPath = getLockfilePath(resolved.id);
  const lockDir = path.dirname(lockPath);

  // Ensure lock directory exists
  if (!fs.existsSync(lockDir)) {
    fs.mkdirSync(lockDir, { recursive: true });
  }

  const installPath = options.installPath || getPackagePath(resolved.id);
  const installLayout = fs.lstatSync(installPath).isDirectory() ? 'directory' : 'file';

  const lockfile = {
    id: resolved.id,
    version: resolved.version,
    name: resolved.name,
    installedAt: new Date().toISOString(),
    checksum: await computeInstalledContentChecksum(installPath, { runtime: resolved.kind === 'runtime' }),
    ...(resolved.kind === 'runtime' ? { checksumMode: 'runtime-tree-v1' } : {}),
    installLayout,
    ...(resolved.source?.type === 'github'
      ? {
          source: {
            type: 'github',
            requestedUrl: resolved.source.requestedUrl,
            repository: resolved.source.repository,
            requestedRef: resolved.source.requestedRef,
            resolvedCommit: resolved.source.resolvedCommit,
            path: resolved.source.path,
          },
        }
      : {}),
    dependencies: (resolved.dependencies || []).map(dep => ({
      id: dep.id,
      version: dep.version,
      checksum: '' // Would compute in production
    }))
  };

  const content = yamlStringify(lockfile, {
    lineWidth: 0 // Don't wrap lines
  });

  // Commit metadata atomically so a partial write cannot damage the old lock.
  const pendingPath = `${lockPath}.${crypto.randomUUID()}.pending`;
  try {
    fs.writeFileSync(pendingPath, content, { flag: 'wx', mode: 0o600 });
    fs.renameSync(pendingPath, lockPath);
  } finally {
    try {
      fs.rmSync(pendingPath, { force: true });
    } catch (error) {
      process.emitWarning(`Could not remove pending package lock ${pendingPath}: ${error.message}`);
    }
  }

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

export function restoreLockfile(id, snapshot) {
  const lockPath = getLockfilePath(id);
  if (!snapshot) {
    deleteLockfile(id);
    return;
  }
  fs.mkdirSync(path.dirname(lockPath), { recursive: true });
  fs.writeFileSync(lockPath, yamlStringify(snapshot, { lineWidth: 0 }));
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

  if (/^[a-f0-9]{64}$/i.test(lockfile.checksum || '')) {
    const [kind, name] = parsePackageId(id);
    const installPath = kind === 'skill' && (
      lockfile.installLayout === 'directory' || lockfile.source?.type === 'github'
    )
      ? path.join(PATHS.skills, name)
      : getPackagePath(id);
    if (lockfile.checksumMode && (lockfile.checksumMode !== 'runtime-tree-v1' || kind !== 'runtime')) {
      return { valid: false, errors: [...errors, 'Unsupported installed package checksum mode'] };
    }
    const checksum = await computeInstalledContentChecksum(installPath, {
      runtime: lockfile.checksumMode === 'runtime-tree-v1',
    });
    if (checksum !== lockfile.checksum) {
      errors.push('Installed package content checksum does not match lockfile');
    }
  }

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
const CHECKSUM_IGNORED_NAMES = new Set([
  '.DS_Store',
  '.git',
  '.venv',
  'node_modules',
  'venv',
]);
const CHECKSUM_IGNORED_ROOT_NAMES = new Set(['outputs', 'runs']);

function updateContentHash(hash, rootPath, currentPath, options) {
  const relativePath = path.relative(rootPath, currentPath).split(path.sep).join('/');
  const stat = fs.lstatSync(currentPath);
  if (stat.isSymbolicLink()) {
    if (!options.runtime) {
      throw new Error(`Cannot checksum symbolic link in installed package: ${relativePath}`);
    }
    const target = path.relative(fs.realpathSync(rootPath), fs.realpathSync(currentPath));
    if (!target || target === '..' || target.startsWith(`..${path.sep}`) || path.isAbsolute(target)) {
      throw new Error(`Runtime symbolic link escapes its installation: ${relativePath}`);
    }
    hash.update(`link\0${relativePath}\0${fs.readlinkSync(currentPath)}\0`);
    return;
  }
  if (stat.isFile()) {
    const executable = (stat.mode & 0o111) !== 0 ? 'executable' : 'regular';
    hash.update(`file\0${relativePath}\0${stat.size}\0${executable}\0`);
    hash.update(fs.readFileSync(currentPath));
    return;
  }
  if (!stat.isDirectory()) {
    throw new Error(`Cannot checksum unsupported installed package entry: ${relativePath}`);
  }
  hash.update(`dir\0${relativePath}\0`);
  for (const entry of fs.readdirSync(currentPath).sort()) {
    if (
      !options.includeIgnored && (CHECKSUM_IGNORED_NAMES.has(entry) ||
      (currentPath === rootPath && CHECKSUM_IGNORED_ROOT_NAMES.has(entry)))
    ) continue;
    updateContentHash(hash, rootPath, path.join(currentPath, entry), options);
  }
}

export async function computeInstalledContentChecksum(installPath, { includeIgnored = false, runtime = false } = {}) {
  if (!fs.existsSync(installPath)) {
    throw new Error(`Cannot checksum missing installed package: ${installPath}`);
  }
  const hash = crypto.createHash('sha256');
  const stat = fs.lstatSync(installPath);
  if (stat.isFile()) {
    const executable = (stat.mode & 0o111) !== 0 ? 'executable' : 'regular';
    hash.update(`file\0.\0${executable}\0`);
    hash.update(fs.readFileSync(installPath));
  } else {
    updateContentHash(hash, installPath, installPath, { includeIgnored: includeIgnored || runtime, runtime });
  }
  return hash.digest('hex');
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
