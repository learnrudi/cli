/**
 * Dependency checker for RUDI
 * Validates that required runtimes and binaries are available
 */

import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';
import { PATHS } from '@learnrudi/env';
import { fetchIndex } from '@learnrudi/registry-client';

/**
 * Check if a runtime is available (RUDI-managed or system)
 * @param {string} runtime - Runtime name (node, python, deno, bun)
 * @returns {{ available: boolean, path: string, version: string, source: 'rudi' | 'system' | null }}
 */
export function checkRuntime(runtime) {
  const name = runtime.replace(/^runtime:/, '');

  // Check RUDI-managed runtime first
  const rudiPath = path.join(PATHS.runtimes, name);
  if (fs.existsSync(rudiPath)) {
    const binPath = getBinPath(rudiPath, name);
    if (binPath && fs.existsSync(binPath)) {
      const version = getVersion(binPath, name);
      return { available: true, path: binPath, version, source: 'rudi' };
    }
  }

  // Fall back to system
  const systemCmd = getSystemCommand(name);
  const systemPath = which(systemCmd);
  if (systemPath) {
    const version = getVersion(systemPath, name);
    return { available: true, path: systemPath, version, source: 'system' };
  }

  return { available: false, path: null, version: null, source: null };
}

/**
 * Check if a binary is available (RUDI-managed or system)
 * @param {string} binary - Binary name (ffmpeg, ripgrep, etc.)
 * @returns {{ available: boolean, path: string, version: string, source: 'rudi' | 'system' | null }}
 */
export function checkBinary(binary) {
  const name = binary.replace(/^binary:/, '');

  // Check RUDI-managed binary first
  const rudiPath = path.join(PATHS.binaries, name);
  if (fs.existsSync(rudiPath)) {
    const binPath = getBinPath(rudiPath, name);
    if (binPath && fs.existsSync(binPath)) {
      const version = getVersion(binPath, name);
      return { available: true, path: binPath, version, source: 'rudi' };
    }
  }

  // Fall back to system
  const systemPath = which(name);
  if (systemPath) {
    const version = getVersion(systemPath, name);
    return { available: true, path: systemPath, version, source: 'system' };
  }

  return { available: false, path: null, version: null, source: null };
}

/**
 * Check all dependencies for a resolved package
 * @param {Object} resolved - Resolved package from resolver
 * @returns {{ satisfied: boolean, results: Array }}
 */
export function checkAllDependencies(resolved) {
  const results = [];
  let satisfied = true;

  // Check runtime (binary stacks are self-contained — no runtime dependency)
  if (resolved.runtime && resolved.runtime !== 'binary') {
    const runtime = resolved.runtime.replace(/^runtime:/, '');
    const check = checkRuntime(runtime);
    results.push({
      type: 'runtime',
      name: runtime,
      required: true,
      ...check
    });
    if (!check.available) satisfied = false;
  }

  // Check required runtimes
  for (const rt of resolved.requires?.runtimes || []) {
    const name = rt.replace(/^runtime:/, '');
    const check = checkRuntime(name);
    results.push({
      type: 'runtime',
      name,
      required: true,
      ...check
    });
    if (!check.available) satisfied = false;
  }

  // Check required binaries
  for (const bin of resolved.requires?.binaries || []) {
    const name = bin.replace(/^binary:/, '');
    const check = checkBinary(name);
    results.push({
      type: 'binary',
      name,
      required: true,
      ...check
    });
    if (!check.available) satisfied = false;
  }

  return { satisfied, results };
}

/**
 * Format dependency check results for display
 * @param {Array} results - Results from checkAllDependencies
 * @returns {string[]} Lines to display
 */
export function formatDependencyResults(results) {
  const lines = [];

  for (const r of results) {
    const icon = r.available ? '✓' : '✗';
    const version = r.version ? ` v${r.version}` : '';
    const source = r.source ? ` (${r.source})` : '';
    const status = r.available
      ? `${icon} ${r.name}${version}${source}`
      : `${icon} ${r.name} - not found`;
    lines.push(`  ${status}`);
  }

  return lines;
}

