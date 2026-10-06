/**
 * @learnrudi/registry-client
 *
 * Registry client for fetching index, downloading packages, caching, and verification.
 * Handles all HTTP and caching concerns.
 */

import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { execFileSync as defaultExecFileSync } from 'child_process';
import { PATHS, getPlatformArch } from '@learnrudi/env';
import {
  detectRegistrySchema,
  getRegistryPackage,
  listRegistryPackages,
  normalizeRegistryPackage,
} from './registry-contract.js';
import { downloadGitHubDirectory } from './github-source.js';
import { describePackage, matchesSkillFilters, normalizeSkillFilters } from './skill-facets.js';

export { describePackage, describeSkill, matchesSkillFilters, normalizeSkillFilters } from './skill-facets.js';

export { normalizeRegistryPackage, resolveRegistryPackageForPlatform } from './registry-contract.js';
export {
  assertGitHubDirectoryFile,
  downloadGitHubDirectory,
  isGitHubTreeUrl,
  parseGitHubTreeUrl,
  readGitHubJsonFile,
  readGitHubTextFile,
  resolveGitHubTreeSource,
} from './github-source.js';

// =============================================================================
// CONFIGURATION
// =============================================================================

/**
 * Default registry URL
 */
export const DEFAULT_REGISTRY_URL = 'https://raw.githubusercontent.com/learnrudi/registry/main/index.json';

/**
 * Default downloads base URL (from registry repo releases)
 */
export const RUNTIMES_DOWNLOAD_BASE = 'https://github.com/learnrudi/registry/releases/download';

/**
 * Cache TTL in milliseconds (1 hour)
 */
export const CACHE_TTL = 60 * 60 * 1000;

function assertCommandArg(value, label) {
  if (typeof value !== 'string' || value.length === 0 || value.includes('\0')) {
    throw new Error(`Invalid command ${label}`);
  }
  return value;
}

function normalizeCommandPlan(plan) {
  if (!plan || typeof plan !== 'object' || Array.isArray(plan)) {
    throw new Error('Command plan must be an object');
  }

  const command = assertCommandArg(plan.command, 'command');
  const args = Array.isArray(plan.args)
    ? plan.args.map((arg, index) => assertCommandArg(arg, `arg ${index}`))
    : [];

  return { command, args };
}

export function runRegistryCommandPlan(plan, options = {}) {
  const { execFileSync = defaultExecFileSync, ...execOptions } = options;
  const { command, args } = normalizeCommandPlan(plan);
  return execFileSync(command, args, execOptions);
}

export function createRegistryArchiveExtractCommand(archiveType, archivePath, destPath, options = {}) {
  const archive = assertCommandArg(archivePath, 'archive path');
  const dest = assertCommandArg(destPath, 'destination path');
  const stripComponents = Number(options.stripComponents || 0);
  const withStrip = [];

  if (!Number.isInteger(stripComponents) || stripComponents < 0) {
    throw new Error(`Invalid stripComponents: ${options.stripComponents}`);
  }
  if (stripComponents > 0) {
    withStrip.push(`--strip-components=${stripComponents}`);
  }

  if (archiveType === 'tar.gz' || archiveType === 'tgz') {
    return { command: 'tar', args: ['-xzf', archive, '-C', dest, ...withStrip] };
  }
  if (archiveType === 'tar.xz') {
    return { command: 'tar', args: ['-xJf', archive, '-C', dest, ...withStrip] };
  }
  if (archiveType === 'zip') {
    return { command: 'unzip', args: ['-o', archive, '-d', dest] };
  }

  throw new Error(`Unsupported archive type: ${archiveType}`);
}

export function installRawBinaryDownload(downloadPath, destPath, binaryName, options = {}) {
  const source = assertCommandArg(downloadPath, 'raw binary download path');
  const destinationRoot = assertCommandArg(destPath, 'raw binary destination');
  const rawName = assertCommandArg(binaryName, 'raw binary name').replaceAll('\\', '/');
  const finalName = path.posix.basename(rawName);

  if (!finalName || finalName === '.' || finalName === '..') {
    throw new Error(`Invalid raw binary name: ${binaryName}`);
  }

  fs.mkdirSync(destinationRoot, { recursive: true });
  const finalPath = path.join(destinationRoot, finalName);
  fs.copyFileSync(source, finalPath);

  if (options.chmod !== false) {
    fs.chmodSync(finalPath, 0o755);
  }

  return finalPath;
}

function createCurlDownloadCommand(url, destPath) {
  const parsed = new URL(assertCommandArg(url, 'download URL'));
  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
    throw new Error(`Unsupported download protocol: ${parsed.protocol}`);
  }
  return {
    command: 'curl',
    args: ['-sL', parsed.toString(), '-o', assertCommandArg(destPath, 'download destination')],
  };
}

function getRegistryRootCandidates(startDir) {
  const roots = [];
  let current = path.resolve(startDir);

  while (true) {
    roots.push(path.join(current, 'registry'));
    roots.push(path.join(current, 'apps', 'registry'));

    const parent = path.dirname(current);
    if (parent === current) {
      return roots;
    }
    current = parent;
  }
}

function getLocalRegistryRoots() {
  if (process.env.USE_LOCAL_REGISTRY !== 'true') {
    return [];
  }

  const cwd = process.cwd();
  const workspaceRoot = process.env.RUDI_WORKSPACE_ROOT;
  const roots = [
    process.env.RUDI_REGISTRY_ROOT,
    workspaceRoot ? path.join(workspaceRoot, 'apps', 'registry') : null,
    ...getRegistryRootCandidates(cwd),
  ].filter(Boolean);

  return [...new Set(roots.map((registryPath) => path.resolve(registryPath)))];
}

/**
 * Local registry paths (for development)
 * Set USE_LOCAL_REGISTRY=true environment variable to enable local development mode.
 * Set RUDI_REGISTRY_ROOT for a non-standard local registry checkout.
 */
function getLocalRegistryPaths() {
  return getLocalRegistryRoots().map((registryRoot) => path.join(registryRoot, 'index.json'));
}

function getLocalRegistrySource(registryPath) {
  if (process.env.USE_LOCAL_REGISTRY !== 'true') {
    return null;
  }

  for (const registryRoot of getLocalRegistryRoots()) {
    const localPath = path.join(registryRoot, registryPath);
    if (fs.existsSync(localPath)) {
      return localPath;
    }
  }

  return null;
}

function shouldCopyLocalRegistryFile(sourcePath) {
  const name = path.basename(sourcePath);
  const segments = sourcePath.split(path.sep);
  if (segments.includes('composer') && segments.includes('public') && segments.includes('media')) {
    return false;
  }

  return ![
    '.DS_Store',
    '.git',
    '.test-rudi',
    'clips',
    'node_modules',
    'output',
    'outputs',
    'runs',
    '__pycache__'
  ].includes(name) && !name.endsWith('.pyc');
}

