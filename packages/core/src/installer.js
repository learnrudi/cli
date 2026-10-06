/**
 * Package installer for RUDI
 * Downloads, extracts, and installs packages
 */

import fs from 'fs';
import os from 'os';
import path from 'path';
import { execFileSync as defaultExecFileSync } from 'child_process';
import { pipeline } from 'stream/promises';
import { createWriteStream } from 'fs';
import { createGunzip } from 'zlib';
import { parsePackageMetadata, parseSkillDocument } from './package-metadata.js';
import {
  PATHS,
  discoverSkillPackages,
  getPackagePath,
  ensureDirectories,
  parsePackageId,
  getNodeRuntimeRoot,
  getPlatformArch
} from '@learnrudi/env';
import {
  downloadRuntime,
  downloadPackage,
  downloadResolvedPackage,
  downloadTool,
  verifyHash,
  describePackage,
  getAvailableRegistryIndex,
} from '@learnrudi/registry-client';
import { resolvePackage, getInstallOrder } from './resolver.js';
import { readLockfile, restoreLockfile, writeLockfile } from './lockfile.js';
import { createShimsForTool, removeShims } from './shims.js';
import { getNpmNodeRuntimeId, resolveNpmRuntimeBin } from './npm-runtime.js';
import { installRegistrySkill } from './skill-install.js';

