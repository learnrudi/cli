/**
 * Package installer for RUDI
 * Downloads, extracts, and installs packages
 */

import fs from 'fs';
import os from 'os';
import path from 'path';
import { pipeline } from 'stream/promises';
import { createWriteStream } from 'fs';
import { createGunzip } from 'zlib';
import {
  PATHS,
  getPackagePath,
  ensureDirectories,
  parsePackageId,
  getNodeRuntimeRoot,
  getNodeRuntimeBinDir,
  resolveNodeRuntimeBin,
  getPlatformArch
} from '@learnrudi/env';
import { downloadRuntime, downloadPackage, downloadTool, verifyHash } from '@learnrudi/registry-client';
import { resolvePackage, getInstallOrder } from './resolver.js';
import { writeLockfile } from './lockfile.js';
import { createShimsForTool, removeShims } from './shims.js';

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

/**
 * Install a package and its dependencies
 * @param {string} id - Package ID
 * @param {Object} options
 * @param {boolean} [options.force] - Force reinstall
 * @param {boolean} [options.withShims] - Create/update shims in ~/.rudi/bins
 * @param {Function} [options.onProgress] - Progress callback
 * @returns {Promise<InstallResult>}
 */
export async function installPackage(id, options = {}) {
  const { force = false, allowScripts = false, withShims = false, onProgress } = options;

  // Ensure directories exist
  ensureDirectories();

  // Resolve package and dependencies
  onProgress?.({ phase: 'resolving', package: id });
  const resolved = await resolvePackage(id);

  // Get install order (dependencies first)
  let toInstall = getInstallOrder(resolved);

  // If already installed and not forcing, skip
  if (toInstall.length === 0 && !force) {
    return {
      success: true,
      id: resolved.id,
      path: getPackagePath(resolved.id),
      alreadyInstalled: true
    };
  }

  // If forcing reinstall, add the main package if not already in list
  if (force && !toInstall.find(p => p.id === resolved.id)) {
    toInstall.push(resolved);
  }

  // Install each package in order
  const results = [];
  for (const pkg of toInstall) {
    onProgress?.({ phase: 'installing', package: pkg.id, total: toInstall.length, current: results.length + 1 });

    try {
      const result = await installSinglePackage(pkg, { force, allowScripts, withShims, onProgress });
      results.push(result);
    } catch (error) {
      return {
        success: false,
        id: pkg.id,
        error: error.message
      };
    }
  }

  // Write lockfile
  onProgress?.({ phase: 'lockfile', package: resolved.id });
  await writeLockfile(resolved);

  return {
    success: true,
    id: resolved.id,
    path: getPackagePath(resolved.id),
    installed: results.map(r => r.id)
  };
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
    const { execSync } = await import('child_process');

    if (extractType === 'none') {
      // Raw binary — move directly
      const destPath = path.join(installPath, binaryName);
      fs.copyFileSync(tempFile, destPath);
    } else if (extractType === 'tar.gz' || extractType === 'tgz') {
      execSync(`tar -xzf "${tempFile}" -C "${installPath}"`, { stdio: 'pipe' });
    } else if (extractType === 'tar.xz') {
      execSync(`tar -xJf "${tempFile}" -C "${installPath}"`, { stdio: 'pipe' });
    } else if (extractType === 'zip') {
      execSync(`unzip -o "${tempFile}" -d "${installPath}"`, { stdio: 'pipe' });
    } else {
      throw new Error(`Unsupported extract type: ${extractType}`);
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
  const { force = false, allowScripts = false, withShims = false, onProgress } = options;
  const installPath = getPackagePath(pkg.id);
  const pkgName = pkg.id.replace(/^(runtime|binary|agent):/, '');
  const isAgentNpm = pkg.kind === 'agent' && pkg.npmPackage;

  // Check if already installed
  if (fs.existsSync(installPath) && !force) {
    if (!isAgentNpm) {
      return { success: true, id: pkg.id, path: installPath, skipped: true };
    }

    // For npm-based agents, only skip if the global bin exists
    const manifestPath = path.join(installPath, 'manifest.json');
    let bins = pkg.bins || [];
    if (fs.existsSync(manifestPath)) {
      try {
        const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf-8'));
        bins = manifest.bins || manifest.binaries || bins;
      } catch {
        // Use fallback bins
      }
    }
    if (bins.length === 0) {
      bins = [pkgName];
    }

    const hasGlobalBin = bins.some(bin => fs.existsSync(resolveNodeRuntimeBin(bin)));
    if (hasGlobalBin) {
      return { success: true, id: pkg.id, path: installPath, skipped: true };
    }
  }

  // Handle runtimes, binaries, agents - download from GitHub releases or install via npm
  if (pkg.kind === 'runtime' || pkg.kind === 'binary' || pkg.kind === 'agent') {
    onProgress?.({ phase: 'downloading', package: pkg.id });

    // Handle native installer packages (e.g., Claude CLI)
    if (pkg.installType === 'native-installer' && pkg.nativeInstaller) {
      const { execSync } = await import('child_process');
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
          const which = execSync(`which ${pkgName}`, { encoding: 'utf-8' }).trim();
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
      execSync(installerCmd, { stdio: 'inherit' });

      // Verify installation
      const verifyPath = nativeBin && fs.existsSync(nativeBin) ? nativeBin : (() => {
        try { return execSync(`which ${pkgName}`, { encoding: 'utf-8' }).trim(); }
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

    // Handle npm-based packages (agents, cloud CLIs)
    if (pkg.npmPackage) {
      try {
        const { execSync } = await import('child_process');
        const npmInstallRoot = isAgentNpm ? getNodeRuntimeRoot() : installPath;
        const npmScope = isAgentNpm ? 'global' : 'local';

        if (!fs.existsSync(installPath)) {
          fs.mkdirSync(installPath, { recursive: true });
        }
        if (isAgentNpm && !fs.existsSync(npmInstallRoot)) {
          fs.mkdirSync(npmInstallRoot, { recursive: true });
        }

        onProgress?.({ phase: 'installing', package: pkg.id, message: `npm install ${pkg.npmPackage}` });

        // Use bundled Node's npm if RESOURCES_PATH is set (running from Studio)
        // Otherwise fall back to system npm (CLI standalone use)
        const resourcesPath = process.env.RESOURCES_PATH;
        const npmCmd = resourcesPath
          ? path.join(resourcesPath, 'bundled-runtimes', 'node', 'bin', 'npm')
          : await findNpmExecutable();

        // Initialize package.json if needed (local installs only)
        if (!isAgentNpm && !fs.existsSync(path.join(installPath, 'package.json'))) {
          execSync(`"${npmCmd}" init -y`, { cwd: installPath, stdio: 'pipe', env: buildNodeToolEnv(npmCmd) });
        }

        // Install the npm package with safety flags
        // --ignore-scripts: prevent arbitrary code execution during install (safer default)
        // --no-audit --no-fund: reduce noise
        const shouldIgnoreScripts = pkg.source?.type === 'npm' && !allowScripts;
        const installFlags = shouldIgnoreScripts
          ? '--ignore-scripts --no-audit --no-fund'  // Dynamic npm: safer default
          : '--no-audit --no-fund';  // Curated or --allow-scripts: run scripts

        const installCmd = isAgentNpm
          ? `install -g ${pkg.npmPackage} ${installFlags} --prefix "${npmInstallRoot}"`
          : `install ${pkg.npmPackage} ${installFlags}`;
        execSync(`"${npmCmd}" ${installCmd}`, { cwd: installPath, stdio: 'pipe', env: buildNodeToolEnv(npmCmd) });

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
          const binDir = isAgentNpm
            ? getNodeRuntimeBinDir()
            : path.join(installPath, 'node_modules', '.bin');
          // Replace 'npx <cmd>' with direct bin path for reliability
          const postInstallCmd = pkg.postInstall.replace(
            /^npx\s+(\S+)/,
            `"${path.join(binDir, '$1')}"`
          );
          execSync(postInstallCmd, {
            cwd: installPath,
            stdio: 'pipe',
            env: {
              ...process.env,
              PATH: `${binDir}${path.delimiter}${process.env.PATH || ''}`
            }
          });
        }

        // Check if package has install scripts
        const scriptsDetected = hasInstallScripts(npmInstallRoot, pkg.npmPackage, npmScope);
        const scriptsPolicy = installFlags.includes('--ignore-scripts') ? 'ignore' : 'allow';

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
          bins: bins,
          hasInstallScripts: scriptsDetected,
          scriptsPolicy: scriptsPolicy,
          postInstall: pkg.postInstall,
          installType: isAgentNpm ? 'npm-global' : 'npm',
          npmPrefix: isAgentNpm ? npmInstallRoot : undefined,
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
              installType: isAgentNpm ? 'npm-global' : 'npm',
              installDir: npmInstallRoot,
              bins: bins,
              name: pkgName
            });
          } else {
            console.warn(`[Installer] Warning: No binaries found for ${pkg.npmPackage}`);
          }
        }

        // Remove legacy local node_modules for agents (global canonical install)
        if (isAgentNpm) {
          const legacyPath = path.join(installPath, 'node_modules');
          if (fs.existsSync(legacyPath)) {
            fs.rmSync(legacyPath, { recursive: true, force: true });
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
      // If download fails, create placeholder (for development/testing)
      console.warn(`Package download failed: ${error.message}`);
      console.warn(`Creating placeholder for ${pkg.id}`);

      if (!fs.existsSync(installPath)) {
        fs.mkdirSync(installPath, { recursive: true });
      }
      fs.writeFileSync(
        path.join(installPath, 'manifest.json'),
        JSON.stringify({
          id: pkg.id,
          kind: pkg.kind,
          name: pkg.name,
          version: pkg.version,
          installedAt: new Date().toISOString(),
          source: 'placeholder',
          error: error.message
        }, null, 2)
      );
      return { success: true, id: pkg.id, path: installPath, placeholder: true };
    }
  }

  // Handle binary runtime stacks — download platform binary directly
  if (pkg.runtime === 'binary' && pkg.binary?.platforms) {
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

  // Handle stacks/prompts - download from registry or local
  if (pkg.path) {
    onProgress?.({ phase: 'downloading', package: pkg.id });
    try {
      await downloadPackage(pkg, installPath, { onProgress });

      // Skills and prompts are single .md files, no manifest.json needed
      if (pkg.kind !== 'prompt' && pkg.kind !== 'skill') {
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
    } catch (error) {
      throw new Error(`Failed to install ${pkg.id}: ${error.message}`);
    }
  }

  // Fallback: create placeholder
  // For skills and prompts, we can't create a placeholder - they must come from registry
  if (pkg.kind === 'prompt' || pkg.kind === 'skill') {
    throw new Error(`${pkg.kind === 'skill' ? 'Skill' : 'Prompt'} ${pkg.id} not found in registry`);
  }

  if (fs.existsSync(installPath)) {
    fs.rmSync(installPath, { recursive: true });
  }
  fs.mkdirSync(installPath, { recursive: true });

  const manifest = {
    id: pkg.id,
    kind: pkg.kind,
    name: pkg.name,
    version: pkg.version,
    description: pkg.description,
    installedAt: new Date().toISOString(),
    source: 'registry'
  };

  fs.writeFileSync(
    path.join(installPath, 'manifest.json'),
    JSON.stringify(manifest, null, 2)
  );

  onProgress?.({ phase: 'installed', package: pkg.id });

  return { success: true, id: pkg.id, path: installPath };
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
    if (kind !== 'prompt' && kind !== 'skill') {
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

    // Uninstall global npm package for agents
    if (kind === 'agent' && manifest?.npmPackage) {
      try {
        const { execSync } = await import('child_process');
        const npmCmd = await findNpmExecutable();
        const npmPrefix = getNodeRuntimeRoot();
        execSync(`"${npmCmd}" uninstall -g ${manifest.npmPackage} --prefix "${npmPrefix}" --no-audit --no-fund`, {
          stdio: 'pipe',
          env: buildNodeToolEnv(npmCmd)
        });
      } catch (error) {
        console.warn(`[Installer] Warning: Failed to uninstall ${manifest.npmPackage}: ${error.message}`);
      }
    }

    // Remove shims BEFORE deleting the package directory
    if (bins.length > 0) {
      removeShims(bins);
    }

    // Skills and prompts are single files, not directories
    if (kind === 'prompt' || kind === 'skill') {
      fs.unlinkSync(installPath);
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

/**
 * List all installed packages
 * @param {'stack' | 'skill' | 'prompt' | 'runtime' | 'binary' | 'agent'} [kind] - Filter by kind
 * @returns {Promise<Array>}
 */
export async function listInstalled(kind) {
  const kinds = kind ? [kind] : ['stack', 'skill', 'prompt', 'runtime', 'binary', 'agent'];
  const packages = [];

  for (const k of kinds) {
    const dir = {
      stack: PATHS.stacks,
      skill: PATHS.skills,
      prompt: PATHS.skills,  // Backward compat: prompts map to skills
      runtime: PATHS.runtimes,
      binary: PATHS.binaries,
      agent: PATHS.agents
    }[k];

    if (!dir || !fs.existsSync(dir)) continue;

    const entries = fs.readdirSync(dir, { withFileTypes: true });

    // Skills and prompts are .md files, not directories
    if (k === 'skill' || k === 'prompt') {
      for (const entry of entries) {
        if (!entry.isFile() || !entry.name.endsWith('.md') || entry.name.startsWith('.')) continue;

        const filePath = path.join(dir, entry.name);
        const name = entry.name.replace(/\.md$/, '');

        // Read skill/prompt file to extract frontmatter metadata
        try {
          const content = fs.readFileSync(filePath, 'utf-8');
          const frontmatterMatch = content.match(/^---\n([\s\S]*?)\n---/);

          let metadata = {};
          if (frontmatterMatch) {
            // Simple YAML parsing for common fields
            const yaml = frontmatterMatch[1];
            const nameMatch = yaml.match(/^name:\s*["']?(.+?)["']?\s*$/m);
            const descMatch = yaml.match(/^description:\s*["']?(.+?)["']?\s*$/m);
            const versionMatch = yaml.match(/^version:\s*["']?(.+?)["']?\s*$/m);
            const categoryMatch = yaml.match(/^category:\s*["']?(.+?)["']?\s*$/m);
            const iconMatch = yaml.match(/^icon:\s*["']?(.+?)["']?\s*$/m);

            if (nameMatch) metadata.name = nameMatch[1];
            if (descMatch) metadata.description = descMatch[1];
            if (versionMatch) metadata.version = versionMatch[1];
            if (categoryMatch) metadata.category = categoryMatch[1];
            if (iconMatch) metadata.icon = iconMatch[1];

            // Parse tags (YAML list format)
            const tagsSection = yaml.match(/^tags:\s*\n((?:\s+-\s+.+\n?)+)/m);
            if (tagsSection) {
              metadata.tags = tagsSection[1]
                .split('\n')
                .map(line => line.replace(/^\s+-\s+/, '').trim())
                .filter(Boolean);
            }

            // Parse requires.stacks (for skills)
            const requiresStacksMatch = yaml.match(/^requires:\s*\n\s+stacks:\s*\n((?:\s+-\s+.+\n?)+)/m);
            if (requiresStacksMatch) {
              metadata.requires = {
                stacks: requiresStacksMatch[1]
                  .split('\n')
                  .map(line => line.replace(/^\s+-\s+/, '').trim())
                  .filter(Boolean)
              };
            }
          }

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
        packages.push({ ...manifest, kind: k, path: pkgDir });
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

  return packages;
}

/**
 * Update a package to the latest version
 * @param {string} id - Package ID
 * @returns {Promise<InstallResult>}
 */
export async function updatePackage(id) {
  // Force reinstall
  return installPackage(id, { force: true });
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
      const result = await updatePackage(pkg.id);
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
async function installStackDependencies(stackPath, onProgress) {
  const { execSync } = await import('child_process');

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

        execSync(`"${pnpmCmd}" install --store-dir "${pnpmStore}" --prefer-frozen-lockfile`, {
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
        execSync(`"${npmCmd}" install`, { cwd: nodePath, stdio: 'pipe', env: buildNodeToolEnv(npmCmd) });
        onProgress?.({ phase: 'installing-deps', message: 'Dependencies installed with npm' });
      } catch (error) {
        console.warn(`Warning: Failed to install Node.js dependencies: ${error.message}`);
        // Don't fail installation if deps fail - stack may still work
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

    try {
      // Use uv if available (10-100x faster), fallback to pip
      await installPythonRequirements(pythonPath, onProgress);
    } catch (error) {
      console.warn(`Warning: Failed to install Python dependencies: ${error.message}`);
      // Don't fail installation if deps fail - stack may still work
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
    const { execSync } = await import('child_process');
    execSync('pnpm --version', { stdio: 'pipe' });
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
    const { execSync } = require('child_process');
    execSync('uv --version', { stdio: 'pipe' });
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
  const { execSync } = await import('child_process');
  const uvCmd = findUvExecutable();

  if (uvCmd) {
    // Use uv - 10-100x faster than pip
    onProgress?.({ phase: 'installing', message: `uv pip install ${pipPackage}` });

    // Create venv with uv
    execSync(`"${uvCmd}" venv "${installPath}/venv"`, { stdio: 'pipe' });

    // Install package with uv
    execSync(`"${uvCmd}" pip install --python "${installPath}/venv/bin/python" ${pipPackage}`, { stdio: 'pipe' });

    return { usedUv: true };
  } else {
    // Fallback to pip
    onProgress?.({ phase: 'installing', message: `pip install ${pipPackage}` });

    const pythonCmd = await findPythonExecutable();

    // Create venv with python
    execSync(`"${pythonCmd}" -m venv "${installPath}/venv"`, { stdio: 'pipe' });

    // Install package with pip
    execSync(`"${installPath}/venv/bin/pip" install ${pipPackage}`, { stdio: 'pipe' });

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
  const { execSync } = await import('child_process');
  const uvCmd = findUvExecutable();
  const isWindows = process.platform === 'win32';
  const venvPython = isWindows
    ? path.join(pythonPath, 'venv', 'Scripts', 'python.exe')
    : path.join(pythonPath, 'venv', 'bin', 'python');

  if (uvCmd) {
    // Use uv - 10-100x faster than pip
    onProgress?.({ phase: 'installing-deps', message: 'Installing Python dependencies with uv...' });

    // Create venv with uv
    execSync(`"${uvCmd}" venv "${pythonPath}/venv"`, { cwd: pythonPath, stdio: 'pipe' });

    // Install requirements with uv
    execSync(`"${uvCmd}" pip install --python "${venvPython}" -r requirements.txt`, { cwd: pythonPath, stdio: 'pipe' });

    return { usedUv: true };
  } else {
    // Fallback to pip
    onProgress?.({ phase: 'installing-deps', message: 'Installing Python dependencies...' });

    const pythonCmd = await findPythonExecutable();

    // Create venv with python
    execSync(`"${pythonCmd}" -m venv venv`, { cwd: pythonPath, stdio: 'pipe' });

    // Install requirements with pip
    const pipCmd = isWindows ? '.\\venv\\Scripts\\pip' : './venv/bin/pip';
    execSync(`${pipCmd} install -r requirements.txt`, { cwd: pythonPath, stdio: 'pipe' });

    return { usedUv: false };
  }
}