function copyLocalRegistrySource(sourcePath, destPath, onProgress) {
  const sourceStat = fs.statSync(sourcePath);
  fs.rmSync(destPath, { recursive: true, force: true });

  if (sourceStat.isDirectory()) {
    fs.mkdirSync(destPath, { recursive: true });
    fs.cpSync(sourcePath, destPath, {
      recursive: true,
      filter: shouldCopyLocalRegistryFile
    });
    if (fs.existsSync(path.join(destPath, 'manifest.json'))) {
      installCanonicalStackManifest(destPath);
    }
    onProgress?.({ phase: 'downloading', source: 'local', directory: sourcePath });
    return;
  }

  const destDir = path.dirname(destPath);
  if (!fs.existsSync(destDir)) {
    fs.mkdirSync(destDir, { recursive: true });
  }
  fs.copyFileSync(sourcePath, destPath);
  onProgress?.({ phase: 'downloading', source: 'local', file: sourcePath });
}

function installCanonicalStackManifest(destPath, manifest = null) {
  const canonicalManifest = manifest || JSON.parse(
    fs.readFileSync(path.join(destPath, 'manifest.json'), 'utf-8')
  );
  const normalized = normalizeRegistryPackage(canonicalManifest, 'stack');
  fs.writeFileSync(path.join(destPath, 'manifest.json'), JSON.stringify(normalized, null, 2));
  return normalized;
}

// =============================================================================
// INDEX FETCHING
// =============================================================================

/**
 * Fetch the registry index
 * @param {Object} options
 * @param {string} [options.url] - Registry URL
 * @param {boolean} [options.force] - Force refresh, ignore cache
 * @param {boolean} [options.persist] - Persist a fetched/local index to the cache
 * @returns {Promise<Object>} Registry index
 */
export async function fetchIndex(options = {}) {
  const configuredUrl = process.env.RUDI_REGISTRY_URL;
  const url = options.url || configuredUrl || DEFAULT_REGISTRY_URL;
  const force = options.force ?? false;
  const persist = options.persist !== false;

  // In development, prefer local registry if it's newer than cache
  const localResult = getLocalIndex();
  if (localResult) {
    const { index: localIndex, mtime: localMtime } = localResult;
    const cacheMtime = getCacheMtime();

    // Use local if: forcing, no cache, or local is newer
    if (force || !cacheMtime || localMtime > cacheMtime) {
      if (persist) cacheIndex(localIndex);
      return localIndex;
    }
  }

  // Check cache (unless forcing)
  if (!force) {
    const cached = getCachedIndex();
    if (cached) {
      return cached;
    }
  }

  // Local index already handled above, try remote
  if (localResult) {
    return localResult.index;
  }

  // Fetch the single canonical registry contract. Invalid JSON, transport
  // failures, and unsupported schemas all fail without silent downgrade.
  try {
    const index = await fetchRemoteRegistryIndex(url);

    // Cache the result
    if (persist) cacheIndex(index);

    return index;
  } catch (error) {
    throw new Error(`Failed to fetch registry: ${error.message}`);
  }
}

async function fetchRemoteRegistryIndex(url) {
  let response;
  try {
    response = await fetch(url, {
      headers: {
        'Accept': 'application/json',
        'User-Agent': 'rudi-cli/2.0'
      }
    });
  } catch (error) {
    const transportError = new Error(error instanceof Error ? error.message : String(error));
    transportError.registryTransportFailure = true;
    throw transportError;
  }

  if (!response.ok) {
    const transportError = new Error(`HTTP ${response.status}: ${response.statusText}`);
    transportError.registryTransportFailure = true;
    throw transportError;
  }

  let index;
  try {
    index = await response.json();
  } catch (error) {
    throw new Error(`Invalid registry JSON from ${url}: ${error.message}`);
  }

  detectRegistrySchema(index);
  return index;
}

/**
 * Get cached index if valid
 * @returns {Object|null}
 */
function getCachedIndex({ allowExpired = false } = {}) {
  const cachePath = PATHS.registryCache;

  if (!fs.existsSync(cachePath)) {
    return null;
  }

  try {
    const stat = fs.statSync(cachePath);
    const age = Date.now() - stat.mtimeMs;

    if (!allowExpired && age > CACHE_TTL) {
      return null; // Cache expired
    }

    return JSON.parse(fs.readFileSync(cachePath, 'utf-8'));
  } catch {
    return null;
  }
}

/** Read-only catalog context for installed inventory; never fetch or refresh cache. */
export function getAvailableRegistryIndex() {
  const index = getLocalIndex()?.index || getCachedIndex({ allowExpired: true });
  if (!index) return null;
  try { detectRegistrySchema(index); return index; } catch { return null; }
}

/**
 * Cache the registry index
 * @param {Object} index
 */
function cacheIndex(index) {
  const cachePath = PATHS.registryCache;
  const cacheDir = path.dirname(cachePath);

  if (!fs.existsSync(cacheDir)) {
    fs.mkdirSync(cacheDir, { recursive: true });
  }

  fs.writeFileSync(cachePath, JSON.stringify(index, null, 2));
}

/**
 * Get cache modification time
 * @returns {number|null}
 */
function getCacheMtime() {
  const cachePath = PATHS.registryCache;
  if (!fs.existsSync(cachePath)) {
    return null;
  }
  try {
    return fs.statSync(cachePath).mtimeMs;
  } catch {
    return null;
  }
}

/**
 * Get local index if available (for development)
 * @returns {{ index: Object, mtime: number }|null}
 */
function getLocalIndex() {
  for (const localPath of getLocalRegistryPaths()) {
    if (fs.existsSync(localPath)) {
      try {
        const index = JSON.parse(fs.readFileSync(localPath, 'utf-8'));
        const mtime = fs.statSync(localPath).mtimeMs;
        return { index, mtime };
      } catch {
        continue;
      }
    }
  }
  return null;
}

/**
 * Clear the registry cache
 */
export function clearCache() {
  if (fs.existsSync(PATHS.registryCache)) {
    fs.unlinkSync(PATHS.registryCache);
  }
}

/**
 * Check if cache is fresh
 * @returns {{ fresh: boolean, age: number|null }}
 */
export function checkCache() {
  const cachePath = PATHS.registryCache;

  if (!fs.existsSync(cachePath)) {
    return { fresh: false, age: null };
  }

  try {
    const stat = fs.statSync(cachePath);
    const age = Date.now() - stat.mtimeMs;
    return { fresh: age <= CACHE_TTL, age };
  } catch {
    return { fresh: false, age: null };
  }
}

// =============================================================================
// PACKAGE SEARCH
// =============================================================================

/**
 * All valid package kinds
 */
export const PACKAGE_KINDS = ['stack', 'skill', 'prompt', 'workflow', 'runtime', 'binary', 'agent'];

/**
 * Search packages in the registry
 * @param {string} query - Search query
 * @param {Object} options
 * @param {string} [options.kind] - Filter by kind
 * @returns {Promise<Array>}
 */
