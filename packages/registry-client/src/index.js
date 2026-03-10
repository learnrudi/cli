/**
 * @learnrudi/registry-client
 *
 * Registry client for fetching index, downloading packages, caching, and verification.
 * Handles all HTTP and caching concerns.
 */

import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { PATHS, getPlatformArch } from '@learnrudi/env';

// =============================================================================
// CONFIGURATION
// =============================================================================

/**
 * Default registry URL
 */
export const DEFAULT_REGISTRY_URL = 'https://raw.githubusercontent.com/learn-rudi/registry/main/index.json';

/**
 * Default downloads base URL (from registry repo releases)
 */
export const RUNTIMES_DOWNLOAD_BASE = 'https://github.com/learn-rudi/registry/releases/download';

/**
 * Cache TTL in milliseconds (1 hour)
 */
export const CACHE_TTL = 60 * 60 * 1000;

/**
 * Local registry paths (for development)
 * Set USE_LOCAL_REGISTRY=true environment variable to enable local development mode
 */
function getLocalRegistryPaths() {
  if (process.env.USE_LOCAL_REGISTRY !== 'true') {
    return [];
  }
  return [
    path.join(process.cwd(), 'registry', 'index.json'),
    path.join(process.cwd(), '..', 'registry', 'index.json'),
    '/Users/hoff/dev/RUDI/registry/index.json'
  ];
}

// =============================================================================
// INDEX FETCHING
// =============================================================================

/**
 * Fetch the registry index
 * @param {Object} options
 * @param {string} [options.url] - Registry URL
 * @param {boolean} [options.force] - Force refresh, ignore cache
 * @returns {Promise<Object>} Registry index
 */
