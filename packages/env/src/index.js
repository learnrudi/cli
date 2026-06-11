/**
 * @learnrudi/env
 *
 * Environment configuration, paths, and platform detection.
 * This package has NO dependencies - it's the foundation.
 *
 * © 2026 RUDI LLC. All rights reserved.
 */

import path from 'path';
import os from 'os';
import fs from 'fs';

// =============================================================================
// PATHS
// =============================================================================

/**
 * Root directory for all RUDI data
 */
export const RUDI_HOME = process.env.RUDI_HOME
  ? path.resolve(process.env.RUDI_HOME)
  : path.join(os.homedir(), '.rudi');

/**
 * Claude Code home directory. RUDI may discover skills from this directory, but
 * does not own or mutate it.
 */
export const CLAUDE_HOME = process.env.CLAUDE_HOME
  ? path.resolve(process.env.CLAUDE_HOME)
  : path.join(os.homedir(), '.claude');

/**
 * All standard paths
 */
export const PATHS = {
  // Root
  home: RUDI_HOME,

  // Installed packages - shared with Studio for unified discovery
  packages: path.join(RUDI_HOME, 'packages'),
  stacks: path.join(RUDI_HOME, 'stacks'),     // Shared with Studio
  skills: path.join(RUDI_HOME, 'skills'),     // Shared with Studio
  prompts: path.join(RUDI_HOME, 'skills'),    // Backward compat alias -> skills
  workflows: path.join(RUDI_HOME, 'workflows'),

  // Runtimes (interpreters: node, python, deno, bun)
  runtimes: path.join(RUDI_HOME, 'runtimes'),

  // Binaries (utility CLIs: ffmpeg, imagemagick, ripgrep, etc.)
  binaries: path.join(RUDI_HOME, 'binaries'),

  // Agents (AI CLI tools: claude, codex, gemini, copilot, ollama)
  agents: path.join(RUDI_HOME, 'agents'),

  // Runtime binaries (content-addressed)
  store: path.join(RUDI_HOME, 'store'),

  // Shims (symlinks to store/)
  bins: path.join(RUDI_HOME, 'bins'),

  // Lockfiles
  locks: path.join(RUDI_HOME, 'locks'),

  // Secrets (OS Keychain preferred, encrypted file fallback)
  vault: path.join(RUDI_HOME, 'vault'),

  // Database (shared with Studio)
  db: RUDI_HOME,
  dbFile: path.join(RUDI_HOME, 'rudi.db'),

  // Cache
  cache: path.join(RUDI_HOME, 'cache'),
  registryCache: path.join(RUDI_HOME, 'cache', 'registry.json'),

  // Config
  config: path.join(RUDI_HOME, 'config.json'),

  // Logs
  logs: path.join(RUDI_HOME, 'logs')
};

// =============================================================================
// INSTALL ROOT
// =============================================================================

/**
 * Get the install root directory
 * @returns {string}
 */
export function getInstallRoot() {
  return RUDI_HOME;
}

/**
 * Get the bins directory (where shims live)
 * @returns {string}
 */
export function getBinsDir() {
  return PATHS.bins;
}

/**
 * Get the store directory (where binaries live)
 * @returns {string}
 */
export function getStoreDir() {
  return PATHS.store;
}

/**
 * Get the Node runtime root (global npm prefix for RUDI-managed agents)
 * @returns {string}
 */
export function getNodeRuntimeRoot() {
  return path.join(PATHS.runtimes, 'node');
}

/**
 * Resolve a binary inside the RUDI-managed Node runtime
 * Prefer arch-specific layout, fall back to flat layout
 * @param {string} binName
 * @returns {string}
 */
export function resolveNodeRuntimeBin(binName) {
  const root = getNodeRuntimeRoot();
  const isWindows = os.platform() === 'win32';
  const arch = os.arch() === 'arm64' ? 'arm64' : 'x64';
  const binDir = isWindows ? 'Scripts' : 'bin';
  const candidates = [];

  if (isWindows) {
    const names = [`${binName}.cmd`, `${binName}.exe`, binName];
    for (const name of names) {
      candidates.push(path.join(root, arch, binDir, name));
      candidates.push(path.join(root, binDir, name));
    }
  } else {
    candidates.push(path.join(root, arch, binDir, binName));
    candidates.push(path.join(root, binDir, binName));
  }

  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) {
      return candidate;
    }
  }

  // Default to flat layout if nothing exists yet
  return candidates[candidates.length - 1];
}