export async function searchPackages(query, options = {}) {
  const { kind } = options;
  const filters = normalizeSkillFilters(options);
  const index = await fetchIndex();

  const results = [];
  const queryLower = query.toLowerCase();

  const kinds = kind ? [kind] : PACKAGE_KINDS;

  for (const k of kinds) {
    const packages = listRegistryPackages(index, k);

    for (const raw of packages) {
      const pkg = describePackage(raw, index);
      if (matchesQuery(pkg, queryLower) && matchesSkillFilters(pkg, filters)) {
        results.push({ ...pkg, kind: k });
      }
    }
  }

  return results;
}

/**
 * Check if a package matches a search query
 */
function matchesQuery(pkg, query) {
  const searchable = [
    pkg.id || '',
    pkg.name || '',
    pkg.description || '',
    pkg.category || '',
    ...(pkg.tags || [])
  ].join(' ').toLowerCase();

  return searchable.includes(query);
}

/**
 * Get a specific package from the registry
 * @param {string} id - Package ID (e.g., 'stack:pdf-creator', 'binary:ffmpeg', 'agent:claude')
 * @returns {Promise<Object|null>}
 */
export async function getPackage(id) {
  const index = await fetchIndex();
  return getRegistryPackage(index, id, PACKAGE_KINDS);
}

/**
 * Get canonical manifest for a package
 * Fetches the full manifest from catalog path (not just index metadata)
 * @param {Object} pkg - Package object from getPackage() with path field
 * @returns {Promise<Object|null>} Full manifest with install-critical fields
 */
export async function getManifest(pkg) {
  if (!pkg || !pkg.path) {
    return null;
  }

  const manifestPath = pkg.path;

  function normalizeManifest(manifest) {
    return manifest?.delivery && manifest?.install?.source
      ? normalizeRegistryPackage(manifest, pkg.kind)
      : manifest;
  }

  // Try local registry first (development mode)
  if (process.env.USE_LOCAL_REGISTRY === 'true') {
    const localPaths = getLocalRegistryRoots().map((registryRoot) => {
      return path.join(registryRoot, manifestPath);
    });

    for (const localPath of localPaths) {
      if (fs.existsSync(localPath)) {
        const candidates = fs.statSync(localPath).isDirectory()
          ? [path.join(localPath, 'manifest.json')]
          : [localPath];
        for (const filePath of candidates) {
          if (!fs.existsSync(filePath)) continue;
          try {
            return normalizeManifest(JSON.parse(fs.readFileSync(filePath, 'utf-8')));
          } catch (error) {
            throw new Error(`Invalid registry manifest ${filePath}: ${error.message}`);
          }
        }
      }
    }
  }

  // Fetch from remote (GitHub raw)
  try {
    const remotePaths = manifestPath.endsWith('.json')
      ? [manifestPath]
      : [`${manifestPath}/manifest.json`];
    for (const remotePath of remotePaths) {
      const url = `${GITHUB_RAW_BASE}/${remotePath}`;
      const response = await fetch(url, {
        headers: {
          'Accept': 'application/json',
          'User-Agent': 'rudi-cli/2.0'
        }
      });
      if (response.status === 404) continue;
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }
      try {
        return normalizeManifest(await response.json());
      } catch (error) {
        throw new Error(`Invalid registry manifest ${remotePath}: ${error.message}`);
      }
    }
    return null;
  } catch (err) {
    throw new Error(`Failed to fetch registry manifest ${manifestPath}: ${err.message}`);
  }
}

/**
 * List all packages of a specific kind
 * @param {'stack' | 'skill' | 'prompt' | 'workflow' | 'runtime' | 'binary' | 'agent'} kind
 * @returns {Promise<Array>}
 */
export async function listPackages(kind, options = {}) {
  const filters = normalizeSkillFilters(options);
  const index = await fetchIndex();
  return listRegistryPackages(index, kind).map(pkg => describePackage(pkg, index))
    .filter(pkg => matchesSkillFilters(pkg, filters));
}

/**
 * List all available package kinds
 * @returns {string[]}
 */
export function getPackageKinds() {
  return PACKAGE_KINDS;
}

// =============================================================================
// PACKAGE DOWNLOAD
// =============================================================================

function resolvedBinEntries(bins, packageId) {
  const entries = Array.isArray(bins)
    ? bins.map((name) => ({ name, path: name }))
    : Object.entries(bins || {}).map(([name, config]) => ({
        name,
        path: config?.path || name,
      }));

  if (entries.length === 0) {
    throw new Error(`[${packageId}] download package requires at least one binary`);
  }
  for (const entry of entries) {
    if (
      typeof entry.name !== 'string' ||
      !entry.name ||
      path.basename(entry.name) !== entry.name ||
      typeof entry.path !== 'string' ||
      !entry.path ||
      entry.path.includes('\0') ||
      entry.path.replaceAll('\\', '/').split('/').some((segment) => segment === '..')
    ) {
      throw new Error(`[${packageId}] invalid binary path`);
    }
  }
  return entries;
}

function validateRuntimeBinary(root, relativePath, packageId) {
  const binaryPath = path.join(root, relativePath);
  if (!fs.existsSync(binaryPath)) {
    throw new Error(`[${packageId}] extracted runtime binary not found: ${relativePath}`);
  }
  const relative = path.relative(fs.realpathSync(root), fs.realpathSync(binaryPath));
  if (!relative || relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
    throw new Error(`[${packageId}] runtime binary escapes its installation: ${relativePath}`);
  }
  if (!fs.statSync(binaryPath).isFile()) {
    throw new Error(`[${packageId}] runtime binary is not a regular file: ${relativePath}`);
  }
  fs.chmodSync(binaryPath, 0o755);
}

/**
 * Download an already platform-resolved registry v2 package.
 * Runtime replacements stage first and retain the previous tree for rollback.
 * Incomplete binary-package destinations are removed on failure.
 */