export async function fetchIndex(options = {}) {
  const { url = DEFAULT_REGISTRY_URL, force = false } = options;

  // In development, prefer local registry if it's newer than cache
  const localResult = getLocalIndex();
  if (localResult) {
    const { index: localIndex, mtime: localMtime } = localResult;
    const cacheMtime = getCacheMtime();

    // Use local if: forcing, no cache, or local is newer
    if (force || !cacheMtime || localMtime > cacheMtime) {
      cacheIndex(localIndex);
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

  // Fetch from remote
  try {
    const response = await fetch(url, {
      headers: {
        'Accept': 'application/json',
        'User-Agent': 'rudi-cli/2.0'
      }
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }

    const index = await response.json();

    // Cache the result
    cacheIndex(index);

    return index;
  } catch (error) {
    // If remote fails, try local as last resort
    const fallback = getLocalIndex();
    if (fallback) {
      return fallback.index;
    }
    throw new Error(`Failed to fetch registry: ${error.message}`);
  }
}

/**
 * Get cached index if valid
 * @returns {Object|null}
 */
function getCachedIndex() {
  const cachePath = PATHS.registryCache;

  if (!fs.existsSync(cachePath)) {
    return null;
  }

  try {
    const stat = fs.statSync(cachePath);
    const age = Date.now() - stat.mtimeMs;

    if (age > CACHE_TTL) {
      return null; // Cache expired
    }

    return JSON.parse(fs.readFileSync(cachePath, 'utf-8'));
  } catch {
    return null;
  }
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
export const PACKAGE_KINDS = ['stack', 'prompt', 'runtime', 'binary', 'agent'];

const KIND_PLURALS = {
  binary: 'binaries'
};

function getKindSection(kind) {
  return KIND_PLURALS[kind] || `${kind}s`;
}

/**
 * Search packages in the registry
 * @param {string} query - Search query
 * @param {Object} options
 * @param {string} [options.kind] - Filter by kind
 * @returns {Promise<Array>}
 */
export async function searchPackages(query, options = {}) {
  const { kind } = options;
  const index = await fetchIndex();

  const results = [];
  const queryLower = query.toLowerCase();

  const kinds = kind ? [kind] : PACKAGE_KINDS;

  for (const k of kinds) {
    const section = index.packages?.[getKindSection(k)];
    if (!section) continue;

    const packages = [...(section.official || []), ...(section.community || [])];

    for (const pkg of packages) {
      if (matchesQuery(pkg, queryLower)) {
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
  const [kind, name] = id.includes(':') ? id.split(':') : [null, id];

  const kinds = kind ? [kind] : PACKAGE_KINDS;

  for (const k of kinds) {
    const section = index.packages?.[getKindSection(k)];
    if (!section) continue;

    const packages = [...(section.official || []), ...(section.community || [])];

    for (const pkg of packages) {
      const kindPrefixPattern = new RegExp(`^(${PACKAGE_KINDS.join('|')}):`);
      const pkgShortId = pkg.id?.replace(kindPrefixPattern, '') || '';
      if (pkgShortId === name || pkg.id === id) {
        return { ...pkg, kind: k };
      }
    }
  }

  return null;
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

  // Try local registry first (development mode)
  if (process.env.USE_LOCAL_REGISTRY === 'true') {
    const localPaths = [
      path.join(process.cwd(), 'registry', manifestPath),
      path.join(process.cwd(), '..', 'registry', manifestPath),
      `/Users/hoff/dev/RUDI/registry/${manifestPath}`
    ];

    for (const localPath of localPaths) {
      if (fs.existsSync(localPath)) {
        // If path is a directory, look for manifest.json inside it
        const filePath = fs.statSync(localPath).isDirectory()
          ? path.join(localPath, 'manifest.json')
          : localPath;
        try {
          const content = fs.readFileSync(filePath, 'utf-8');
          return JSON.parse(content);
        } catch (err) {
          // Skip invalid JSON or missing manifest.json
        }
      }
    }
  }

  // Fetch from remote (GitHub raw)
  try {
    const remotePath = manifestPath.endsWith('.json') ? manifestPath : `${manifestPath}/manifest.json`;
    const url = `${GITHUB_RAW_BASE}/${remotePath}`;
    const response = await fetch(url, {
      headers: {
        'Accept': 'application/json',
        'User-Agent': 'rudi-cli/2.0'
      }
    });

    if (!response.ok) {
      return null;
    }

    return await response.json();
  } catch (err) {
    return null;
  }
}

/**
 * List all packages of a specific kind
 * @param {'stack' | 'prompt' | 'runtime' | 'binary' | 'agent'} kind
 * @returns {Promise<Array>}
 */
export async function listPackages(kind) {
  const index = await fetchIndex();
  const section = index.packages?.[getKindSection(kind)];
  if (!section) return [];
  return [...(section.official || []), ...(section.community || [])];
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

/**
 * GitHub raw content base URL
 */
const GITHUB_RAW_BASE = 'https://raw.githubusercontent.com/learn-rudi/registry/main';

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

  const registryPath = pkg.path; // e.g., 'catalog/stacks/slack' or 'catalog/prompts/code-review.md'

  // Create destination directory
  if (!fs.existsSync(destPath)) {
    fs.mkdirSync(destPath, { recursive: true });
  }

  onProgress?.({ phase: 'downloading', package: pkg.name || pkg.id });

  // For stacks, download source files from GitHub raw
  if (pkg.kind === 'stack' || registryPath.includes('/stacks/')) {
    await downloadStackFromGitHub(registryPath, destPath, onProgress);
    return { success: true, path: destPath };
  }

  // For single file packages (prompts)
  if (registryPath.endsWith('.md')) {
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
    fs.writeFileSync(destPath, content);
    return { success: true, path: destPath };
  }

  throw new Error(`Unsupported package type: ${registryPath}`);
}

/**
 * Download a stack from GitHub raw content
 * Downloads manifest.json, package.json, and source files
 */
async function downloadStackFromGitHub(registryPath, destPath, onProgress) {
  const baseUrl = `${GITHUB_RAW_BASE}/${registryPath}`;

  // First, list the directory contents using GitHub API to see what exists
  const apiUrl = `https://api.github.com/repos/learn-rudi/registry/contents/${registryPath}`;
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

  // Download manifest.json (required)
  const manifestItem = existingItems.get('manifest.json');
  if (!manifestItem) {
    throw new Error(`Stack missing manifest.json: ${registryPath}`);
  }

  const manifestResponse = await fetch(manifestItem.download_url, {
    headers: { 'User-Agent': 'rudi-cli/2.0' }
  });
  const manifest = await manifestResponse.json();
  fs.writeFileSync(path.join(destPath, 'manifest.json'), JSON.stringify(manifest, null, 2));
  onProgress?.({ phase: 'downloading', file: 'manifest.json' });

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
  // From: https://raw.githubusercontent.com/learn-rudi/registry/main/catalog/stacks/slack/src
  // To: https://api.github.com/repos/learn-rudi/registry/contents/catalog/stacks/slack/src
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
  const { execSync } = await import('child_process');

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
      execSync(`curl -sL "${url}" -o "${tempFile}"`, { stdio: 'pipe' });
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
      execSync(`tar -xzf "${tempFile}" -C "${destPath}" --strip-components=1`, { stdio: 'pipe' });
      fs.unlinkSync(tempFile);
    } else if (downloadType === 'tar.xz') {
      execSync(`tar -xJf "${tempFile}" -C "${destPath}" --strip-components=1`, { stdio: 'pipe' });
      fs.unlinkSync(tempFile);
    } else if (downloadType === 'zip') {
      execSync(`unzip -o "${tempFile}" -d "${destPath}"`, { stdio: 'pipe' });
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

  const { execSync } = await import('child_process');

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

        // Extract based on archive type
        const archiveType = type || guessArchiveType(urlFilename);

        if (archiveType === 'zip') {
          execSync(`unzip -o "${tempFile}" -d "${destPath}"`, { stdio: 'pipe' });
        } else if (archiveType === 'tar.xz') {
          execSync(`tar -xJf "${tempFile}" -C "${destPath}"`, { stdio: 'pipe' });
        } else if (archiveType === 'tar.gz' || archiveType === 'tgz') {
          execSync(`tar -xzf "${tempFile}" -C "${destPath}"`, { stdio: 'pipe' });
        } else {
          throw new Error(`Unsupported archive type: ${archiveType}`);
        }

        // Extract/move the specific binary to dest root
        await extractBinaryFromPath(destPath, binary, destPath);

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
      const stripFlag = stripComponents > 0 ? ` --strip-components=${stripComponents}` : '';

      if (archiveType === 'zip') {
        execSync(`unzip -o "${tempFile}" -d "${destPath}"`, { stdio: 'pipe' });
      } else if (archiveType === 'tar.xz') {
        execSync(`tar -xJf "${tempFile}" -C "${destPath}"${stripFlag}`, { stdio: 'pipe' });
      } else if (archiveType === 'tar.gz' || archiveType === 'tgz') {
        execSync(`tar -xzf "${tempFile}" -C "${destPath}"${stripFlag}`, { stdio: 'pipe' });
      } else {
        throw new Error(`Unsupported archive type: ${archiveType}`);
      }

      // Extract the binary
      await extractBinaryFromPath(destPath, extractConfig.binary || toolName, destPath);

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
    const url = `https://raw.githubusercontent.com/learn-rudi/registry/main/catalog/runtimes/${runtimeName}.json`;
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
    const url = `https://raw.githubusercontent.com/learn-rudi/registry/main/catalog/binaries/${toolName}.json`;
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