/**
 * Get the Node runtime bin directory
 * @returns {string}
 */
export function getNodeRuntimeBinDir() {
  return path.dirname(resolveNodeRuntimeBin('node'));
}

// =============================================================================
// PLATFORM DETECTION
// =============================================================================

/**
 * Get current platform-architecture string
 * @returns {string} e.g., 'darwin-arm64', 'linux-x64'
 */
export function getPlatformArch() {
  const platform = os.platform();
  const arch = os.arch();

  // Normalize architecture names
  const normalizedArch = arch === 'x64' ? 'x64' : arch === 'arm64' ? 'arm64' : arch;

  return `${platform}-${normalizedArch}`;
}

/**
 * Get platform name
 * @returns {'darwin' | 'linux' | 'win32' | string}
 */
export function getPlatform() {
  return os.platform();
}

/**
 * Get architecture
 * @returns {'arm64' | 'x64' | string}
 */
export function getArch() {
  return os.arch();
}

/**
 * Check if running on macOS
 * @returns {boolean}
 */
export function isMacOS() {
  return os.platform() === 'darwin';
}

/**
 * Check if running on Linux
 * @returns {boolean}
 */
export function isLinux() {
  return os.platform() === 'linux';
}

/**
 * Check if running on Windows
 * @returns {boolean}
 */
export function isWindows() {
  return os.platform() === 'win32';
}

// =============================================================================
// DIRECTORY MANAGEMENT
// =============================================================================

/**
 * Ensure all required directories exist
 */
export function ensureDirectories() {
  const dirs = [
    PATHS.stacks,      // MCP servers (google-ai, notion-workspace, etc.)
    PATHS.skills,      // Reusable skills (formerly prompts)
    PATHS.workflows,   // Repeatable workflow definitions
    PATHS.runtimes,    // Language runtimes (node, python, bun, deno)
    PATHS.binaries,    // Utility binaries (ffmpeg, git, jq, etc.)
    PATHS.agents,      // AI CLI agents (claude, codex, gemini, copilot)
    PATHS.bins,        // Shims directory (opt-in)
    PATHS.locks,       // Lock files
    PATHS.db,          // Database directory
    PATHS.cache        // Registry cache
  ];

  for (const dir of dirs) {
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
  }

  // Auto-migration: move .md files from prompts/ to skills/ if skills/ is empty
  const oldPromptsDir = path.join(RUDI_HOME, 'prompts');
  if (fs.existsSync(oldPromptsDir) && oldPromptsDir !== PATHS.skills) {
    try {
      const oldFiles = fs.readdirSync(oldPromptsDir).filter(f => f.endsWith('.md'));
      const newFiles = fs.existsSync(PATHS.skills)
        ? fs.readdirSync(PATHS.skills).filter(f => f.endsWith('.md'))
        : [];

      if (oldFiles.length > 0 && newFiles.length === 0) {
        console.log(`Migrating ${oldFiles.length} prompt(s) to skills directory...`);
        for (const file of oldFiles) {
          const oldPath = path.join(oldPromptsDir, file);
          const newPath = path.join(PATHS.skills, file);
          fs.copyFileSync(oldPath, newPath);
        }
      }
    } catch (err) {
      // Migration is best-effort, don't fail
      console.warn(`Warning: Could not migrate prompts to skills: ${err.message}`);
    }
  }
}

/**
 * Check if directories are initialized
 * @returns {boolean}
 */
export function areDirectoriesInitialized() {
  return fs.existsSync(PATHS.stacks) && fs.existsSync(PATHS.db);
}

// =============================================================================
// PACKAGE PATHS
// =============================================================================

/**
 * All valid package kinds
 */
export const PACKAGE_KINDS = ['stack', 'skill', 'prompt', 'workflow', 'runtime', 'binary', 'agent'];

/**
 * Parse a package ID into kind and name
 * @param {string} id - Package ID (e.g., 'stack:pdf-creator', 'binary:ffmpeg', 'agent:claude', 'npm:cowsay')
 * @returns {[string, string]} [kind, name]
 */