export async function downloadResolvedPackage(pkg, destPath, options = {}) {
  const { onProgress } = options;
  if (!pkg || pkg.install?.source !== 'download') {
    throw new Error('downloadResolvedPackage requires install.source=download');
  }
  if (typeof pkg.install.url !== 'string' || pkg.install.checksum?.algo !== 'sha256') {
    throw new Error(`[${pkg.id}] resolved download requires URL and sha256 checksum`);
  }
  const parsedUrl = new URL(pkg.install.url);
  if (parsedUrl.protocol !== 'https:') {
    throw new Error(`[${pkg.id}] download URL must use https`);
  }
  const expectedHash = pkg.install.checksum.value;
  if (!/^[a-f0-9]{64}$/i.test(expectedHash || '')) {
    throw new Error(`[${pkg.id}] resolved download requires a valid sha256 checksum`);
  }
  const extractType = pkg.install.extract?.type;
  if (!['raw', 'zip', 'tar.gz', 'tar.xz'].includes(extractType)) {
    throw new Error(`[${pkg.id}] unsupported extract type: ${extractType}`);
  }

  const bins = resolvedBinEntries(pkg.bins, pkg.id);
  const cacheDir = path.join(PATHS.cache, 'downloads');
  fs.mkdirSync(cacheDir, { recursive: true });
  const safeId = String(pkg.id).replace(/[^a-zA-Z0-9._-]/g, '-');
  const tempFile = path.join(cacheDir, `${safeId}-${crypto.randomUUID()}.download`);
  let destinationPrepared = false;
  let stagingPath = null;
  let backupPath = null;
  let runtimeActivated = false;

  try {
    onProgress?.({ phase: 'downloading', package: pkg.id, url: parsedUrl.toString() });
    const response = await fetch(parsedUrl, {
      headers: {
        'User-Agent': 'rudi-cli/2.0',
        'Accept': 'application/octet-stream',
      },
    });
    if (!response.ok) {
      throw new Error(`Failed to download ${pkg.id}: HTTP ${response.status}`);
    }
    fs.writeFileSync(tempFile, Buffer.from(await response.arrayBuffer()));

    if (!await verifyHash(tempFile, expectedHash)) {
      throw new Error(`Checksum mismatch for ${pkg.id}`);
    }

    if (pkg.kind === 'runtime') {
      fs.mkdirSync(path.dirname(destPath), { recursive: true });
      stagingPath = fs.mkdtempSync(path.join(path.dirname(destPath), `.${path.basename(destPath)}.install-`));
    } else {
      fs.rmSync(destPath, { recursive: true, force: true });
      destinationPrepared = true;
      fs.mkdirSync(destPath, { recursive: true });
    }
    const workPath = stagingPath || destPath;
    onProgress?.({ phase: 'extracting', package: pkg.id });

    if (extractType === 'raw') {
      if (bins.length !== 1) {
        throw new Error(`[${pkg.id}] raw download must expose exactly one binary`);
      }
      installRawBinaryDownload(tempFile, workPath, bins[0].name);
    } else {
      runRegistryCommandPlan(createRegistryArchiveExtractCommand(extractType, tempFile, workPath, {
        stripComponents: pkg.install.extract?.strip || 0,
      }), { stdio: 'pipe' });
      for (const bin of bins) {
        if (pkg.kind === 'runtime') {
          validateRuntimeBinary(workPath, bin.path, pkg.id);
          continue;
        }
        const direct = path.join(workPath, bin.name);
        if (!fs.existsSync(direct)) {
          await extractBinaryFromPath(workPath, bin.path, workPath);
        }
        if (!fs.existsSync(direct)) {
          throw new Error(`[${pkg.id}] extracted binary not found: ${bin.name}`);
        }
        fs.chmodSync(direct, 0o755);
      }
    }

    const installedAt = new Date().toISOString();
    const manifest = {
      id: pkg.id,
      kind: pkg.kind,
      name: pkg.name,
      version: pkg.version,
      installType: 'binary',
      bins: bins.map((bin) => bin.name),
      platformArch: getPlatformArch(),
      source: {
        url: parsedUrl.toString(),
        sha256: expectedHash,
      },
      installedAt,
    };
    // Runtime metadata is installer-owned; never follow archive-provided links.
    fs.writeFileSync(path.join(workPath, 'manifest.json'), JSON.stringify(manifest, null, 2),
      pkg.kind === 'runtime' ? { flag: 'wx' } : undefined);
    if (pkg.kind === 'runtime') {
      fs.writeFileSync(path.join(workPath, 'runtime.json'), JSON.stringify({
        runtime: pkg.id.replace(/^runtime:/, ''),
        version: pkg.version,
        platformArch: getPlatformArch(),
        source: parsedUrl.toString(),
        downloadedAt: installedAt,
        bins: manifest.bins,
      }, null, 2), { flag: 'wx' });
      // Finish fallible scratch cleanup before the working runtime is replaced.
      fs.unlinkSync(tempFile);
      if (fs.existsSync(destPath)) {
        backupPath = path.join(path.dirname(destPath), `.${path.basename(destPath)}.runtime-backup-${crypto.randomUUID()}`);
        fs.renameSync(destPath, backupPath);
      }
      fs.renameSync(stagingPath, destPath);
      stagingPath = null;
      runtimeActivated = true;
    }

    onProgress?.({ phase: 'complete', package: pkg.id, path: destPath });
    return { success: true, path: destPath, ...(backupPath ? { backupPath } : {}) };
  } catch (error) {
    if (destinationPrepared) fs.rmSync(destPath, { recursive: true, force: true });
    if (runtimeActivated) fs.rmSync(destPath, { recursive: true, force: true });
    if (backupPath) {
      if (fs.existsSync(destPath)) {
        throw new Error(`${error.message}; previous runtime retained at ${backupPath}; destination changed during rollback`);
      }
      fs.renameSync(backupPath, destPath);
    }
    throw error;
  } finally {
    if (stagingPath) fs.rmSync(stagingPath, { recursive: true, force: true });
    if (fs.existsSync(tempFile)) fs.unlinkSync(tempFile);
  }
}

/**
 * GitHub raw content base URL
 */
const GITHUB_RAW_BASE = 'https://raw.githubusercontent.com/learnrudi/registry/main';

/**
 * Download a package from the registry (from GitHub raw for stacks)
 *
 * Stacks are downloaded as source and built locally using bundled runtimes.
 * No tarballs needed - just fetch source files and run npm/pip install.
 *
 * @param {Object} pkg - Package metadata from registry
 * @param {string} destPath - Destination path
 * @param {Object} options
 * @param {Function} [options.onProgress] - Progress callback
 * @returns {Promise<{ success: boolean, path: string }>}
 */
export async function downloadPackage(pkg, destPath, options = {}) {
  const { onProgress } = options;

  if (pkg.source?.type === 'github') {
    await downloadGitHubDirectory(pkg.source, pkg.source.path, destPath, { onProgress });
    if (pkg.kind === 'stack') {
      const manifest = installCanonicalStackManifest(destPath);
      fs.writeFileSync(
        path.join(destPath, 'manifest.json'),
        JSON.stringify({ ...manifest, source: pkg.source }, null, 2),
      );
    } else if (pkg.kind === 'skill' && !fs.existsSync(path.join(destPath, 'SKILL.md'))) {
      fs.rmSync(destPath, { recursive: true, force: true });
      throw new Error(`GitHub operator skill is missing SKILL.md: ${pkg.source.path}`);
    }
    return { success: true, path: destPath };
  }

  const registryPath = pkg.path; // e.g., 'catalog/stacks/slack' or 'catalog/skills/code-review.md'
  const isSingleFilePackage = (
    pkg.kind === 'prompt' ||
    pkg.kind === 'workflow' ||
    registryPath.endsWith('.md')
  );

  onProgress?.({ phase: 'downloading', package: pkg.name || pkg.id });

  const localSourcePath = getLocalRegistrySource(registryPath);
  if (localSourcePath) {
    copyLocalRegistrySource(localSourcePath, destPath, onProgress);
    return { success: true, path: destPath };
  }

  // For single file packages (skills/prompts/workflows)
  if (isSingleFilePackage) {
    const url = `${GITHUB_RAW_BASE}/${registryPath}`;
    const response = await fetch(url, {
      headers: { 'User-Agent': 'rudi-cli/2.0' }
    });

    if (!response.ok) {
      throw new Error(`Failed to download ${registryPath}: HTTP ${response.status}`);
    }

    const content = await response.text();
    const destDir = path.dirname(destPath);
    if (!fs.existsSync(destDir)) {
      fs.mkdirSync(destDir, { recursive: true });
    }
    if (fs.existsSync(destPath) && fs.statSync(destPath).isDirectory()) {
      fs.rmSync(destPath, { recursive: true, force: true });
    }
    fs.writeFileSync(destPath, content);
    return { success: true, path: destPath };
  }

  // Create destination directory
  if (!fs.existsSync(destPath)) {
    fs.mkdirSync(destPath, { recursive: true });
  }

  if (pkg.kind === 'skill') {
    await downloadPackageDirectoryFromGitHub(registryPath, destPath, onProgress);
    return { success: true, path: destPath };
  }

  // For stacks, download source files from GitHub raw
  if (pkg.kind === 'stack' || registryPath.includes('/stacks/')) {
    await downloadStackFromGitHub(registryPath, destPath, onProgress);
    return { success: true, path: destPath };
  }

  throw new Error(`Unsupported package type: ${registryPath}`);
}