// Helper: Get binary path within a RUDI-managed directory
function getBinPath(baseDir, name) {
  const arch = process.arch === 'arm64' ? 'arm64' : 'x64';
  const isWindows = process.platform === 'win32';
  const ext = isWindows ? '.exe' : '';

  // Map runtime names to executables
  const exeMap = {
    node: 'node',
    python: 'python3',
    deno: 'deno',
    bun: 'bun',
    ffmpeg: 'ffmpeg',
    ripgrep: 'rg',
    sqlite: 'sqlite3',
    jq: 'jq',
    yq: 'yq'
  };

  const exe = exeMap[name] || name;

  // Try arch-specific path
  const archPath = path.join(baseDir, arch, 'bin', exe + ext);
  if (fs.existsSync(archPath)) return archPath;

  // Try flat bin path
  const flatPath = path.join(baseDir, 'bin', exe + ext);
  if (fs.existsSync(flatPath)) return flatPath;

  // Try direct path (for single-binary tools)
  const directPath = path.join(baseDir, exe + ext);
  if (fs.existsSync(directPath)) return directPath;

  return null;
}

// Helper: Get system command name
function getSystemCommand(name) {
  const cmdMap = {
    python: 'python3',
    node: 'node',
    deno: 'deno',
    bun: 'bun'
  };
  return cmdMap[name] || name;
}

// Helper: Find executable in PATH
function which(cmd) {
  try {
    const result = execSync(`which ${cmd} 2>/dev/null`, { encoding: 'utf-8' });
    return result.trim();
  } catch {
    return null;
  }
}

// Helper: Get version from executable
function getVersion(binPath, name) {
  const versionFlags = {
    node: '--version',
    python: '--version',
    python3: '--version',
    deno: '--version',
    bun: '--version',
    ffmpeg: '-version',
    rg: '--version',
    ripgrep: '--version',
    sqlite3: '--version',
    jq: '--version',
    yq: '--version'
  };

  const flag = versionFlags[name] || '--version';

  try {
    const output = execSync(`"${binPath}" ${flag} 2>&1`, { encoding: 'utf-8' });
    // Extract version number (first match of semver-like pattern)
    const match = output.match(/(\d+\.\d+(?:\.\d+)?)/);
    return match ? match[1] : output.split('\n')[0].trim();
  } catch {
    return null;
  }
}

/**
 * Get summary of all available runtimes and binaries
 * Dynamically scans ~/.rudi directories + checks common system tools
 * @returns {{ runtimes: Array, binaries: Array }}
 */
export function getAvailableDeps() {
  // Start with what's installed in ~/.rudi
  const installedRuntimes = scanDirectory(PATHS.runtimes);
  const installedBinaries = scanDirectory(PATHS.binaries);

  // Common runtimes/binaries to also check on system PATH
  const commonRuntimes = ['node', 'python', 'deno', 'bun'];
  const commonBinaries = ['ffmpeg', 'ripgrep', 'sqlite3', 'jq', 'yq', 'git', 'docker', 'rg'];

  // Merge installed + common (dedupe)
  const runtimeNames = [...new Set([...installedRuntimes, ...commonRuntimes])];
  const binaryNames = [...new Set([...installedBinaries, ...commonBinaries])];

  const runtimes = runtimeNames.map(name => ({
    name,
    ...checkRuntime(name)
  }));

  const binaries = binaryNames
    .filter(name => name !== 'rg') // ripgrep alias, skip duplicate
    .map(name => ({
      name,
      ...checkBinary(name)
    }));

  return { runtimes, binaries };
}

/**
 * Scan a directory for installed packages
 * @param {string} dir - Directory to scan
 * @returns {string[]} List of package names
 */
function scanDirectory(dir) {
  if (!fs.existsSync(dir)) return [];

  try {
    return fs.readdirSync(dir, { withFileTypes: true })
      .filter(entry => entry.isDirectory() && !entry.name.startsWith('.'))
      .map(entry => entry.name);
  } catch {
    return [];
  }
}

/**
 * Get all runtimes and binaries from the registry
 * Shows what's available to install + current status
 * @returns {Promise<{ runtimes: Array, binaries: Array }>}
 */
export async function getAllDepsFromRegistry() {
  const index = await fetchIndex();

  const runtimes = (index.packages?.runtimes?.official || []).map(rt => {
    const name = rt.id.replace(/^runtime:/, '');
    const check = checkRuntime(name);
    return {
      name,
      registryVersion: rt.version,
      description: rt.description,
      ...check,
      status: check.available
        ? (check.source === 'rudi' ? 'installed' : 'system')
        : 'available'
    };
  });

  const binaries = (index.packages?.binaries?.official || []).map(bin => {
    const name = bin.id.replace(/^binary:/, '');
    const check = checkBinary(name);
    return {
      name,
      registryVersion: bin.version,
      description: bin.description,
      managed: bin.managed !== false,
      ...check,
      status: check.available
        ? (check.source === 'rudi' ? 'installed' : 'system')
        : 'available'
    };
  });

  return { runtimes, binaries };
}
