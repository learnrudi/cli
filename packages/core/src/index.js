/**
 * @learnrudi/core
 *
 * Core logic for RUDI - resolve dependencies, install packages, manage lockfiles.
 * Does NOT handle execution or secrets (that's runner's job).
 */

// Re-export from env for convenience
export {
  PATHS,
  getPackagePath,
  getLockfilePath,
  isPackageInstalled,
  getInstalledPackages,
  ensureDirectories,
  parsePackageId,
  createPackageId,
  getNodeRuntimeRoot,
  getNodeRuntimeBinDir,
  resolveNodeRuntimeBin
} from '@learnrudi/env';

// Re-export from registry-client for convenience
export {
  fetchIndex,
  searchPackages,
  getPackage,
  listPackages,
  clearCache
} from '@learnrudi/registry-client';

// Core exports
export * from './resolver.js';
export * from './installer.js';
export * from './lockfile.js';
export * from './deps.js';
export * from './rudi-config.js';
export * from './tool-index.js';
export * from './shims.js';
export * from './system-registry.js';
export * from './stack-lifecycle.js';