function assertGitHubContentName(name, registryPath) {
  if (
    typeof name !== 'string' ||
    !name ||
    name === '.' ||
    name === '..' ||
    path.basename(name) !== name ||
    name.includes('\0')
  ) {
    throw new Error(`Invalid package entry in ${registryPath}`);
  }
  return name;
}

async function writeGitHubContentFile(item, destination, registryPath) {
  if (typeof item.download_url !== 'string') {
    throw new Error(`Package file missing download URL: ${registryPath}/${item.name}`);
  }

  const downloadUrl = new URL(item.download_url);
  if (downloadUrl.protocol !== 'https:') {
    throw new Error(`Unsupported package file URL: ${item.download_url}`);
  }

  const response = await fetch(downloadUrl, {
    headers: { 'User-Agent': 'rudi-cli/2.0' }
  });
  if (!response.ok) {
    throw new Error(`Failed to download ${registryPath}/${item.name}: HTTP ${response.status}`);
  }

  const content = typeof response.arrayBuffer === 'function'
    ? Buffer.from(await response.arrayBuffer())
    : await response.text();
  fs.writeFileSync(destination, content);
}

async function downloadGitHubContents(apiUrl, registryPath, destPath, onProgress) {
  const response = await fetch(apiUrl, {
    headers: {
      'User-Agent': 'rudi-cli/2.0',
      'Accept': 'application/vnd.github.v3+json'
    }
  });
  if (!response.ok) {
    throw new Error(`Package directory not found: ${registryPath} (HTTP ${response.status})`);
  }

  const contents = await response.json();
  if (!Array.isArray(contents)) {
    throw new Error(`Invalid package directory: ${registryPath}`);
  }

  fs.mkdirSync(destPath, { recursive: true });
  for (const item of contents) {
    const name = assertGitHubContentName(item?.name, registryPath);
    const destination = path.join(destPath, name);
    const childRegistryPath = `${registryPath}/${name}`;

    if (item.type === 'file') {
      await writeGitHubContentFile(item, destination, registryPath);
      onProgress?.({ phase: 'downloading', file: childRegistryPath });
      continue;
    }

    if (item.type === 'dir') {
      if (typeof item.url !== 'string' || !item.url.startsWith('https://api.github.com/repos/learnrudi/registry/contents/')) {
        throw new Error(`Invalid package directory URL: ${childRegistryPath}`);
      }
      await downloadGitHubContents(item.url, childRegistryPath, destination, onProgress);
      continue;
    }

    throw new Error(`Unsupported package entry type in ${childRegistryPath}: ${item.type}`);
  }
}

async function downloadPackageDirectoryFromGitHub(registryPath, destPath, onProgress) {
  const normalizedPath = String(registryPath || '').replaceAll('\\', '/');
  if (
    !normalizedPath ||
    normalizedPath.startsWith('/') ||
    normalizedPath.split('/').some(segment => !segment || segment === '.' || segment === '..')
  ) {
    throw new Error(`Invalid registry package path: ${registryPath}`);
  }

  const apiUrl = `https://api.github.com/repos/learnrudi/registry/contents/${normalizedPath}`;
  fs.rmSync(destPath, { recursive: true, force: true });
  await downloadGitHubContents(apiUrl, normalizedPath, destPath, onProgress);
}

/**
 * Download a stack from GitHub raw content
 * Downloads manifest.json, package.json, and source files
 */
async function downloadStackFromGitHub(registryPath, destPath, onProgress) {
  const baseUrl = `${GITHUB_RAW_BASE}/${registryPath}`;

  // First, list the directory contents using GitHub API to see what exists
  const apiUrl = `https://api.github.com/repos/learnrudi/registry/contents/${registryPath}`;
  const listResponse = await fetch(apiUrl, {
    headers: {
      'User-Agent': 'rudi-cli/2.0',
      'Accept': 'application/vnd.github.v3+json'
    }
  });

  if (!listResponse.ok) {
    throw new Error(`Stack not found: ${registryPath}`);
  }

  const contents = await listResponse.json();
  if (!Array.isArray(contents)) {
    throw new Error(`Invalid stack directory: ${registryPath}`);
  }

  // Build a map of what exists in the directory
  const existingItems = new Map();
  for (const item of contents) {
    existingItems.set(item.name, item);
  }

  const manifestName = 'manifest.json';
  const manifestItem = existingItems.get(manifestName);
  if (!manifestItem) {
    throw new Error(`Stack missing ${manifestName}: ${registryPath}`);
  }

  const manifestResponse = await fetch(manifestItem.download_url, {
    headers: { 'User-Agent': 'rudi-cli/2.0' }
  });
  if (!manifestResponse.ok) {
    throw new Error(`Failed to download ${registryPath}/${manifestName}: HTTP ${manifestResponse.status}`);
  }
  const manifest = await manifestResponse.json();
  installCanonicalStackManifest(destPath, manifest);
  onProgress?.({ phase: 'downloading', file: manifestName });

  // Download package.json if it exists
  const pkgJsonItem = existingItems.get('package.json');
  if (pkgJsonItem) {
    const pkgJsonResponse = await fetch(pkgJsonItem.download_url, {
      headers: { 'User-Agent': 'rudi-cli/2.0' }
    });
    if (pkgJsonResponse.ok) {
      const pkgJson = await pkgJsonResponse.text();
      fs.writeFileSync(path.join(destPath, 'package.json'), pkgJson);
      onProgress?.({ phase: 'downloading', file: 'package.json' });
    }
  }

  // Preserve root package metadata required for deterministic installs and support.
  const additionalRootFiles = [
    'package-lock.json',
    'pnpm-lock.yaml',
    'yarn.lock',
    'bun.lock',
    'bun.lockb',
    'README.md',
    'LICENSE',
  ];
  for (const fileName of additionalRootFiles) {
    const item = existingItems.get(fileName);
    if (!item || item.type !== 'file') continue;

    const response = await fetch(item.download_url, {
      headers: { 'User-Agent': 'rudi-cli/2.0' }
    });
    if (!response.ok) {
      throw new Error(`Failed to download ${registryPath}/${fileName}: HTTP ${response.status}`);
    }
    fs.writeFileSync(path.join(destPath, fileName), await response.text());
    onProgress?.({ phase: 'downloading', file: fileName });
  }

  // Download .env.example if it exists
  const envExampleItem = existingItems.get('.env.example');
  if (envExampleItem) {
    const envResponse = await fetch(envExampleItem.download_url, {
      headers: { 'User-Agent': 'rudi-cli/2.0' }
    });
    if (envResponse.ok) {
      const envContent = await envResponse.text();
      fs.writeFileSync(path.join(destPath, '.env.example'), envContent);
    }
  }

  // Download tsconfig.json if it exists
  const tsconfigItem = existingItems.get('tsconfig.json');
  if (tsconfigItem) {
    const tsconfigResponse = await fetch(tsconfigItem.download_url, {
      headers: { 'User-Agent': 'rudi-cli/2.0' }
    });
    if (tsconfigResponse.ok) {
      const tsconfig = await tsconfigResponse.text();
      fs.writeFileSync(path.join(destPath, 'tsconfig.json'), tsconfig);
    }
  }

  // Download requirements.txt if it exists (Python)
  const requirementsItem = existingItems.get('requirements.txt');
  if (requirementsItem) {
    const reqResponse = await fetch(requirementsItem.download_url, {
      headers: { 'User-Agent': 'rudi-cli/2.0' }
    });
    if (reqResponse.ok) {
      const requirements = await reqResponse.text();
      fs.writeFileSync(path.join(destPath, 'requirements.txt'), requirements);
    }
  }

  // Download source directories - check for common patterns
  const sourceDirs = ['src', 'dist', 'node', 'python', 'lib'];
  for (const dirName of sourceDirs) {
    const dirItem = existingItems.get(dirName);
    if (dirItem && dirItem.type === 'dir') {
      onProgress?.({ phase: 'downloading', directory: dirName });
      await downloadDirectoryFromGitHub(
        `${baseUrl}/${dirName}`,
        path.join(destPath, dirName),
        onProgress
      );
    }
  }
}