const SINGLE_FILE_KINDS = new Set(['skill', 'prompt', 'workflow']);
const WORKFLOW_EXTENSIONS = ['.yaml', '.yml', '.json'];
const DEFAULT_STACK_STATE_PATHS = ['runs'];
const NPM_PACKAGE_PATTERN = /^(?:@[a-z0-9][a-z0-9._-]*\/)?[a-z0-9][a-z0-9._-]*(?:@[a-zA-Z0-9._~^>=<:+-][a-zA-Z0-9._~^>=<:+-]*)?$/;
const PIP_PACKAGE_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]*(?:\[[A-Za-z0-9_,.-]+])?(?:[<>=!~]=?[A-Za-z0-9.*+!_~:-]+)?$/;
const SHELL_CONTROL_PATTERN = /[|&;<>()`$\\\n\r]/;

export function getInstallPathForPackage(pkg) {
  if (!pkg || typeof pkg.id !== 'string') {
    throw new Error('Package metadata requires an id');
  }

  const [kind, name] = parsePackageId(pkg.id);
  if (
    kind === 'skill' &&
    typeof pkg.path === 'string' &&
    pkg.path.length > 0
  ) {
    return path.join(PATHS.skills, pkg.path.replaceAll('\\', '/').endsWith('.md') ? `${name}.md` : name);
  }

  return getPackagePath(pkg.id);
}

function assertCommandArg(value, label) {
  if (typeof value !== 'string' || value.length === 0 || value.includes('\0')) {
    throw new Error(`Invalid command ${label}`);
  }
  return value;
}

function assertNoShellControlSyntax(value, label) {
  assertCommandArg(value, label);
  if (SHELL_CONTROL_PATTERN.test(value)) {
    throw new Error(`Unsupported ${label}: shell control syntax is not allowed`);
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

export function runCommandPlan(plan, options = {}) {
  const { execFileSync = defaultExecFileSync, ...execOptions } = options;
  const { command, args } = normalizeCommandPlan(plan);
  return execFileSync(command, args, execOptions);
}

export function createArchiveExtractCommand(extractType, archivePath, destPath, options = {}) {
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

  if (extractType === 'tar.gz' || extractType === 'tgz') {
    return { command: 'tar', args: ['-xzf', archive, '-C', dest, ...withStrip] };
  }
  if (extractType === 'tar.xz') {
    return { command: 'tar', args: ['-xJf', archive, '-C', dest, ...withStrip] };
  }
  if (extractType === 'zip') {
    return { command: 'unzip', args: ['-o', archive, '-d', dest] };
  }

  throw new Error(`Unsupported extract type: ${extractType}`);
}

function assertNpmPackageName(packageName) {
  const value = assertCommandArg(packageName, 'npm package name');
  if (!NPM_PACKAGE_PATTERN.test(value)) {
    throw new Error(`Invalid npm package name: ${packageName}`);
  }
  return value;
}

function assertPipPackageSpec(packageSpec) {
  const value = assertCommandArg(packageSpec, 'pip package spec');
  if (!PIP_PACKAGE_PATTERN.test(value)) {
    throw new Error(`Invalid pip package spec: ${packageSpec}`);
  }
  return value;
}

export function createNpmInitCommand(npmCmd) {
  return { command: assertCommandArg(npmCmd, 'npm command'), args: ['init', '-y'] };
}

export function createNpmInstallCommand(options = {}) {
  const command = assertCommandArg(options.npmCmd, 'npm command');
  const packageName = assertNpmPackageName(options.packageName);
  const args = ['install'];

  if (options.global) {
    args.push('-g');
  }

  const version = options.version;
  if (version !== undefined && (typeof version !== 'string'
    || !/^[a-zA-Z0-9._~^>=<:+-]+$/.test(version))) {
    throw new Error('Invalid npm package version');
  }
  const alreadyVersioned = packageName.slice(1).includes('@');
  args.push(version && version !== 'latest' && !alreadyVersioned
    ? `${packageName}@${version}` : packageName);

  if (options.ignoreScripts) {
    args.push('--ignore-scripts');
  }

  args.push('--no-audit', '--no-fund');

  if (options.prefix) {
    args.push('--prefix', assertCommandArg(options.prefix, 'npm prefix'));
  }

  return { command, args };
}

export function createStackDependencyInstallCommand(manager, commandValue, options = {}) {
  const command = assertCommandArg(commandValue, `${manager} command`);
  let args;
  if (manager === 'pnpm') {
    args = ['install'];
    if (options.storeDir) {
      args.push('--store-dir', assertCommandArg(options.storeDir, 'pnpm store directory'));
    }
    args.push('--prefer-frozen-lockfile');
  } else if (manager === 'npm') {
    args = ['install', '--no-audit', '--no-fund'];
  } else {
    throw new Error(`Unsupported stack dependency manager: ${manager}`);
  }
  if (!options.allowScripts) args.push('--ignore-scripts');
  return { command, args };
}

export function createNpmUninstallCommand(options = {}) {
  const command = assertCommandArg(options.npmCmd, 'npm command');
  const packageName = assertNpmPackageName(options.packageName);
  const args = ['uninstall', '-g', packageName, '--no-audit', '--no-fund'];

  if (options.prefix) {
    args.push('--prefix', assertCommandArg(options.prefix, 'npm prefix'));
  }

  return { command, args };
}

export function createPipInstallCommand(pipCmd, pipPackage) {
  return {
    command: assertCommandArg(pipCmd, 'pip command'),
    args: ['install', assertPipPackageSpec(pipPackage)],
  };
}

function tokenizeSimpleRegistryCommand(command, label) {
  let value;
  try {
    value = assertNoShellControlSyntax(command, label).trim();
  } catch {
    throw new Error(`Unsupported ${label} command`);
  }
  if (value.includes('"') || value.includes("'")) {
    throw new Error(`Unsupported ${label} command`);
  }
  return value.split(/\s+/).filter(Boolean);
}

function normalizeRegistryArgList(args, label) {
  if (!Array.isArray(args)) {
    throw new Error(`${label} args must be an array`);
  }
  return args.map((arg, index) => assertNoShellControlSyntax(arg, `${label} arg ${index}`));
}

export function createPostInstallCommand(postInstall, binDir) {
  const binRoot = assertCommandArg(binDir, 'postInstall bin directory');

  if (postInstall && typeof postInstall === 'object' && !Array.isArray(postInstall)) {
    if (postInstall.bin) {
      return {
        command: path.join(binRoot, assertNoShellControlSyntax(postInstall.bin, 'postInstall bin')),
        args: normalizeRegistryArgList(postInstall.args || [], 'postInstall'),
      };
    }
    return normalizeCommandPlan({
      command: assertNoShellControlSyntax(postInstall.command, 'postInstall command'),
      args: normalizeRegistryArgList(postInstall.args || [], 'postInstall'),
    });
  }

  const tokens = tokenizeSimpleRegistryCommand(postInstall, 'postInstall');
  if (tokens.length < 2 || tokens[0] !== 'npx') {
    throw new Error('Unsupported postInstall command: expected npx <bin> [args...]');
  }

  return {
    command: path.join(binRoot, assertNoShellControlSyntax(tokens[1], 'postInstall bin')),
    args: tokens.slice(2).map((arg, index) => assertNoShellControlSyntax(arg, `postInstall arg ${index}`)),
  };
}

export function createNativeInstallerCommand(nativeInstaller, platform = process.platform) {
  const installer = nativeInstaller?.[platform];
  if (!installer) {
    throw new Error(`No native installer available for platform: ${platform}`);
  }

  if (typeof installer === 'string') {
    throw new Error('Native installer must be explicit argv metadata, not a shell command string');
  }

  const rawPlan = Array.isArray(installer)
    ? { command: installer[0], args: installer.slice(1) }
    : installer;

  if (!rawPlan || typeof rawPlan !== 'object') {
    throw new Error('Native installer must be explicit argv metadata');
  }

  return normalizeCommandPlan({
    command: assertNoShellControlSyntax(rawPlan.command, 'native installer command'),
    args: normalizeRegistryArgList(rawPlan.args || [], 'native installer'),
  });
}

function normalizeInstalledPackageId(kind, manifestId, directoryName) {
  const rawId = typeof manifestId === 'string' ? manifestId.trim() : '';
  if (!rawId) return `${kind}:${directoryName}`;
  if (!rawId.includes(':')) return `${kind}:${rawId}`;

  const [idKind] = parsePackageId(rawId);
  if (idKind !== kind) {
    throw new Error(`Installed ${kind} manifest id must use "${kind}:" prefix: ${rawId}`);
  }

  return rawId;
}

function normalizePreservedStatePaths(paths) {
  const normalized = [];
  const seen = new Set();

  for (const value of paths || []) {
    if (typeof value !== 'string') continue;
    const rel = path.normalize(value.trim()).replace(/\\/g, '/');
    if (!rel || rel === '.' || rel === '..' || path.isAbsolute(rel) || rel.startsWith('../') || rel.includes('/../')) {
      continue;
    }
    if (!seen.has(rel)) {
      seen.add(rel);
      normalized.push(rel);
    }
  }

  return normalized;
}

function isSystemInstalledPackage(pkg) {
  return (pkg.kind === 'binary' || pkg.kind === 'agent') && (
    pkg.installType === 'system' ||
    pkg.managed === false ||
    pkg.install?.source === 'system'
  );
}

function executableBasename(value) {
  if (typeof value !== 'string') return null;
  const normalized = value.trim().replace(/\\/g, '/');
  if (!normalized) return null;
  const name = path.posix.basename(normalized);
  return name && name !== '.' && name !== '..' ? name : null;
}

function normalizeBinaryList(pkg, pkgName) {
  const candidates = [
    ...(Array.isArray(pkg.bins) ? pkg.bins : []),
    ...(Array.isArray(pkg.binaries) ? pkg.binaries : []),
  ];

  if (typeof pkg.binary === 'string') {
    candidates.push(pkg.binary);
  }

  const bins = [];
  const seen = new Set();
  for (const candidate of candidates) {
    const name = executableBasename(candidate);
    if (!name || seen.has(name)) continue;
    seen.add(name);
    bins.push(name);
  }

  return bins.length > 0 ? bins : [pkgName];
}

function getSystemDetectPlan(pkg, pkgName) {
  const rawCommand = pkg.checkCommand || pkg.detect?.command || pkg.install?.detect?.command || `${pkgName} --version`;
  const tokens = tokenizeSimpleRegistryCommand(rawCommand, 'system detect');
  if (tokens.length === 0) {
    throw new Error(`System binary ${pkg.id} must declare a detect command`);
  }
  return { command: tokens[0], args: tokens.slice(1), rawCommand };
}

function isExecutableFile(filePath) {
  try {
    fs.accessSync(filePath, fs.constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

function findExecutableOnPath(command) {
  if (path.isAbsolute(command)) {
    return isExecutableFile(command) ? command : null;
  }

  try {
    const result = runCommandPlan({ command: 'which', args: [command] }, { encoding: 'utf8' }).trim();
    return result && isExecutableFile(result) ? result : null;
  } catch {
    return null;
  }
}

function collectSystemExecutableCandidates(command, pkg) {
  const candidates = [];
  const addCandidate = (candidate) => {
    if (typeof candidate === 'string' && candidate && !candidates.includes(candidate)) {
      candidates.push(candidate);
    }
  };

  addCandidate(findExecutableOnPath(command));

  for (const candidate of pkg.systemPaths || []) {
    if (typeof candidate !== 'string' || !candidate.trim()) continue;
    const resolved = path.resolve(candidate);
    if (fs.existsSync(resolved) && fs.statSync(resolved).isFile()) {
      addCandidate(resolved);
      continue;
    }
    addCandidate(path.join(resolved, command));
  }

  if (path.isAbsolute(command)) {
    addCandidate(command);
  }

  return candidates.filter(Boolean);
}

function detectSystemBinary(pkg, pkgName) {
  const detectPlan = getSystemDetectPlan(pkg, pkgName);
  const candidates = collectSystemExecutableCandidates(detectPlan.command, pkg);
  const commandsToTry = candidates.length > 0 ? candidates : [detectPlan.command];

  for (const command of commandsToTry) {
    try {
      runCommandPlan({ command, args: detectPlan.args }, { stdio: 'pipe' });
      const resolvedPath = path.isAbsolute(command)
        ? command
        : findExecutableOnPath(command);
      if (resolvedPath && isExecutableFile(resolvedPath)) {
        return {
          path: resolvedPath,
          command: detectPlan.rawCommand,
        };
      }
    } catch {
      // Continue through the declared candidates.
    }
  }

  return null;
}

async function installSystemBinaryPackage(pkg, installPath, pkgName, options = {}) {
  const { withShims = false, onProgress } = options;
  const bins = normalizeBinaryList(pkg, pkgName);

  onProgress?.({ phase: 'detecting', package: pkg.id });

  const detected = detectSystemBinary(pkg, bins[0] || pkgName);
  if (!detected) {
    const hint = pkg.instructions ? ` ${pkg.instructions}` : '';
    throw new Error(`System binary ${pkg.id} was not detected.${hint}`);
  }

  if (fs.existsSync(installPath)) {
    fs.rmSync(installPath, { recursive: true, force: true });
  }
  fs.mkdirSync(installPath, { recursive: true });

  const manifest = {
    id: pkg.id,
    kind: pkg.kind,
    name: pkgName,
    version: pkg.version || 'system',
    installType: 'system',
    managed: false,
    bins,
    checkCommand: detected.command,
    installedAt: new Date().toISOString(),
    source: {
      type: 'system',
      path: detected.path,
    },
  };

  fs.writeFileSync(
    path.join(installPath, 'manifest.json'),
    JSON.stringify(manifest, null, 2)
  );

  if (withShims) {
    await createShimsForTool({
      id: pkg.id,
      installType: 'system',
      installDir: installPath,
      bins,
      name: pkgName,
      source: { path: detected.path },
    });
  }

  return { success: true, id: pkg.id, path: installPath };
}

function getMutableStatePaths(pkg, options = {}) {
  const configured = Array.isArray(options.preserveStatePaths)
    ? options.preserveStatePaths
    : (
        Array.isArray(pkg?.statePaths) ? pkg.statePaths
          : Array.isArray(pkg?.preserveStatePaths) ? pkg.preserveStatePaths
            : Array.isArray(pkg?.mutableStatePaths) ? pkg.mutableStatePaths
              : null
      );

  return normalizePreservedStatePaths(
    configured || (pkg?.kind === 'stack' ? DEFAULT_STACK_STATE_PATHS : [])
  );
}

function getPreservedStatePaths(pkg, options = {}) {
  if (options.preserveState === false) return [];
  return getMutableStatePaths(pkg, options);
}

function getMigratedStatePaths(pkg, options = {}) {
  if (options.preserveState !== false || options.migrateState === false) return [];
  return getMutableStatePaths(pkg, options);
}

function getPackageStateRoot(pkg) {
  if (pkg?.kind !== 'stack') return null;
  const [kind, name] = parsePackageId(pkg.id);
  if (kind !== 'stack') return null;
  return path.join(PATHS.home, 'state', 'stacks', name);
}

function makeStateBackupRoot(installPath) {
  const parent = path.dirname(installPath);
  const base = path.basename(installPath).replace(/[^a-zA-Z0-9_.-]/g, '_');
  return path.join(parent, `.${base}.state-backup-${process.pid}-${Date.now()}`);
}

function assertStateDestinationOutsideInstall(installPath, stateRoot) {
  const installRoot = path.resolve(installPath);
  const targetRoot = path.resolve(stateRoot);
  if (targetRoot === installRoot || targetRoot.startsWith(`${installRoot}${path.sep}`)) {
    throw new Error(`State root must be outside install path: ${stateRoot}`);
  }
}

function ensureNoMigrationConflicts(sourcePath, destPath) {
  if (!fs.existsSync(destPath)) return;

  const sourceStat = fs.lstatSync(sourcePath);
  const destStat = fs.lstatSync(destPath);
  if (sourceStat.isDirectory() && destStat.isDirectory()) {
    for (const entry of fs.readdirSync(sourcePath)) {
      ensureNoMigrationConflicts(path.join(sourcePath, entry), path.join(destPath, entry));
    }
    return;
  }

  throw new Error(`Cannot migrate install-local state because destination already exists: ${destPath}`);
}

function renameOrCopyPath(sourcePath, destPath) {
  fs.mkdirSync(path.dirname(destPath), { recursive: true });
  try {
    fs.renameSync(sourcePath, destPath);
  } catch (error) {
    if (error.code !== 'EXDEV') throw error;
    fs.cpSync(sourcePath, destPath, { recursive: true, errorOnExist: true, force: false });
    fs.rmSync(sourcePath, { recursive: true, force: true });
  }
}

function movePathWithoutOverwrite(sourcePath, destPath) {
  if (!fs.existsSync(destPath)) {
    renameOrCopyPath(sourcePath, destPath);
    return;
  }

  const sourceStat = fs.lstatSync(sourcePath);
  const destStat = fs.lstatSync(destPath);
  if (!sourceStat.isDirectory() || !destStat.isDirectory()) {
    throw new Error(`Cannot migrate install-local state because destination already exists: ${destPath}`);
  }

  fs.mkdirSync(destPath, { recursive: true });
  for (const entry of fs.readdirSync(sourcePath)) {
    movePathWithoutOverwrite(path.join(sourcePath, entry), path.join(destPath, entry));
  }
  fs.rmdirSync(sourcePath);
}

function restorePreservedState(backups) {
  for (const backup of backups) {
    if (!fs.existsSync(backup.backupPath)) continue;
    fs.mkdirSync(path.dirname(backup.sourcePath), { recursive: true });
    fs.rmSync(backup.sourcePath, { recursive: true, force: true });
    fs.renameSync(backup.backupPath, backup.sourcePath);
    backup.onProgress?.({ phase: 'restored-state', package: backup.packageId, path: backup.relativePath });
  }
}

export async function withPreservedInstallState(installPath, relativePaths, operation, options = {}) {
  const pathsToPreserve = normalizePreservedStatePaths(relativePaths);
  if (pathsToPreserve.length === 0) {
    return operation();
  }

  const backupRoot = makeStateBackupRoot(installPath);
  const backups = [];

  for (const relativePath of pathsToPreserve) {
    const sourcePath = path.join(installPath, relativePath);
    if (!fs.existsSync(sourcePath)) continue;

    const backupPath = path.join(backupRoot, relativePath);
    fs.mkdirSync(path.dirname(backupPath), { recursive: true });
    fs.renameSync(sourcePath, backupPath);
    backups.push({
      sourcePath,
      backupPath,
      relativePath,
      packageId: options.packageId,
      onProgress: options.onProgress,
    });
    options.onProgress?.({ phase: 'preserving-state', package: options.packageId, path: relativePath });
  }

  if (backups.length === 0) {
    return operation();
  }

  let result;
  try {
    result = await operation();
  } catch (error) {
    restorePreservedState(backups);
    try { fs.rmSync(backupRoot, { recursive: true, force: true }); } catch {}
    throw error;
  }

  restorePreservedState(backups);
  try { fs.rmSync(backupRoot, { recursive: true, force: true }); } catch {}
  return result;
}

async function withMigratedInstallState(installPath, stateRoot, relativePaths, operation, options = {}) {
  const pathsToMigrate = normalizePreservedStatePaths(relativePaths);
  if (!stateRoot || pathsToMigrate.length === 0) {
    return operation();
  }

  assertStateDestinationOutsideInstall(installPath, stateRoot);
  const migrations = [];

  for (const relativePath of pathsToMigrate) {
    const sourcePath = path.join(installPath, relativePath);
    if (!fs.existsSync(sourcePath)) continue;

    const destPath = path.join(stateRoot, relativePath);
    ensureNoMigrationConflicts(sourcePath, destPath);
    migrations.push({ sourcePath, destPath, relativePath });
  }

  for (const migration of migrations) {
    movePathWithoutOverwrite(migration.sourcePath, migration.destPath);
    options.onProgress?.({ phase: 'migrated-state', package: options.packageId, path: migration.relativePath });
  }

  return operation();
}

function getNpmModulesRoot(installRoot, scope = 'local') {
  if (scope === 'global') {
    return path.join(installRoot, 'lib', 'node_modules');
  }
  return path.join(installRoot, 'node_modules');
}

function getNpmPackageJsonPath(installRoot, packageName, scope = 'local') {
  return path.join(getNpmModulesRoot(installRoot, scope), packageName, 'package.json');
}

/**
 * Auto-discover binaries from installed npm package
 * Reads package.json bin field after npm install completes
 * @param {string} installRoot - Installation directory or npm prefix
 * @param {string} packageName - npm package name
 * @param {'local' | 'global'} [scope]
 * @returns {string[]} Array of discovered bin names
 */
function discoverNpmBins(installRoot, packageName, scope = 'local') {
  try {
    const pkgJsonPath = getNpmPackageJsonPath(installRoot, packageName, scope);

    if (!fs.existsSync(pkgJsonPath)) {
      console.warn(`[Installer] Warning: Could not find package.json at ${pkgJsonPath}`);
      return [];
    }

    const pkgJson = JSON.parse(fs.readFileSync(pkgJsonPath, 'utf8'));
    const bins = [];

    if (typeof pkgJson.bin === 'string') {
      // Single binary - use package name (minus scope)
      const binName = packageName.split('/').pop();
      bins.push(binName);
    } else if (typeof pkgJson.bin === 'object' && pkgJson.bin !== null) {
      // Multiple binaries - use all keys
      bins.push(...Object.keys(pkgJson.bin));
    } else {
      console.warn(`[Installer] Warning: Package '${packageName}' has no 'bin' field`);
    }

    return bins;
  } catch (error) {
    console.warn(`[Installer] Error discovering bins: ${error.message}`);
    return [];
  }
}

/**
 * Check if package defines install scripts
 * @param {string} installPath - Installation directory
 * @param {string} packageName - npm package name
 * @returns {boolean} True if package has install scripts
 */
function hasInstallScripts(installRoot, packageName, scope = 'local') {
  try {
    const pkgJsonPath = getNpmPackageJsonPath(installRoot, packageName, scope);

    if (!fs.existsSync(pkgJsonPath)) {
      return false;
    }

    const pkgJson = JSON.parse(fs.readFileSync(pkgJsonPath, 'utf8'));
    const scripts = pkgJson.scripts || {};

    // Check for common install-time scripts
    const installScriptKeys = ['preinstall', 'install', 'postinstall', 'prepare'];
    return installScriptKeys.some(key => scripts[key]);
  } catch (error) {
    return false;
  }
}

/**
 * @typedef {Object} InstallResult
 * @property {boolean} success
 * @property {string} id - Package ID
 * @property {string} path - Install path
 * @property {string} [error] - Error message if failed
 */

async function withRuntimeInstallLock(pkg, install) {
  if (pkg.kind !== 'runtime' || pkg.install?.source !== 'download' || !pkg.install?.url) {
    return install();
  }
  const installPath = getInstallPathForPackage(pkg);
  fs.mkdirSync(path.dirname(installPath), { recursive: true });
  const lockPath = path.join(path.dirname(installPath), `.${path.basename(installPath)}.runtime-install.lock`);
  let descriptor;
  try {
    descriptor = fs.openSync(lockPath, 'wx', 0o600);
  } catch (error) {
    if (error.code === 'EEXIST') {
      throw new Error(`Runtime installation already in progress: ${pkg.id} (${lockPath})`);
    }
    throw error;
  }
  const owned = fs.fstatSync(descriptor);
  try {
    fs.writeFileSync(descriptor, JSON.stringify({ package: pkg.id, pid: process.pid }));
    return await install();
  } finally {
    fs.closeSync(descriptor);
    if (fs.existsSync(lockPath)) {
      const current = fs.lstatSync(lockPath);
      if (current.dev === owned.dev && current.ino === owned.ino) fs.unlinkSync(lockPath);
    }
  }
}

/**
 * Install a package and its dependencies
 * @param {string} id - Package ID
 * @param {Object} options
 * @param {boolean} [options.force] - Force reinstall
 * @param {boolean} [options.preserveState] - Preserve mutable stack state during force reinstall
 * @param {boolean} [options.migrateState] - Move mutable stack state to ~/.rudi/state before force reinstall
 * @param {string[]} [options.preserveStatePaths] - Relative install paths to preserve
 * @param {boolean} [options.withShims] - Create/update shims in ~/.rudi/bins
 * @param {Object} [options.resolvedPackage] - Already-resolved package metadata
 * @param {boolean} [options.deferFinalize] - Keep a GitHub replacement reversible for caller validation
 * @param {Function} [options.onProgress] - Progress callback
 * @returns {Promise<InstallResult>}
 */
export async function installPackage(id, options = {}) {
  const {
    force = false,
    allowScripts = false,
    withShims = false,
    preserveState = false,
    migrateState = true,
    preserveStatePaths,
    resolvedPackage,
    deferFinalize = false,
    onProgress
  } = options;

  onProgress?.({ phase: 'resolving', package: id });

  if (typeof id === 'string' && id.trim().startsWith('agent:')) {
    return {
      success: false,
      id: id.trim(),
      error: 'Agent hosts are externally managed and cannot be installed by RUDI.',
    };
  }

  // Resolve package and dependencies
  const resolved = resolvedPackage || await resolvePackage(id);
  if (!resolved || resolved.id !== id) {
    throw new Error(`Resolved package identity mismatch for ${id}`);
  }

  if (resolved.kind === 'agent') {
    const installHint = resolved.installHints?.manual || resolved.instructions;
    return {
      success: false,
      id: resolved.id,
      error: `Agent hosts are externally managed and cannot be installed by RUDI.${installHint ? ` ${installHint}` : ''}`,
    };
  }

  // Create RUDI package directories only after the request is known to be a
  // RUDI-managed package.
  ensureDirectories();

  // Get install order (dependencies first)
  let toInstall = getInstallOrder(resolved);

  // An installed ID may still need a source-format migration at its new path.
  if (resolved.kind === 'skill' && !fs.existsSync(getInstallPathForPackage(resolved))
    && !toInstall.some(pkg => pkg.id === resolved.id)) {
    toInstall.push(resolved);
  }

  // If already installed and not forcing, skip
  if (toInstall.length === 0 && !force) {
    return {
      success: true,
      id: resolved.id,
      path: getInstallPathForPackage(resolved),
      alreadyInstalled: true
    };
  }

  // If forcing reinstall, add the main package if not already in list
  if (force && !toInstall.find(p => p.id === resolved.id)) {
    toInstall.push(resolved);
  }

  // Install each package in order
  const results = [];
  const previousLockfile = resolved.source?.type === 'github'
    ? readLockfile(resolved.id)
    : null;
  for (const pkg of toInstall) {
    onProgress?.({ phase: 'installing', package: pkg.id, total: toInstall.length, current: results.length + 1 });

    try {
      const result = await withRuntimeInstallLock(pkg, () => installSinglePackage(pkg, {
        force,
        allowScripts,
        withShims,
        preserveState,
        migrateState,
        preserveStatePaths,
        deferFinalize: pkg.id === resolved.id && pkg.source?.type === 'github',
        onProgress
      }));
      results.push(result);
    } catch (error) {
      return {
        success: false,
        id: pkg.id,
        error: error.message
      };
    }
  }

  const mainResult = results.find((result) => result.id === resolved.id);
  const transaction = mainResult?.transaction
    ? {
        ...mainResult.transaction,
        resolved,
        previousLockfile,
      }
    : null;

  if (transaction && !deferFinalize) {
    try {
      await finalizeDeferredInstall(transaction, { onProgress });
    } catch (error) {
      try {
        await rollbackDeferredInstall(transaction);
      } catch (rollbackError) {
        return {
          success: false,
          id: resolved.id,
          error: `${error.message}; rollback also failed: ${rollbackError.message}`,
        };
      }
      return { success: false, id: resolved.id, error: error.message };
    }
  } else if (!transaction && !mainResult?.lockfileWritten && !mainResult?.skipped) {
    onProgress?.({ phase: 'lockfile', package: resolved.id });
    await writeLockfile(resolved, {
      installPath: getInstallPathForPackage(resolved),
    });
  }

  return {
    success: true,
    id: resolved.id,
    path: getInstallPathForPackage(resolved),
    ...(mainResult?.backupPath ? { backupPath: mainResult.backupPath } : {}),
    installed: results.map(r => r.id),
    ...(transaction && deferFinalize ? { transaction } : {}),
  };
}

export async function finalizeDeferredInstall(transaction, options = {}) {
  await prepareDeferredInstall(transaction, options);
  return commitDeferredInstall(transaction);
}

export async function prepareDeferredInstall(transaction, options = {}) {
  if (!transaction?.resolved || !transaction.installPath) {
    throw new Error('Invalid deferred install transaction');
  }
  options.onProgress?.({ phase: 'lockfile', package: transaction.id });
  await writeLockfile(transaction.resolved, { installPath: transaction.installPath });
  return { success: true, id: transaction.id, path: transaction.installPath };
}

export function commitDeferredInstall(transaction) {
  if (!transaction?.id || !transaction.installPath) {
    throw new Error('Invalid deferred install transaction');
  }
  let cleanupError = null;
  if (transaction.backupPath) {
    try {
      fs.rmSync(transaction.backupPath, { recursive: true, force: true });
    } catch (error) {
      cleanupError = error.message;
    }
  }
  return {
    success: true,
    id: transaction.id,
    path: transaction.installPath,
    ...(cleanupError ? { cleanupError } : {}),
  };
}

export async function rollbackDeferredInstall(transaction) {
  if (!transaction?.id || !transaction.installPath) {
    throw new Error('Invalid deferred install transaction');
  }
  if (
    transaction.previousInstallExisted &&
    (!transaction.backupPath || !fs.existsSync(transaction.backupPath))
  ) {
    throw new Error(`Cannot roll back ${transaction.id}: previous install backup is missing`);
  }

  fs.rmSync(transaction.installPath, { recursive: true, force: true });
  if (transaction.backupPath) {
    fs.renameSync(transaction.backupPath, transaction.installPath);
  }
  if (!transaction.lockfileUnchanged) {
    restoreLockfile(transaction.id, transaction.previousLockfile);
  }
  return { success: true, id: transaction.id, path: transaction.installPath };
}

/**
 * Install a binary stack — download platform binary, verify, extract, chmod
 * @param {Object} pkg - Resolved package with binary.platforms
 * @param {string} installPath - Destination directory
 * @param {Object} options
 * @returns {Promise<void>}
 */
async function installBinaryStack(pkg, installPath, options = {}) {
  const { onProgress } = options;
  const platformArch = getPlatformArch();
  const platforms = pkg.binary?.platforms;

  if (!platforms || !platforms[platformArch]) {
    const supported = platforms ? Object.keys(platforms).join(', ') : 'none';
    throw new Error(`No binary for ${platformArch}. Supported: ${supported}`);
  }

  const platform = platforms[platformArch];
  const { url, sha256, extractType = 'tar.gz' } = platform;
  const binaryName = platform.binary || pkg.command?.[0]?.replace(/^\.\//, '') || pkg.id;

  // Download to temp file
  const cacheDir = path.join(PATHS.cache, 'downloads');
  fs.mkdirSync(cacheDir, { recursive: true });
  const tempFile = path.join(cacheDir, `${pkg.id}-${platformArch}.download`);

  try {
    onProgress?.({ phase: 'downloading', package: pkg.id, detail: `Downloading binary for ${platformArch}` });

    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`Download failed: HTTP ${response.status} from ${url}`);
    }
    await pipeline(response.body, createWriteStream(tempFile));

    // Verify checksum if provided
    if (sha256) {
      onProgress?.({ phase: 'verifying', package: pkg.id });
      const valid = await verifyHash(tempFile, sha256);
      if (!valid) {
        throw new Error(`Checksum verification failed for ${pkg.id}`);
      }
    }

    // Extract
    onProgress?.({ phase: 'extracting', package: pkg.id });

    if (extractType === 'none') {
      // Raw binary — move directly
      const destPath = path.join(installPath, binaryName);
      fs.copyFileSync(tempFile, destPath);
    } else {
      runCommandPlan(createArchiveExtractCommand(extractType, tempFile, installPath), { stdio: 'pipe' });
    }

    // Make binary executable
    const binaryPath = path.join(installPath, binaryName);
    if (!fs.existsSync(binaryPath)) {
      // Binary might be in a subdirectory — look one level deep
      const entries = fs.readdirSync(installPath, { withFileTypes: true });
      let found = false;
      for (const entry of entries) {
        if (entry.isDirectory()) {
          const nested = path.join(installPath, entry.name, binaryName);
          if (fs.existsSync(nested)) {
            // Move binary up to install root
            fs.renameSync(nested, binaryPath);
            found = true;
            break;
          }
        }
      }
      if (!found) {
        throw new Error(`Binary '${binaryName}' not found after extraction`);
      }
    }

    if (process.platform !== 'win32') {
      fs.chmodSync(binaryPath, 0o755);
    }

    onProgress?.({ phase: 'installed', package: pkg.id });
  } finally {
    // Always clean up temp file
    try { fs.unlinkSync(tempFile); } catch { /* ignore */ }
  }
}

/**
 * Install a single package (without dependencies)
 * @param {Object} pkg - Resolved package info
 * @param {Object} options
 * @returns {Promise<InstallResult>}
 */
async function installSinglePackage(pkg, options = {}) {
  const {
    force = false,
    allowScripts = false,
    withShims = false,
    preserveState = false,
    migrateState = true,
    preserveStatePaths,
    deferFinalize = false,
    onProgress,
  } = options;
  const installPath = getInstallPathForPackage(pkg);
  const pkgName = pkg.id.replace(/^(runtime|binary|agent):/, '');

  if (pkg.kind === 'agent') {
    throw new Error(`Agent hosts are externally managed and cannot be installed by RUDI: ${pkg.id}`);
  }

  // Check if already installed
  if (fs.existsSync(installPath) && !force) {
    return { success: true, id: pkg.id, path: installPath, skipped: true };
  }

  if (pkg.kind === 'skill' && pkg.source?.type !== 'github' && pkg.path) {
    return installRegistrySkill(pkg, installPath, { onProgress });
  }

  // Handle RUDI-managed runtimes and binaries.
  if (pkg.kind === 'runtime' || pkg.kind === 'binary') {
    onProgress?.({ phase: 'downloading', package: pkg.id });

    // Handle registry-governed native installers for non-agent packages.
    if (pkg.installType === 'native-installer' && pkg.nativeInstaller) {
      const homedir = os.homedir();
      const nativeBin = pkg.nativeBinPath
        ? path.join(homedir, pkg.nativeBinPath)
        : null;

      // Check if already installed at native path
      if (nativeBin && fs.existsSync(nativeBin) && !force) {
        console.log(`  Found ${pkg.name} at ${nativeBin}`);
        if (!fs.existsSync(installPath)) fs.mkdirSync(installPath, { recursive: true });
        fs.writeFileSync(path.join(installPath, 'manifest.json'), JSON.stringify({
          id: pkg.id, kind: pkg.kind, name: pkgName,
          installType: 'native',
          detectedPath: nativeBin,
          installedAt: new Date().toISOString(),
        }, null, 2));
        return { success: true, id: pkg.id, path: installPath };
      }

      // Also check PATH
      if (!force) {
        try {
          const which = runCommandPlan({ command: 'which', args: [pkgName] }, { encoding: 'utf-8' }).trim();
          if (which && fs.existsSync(which)) {
            console.log(`  Found ${pkg.name} in PATH: ${which}`);
            if (!fs.existsSync(installPath)) fs.mkdirSync(installPath, { recursive: true });
            fs.writeFileSync(path.join(installPath, 'manifest.json'), JSON.stringify({
              id: pkg.id, kind: pkg.kind, name: pkgName,
              installType: 'native',
              detectedPath: which,
              installedAt: new Date().toISOString(),
            }, null, 2));
            return { success: true, id: pkg.id, path: installPath };
          }
        } catch {}
      }

      // Run native installer
      const platform = process.platform;
      const installerCmd = pkg.nativeInstaller[platform];
      if (!installerCmd) {
        throw new Error(`No native installer available for platform: ${platform}`);
      }

      console.log(`  Running native installer for ${pkg.name}...`);
      runCommandPlan(createNativeInstallerCommand(pkg.nativeInstaller, platform), { stdio: 'inherit' });

      // Verify installation
      const verifyPath = nativeBin && fs.existsSync(nativeBin) ? nativeBin : (() => {
        try { return runCommandPlan({ command: 'which', args: [pkgName] }, { encoding: 'utf-8' }).trim(); }
        catch { return null; }
      })();
      if (!verifyPath || !fs.existsSync(verifyPath)) {
        throw new Error(`Installation completed but ${pkgName} binary not found. You may need to restart your shell.`);
      }

      if (!fs.existsSync(installPath)) fs.mkdirSync(installPath, { recursive: true });
      fs.writeFileSync(path.join(installPath, 'manifest.json'), JSON.stringify({
        id: pkg.id, kind: pkg.kind, name: pkgName,
        installType: 'native',
        detectedPath: verifyPath,
        installedAt: new Date().toISOString(),
      }, null, 2));

      return { success: true, id: pkg.id, path: installPath };
    }

    if (isSystemInstalledPackage(pkg)) {
      return await installSystemBinaryPackage(pkg, installPath, pkgName, {
        withShims,
        onProgress,
      });
    }

    // Handle RUDI-managed npm tools and cloud CLIs. Agent Hosts are rejected
    // above because their vendors own installation and updates.
    if (pkg.npmPackage) {
      try {
        const npmInstallRoot = installPath;
        const npmScope = 'local';
        const nodeRuntime = getNpmNodeRuntimeId(pkg);
        const boundNpm = nodeRuntime ? resolveNpmRuntimeBin(nodeRuntime, 'npm') : undefined;

        if (!fs.existsSync(installPath)) {
          fs.mkdirSync(installPath, { recursive: true });
        }

        onProgress?.({ phase: 'installing', package: pkg.id, message: `npm install ${pkg.npmPackage}` });

        // Use bundled Node's npm if RESOURCES_PATH is set (running from Studio)
        // Otherwise fall back to system npm (CLI standalone use)
        const resourcesPath = process.env.RESOURCES_PATH;
        const npmCmd = boundNpm || (resourcesPath
          ? path.join(resourcesPath, 'bundled-runtimes', 'node', 'bin', 'npm')
          : await findNpmExecutable());

        if (!fs.existsSync(path.join(installPath, 'package.json'))) {
          runCommandPlan(createNpmInitCommand(npmCmd), {
            cwd: installPath,
            stdio: 'pipe',
            env: buildNodeToolEnv(npmCmd),
          });
        }

        // Install the npm package with safety flags
        // --ignore-scripts: prevent arbitrary code execution during install (safer default)
        // --no-audit --no-fund: reduce noise
        const shouldIgnoreScripts = pkg.source?.type === 'npm' && !allowScripts;
        runCommandPlan(createNpmInstallCommand({
          npmCmd,
          packageName: pkg.npmPackage,
          version: pkg.version,
          global: false,
          prefix: null,
          ignoreScripts: shouldIgnoreScripts,
        }), {
          cwd: installPath,
          stdio: 'pipe',
          env: buildNodeToolEnv(npmCmd),
        });

        // Auto-discover bins if not specified (dynamic npm installs)
        let bins = pkg.bins;
        if (!bins || bins.length === 0) {
          bins = discoverNpmBins(npmInstallRoot, pkg.npmPackage, npmScope);
          console.log(`[Installer] Discovered binaries: ${bins.join(', ') || '(none)'}`);
        }

        // Get actual installed version
        let installedVersion = pkg.version || 'latest';
        try {
          const pkgJsonPath = getNpmPackageJsonPath(npmInstallRoot, pkg.npmPackage, npmScope);
          if (fs.existsSync(pkgJsonPath)) {
            const pkgJson = JSON.parse(fs.readFileSync(pkgJsonPath, 'utf8'));
            installedVersion = pkgJson.version;
          }
        } catch (err) {
          // Use fallback version
        }

        // Run postInstall if specified
        if (pkg.postInstall) {
          onProgress?.({ phase: 'postInstall', package: pkg.id, message: pkg.postInstall });
          const binDir = path.join(installPath, 'node_modules', '.bin');
          runCommandPlan(createPostInstallCommand(pkg.postInstall, binDir), {
            cwd: installPath,
            stdio: 'pipe',
            env: buildNodeToolEnv(npmCmd, {
              PATH: `${binDir}${path.delimiter}${process.env.PATH || ''}`
            })
          });
        }

        // Check if package has install scripts
        const scriptsDetected = hasInstallScripts(npmInstallRoot, pkg.npmPackage, npmScope);
        const scriptsPolicy = shouldIgnoreScripts ? 'ignore' : 'allow';

        // Warn if scripts were skipped
        if (scriptsDetected && scriptsPolicy === 'ignore') {
          console.warn(`\n⚠️  This package defines install scripts that were skipped for security.`);
          console.warn(`   If the CLI fails to run, reinstall with:`);
          console.warn(`   rudi install ${pkg.id} --allow-scripts\n`);
        }

        // Write package metadata
        const manifest = {
          id: pkg.id,
          kind: pkg.kind,
          name: pkgName,
          version: installedVersion,
          npmPackage: pkg.npmPackage,
          ...(nodeRuntime ? { nodeRuntime } : {}),
          bins: bins,
          hasInstallScripts: scriptsDetected,
          scriptsPolicy: scriptsPolicy,
          postInstall: pkg.postInstall,
          installType: 'npm',
          installedAt: new Date().toISOString(),
          source: pkg.source || { type: 'npm' }
        };

        fs.writeFileSync(
          path.join(installPath, 'manifest.json'),
          JSON.stringify(manifest, null, 2)
        );

        // Create shims for discovered/specified bins (opt-in)
        if (withShims) {
          if (bins && bins.length > 0) {
            await createShimsForTool({
              id: pkg.id,
              installType: 'npm',
              installDir: npmInstallRoot,
              bins: bins,
              name: pkgName,
              nodeRuntime,
            });
          } else {
            console.warn(`[Installer] Warning: No binaries found for ${pkg.npmPackage}`);
          }
        }

        return { success: true, id: pkg.id, path: installPath };
      } catch (error) {
        throw new Error(`Failed to install ${pkg.npmPackage}: ${error.message}`);
      }
    }

    // Handle pip-based packages (aider, etc.)
    if (pkg.pipPackage) {
      try {
        if (!fs.existsSync(installPath)) {
          fs.mkdirSync(installPath, { recursive: true });
        }

        onProgress?.({ phase: 'installing', package: pkg.id, message: `Installing ${pkg.pipPackage}...` });

        // Use uv if available (10-100x faster), fallback to pip
        const { usedUv } = await installPythonPackage(installPath, pkg.pipPackage, (p) => {
          onProgress?.({ ...p, package: pkg.id });
        });

        // Write package metadata
        const manifest = {
          id: pkg.id,
          kind: pkg.kind,
          name: pkgName,
          version: pkg.version || 'latest',
          pipPackage: pkg.pipPackage,
          installedAt: new Date().toISOString(),
          source: usedUv ? 'uv' : 'pip',
          venvPath: path.join(installPath, 'venv')
        };

        fs.writeFileSync(
          path.join(installPath, 'manifest.json'),
          JSON.stringify(manifest, null, 2)
        );

        // Create shims for pip package (opt-in)
        if (withShims) {
          await createShimsForTool({
            id: pkg.id,
            installType: 'pip',
            installDir: installPath,
            bins: pkg.bins || [pkgName],
            name: pkgName
          });
        }

        return { success: true, id: pkg.id, path: installPath };
      } catch (error) {
        throw new Error(`Failed to install ${pkg.pipPackage}: ${error.message}`);
      }
    }

    // Handle binary packages - binaries use upstream URLs, runtimes use GitHub releases
    const version = pkg.version?.replace(/\.x$/, '.0') || '1.0.0';

    try {
      if (pkg.install?.source === 'download' && pkg.install?.url) {
        const downloaded = await downloadResolvedPackage(pkg, installPath, {
          onProgress: (progress) => onProgress?.({ ...progress, package: pkg.id }),
        });

        if (pkg.kind === 'runtime') {
          try {
            onProgress?.({ phase: 'lockfile', package: pkg.id });
            await writeLockfile(pkg, { installPath });
          } catch (error) {
            try {
              await rollbackDeferredInstall({
                id: pkg.id, installPath,
                previousInstallExisted: Boolean(downloaded.backupPath),
                backupPath: downloaded.backupPath,
                // Atomic lock writes leave the old bytes untouched on failure.
                lockfileUnchanged: true,
              });
            } catch (rollbackError) {
              throw new Error(`${error.message}; runtime rollback failed: ${rollbackError.message}`);
            }
            throw error;
          }
          return { success: true, id: pkg.id, path: installPath, lockfileWritten: true,
            ...(downloaded.backupPath ? { backupPath: downloaded.backupPath } : {}) };
        }

        if (pkg.kind === 'binary' && withShims) {
          const bins = Array.isArray(pkg.bins) ? pkg.bins : Object.keys(pkg.bins || {});
          await createShimsForTool({
            id: pkg.id,
            installType: 'binary',
            installDir: installPath,
            bins,
            name: pkgName,
          });
        }
        return { success: true, id: pkg.id, path: installPath };
      }

      if (pkg.kind === 'binary') {
        // Binaries: use upstream URLs from binary manifests (e.g., evermeet.cx for ffmpeg)
        await downloadTool(pkgName, installPath, {
          onProgress: (p) => onProgress?.({ ...p, package: pkg.id })
        });

        // Read the manifest written by downloadTool
        const manifestPath = path.join(installPath, 'manifest.json');
        const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf-8'));

        // Create shims for binary (support both 'bins' and 'binaries' for backward compat, opt-in)
        if (withShims) {
          await createShimsForTool({
            id: pkg.id,
            installType: 'binary',
            installDir: installPath,
            bins: manifest.bins || manifest.binaries || pkg.bins || [pkgName],
            name: pkgName
          });
        }
      } else {
        // Runtimes and agents: use GitHub releases
        await downloadRuntime(pkgName, version, installPath, {
          onProgress: (p) => onProgress?.({ ...p, package: pkg.id })
        });
      }
      return { success: true, id: pkg.id, path: installPath };
    } catch (error) {
      // Verified runtime downloads own staging and rollback. Removing their
      // destination here would delete the working installation they preserved.
      if (pkg.kind !== 'runtime' || pkg.install?.source !== 'download' || !pkg.install?.url) {
        try { fs.rmSync(installPath, { recursive: true, force: true }); } catch {}
      }
      throw new Error(`Failed to install ${pkg.id}: ${error.message}`);
    }
  }

  // Handle binary runtime stacks — download platform binary directly
  if (
    pkg.source?.type !== 'github' &&
    pkg.runtime === 'binary' &&
    pkg.binary?.platforms
  ) {
    onProgress?.({ phase: 'downloading', package: pkg.id });
    try {
      fs.mkdirSync(installPath, { recursive: true });
      await installBinaryStack(pkg, installPath, { onProgress });

      // Write manifest for reference
      fs.writeFileSync(
        path.join(installPath, 'manifest.json'),
        JSON.stringify(pkg, null, 2)
      );

      return { success: true, id: pkg.id, path: installPath };
    } catch (error) {
      // Clean up install dir on failure
      try { fs.rmSync(installPath, { recursive: true, force: true }); } catch { /* ignore */ }
      throw new Error(`Failed to install binary stack ${pkg.id}: ${error.message}`);
    }
  }

  if (pkg.source?.type === 'github') {
    const parent = path.dirname(installPath);
    const base = path.basename(installPath).replace(/[^a-zA-Z0-9_.-]/g, '_');
    const stagingPath = path.join(parent, `.${base}.github-stage-${process.pid}-${Date.now()}`);
    const backupPath = path.join(parent, `.${base}.github-backup-${process.pid}-${Date.now()}`);
    fs.mkdirSync(parent, { recursive: true });

    let previousInstallExisted = false;
    let installedStaging = false;
    try {
      await downloadPackage(pkg, stagingPath, { onProgress });
      if (pkg.kind === 'stack') {
        await installStackDependencies(stagingPath, onProgress, {
          allowScripts,
          failClosed: true,
        });
      }

      previousInstallExisted = fs.existsSync(installPath);
      if (previousInstallExisted) fs.renameSync(installPath, backupPath);
      try {
        fs.renameSync(stagingPath, installPath);
        installedStaging = true;
      } catch (error) {
        if (fs.existsSync(backupPath)) fs.renameSync(backupPath, installPath);
        throw error;
      }
      if (!deferFinalize) {
        fs.rmSync(backupPath, { recursive: true, force: true });
      }
      onProgress?.({ phase: 'installed', package: pkg.id });
      return {
        success: true,
        id: pkg.id,
        path: installPath,
        ...(deferFinalize
          ? {
              transaction: {
                id: pkg.id,
                installPath,
                backupPath: previousInstallExisted ? backupPath : null,
                previousInstallExisted,
              },
            }
          : {}),
      };
    } catch (error) {
      fs.rmSync(stagingPath, { recursive: true, force: true });
      if (installedStaging) {
        fs.rmSync(installPath, { recursive: true, force: true });
      }
      if (previousInstallExisted && fs.existsSync(backupPath)) {
        fs.renameSync(backupPath, installPath);
      }
      throw new Error(`Failed to install pinned GitHub package ${pkg.id}: ${error.message}`);
    }
  }

  // Handle registry/local package source downloads
  if (pkg.path) {
    onProgress?.({ phase: 'downloading', package: pkg.id });
    const installFromRegistry = async () => {
      await downloadPackage(pkg, installPath, { onProgress });

      // Single-file packages do not need manifest.json or dependency install here.
      if (!SINGLE_FILE_KINDS.has(pkg.kind)) {
        // Only write manifest.json if one wasn't downloaded from registry
        const manifestPath = path.join(installPath, 'manifest.json');
        if (!fs.existsSync(manifestPath)) {
          // Write minimal manifest as fallback
          fs.writeFileSync(
            manifestPath,
            JSON.stringify({
              id: pkg.id,
              kind: pkg.kind,
              name: pkg.name,
              version: pkg.version,
              description: pkg.description,
              runtime: pkg.runtime,
              entry: pkg.entry || 'create_pdf.py',  // default entry point
              requires: pkg.requires,
              installedAt: new Date().toISOString(),
              source: 'registry'
            }, null, 2)
          );
        }

        // Install dependencies for stacks with node or python runtime
        if (pkg.kind === 'stack') {
          onProgress?.({ phase: 'installing-deps', package: pkg.id });
          await installStackDependencies(installPath, onProgress);
        }
      }

      onProgress?.({ phase: 'installed', package: pkg.id });
      return { success: true, id: pkg.id, path: installPath };
    };

    try {
      const migrateAndInstall = () => withMigratedInstallState(
        installPath,
        getPackageStateRoot(pkg),
        getMigratedStatePaths(pkg, { preserveState, migrateState, preserveStatePaths }),
        installFromRegistry,
        { packageId: pkg.id, onProgress }
      );

      return await withPreservedInstallState(
        installPath,
        getPreservedStatePaths(pkg, { preserveState, preserveStatePaths }),
        migrateAndInstall,
        { packageId: pkg.id, onProgress }
      );
    } catch (error) {
      throw new Error(`Failed to install ${pkg.id}: ${error.message}`);
    }
  }

  const label = pkg.kind.charAt(0).toUpperCase() + pkg.kind.slice(1);
  throw new Error(`${label} ${pkg.id} has no install source`);
}

/**
 * Uninstall a package
 * @param {string} id - Package ID
 * @returns {Promise<{ success: boolean, error?: string, removedShims?: string[] }>}
 */
export async function uninstallPackage(id) {
  const installPath = getPackagePath(id);
  const [kind, name] = parsePackageId(id);

  if (!fs.existsSync(installPath)) {
    return { success: false, error: `Package not installed: ${id}` };
  }

  try {
    // Read manifest to get bins list for shim cleanup
    let bins = [];
    let manifest = null;
    if (!SINGLE_FILE_KINDS.has(kind)) {
      const manifestPath = path.join(installPath, 'manifest.json');
      if (fs.existsSync(manifestPath)) {
        try {
          manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf-8'));
          bins = manifest.bins || manifest.binaries || [];
        } catch {
          // Fallback: use package name as bin
          bins = [name];
        }
      }
    }

    // Remove the legacy global npm package before deleting retry metadata.
    if (kind === 'agent' && manifest?.npmPackage) {
      try {
        const npmCmd = await findNpmExecutable();
        const npmPrefix = getNodeRuntimeRoot();
        runCommandPlan(createNpmUninstallCommand({
          npmCmd,
          packageName: manifest.npmPackage,
          prefix: npmPrefix,
        }), {
          stdio: 'pipe',
          env: buildNodeToolEnv(npmCmd)
        });
      } catch (error) {
        throw new Error(
          `Failed to uninstall legacy Agent Host package ${manifest.npmPackage}: ${error.message}`,
          { cause: error },
        );
      }
    }

    // Remove shims BEFORE deleting the package directory
    if (bins.length > 0) {
      removeShims(bins);
    }

    // Legacy skills/prompts/workflows are files; bundled skills are directories.
    if (SINGLE_FILE_KINDS.has(kind)) {
      const stat = fs.statSync(installPath);
      if (stat.isDirectory()) {
        fs.rmSync(installPath, { recursive: true });
      } else {
        fs.unlinkSync(installPath);
      }
    } else {
      fs.rmSync(installPath, { recursive: true });
    }

    // Remove lockfile (handle both direct name and sanitized npm names)
    const lockDir = kind === 'binary' ? 'binaries' : kind === 'npm' ? 'npms' : kind + 's';
    const lockName = name.replace(/\//g, '__').replace(/^@/, '');
    const lockPath = path.join(PATHS.locks, lockDir, `${lockName}.lock.yaml`);
    if (fs.existsSync(lockPath)) {
      fs.unlinkSync(lockPath);
    }

    return { success: true, removedShims: bins };
  } catch (error) {
    return { success: false, error: error.message };
  }
}

/**
 * Install from a local directory
 * @param {string} dir - Directory containing the package
 * @param {Object} options
 * @returns {Promise<InstallResult>}
 */
export async function installFromLocal(dir, options = {}) {
  ensureDirectories();

  // Read manifest
  const manifestPath = path.join(dir, 'stack.yaml') || path.join(dir, 'manifest.yaml');
  if (!fs.existsSync(manifestPath)) {
    throw new Error(`No manifest found in ${dir}`);
  }

  // Parse manifest (simplified for now)
  const { parse: parseYaml } = await import('yaml');
  const manifestContent = fs.readFileSync(manifestPath, 'utf-8');
  const manifest = parseYaml(manifestContent);

  // Ensure ID has prefix
  const id = manifest.id.includes(':') ? manifest.id : `stack:${manifest.id}`;
  const installPath = getPackagePath(id);

  // Copy to install location
  if (fs.existsSync(installPath)) {
    fs.rmSync(installPath, { recursive: true });
  }

  await copyDirectory(dir, installPath);

  // Write install metadata
  const meta = {
    id,
    kind: 'stack',
    name: manifest.name,
    version: manifest.version,
    installedAt: new Date().toISOString(),
    source: 'local',
    sourcePath: dir
  };

  fs.writeFileSync(
    path.join(installPath, '.install-meta.json'),
    JSON.stringify(meta, null, 2)
  );

  return { success: true, id, path: installPath };
}

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


function extractSingleFileMetadata(filePath, kind) {
  const content = fs.readFileSync(filePath, 'utf-8');

  if (kind === 'workflow' && filePath.endsWith('.json')) {
    return JSON.parse(content);
  }

  if (/^---\r?\n/.test(content)) return parseSkillDocument(content).metadata;

  if (kind === 'workflow') {
    return parsePackageMetadata(content);
  }

  return {};
}

function getInstalledPackageSource(id, fallback) {
  return readLockfile(id)?.source || fallback;
}

/**
 * List all installed packages
 * @param {'stack' | 'skill' | 'prompt' | 'workflow' | 'runtime' | 'binary' | 'agent'} [kind] - Filter by kind
 * @returns {Promise<Array>}
 */
export async function listInstalled(kind) {
  // Agent Host entries are excluded from normal package inventory. Explicit
  // agent listing remains available only so legacy artifacts can be removed.
  const kinds = kind ? [kind] : ['stack', 'skill', 'workflow', 'runtime', 'binary'];
  const packages = [];

  for (const k of kinds) {
    const dir = {
      stack: PATHS.stacks,
      skill: PATHS.skills,
      prompt: PATHS.skills,  // Backward compat: prompts map to skills
      workflow: PATHS.workflows,
      runtime: PATHS.runtimes,
      binary: PATHS.binaries,
      agent: PATHS.agents
    }[k];

    if (!dir || !fs.existsSync(dir)) continue;

    const entries = fs.readdirSync(dir, { withFileTypes: true });

    if (k === 'skill') {
      for (const skill of discoverSkillPackages({ includeExternal: true })) {
        try {
          const metadata = extractSingleFileMetadata(skill.entryPath, k);

          packages.push({
            id: `${k}:${skill.name}`,
            kind: k,
            name: metadata.name || skill.name,
            version: metadata.version || '1.0.0',
            description: metadata.description || `${skill.name} ${k}`,
            category: metadata.category || 'general',
            tags: metadata.tags || [],
            icon: metadata.icon || '',
            requires: metadata.requires,
            format: skill.format,
            source: getInstalledPackageSource(`${k}:${skill.name}`, skill.source),
            entryPath: skill.entryPath,
            ...(skill.conflictingPaths ? { conflictingPaths: skill.conflictingPaths } : {}),
            path: skill.packagePath
          });
        } catch {
          // If we can't read the skill entry file, still list it.
          packages.push({
            id: `${k}:${skill.name}`,
            kind: k,
            name: skill.name,
            version: '1.0.0',
            description: `${skill.name} ${k}`,
            category: 'general',
            tags: [],
            format: skill.format,
            source: getInstalledPackageSource(`${k}:${skill.name}`, skill.source),
            entryPath: skill.entryPath,
            ...(skill.conflictingPaths ? { conflictingPaths: skill.conflictingPaths } : {}),
            path: skill.packagePath
          });
        }
      }
      continue;
    }

    // Prompts and workflows are single files, not directories
    if (k === 'prompt' || k === 'workflow') {
      const extensions = k === 'workflow' ? WORKFLOW_EXTENSIONS : ['.md'];
      for (const entry of entries) {
        const extension = path.extname(entry.name);
        if (!entry.isFile() || !extensions.includes(extension) || entry.name.startsWith('.')) continue;

        const filePath = path.join(dir, entry.name);
        const name = entry.name.slice(0, -extension.length);

        // Read single-file package to extract metadata
        try {
          const metadata = extractSingleFileMetadata(filePath, k);

          packages.push({
            id: `${k}:${name}`,
            kind: k,
            name: metadata.name || name,
            version: metadata.version || '1.0.0',
            description: metadata.description || `${name} ${k}`,
            category: metadata.category || 'general',
            tags: metadata.tags || [],
            icon: metadata.icon || '',
            requires: metadata.requires,
            path: filePath
          });
        } catch {
          // If we can't read the file, still list it
          packages.push({
            id: `${k}:${name}`,
            kind: k,
            name: name,
            version: '1.0.0',
            description: `${name} ${k}`,
            category: 'general',
            tags: [],
            path: filePath
          });
        }
      }
      continue;
    }

    // Other packages are directories
    for (const entry of entries) {
      if (!entry.isDirectory() || entry.name.startsWith('.')) continue;

      const pkgDir = path.join(dir, entry.name);

      // Check for manifest.json or runtime.json
      const manifestPath = path.join(pkgDir, 'manifest.json');
      const runtimePath = path.join(pkgDir, 'runtime.json');

      if (fs.existsSync(manifestPath)) {
        const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf-8'));
        const packageId = normalizeInstalledPackageId(k, manifest.id, entry.name);
        packages.push({
          ...manifest,
          id: packageId,
          kind: k,
          name: manifest.name || entry.name,
          source: getInstalledPackageSource(packageId, manifest.source),
          path: pkgDir
        });
      } else if (fs.existsSync(runtimePath)) {
        // Older format - has runtime.json
        const runtimeMeta = JSON.parse(fs.readFileSync(runtimePath, 'utf-8'));
        packages.push({
          id: `${k}:${entry.name}`,
          kind: k,
          name: entry.name,
          version: runtimeMeta.version || 'unknown',
          description: `${entry.name} ${k}`,
          installedAt: runtimeMeta.downloadedAt || runtimeMeta.installedAt,
          path: pkgDir
        });
      }
    }
  }

  const index = packages.some(pkg => pkg.kind === 'skill') ? getAvailableRegistryIndex() : null;
  return packages.map(pkg => {
    if (pkg.kind === 'stack') return describePackage(pkg, index);
    if (pkg.kind !== 'skill') return pkg;
    const lock = readLockfile(pkg.id);
    const catalogIdentity = pkg.source === 'rudi' && lock?.id === pkg.id
      && /^[a-f0-9]{64}$/i.test(lock.checksum || '');
    return describePackage(pkg, index, { catalogIdentity });
  });
}

/**
 * Update a package to the latest version
 * @param {string} id - Package ID
 * @returns {Promise<InstallResult>}
 */
export async function updatePackage(id, options = {}) {
  // Force reinstall
  return installPackage(id, { ...options, force: true });
}

/**
 * Update all installed packages
 * @param {Object} options
 * @param {Function} [options.onProgress] - Progress callback
 * @returns {Promise<InstallResult[]>}
 */
export async function updateAll(options = {}) {
  const installed = await listInstalled();
  const results = [];

  for (const pkg of installed) {
    options.onProgress?.({ package: pkg.id, current: results.length + 1, total: installed.length });

    try {
      const result = await updatePackage(pkg.id, options);
      results.push(result);
    } catch (error) {
      results.push({ success: false, id: pkg.id, error: error.message });
    }
  }

  return results;
}

/**
 * Install dependencies for a stack (pnpm preferred for node, pip install for python)
 * @param {string} stackPath - Path to the installed stack
 * @param {Function} [onProgress] - Progress callback
 * @returns {Promise<void>}
 */
async function installStackDependencies(stackPath, onProgress, options = {}) {
  const { allowScripts = true, failClosed = false } = options;
  // Check for Node.js dependencies
  // Support both flat layout (package.json at root) and structured layout (node/package.json)
  const nodeDepsPaths = [
    stackPath,                          // Flat layout: package.json at stack root
    path.join(stackPath, 'node'),       // Structured layout: node/package.json
  ];

  for (const nodePath of nodeDepsPaths) {
    const packageJsonPath = path.join(nodePath, 'package.json');
    if (!fs.existsSync(packageJsonPath)) continue;

    onProgress?.({ phase: 'installing-deps', message: 'Installing Node.js dependencies...' });
    let installedWithPnpm = false;

    // Try pnpm first (if installed) - uses shared store for disk efficiency
    try {
      const pnpmCmd = await findPnpmExecutable();
      if (pnpmCmd) {
        const pnpmStore = path.join(PATHS.cache, 'pnpm');
        fs.mkdirSync(pnpmStore, { recursive: true });

        runCommandPlan(createStackDependencyInstallCommand('pnpm', pnpmCmd, {
          storeDir: pnpmStore,
          allowScripts,
        }), {
          cwd: nodePath,
          stdio: 'pipe',
          env: buildNodeToolEnv(pnpmCmd)
        });
        installedWithPnpm = true;
        onProgress?.({ phase: 'installing-deps', message: 'Dependencies installed with pnpm (shared store)' });
      }
    } catch (error) {
      console.warn(`Warning: pnpm install failed, falling back to npm: ${error.message}`);
    }

    // Fall back to npm
    if (!installedWithPnpm) {
      try {
        const npmCmd = await findNpmExecutable();
        runCommandPlan(createStackDependencyInstallCommand('npm', npmCmd, {
          allowScripts,
        }), {
          cwd: nodePath,
          stdio: 'pipe',
          env: buildNodeToolEnv(npmCmd),
        });
        onProgress?.({ phase: 'installing-deps', message: 'Dependencies installed with npm' });
      } catch (error) {
        if (failClosed) throw error;
        console.warn(`Warning: Failed to install Node.js dependencies: ${error.message}`);
      }
    }

    // Only install deps once (first matching path wins)
    break;
  }

  // Check for Python dependencies
  // Support both flat layout (requirements.txt at root) and structured layout (python/requirements.txt)
  const pythonDepsPaths = [
    stackPath,                            // Flat layout: requirements.txt at stack root
    path.join(stackPath, 'python'),       // Structured layout: python/requirements.txt
  ];

  for (const pythonPath of pythonDepsPaths) {
    const requirementsPath = path.join(pythonPath, 'requirements.txt');
    if (!fs.existsSync(requirementsPath)) continue;

    if (failClosed && !allowScripts) {
      throw new Error(
        'External stack Python dependency installation is disabled by default because package builds can execute code; review the pinned source and rerun with --allow-scripts'
      );
    }

    try {
      // Use uv if available (10-100x faster), fallback to pip
      await installPythonRequirements(pythonPath, onProgress);
    } catch (error) {
      if (failClosed) throw error;
      console.warn(`Warning: Failed to install Python dependencies: ${error.message}`);
    }

    // Only install deps once (first matching path wins)
    break;
  }
}

/**
 * Build env for Node tooling so it can resolve the matching runtime
 * @param {string} toolCmd
 * @param {NodeJS.ProcessEnv} [extraEnv]
 * @returns {NodeJS.ProcessEnv}
 */
function buildNodeToolEnv(toolCmd, extraEnv = {}) {
  const env = { ...process.env, ...extraEnv };

  if (!path.isAbsolute(toolCmd)) {
    return env;
  }

  const toolBinDir = path.dirname(toolCmd);
  const basePath = env.PATH || '';
  return {
    ...env,
    PATH: [toolBinDir, basePath].join(path.delimiter)
  };
}

/**
 * Find npm executable - prioritize bundled from Studio, fallback to system
 * Matches Studio's RuntimeController.getArchPath() pattern
 * @returns {Promise<string>} Path to npm executable
 */
async function findNpmExecutable() {
  const isWindows = process.platform === 'win32';
  const arch = process.arch === 'arm64' ? 'arm64' : 'x64';
  const binDir = isWindows ? '' : 'bin';
  const exe = isWindows ? 'npm.cmd' : 'npm';

  // Try bundled npm from Studio (in ~/.prompt/runtimes/node/)
  const bundledNodeBase = path.join(PATHS.runtimes, 'node');

  // Try architecture-specific path first (e.g., node/arm64/bin/npm)
  const archSpecificNpm = path.join(bundledNodeBase, arch, binDir, exe);

  if (fs.existsSync(archSpecificNpm)) {
    return archSpecificNpm;
  }

  // Try flat structure (e.g., node/bin/npm) for backwards compatibility
  const flatNpm = path.join(bundledNodeBase, binDir, exe);

  if (fs.existsSync(flatNpm)) {
    return flatNpm;
  }

  // Fallback to system npm (for CLI users who installed via npm)
  return 'npm';
}

/**
 * Find corepack executable - prioritize bundled from Studio, fallback to system
 * Matches Studio's RuntimeController.getArchPath() pattern
 * @returns {Promise<string>} Path to corepack executable
 */
async function findCorepackExecutable() {
  const isWindows = process.platform === 'win32';
  const arch = process.arch === 'arm64' ? 'arm64' : 'x64';
  const binDir = isWindows ? '' : 'bin';
  const exe = isWindows ? 'corepack.cmd' : 'corepack';

  const bundledNodeBase = path.join(PATHS.runtimes, 'node');
  const archSpecificCorepack = path.join(bundledNodeBase, arch, binDir, exe);
  if (fs.existsSync(archSpecificCorepack)) {
    return archSpecificCorepack;
  }

  const flatCorepack = path.join(bundledNodeBase, binDir, exe);
  if (fs.existsSync(flatCorepack)) {
    return flatCorepack;
  }

  return 'corepack';
}

/**
 * Find pnpm executable - check RUDI runtime first, then system
 * pnpm should be installed via: npm install -g pnpm (in RUDI's node runtime)
 * @returns {Promise<string|null>} Path to pnpm executable, or null if not found
 */
async function findPnpmExecutable() {
  const isWindows = process.platform === 'win32';
  const arch = process.arch === 'arm64' ? 'arm64' : 'x64';
  const binDir = isWindows ? '' : 'bin';
  const exe = isWindows ? 'pnpm.cmd' : 'pnpm';

  const bundledNodeBase = path.join(PATHS.runtimes, 'node');

  // Try architecture-specific path first (e.g., node/arm64/bin/pnpm)
  const archSpecificPnpm = path.join(bundledNodeBase, arch, binDir, exe);
  if (fs.existsSync(archSpecificPnpm)) {
    return archSpecificPnpm;
  }

  // Try flat structure (e.g., node/bin/pnpm)
  const flatPnpm = path.join(bundledNodeBase, binDir, exe);
  if (fs.existsSync(flatPnpm)) {
    return flatPnpm;
  }

  // Check if pnpm is in system PATH
  try {
    runCommandPlan({ command: 'pnpm', args: ['--version'] }, { stdio: 'pipe' });
    return 'pnpm';
  } catch {
    // pnpm not found
    return null;
  }
}


/**
 * Find python executable - prioritize bundled from Studio, fallback to system
 * Matches Studio's RuntimeController.getArchPath() pattern
 * @returns {Promise<string>} Path to python executable
 */
async function findPythonExecutable() {
  const isWindows = process.platform === 'win32';
  const arch = process.arch === 'arm64' ? 'arm64' : 'x64';
  const binDir = isWindows ? '' : 'bin';
  const exe = isWindows ? 'python.exe' : 'python3';

  // Try bundled python from Studio (in ~/.prompt/runtimes/python/)
  const bundledPythonBase = path.join(PATHS.runtimes, 'python');

  // Try architecture-specific path first (e.g., python/arm64/bin/python3)
  const archSpecificPython = path.join(bundledPythonBase, arch, binDir, exe);

  if (fs.existsSync(archSpecificPython)) {
    return archSpecificPython;
  }

  // Try flat structure (e.g., python/bin/python3) for backwards compatibility
  const flatPython = path.join(bundledPythonBase, binDir, exe);

  if (fs.existsSync(flatPython)) {
    return flatPython;
  }

  // Fallback to system python3
  return 'python3';
}

/**
 * Find uv executable - check if uv is installed in binaries
 * @returns {string|null} Path to uv executable, or null if not found
 */
export function findUvExecutable() {
  const isWindows = process.platform === 'win32';
  const exe = isWindows ? 'uv.exe' : 'uv';

  // Check in ~/.rudi/binaries/uv/
  const uvPath = path.join(PATHS.binaries, 'uv', exe);
  if (fs.existsSync(uvPath)) {
    return uvPath;
  }

  // Check if uv is in system PATH
  try {
    runCommandPlan({ command: 'uv', args: ['--version'] }, { stdio: 'pipe' });
    return 'uv';
  } catch {
    return null;
  }
}

/**
 * Ensure uv is installed - auto-install if not present
 * Call this before first Python package installation for faster installs
 * @param {Function} [onProgress] - Progress callback
 * @returns {Promise<string|null>} Path to uv executable, or null if installation failed
 */
export async function ensureUv(onProgress) {
  // Check if already available
  const existing = findUvExecutable();
  if (existing) {
    return existing;
  }

  // Auto-install uv
  onProgress?.({ phase: 'installing', message: 'Installing uv for faster Python package management...' });

  try {
    const result = await installPackage('binary:uv', { onProgress });
    if (result.success) {
      return findUvExecutable();
    }
  } catch (error) {
    console.warn(`Warning: Failed to install uv: ${error.message}`);
    console.warn('Falling back to pip for Python package installation.');
  }

  return null;
}

/**
 * Install Python package using uv (fast) or pip (fallback)
 * @param {string} installPath - Directory to install into
 * @param {string} pipPackage - Package name to install
 * @param {Function} [onProgress] - Progress callback
 * @returns {Promise<{ usedUv: boolean }>}
 */
async function installPythonPackage(installPath, pipPackage, onProgress) {
  const uvCmd = findUvExecutable();
  const validatedPipPackage = assertPipPackageSpec(pipPackage);

  if (uvCmd) {
    // Use uv - 10-100x faster than pip
    onProgress?.({ phase: 'installing', message: `uv pip install ${pipPackage}` });

    // Create venv with uv
    runCommandPlan({ command: uvCmd, args: ['venv', path.join(installPath, 'venv')] }, { stdio: 'pipe' });

    // Install package with uv
    runCommandPlan({
      command: uvCmd,
      args: ['pip', 'install', '--python', path.join(installPath, 'venv', 'bin', 'python'), validatedPipPackage],
    }, { stdio: 'pipe' });

    return { usedUv: true };
  } else {
    // Fallback to pip
    onProgress?.({ phase: 'installing', message: `pip install ${pipPackage}` });

    const pythonCmd = await findPythonExecutable();

    // Create venv with python
    runCommandPlan({ command: pythonCmd, args: ['-m', 'venv', path.join(installPath, 'venv')] }, { stdio: 'pipe' });

    // Install package with pip
    runCommandPlan(createPipInstallCommand(path.join(installPath, 'venv', 'bin', 'pip'), validatedPipPackage), { stdio: 'pipe' });

    return { usedUv: false };
  }
}

/**
 * Install Python requirements using uv (fast) or pip (fallback)
 * @param {string} pythonPath - Directory containing requirements.txt
 * @param {Function} [onProgress] - Progress callback
 * @returns {Promise<{ usedUv: boolean }>}
 */
async function installPythonRequirements(pythonPath, onProgress) {
  const uvCmd = findUvExecutable();
  const isWindows = process.platform === 'win32';
  const venvPython = isWindows
    ? path.join(pythonPath, 'venv', 'Scripts', 'python.exe')
    : path.join(pythonPath, 'venv', 'bin', 'python');

  if (uvCmd) {
    // Use uv - 10-100x faster than pip
    onProgress?.({ phase: 'installing-deps', message: 'Installing Python dependencies with uv...' });

    // Create venv with uv
    runCommandPlan({ command: uvCmd, args: ['venv', path.join(pythonPath, 'venv')] }, {
      cwd: pythonPath,
      stdio: 'pipe',
    });

    // Install requirements with uv
    runCommandPlan({
      command: uvCmd,
      args: ['pip', 'install', '--python', venvPython, '-r', 'requirements.txt'],
    }, { cwd: pythonPath, stdio: 'pipe' });

    return { usedUv: true };
  } else {
    // Fallback to pip
    onProgress?.({ phase: 'installing-deps', message: 'Installing Python dependencies...' });

    const pythonCmd = await findPythonExecutable();

    // Create venv with python
    runCommandPlan({ command: pythonCmd, args: ['-m', 'venv', 'venv'] }, {
      cwd: pythonPath,
      stdio: 'pipe',
    });

    // Install requirements with pip
    const pipCmd = isWindows ? '.\\venv\\Scripts\\pip' : './venv/bin/pip';
    runCommandPlan({ command: pipCmd, args: ['install', '-r', 'requirements.txt'] }, {
      cwd: pythonPath,
      stdio: 'pipe',
    });

    return { usedUv: false };
  }
}