export function parsePackageId(id) {
  // Allow 'npm:' prefix for dynamic npm installs
  const match = id.match(/^(stack|skill|prompt|workflow|runtime|binary|agent|npm):(.+)$/);
  if (!match) {
    throw new Error(`Invalid package ID: ${id} (expected format: kind:name, where kind is one of: ${PACKAGE_KINDS.join(', ')}, npm)`);
  }
  // Map 'prompt' to 'skill' for backward compatibility
  const kind = match[1] === 'prompt' ? 'skill' : match[1];
  return [kind, match[2]];
}

/**
 * Create a package ID from kind and name
 * @param {string} kind - Package kind
 * @param {string} name - Package name
 * @returns {string} Full package ID
 */
export function createPackageId(kind, name) {
  return `${kind}:${name}`;
}

/**
 * Get skill roots in precedence order.
 * @param {{ includeExternal?: boolean }} options
 * @returns {Array<{source: 'rudi' | 'claude', path: string}>}
 */
export function getSkillDiscoveryRoots(options = {}) {
  const roots = [
    { source: 'rudi', path: PATHS.skills }
  ];

  if (options.includeExternal) {
    roots.push({ source: 'claude', path: path.join(CLAUDE_HOME, 'skills') });
  }

  return roots;
}

function readSkillCandidates(root) {
  if (!root?.path || !fs.existsSync(root.path)) return [];

  const candidates = [];

  for (const entry of fs.readdirSync(root.path, { withFileTypes: true })) {
    if (entry.name.startsWith('.')) continue;

    if (entry.isFile() && entry.name.endsWith('.md')) {
      const name = entry.name.replace(/\.md$/, '');
      const filePath = path.join(root.path, entry.name);
      candidates.push({
        name,
        source: root.source,
        format: 'flat',
        packagePath: filePath,
        entryPath: filePath
      });
      continue;
    }

    if (entry.isDirectory()) {
      const packagePath = path.join(root.path, entry.name);
      const entryPath = path.join(packagePath, 'SKILL.md');
      if (fs.existsSync(entryPath) && fs.statSync(entryPath).isFile()) {
        candidates.push({
          name: entry.name,
          source: root.source,
          format: 'directory',
          packagePath,
          entryPath
        });
      }
    }
  }

  return candidates;
}

/**
 * Discover skills in precedence order. RUDI skills win over external skills.
 * Within the same root, flat files keep backward-compatible precedence.
 * @param {{ includeExternal?: boolean }} options
 * @returns {Array<{name: string, source: string, format: string, packagePath: string, entryPath: string}>}
 */
export function discoverSkillPackages(options = {}) {
  const byName = new Map();

  for (const root of getSkillDiscoveryRoots(options)) {
    for (const candidate of readSkillCandidates(root)) {
      if (!byName.has(candidate.name)) {
        byName.set(candidate.name, candidate);
      }
    }
  }

  return Array.from(byName.values());
}

function findLocalSkillPackage(name) {
  return discoverSkillPackages().find(skill => skill.name === name) || null;
}

/**
 * Get path for an installed package
 * @param {string} id - Package ID (e.g., 'stack:pdf-creator', 'binary:ffmpeg', 'agent:claude')
 * @returns {string} Install path
 */