/**
 * Download a directory from GitHub using the GitHub API
 * Note: This uses the GitHub Contents API to list files
 */
async function downloadDirectoryFromGitHub(dirUrl, destDir, onProgress) {
  // Convert raw URL to API URL
  // From: https://raw.githubusercontent.com/learnrudi/registry/main/catalog/stacks/slack/src
  // To: https://api.github.com/repos/learnrudi/registry/contents/catalog/stacks/slack/src
  const apiUrl = dirUrl
    .replace('https://raw.githubusercontent.com/', 'https://api.github.com/repos/')
    .replace('/main/', '/contents/');

  try {
    const response = await fetch(apiUrl, {
      headers: {
        'User-Agent': 'rudi-cli/2.0',
        'Accept': 'application/vnd.github.v3+json'
      }
    });

    if (!response.ok) {
      // Directory might not exist, that's okay
      return;
    }

    const contents = await response.json();

    if (!Array.isArray(contents)) {
      // Single file, not a directory
      return;
    }

    // Create destination directory
    if (!fs.existsSync(destDir)) {
      fs.mkdirSync(destDir, { recursive: true });
    }

    for (const item of contents) {
      if (item.type === 'file') {
        // Download file
        const fileResponse = await fetch(item.download_url, {
          headers: { 'User-Agent': 'rudi-cli/2.0' }
        });
        if (fileResponse.ok) {
          const content = await fileResponse.text();
          fs.writeFileSync(path.join(destDir, item.name), content);
          onProgress?.({ phase: 'downloading', file: item.name });
        }
      } else if (item.type === 'dir') {
        // Recursively download subdirectory
        await downloadDirectoryFromGitHub(
          item.url.replace('https://api.github.com/repos/', 'https://raw.githubusercontent.com/').replace('/contents/', '/main/'),
          path.join(destDir, item.name),
          onProgress
        );
      }
    }
  } catch (error) {
    // Directory download failed, might not exist
    console.error(`Warning: Could not download ${dirUrl}: ${error.message}`);
  }
}

/**
 * Runtime release version - all runtimes are in a single release
 */
export const RUNTIMES_RELEASE_VERSION = 'v1.0.0';

/**
 * Download a runtime binary from GitHub releases
 * @param {string} runtime - Runtime name (e.g., 'python', 'node')
 * @param {string} version - Version (e.g., '3.12', '20.10.0')
 * @param {string} destPath - Destination path
 * @param {Object} options
 * @param {Function} [options.onProgress] - Progress callback
 * @returns {Promise<{ success: boolean, path: string }>}
 */
export async function downloadRuntime(runtime, version, destPath, options = {}) {
  const { onProgress } = options;
  const platformArch = getPlatformArch();

  // Try to load runtime manifest for custom download URLs
  const runtimeManifest = await loadRuntimeManifest(runtime);
  const customDownload = runtimeManifest?.download?.[platformArch];

  // Create temp directory for download
  const tempDir = path.join(PATHS.cache, 'downloads');
  if (!fs.existsSync(tempDir)) {
    fs.mkdirSync(tempDir, { recursive: true });
  }

  // Create destination directory
  if (fs.existsSync(destPath)) {
    fs.rmSync(destPath, { recursive: true });
  }
  fs.mkdirSync(destPath, { recursive: true });

  let url;
  let downloadType;

  if (customDownload) {
    // Use custom download URL from manifest (e.g., Ollama)
    url = typeof customDownload === 'string' ? customDownload : customDownload.url;
    downloadType = customDownload.type || 'tar.gz';
  } else {
    // Fall back to RUDI-hosted runtimes (Node, Python, etc.)
    const shortVersion = version.replace(/\.x$/, '').replace(/\.0$/, '');
    const filename = `${runtime}-${shortVersion}-${platformArch}.tar.gz`;
    url = `${RUNTIMES_DOWNLOAD_BASE}/${RUNTIMES_RELEASE_VERSION}/${filename}`;
    downloadType = 'tar.gz';
  }

  onProgress?.({ phase: 'downloading', runtime, version, url });

  const tempFile = path.join(tempDir, `${runtime}-${version}-${platformArch}.download`);

  try {
    // Download the file (follow redirects with curl for GitHub releases)
    if (url.includes('github.com')) {
      // Use curl for GitHub releases to follow redirects properly
      runRegistryCommandPlan(createCurlDownloadCommand(url, tempFile), { stdio: 'pipe' });
    } else {
      const response = await fetch(url, {
        headers: {
          'User-Agent': 'rudi-cli/2.0',
          'Accept': 'application/octet-stream'
        }
      });

      if (!response.ok) {
        throw new Error(`Failed to download ${runtime}: HTTP ${response.status}`);
      }

      const buffer = await response.arrayBuffer();
      fs.writeFileSync(tempFile, Buffer.from(buffer));
    }

    onProgress?.({ phase: 'extracting', runtime, version });

    // Handle different download types
    if (downloadType === 'binary') {
      // Raw binary - just move and make executable
      const binaryName = runtimeManifest?.binary || runtime;
      const binaryPath = path.join(destPath, binaryName);
      fs.renameSync(tempFile, binaryPath);
      fs.chmodSync(binaryPath, 0o755);
    } else if (downloadType === 'tar.gz' || downloadType === 'tgz') {
      runRegistryCommandPlan(createRegistryArchiveExtractCommand(downloadType, tempFile, destPath, {
        stripComponents: 1,
      }), { stdio: 'pipe' });
      fs.unlinkSync(tempFile);
    } else if (downloadType === 'tar.xz') {
      runRegistryCommandPlan(createRegistryArchiveExtractCommand(downloadType, tempFile, destPath, {
        stripComponents: 1,
      }), { stdio: 'pipe' });
      fs.unlinkSync(tempFile);
    } else if (downloadType === 'zip') {
      runRegistryCommandPlan(createRegistryArchiveExtractCommand(downloadType, tempFile, destPath), { stdio: 'pipe' });
      fs.unlinkSync(tempFile);
    } else {
      throw new Error(`Unsupported download type: ${downloadType}`);
    }

    // Write runtime metadata
    fs.writeFileSync(
      path.join(destPath, 'runtime.json'),
      JSON.stringify({
        runtime,
        version,
        platformArch,
        downloadedAt: new Date().toISOString(),
        source: url,
        ...(runtimeManifest?.commands && { commands: runtimeManifest.commands }),
        ...(runtimeManifest?.postInstall && { postInstall: runtimeManifest.postInstall })
      }, null, 2)
    );

    onProgress?.({ phase: 'complete', runtime, version, path: destPath });

    return { success: true, path: destPath };

  } catch (error) {
    // Clean up on failure
    if (fs.existsSync(tempFile)) {
      fs.unlinkSync(tempFile);
    }
    throw new Error(`Failed to install ${runtime} ${version}: ${error.message}`);
  }
}

// =============================================================================
// TOOL DOWNLOAD (using upstream URLs from manifests)
// =============================================================================

/**
 * Download a binary using upstream URLs from the binary manifest
 * @param {string} toolName - Binary name (e.g., 'ffmpeg', 'pandoc')
 * @param {string} destPath - Destination path
 * @param {Object} options
 * @param {Function} [options.onProgress] - Progress callback
 * @returns {Promise<{ success: boolean, path: string }>}
 */
export async function downloadTool(toolName, destPath, options = {}) {
  const { onProgress } = options;
  const platformArch = getPlatformArch();

  // Load the binary manifest from the registry
  const toolManifest = await loadToolManifest(toolName);
  if (!toolManifest) {
    throw new Error(`Binary manifest not found for: ${toolName}`);
  }

  // Create temp directory for download
  const tempDir = path.join(PATHS.cache, 'downloads');
  if (!fs.existsSync(tempDir)) {
    fs.mkdirSync(tempDir, { recursive: true });
  }

  // Create destination directory
  if (fs.existsSync(destPath)) {
    fs.rmSync(destPath, { recursive: true });
  }
  fs.mkdirSync(destPath, { recursive: true });

  // Check for new multi-download format first
  const downloads = toolManifest.downloads?.[platformArch];

  if (downloads && Array.isArray(downloads)) {
    // New format: multiple downloads per platform
    const downloadedUrls = new Set(); // Track to avoid re-downloading same archive

    for (const download of downloads) {
      const { url, type, binary } = download;

      // Skip if we already downloaded this URL (e.g., Linux tar.xz has both ffmpeg and ffprobe)
      if (downloadedUrls.has(url)) {
        // Just extract the binary from already-extracted content
        await extractBinaryFromPath(destPath, binary, destPath);
        continue;
      }

      onProgress?.({ phase: 'downloading', tool: toolName, binary: path.basename(binary), url });

      const urlFilename = path.basename(new URL(url).pathname);
      const tempFile = path.join(tempDir, urlFilename);

      try {
        // Download the archive
        const response = await fetch(url, {
          headers: {
            'User-Agent': 'rudi-cli/2.0',
            'Accept': 'application/octet-stream'
          }
        });

        if (!response.ok) {
          throw new Error(`Failed to download ${binary}: HTTP ${response.status}`);
        }

        const buffer = await response.arrayBuffer();
        fs.writeFileSync(tempFile, Buffer.from(buffer));
        downloadedUrls.add(url);

        onProgress?.({ phase: 'extracting', tool: toolName, binary: path.basename(binary) });

        const archiveType = type || guessArchiveType(urlFilename);
        if (archiveType === 'raw') {
          installRawBinaryDownload(tempFile, destPath, binary || toolName, { chmod: download.chmod });
        } else {
          runRegistryCommandPlan(createRegistryArchiveExtractCommand(archiveType, tempFile, destPath), {
            stdio: 'pipe',
          });

          // Extract/move the specific binary to dest root
          await extractBinaryFromPath(destPath, binary, destPath);
        }

        // Clean up temp file
        fs.unlinkSync(tempFile);

      } catch (error) {
        if (fs.existsSync(tempFile)) {
          fs.unlinkSync(tempFile);
        }
        throw error;
      }
    }

    // Make all binaries executable
    const binaries = toolManifest.binaries || [toolName];
    for (const bin of binaries) {
      const binPath = path.join(destPath, bin);
      if (fs.existsSync(binPath)) {
        fs.chmodSync(binPath, 0o755);
      }
    }

  } else {
    // Legacy format: single upstream URL per platform
    const upstreamUrl = toolManifest.upstream?.[platformArch];
    if (!upstreamUrl) {
      throw new Error(`No upstream URL for ${toolName} on ${platformArch}`);
    }

    const extractConfig = toolManifest.extract?.[platformArch] || toolManifest.extract?.default;
    if (!extractConfig) {
      throw new Error(`No extract config for ${toolName} on ${platformArch}`);
    }

    onProgress?.({ phase: 'downloading', tool: toolName, url: upstreamUrl });

    const urlFilename = path.basename(new URL(upstreamUrl).pathname);
    const tempFile = path.join(tempDir, urlFilename);

    try {
      const response = await fetch(upstreamUrl, {
        headers: {
          'User-Agent': 'rudi-cli/2.0',
          'Accept': 'application/octet-stream'
        }
      });

      if (!response.ok) {
        throw new Error(`Failed to download ${toolName}: HTTP ${response.status}`);
      }

      const buffer = await response.arrayBuffer();
      fs.writeFileSync(tempFile, Buffer.from(buffer));

      onProgress?.({ phase: 'extracting', tool: toolName });

      const archiveType = extractConfig.type || guessArchiveType(urlFilename);
      const stripComponents = extractConfig.strip || 0;
      if (archiveType === 'raw') {
        installRawBinaryDownload(tempFile, destPath, extractConfig.binary || toolName, {
          chmod: extractConfig.chmod,
        });
      } else {
        runRegistryCommandPlan(createRegistryArchiveExtractCommand(archiveType, tempFile, destPath, {
          stripComponents,
        }), { stdio: 'pipe' });

        // Extract the binary
        await extractBinaryFromPath(destPath, extractConfig.binary || toolName, destPath);
      }

      // Make binaries executable
      const binaries = [toolName, ...(toolManifest.additionalBinaries || [])];
      for (const bin of binaries) {
        const binPath = path.join(destPath, bin);
        if (fs.existsSync(binPath)) {
          fs.chmodSync(binPath, 0o755);
        }
      }

      fs.unlinkSync(tempFile);

    } catch (error) {
      if (fs.existsSync(tempFile)) {
        fs.unlinkSync(tempFile);
      }
      throw new Error(`Failed to install ${toolName}: ${error.message}`);
    }
  }

  // Write binary metadata
  fs.writeFileSync(
    path.join(destPath, 'manifest.json'),
    JSON.stringify({
      id: `binary:${toolName}`,
      kind: 'binary',
      name: toolManifest.name || toolName,
      version: toolManifest.version,
      binaries: toolManifest.bins || toolManifest.binaries || [toolName],
      platformArch,
      installedAt: new Date().toISOString()
    }, null, 2)
  );

  onProgress?.({ phase: 'complete', tool: toolName, path: destPath });

  return { success: true, path: destPath };
}