export function getPackagePath(id) {
  const [kind, name] = parsePackageId(id);

  switch (kind) {
    case 'stack':
      return path.join(PATHS.stacks, name);
    case 'skill': {
      const existingSkill = findLocalSkillPackage(name);
      return existingSkill?.packagePath || path.join(PATHS.skills, `${name}.md`);
    }
    case 'prompt':
      // Backward compat: prompts map to skills directory
      return path.join(PATHS.skills, `${name}.md`);
    case 'workflow':
      // Workflows are single YAML definition files, not directories
      return path.join(PATHS.workflows, `${name}.yaml`);
    case 'runtime':
      return path.join(PATHS.runtimes, name);
    case 'binary':
      return path.join(PATHS.binaries, name);
    case 'agent':
      return path.join(PATHS.agents, name);
    case 'npm':
      // Dynamic npm packages: npm/<sanitized-name>
      // e.g., npm:cowsay -> ~/.rudi/binaries/npm/cowsay
      // e.g., npm:@stripe/cli -> ~/.rudi/binaries/npm/@stripe__cli
      const sanitized = name.replace(/\//g, '__').replace(/^@/, '');
      return path.join(PATHS.binaries, 'npm', sanitized);
    default:
      throw new Error(`Unknown package kind: ${kind}`);
  }
}

/**
 * Get path for a lockfile
 * @param {string} id - Package ID
 * @returns {string} Lockfile path
 */
export function getLockfilePath(id) {
  const [kind, name] = parsePackageId(id);

  // Sanitize npm package names (same as install path)
  let lockName = name;
  if (kind === 'npm') {
    lockName = name.replace(/\//g, '__').replace(/^@/, '');
  }

  const lockDir = kind === 'binary' ? 'binaries' : kind === 'npm' ? 'npms' : kind + 's';
  return path.join(PATHS.locks, lockDir, `${lockName}.lock.yaml`);
}

/**
 * Get path for a runtime binary in store
 * @param {string} runtime - Runtime name (e.g., 'python')
 * @param {string} version - Version string
 * @returns {string} Binary path in store
 */
export function getRuntimeStorePath(runtime, version) {
  const platformArch = getPlatformArch();
  return path.join(PATHS.store, `${runtime}-${version}-${platformArch}`);
}

/**
 * Get path for a runtime shim
 * @param {string} command - Command name (e.g., 'python3')
 * @returns {string} Shim path
 */
export function getShimPath(command) {
  return path.join(PATHS.bins, command);
}

/**
 * Check if a package is installed
 * @param {string} id - Package ID
 * @returns {boolean}
 */
export function isPackageInstalled(id) {
  const packagePath = getPackagePath(id);
  const [kind, name] = parsePackageId(id);

  if (kind === 'skill') {
    return Boolean(findLocalSkillPackage(name));
  }

  // Skills, prompts, and workflows are single files
  if (kind === 'prompt' || kind === 'workflow') {
    return fs.existsSync(packagePath) && fs.statSync(packagePath).isFile();
  }

  // Check if folder exists
  if (!fs.existsSync(packagePath)) {
    return false;
  }

  // For agents (npm packages), check global npm bin in the Node runtime
  if (kind === 'agent') {
    const manifestPath = path.join(packagePath, 'manifest.json');
    let bins = [];

    if (fs.existsSync(manifestPath)) {
      try {
        const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf-8'));
        bins = manifest.bins || manifest.binaries || [];
      } catch {
        bins = [];
      }
    }

    if (bins.length === 0) {
      bins = [name];
    }

    return bins.some(bin => fs.existsSync(resolveNodeRuntimeBin(bin)));
  }

  // For other package types, just check folder is non-empty
  try {
    const contents = fs.readdirSync(packagePath);
    return contents.length > 0;
  } catch {
    return false;
  }
}

/**
 * Get list of installed packages by kind
 * @param {'stack' | 'skill' | 'prompt' | 'workflow' | 'runtime' | 'binary' | 'agent'} kind
 * @returns {string[]} Package names
 */
export function getInstalledPackages(kind) {
  const dir = {
    stack: PATHS.stacks,
    skill: PATHS.skills,
    prompt: PATHS.skills,  // Backward compat: prompts map to skills
    workflow: PATHS.workflows,
    runtime: PATHS.runtimes,
    binary: PATHS.binaries,
    agent: PATHS.agents
  }[kind];

  if (!dir || !fs.existsSync(dir)) {
    return [];
  }

  // Skills support both legacy name.md files and name/SKILL.md directories.
  if (kind === 'skill') {
    return discoverSkillPackages().map(skill => skill.name);
  }

  // Prompts are backward-compatible .md files in the skills directory.
  if (kind === 'prompt') {
    return fs.readdirSync(dir).filter(name => {
      if (!name.endsWith('.md') || name.startsWith('.')) return false;
      const stat = fs.statSync(path.join(dir, name));
      return stat.isFile();
    }).map(name => name.replace(/\.md$/, '')); // Return name without extension
  }

  if (kind === 'workflow') {
    return fs.readdirSync(dir).filter(name => {
      if (!/\.(ya?ml|json)$/.test(name) || name.startsWith('.')) return false;
      const stat = fs.statSync(path.join(dir, name));
      return stat.isFile();
    }).map(name => name.replace(/\.(ya?ml|json)$/, ''));
  }

  // Other packages are directories
  return fs.readdirSync(dir).filter(name => {
    const stat = fs.statSync(path.join(dir, name));
    return stat.isDirectory() && !name.startsWith('.');
  });
}