/**
 * Extract a binary from an extracted archive to the destination root
 * Handles glob patterns like "ffmpeg-*-amd64-static/ffmpeg"
 */
async function extractBinaryFromPath(extractedPath, binaryPattern, destPath) {
  // If binary is already at root, nothing to do
  const directPath = path.join(destPath, path.basename(binaryPattern));
  if (!binaryPattern.includes('/') && !binaryPattern.includes('*')) {
    if (fs.existsSync(directPath)) {
      return; // Already in place
    }
  }

  // Handle glob patterns
  if (binaryPattern.includes('*') || binaryPattern.includes('/')) {
    const parts = binaryPattern.split('/');
    let currentPath = extractedPath;

    for (let i = 0; i < parts.length; i++) {
      const part = parts[i];
      if (part.includes('*')) {
        // Find matching directory/file
        if (!fs.existsSync(currentPath)) break;
        const entries = fs.readdirSync(currentPath);
        const pattern = new RegExp('^' + part.replace(/\*/g, '.*') + '$');
        const match = entries.find(e => pattern.test(e));
        if (match) {
          currentPath = path.join(currentPath, match);
        } else {
          break;
        }
      } else {
        currentPath = path.join(currentPath, part);
      }
    }

    // Move the binary to the dest root if found
    if (fs.existsSync(currentPath) && currentPath !== destPath) {
      const finalPath = path.join(destPath, path.basename(currentPath));
      if (currentPath !== finalPath && !fs.existsSync(finalPath)) {
        fs.renameSync(currentPath, finalPath);
      }
    }
  }
}

/**
 * Load a runtime manifest from the registry
 * @param {string} runtimeName - Runtime name (e.g., 'ollama', 'node')
 * @returns {Promise<Object|null>}
 */
async function loadRuntimeManifest(runtimeName) {
  // Try local registry first
  for (const basePath of getLocalRegistryPaths()) {
    const registryDir = path.dirname(basePath);
    const manifestPath = path.join(registryDir, 'catalog', 'runtimes', `${runtimeName}.json`);

    if (fs.existsSync(manifestPath)) {
      try {
        return JSON.parse(fs.readFileSync(manifestPath, 'utf-8'));
      } catch {
        continue;
      }
    }
  }

  // Try fetching from GitHub raw
  try {
    const url = `https://raw.githubusercontent.com/learnrudi/registry/main/catalog/runtimes/${runtimeName}.json`;
    const response = await fetch(url, {
      headers: {
        'User-Agent': 'rudi-cli/2.0',
        'Accept': 'application/json'
      }
    });

    if (response.ok) {
      return await response.json();
    }
  } catch {
    // Ignore fetch errors
  }

  return null;
}

/**
 * Load a binary manifest from the registry
 * @param {string} toolName - Binary name
 * @returns {Promise<Object|null>}
 */
async function loadToolManifest(toolName) {
  // Try local registry first
  for (const basePath of getLocalRegistryPaths()) {
    const registryDir = path.dirname(basePath);
    const manifestPath = path.join(registryDir, 'catalog', 'binaries', `${toolName}.json`);

    if (fs.existsSync(manifestPath)) {
      try {
        return JSON.parse(fs.readFileSync(manifestPath, 'utf-8'));
      } catch {
        continue;
      }
    }
  }

  // Try fetching from GitHub raw
  try {
    const url = `https://raw.githubusercontent.com/learnrudi/registry/main/catalog/binaries/${toolName}.json`;
    const response = await fetch(url, {
      headers: {
        'User-Agent': 'rudi-cli/2.0',
        'Accept': 'application/json'
      }
    });

    if (response.ok) {
      return await response.json();
    }
  } catch {
    // Ignore fetch errors
  }

  return null;
}

/**
 * Guess archive type from filename
 */
function guessArchiveType(filename) {
  if (filename.endsWith('.tar.gz') || filename.endsWith('.tgz')) return 'tar.gz';
  if (filename.endsWith('.tar.xz')) return 'tar.xz';
  if (filename.endsWith('.zip')) return 'zip';
  return 'tar.gz'; // default
}

// =============================================================================
// VERIFICATION
// =============================================================================

/**
 * Verify a file's SHA256 hash
 * @param {string} filePath - Path to file
 * @param {string} expectedHash - Expected SHA256 hash
 * @returns {Promise<boolean>}
 */
export async function verifyHash(filePath, expectedHash) {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash('sha256');
    const stream = fs.createReadStream(filePath);

    stream.on('data', data => hash.update(data));
    stream.on('end', () => {
      const actualHash = hash.digest('hex');
      resolve(actualHash === expectedHash);
    });
    stream.on('error', reject);
  });
}

/**
 * Compute SHA256 hash of a file
 * @param {string} filePath - Path to file
 * @returns {Promise<string>}
 */
export async function computeHash(filePath) {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash('sha256');
    const stream = fs.createReadStream(filePath);

    stream.on('data', data => hash.update(data));
    stream.on('end', () => resolve(hash.digest('hex')));
    stream.on('error', reject);
  });
}

// =============================================================================
// UTILITIES
// =============================================================================

/**
 * Copy a directory recursively
 */
async function copyDirectory(src, dest) {
  fs.mkdirSync(dest, { recursive: true });

  const entries = fs.readdirSync(src, { withFileTypes: true });

  for (const entry of entries) {
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);

    if (entry.isDirectory()) {
      if (entry.name !== 'node_modules' && entry.name !== '.git') {
        await copyDirectory(srcPath, destPath);
      }
    } else {
      fs.copyFileSync(srcPath, destPath);
    }
  }
}
