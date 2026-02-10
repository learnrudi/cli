/**
 * Shims command - validate all shims in ~/.rudi/bins/
 *
 * Usage:
 *   rudi shims               List all shims
 *   rudi shims check         Validate all shims and report issues
 *   rudi shims fix           Attempt to fix broken shims
 *   rudi shims rebuild       Rebuild all shims from installed packages
 *
 * Exit codes:
 *   0 = all shims valid
 *   1 = one or more shims have issues
 */

import { PATHS, createShimsForTool, ensureDirectories, getNodeRuntimeBinDir, getNodeRuntimeRoot, validateShim } from '@learnrudi/core';
import fs from 'fs';
import path from 'path';

/**
 * List all shims in ~/.rudi/bins/
 */
function listShims() {
  const binsDir = PATHS.bins;

  if (!fs.existsSync(binsDir)) {
    return [];
  }

  const entries = fs.readdirSync(binsDir);
  return entries.filter(entry => {
    const fullPath = path.join(binsDir, entry);
    const stat = fs.lstatSync(fullPath);
    // Include files and symlinks, exclude directories
    return stat.isFile() || stat.isSymbolicLink();
  });
}

/**
 * Check shim type (wrapper or symlink)
 */
function getShimType(shimPath) {
  const stat = fs.lstatSync(shimPath);

  if (stat.isSymbolicLink()) {
    return 'symlink';
  }

  // Check if it's a wrapper script
  try {
    const content = fs.readFileSync(shimPath, 'utf8');
    if (content.includes('#!/usr/bin/env bash')) {
      return 'wrapper';
    }
  } catch (err) {
    // Unable to read
  }

  return 'unknown';
}

/**
 * Get shim target path
 */
function getShimTarget(name, shimPath, type) {
  if (type === 'symlink') {
    try {
      return fs.readlinkSync(shimPath);
    } catch (err) {
      return null;
    }
  }

  if (type === 'wrapper') {
    try {
      const content = fs.readFileSync(shimPath, 'utf8');
      const match = content.match(/exec "([^"]+)"/);
      return match ? match[1] : null;
    } catch (err) {
      return null;
    }
  }

  return null;
}

function createShimLink(shimPath, targetPath) {
  if (fs.existsSync(shimPath)) {
    fs.unlinkSync(shimPath);
  }
  fs.symlinkSync(targetPath, shimPath);
}

function writeShimScript(name, script) {
  const shimPath = path.join(PATHS.bins, name);
  fs.writeFileSync(shimPath, script, { encoding: 'utf8', mode: 0o755 });
}

function getCliEntryPath() {
  const candidates = [
    path.join(path.dirname(process.argv[1]), '..', 'dist', 'index.cjs'),
    path.join(path.dirname(process.argv[1]), '..', 'src', 'index.js'),
  ];

  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) {
      return candidate;
    }
  }

  return null;
}

function copyRouterMcp(routerDir) {
  const destPath = path.join(routerDir, 'router-mcp.js');
  const possibleSources = [
    path.join(path.dirname(process.argv[1]), '..', 'src', 'router-mcp.js'),
    path.join(path.dirname(process.argv[1]), '..', 'dist', 'router-mcp.js'),
  ];

  for (const source of possibleSources) {
    if (fs.existsSync(source)) {
      fs.copyFileSync(source, destPath);
      return true;
    }
  }

  return false;
}

function copySpawnMcp(routerDir) {
  const destPath = path.join(routerDir, 'spawn-mcp.js');
  const possibleSources = [
    path.join(path.dirname(process.argv[1]), '..', 'src', 'spawn-mcp.js'),
    path.join(path.dirname(process.argv[1]), '..', 'dist', 'spawn-mcp.js'),
  ];

  for (const source of possibleSources) {
    if (fs.existsSync(source)) {
      fs.copyFileSync(source, destPath);
      return true;
    }
  }

  return false;
}

function getRuntimeShimDefs() {
  const pythonBin = path.join(PATHS.runtimes, 'python', 'bin');
  const nodeBin = getNodeRuntimeBinDir() || path.join(PATHS.runtimes, 'node', 'bin');

  return {
    node: path.join(nodeBin, 'node'),
    npm: path.join(nodeBin, 'npm'),
    npx: path.join(nodeBin, 'npx'),
    python: path.join(pythonBin, 'python3'),
    python3: path.join(pythonBin, 'python3'),
    pip: path.join(pythonBin, 'pip3'),
    pip3: path.join(pythonBin, 'pip3'),
  };
}

function collectManifests(dir, kind) {
  if (!fs.existsSync(dir)) return [];
  const entries = fs.readdirSync(dir);
  const manifests = [];

  for (const entry of entries) {
    if (entry.startsWith('.')) continue;
    const entryPath = path.join(dir, entry);
    const stat = fs.statSync(entryPath);
    if (!stat.isDirectory()) continue;

    const manifestPath = path.join(entryPath, 'manifest.json');
    if (!fs.existsSync(manifestPath)) continue;

    try {
      const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
      manifests.push({ kind, name: entry, installPath: entryPath, manifest });
    } catch {
      // Skip invalid manifest
    }
  }

  return manifests;
}

function normalizeBins(manifest, fallback) {
  if (Array.isArray(manifest?.bins) && manifest.bins.length > 0) return manifest.bins;
  if (Array.isArray(manifest?.binaries) && manifest.binaries.length > 0) return manifest.binaries;
  if (Array.isArray(manifest?.commands) && manifest.commands.length > 0) return manifest.commands;
  if (typeof manifest?.bin === 'string') return [manifest.bin];
  return [fallback];
}

function inferInstallType(kind, manifest) {
  if (manifest?.installType) return manifest.installType;
  if (manifest?.pipPackage || manifest?.venvPath) return 'pip';
  if (kind === 'agent' && manifest?.npmPackage) return 'npm-global';
  if (manifest?.npmPackage) return 'npm';
  return kind === 'binary' ? 'binary' : 'binary';
}

/**
 * Get package ID from shim path
 */
function getPackageFromShim(shimName, target) {
  if (!target) return null;

  // Check manifest files to find which package provides this shim
  const manifestDirs = [
    path.join(PATHS.binaries),
    path.join(PATHS.runtimes),
    path.join(PATHS.agents)
  ];

  for (const dir of manifestDirs) {
    if (!fs.existsSync(dir)) continue;

    const packages = fs.readdirSync(dir);
    for (const pkg of packages) {
      const manifestPath = path.join(dir, pkg, 'manifest.json');
      if (fs.existsSync(manifestPath)) {
        try {
          const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
          const bins = manifest.bins || manifest.binaries || [manifest.name || pkg];
          if (bins.includes(shimName)) {
            const kind = dir.includes('binaries') ? 'binary' :
                        dir.includes('runtimes') ? 'runtime' : 'agent';
            return `${kind}:${pkg}`;
          }
        } catch (err) {
          // Skip invalid manifest
        }
      }
    }
  }

  // Extract from target path: ~/.rudi/binaries/uv/uv -> binary:uv
  const match = target.match(/\/(binaries|runtimes|agents)\/([^\/]+)/);
  if (match) {
    const [, kind, pkgName] = match;
    const kindMap = {
      'binaries': 'binary',
      'runtimes': 'runtime',
      'agents': 'agent'
    };
    return `${kindMap[kind]}:${pkgName}`;
  }

  return null;
}

/**
 * Format shim status for display
 */
function formatShimStatus(shim, flags) {
  const { name, valid, type, target, error, package: pkg } = shim;

  if (flags.json) {
    return JSON.stringify(shim, null, 2);
  }

  const icon = valid ? '\x1b[32m✓\x1b[0m' : '\x1b[31m✗\x1b[0m';
  const typeLabel = type === 'symlink' ? '→' : '⇒';

  let output = `${icon} ${name} ${typeLabel} ${target || '(no target)'}`;

  if (pkg) {
    output += ` \x1b[90m[${pkg}]\x1b[0m`;
  }

  if (!valid && error) {
    output += `\n  \x1b[31mError: ${error}\x1b[0m`;
  }

  return output;
}

/**
 * Main command handler
 */
export async function cmdShims(args, flags) {
  const subcommand = args[0] || 'list';

  if (!['list', 'check', 'fix', 'rebuild'].includes(subcommand)) {
    console.error('Usage: rudi shims [list|check|fix|rebuild]');
    process.exit(1);
  }

  if (subcommand === 'rebuild') {
    if (process.platform === 'win32') {
      console.error('Shim rebuild is not supported on Windows yet.');
      process.exit(1);
    }
    ensureDirectories();
    fs.mkdirSync(PATHS.bins, { recursive: true });

    let created = 0;
    let missing = 0;
    let collisions = 0;

    // Runtime shims (explicit opt-in)
    const runtimeShimDefs = getRuntimeShimDefs();
    for (const [name, targetPath] of Object.entries(runtimeShimDefs)) {
      if (!fs.existsSync(targetPath)) {
        missing++;
        continue;
      }
      const shimPath = path.join(PATHS.bins, name);
      createShimLink(shimPath, targetPath);
      created++;
    }

    const manifests = [
      ...collectManifests(PATHS.binaries, 'binary'),
      ...collectManifests(PATHS.agents, 'agent'),
    ];

    for (const entry of manifests) {
      const { kind, name, installPath, manifest } = entry;
      const installType = inferInstallType(kind, manifest);
      const bins = normalizeBins(manifest, manifest?.name || name);
      const id = manifest?.id || `${kind}:${name}`;
      const installDir = installType === 'npm-global'
        ? (manifest?.npmPrefix || getNodeRuntimeRoot())
        : installPath;

      const result = await createShimsForTool({
        id,
        installType,
        installDir,
        bins,
        name: manifest?.name || name,
        source: manifest?.source,
        systemPath: manifest?.systemPath,
      });

      created += result.created.length;
      collisions += result.collisions.length;
    }

    const cliEntryPath = getCliEntryPath();
    if (cliEntryPath) {
      const nodeBinDir = getNodeRuntimeBinDir();
      const nodeBin = path.join(nodeBinDir, process.platform === 'win32' ? 'node.exe' : 'node');

      writeShimScript('rudi', `#!/bin/sh
CLI_ENTRY="${cliEntryPath.replace(/"/g, '\\"')}"
NODE_BIN="${nodeBin.replace(/"/g, '\\"')}"
if [ -x "$CLI_ENTRY" ]; then
  if [ -x "$NODE_BIN" ]; then
    exec "$NODE_BIN" "$CLI_ENTRY" "$@"
  fi
  exec node "$CLI_ENTRY" "$@"
fi
echo "RUDI: CLI entry not found at $CLI_ENTRY" 1>&2
exit 127
`);
      created++;
    }

    writeShimScript('rudi-mcp', `#!/bin/sh
# RUDI MCP Shim - Routes agent calls to rudi mcp command
exec rudi mcp "$@"
`);
    created++;

    const routerDir = path.join(PATHS.home, 'router');
    fs.mkdirSync(routerDir, { recursive: true });
    fs.writeFileSync(path.join(routerDir, 'package.json'), JSON.stringify({
      name: 'rudi-router',
      type: 'module',
      private: true
    }, null, 2));

    if (copyRouterMcp(routerDir)) {
      const routerNodeBin = path.join(getNodeRuntimeBinDir(), process.platform === 'win32' ? 'node.exe' : 'node');
      writeShimScript('rudi-router', `#!/bin/sh
# RUDI Router - Master MCP server for all installed stacks
RUDI_HOME="$HOME/.rudi"
NODE_BIN="${routerNodeBin.replace(/"/g, '\\"')}"
if [ -x "$NODE_BIN" ]; then
  exec "$NODE_BIN" "$RUDI_HOME/router/router-mcp.js" "$@"
else
  exec node "$RUDI_HOME/router/router-mcp.js" "$@"
fi
`);
      created++;
    } else {
      console.warn('⚠ router-mcp.js not found; rudi-router shim not created');
    }

    if (copySpawnMcp(routerDir)) {
      const spawnNodeBin = path.join(getNodeRuntimeBinDir(), process.platform === 'win32' ? 'node.exe' : 'node');
      writeShimScript('rudi-spawn', `#!/bin/sh
# RUDI Spawn MCP - Child session spawning via sidecar
RUDI_HOME="$HOME/.rudi"
NODE_BIN="${spawnNodeBin.replace(/"/g, '\\"')}"
if [ -x "$NODE_BIN" ]; then
  exec "$NODE_BIN" "$RUDI_HOME/router/spawn-mcp.js" "$@"
else
  exec node "$RUDI_HOME/router/spawn-mcp.js" "$@"
fi
`);
      created++;
    } else {
      console.warn('⚠ spawn-mcp.js not found; rudi-spawn shim not created');
    }

    console.log(`✓ Rebuilt shims in ~/.rudi/bins/ (${created} created, ${collisions} collisions, ${missing} missing)`);
    process.exit(0);
  }

  const shimNames = listShims();

  if (shimNames.length === 0) {
    console.log('No shims found in ~/.rudi/bins/');
    process.exit(0);
  }

  // List mode - just show shim names
  if (subcommand === 'list' && !flags.verbose) {
    shimNames.forEach(name => console.log(name));
    process.exit(0);
  }

  // Check mode - validate all shims
  const results = [];
  let hasIssues = false;

  for (const name of shimNames) {
    const shimPath = path.join(PATHS.bins, name);
    const validation = validateShim(name);
    const type = getShimType(shimPath);
    const target = getShimTarget(name, shimPath, type);
    const pkg = getPackageFromShim(name, target);

    const result = {
      name,
      valid: validation.valid,
      type,
      target: validation.target || target,
      error: validation.error,
      package: pkg
    };

    results.push(result);

    if (!result.valid) {
      hasIssues = true;
    }
  }

  // Output results
  if (flags.json) {
    console.log(JSON.stringify(results, null, 2));
  } else {
    console.log(`\nShims in ~/.rudi/bins/ (${results.length} total):\n`);

    if (flags.verbose || subcommand === 'check') {
      results.forEach(result => {
        console.log(formatShimStatus(result, flags));
      });
    } else {
      results.forEach(result => {
        const icon = result.valid ? '\x1b[32m✓\x1b[0m' : '\x1b[31m✗\x1b[0m';
        console.log(`${icon} ${result.name}`);
      });
    }

    // Summary
    const valid = results.filter(r => r.valid).length;
    const broken = results.filter(r => !r.valid).length;

    console.log(`\n${valid} valid, ${broken} broken`);

    if (hasIssues) {
      console.log('\n\x1b[33mTo fix broken shims, reinstall the affected packages:\x1b[0m');
      const brokenPackages = new Set();
      results.forEach(r => {
        if (!r.valid && r.package) {
          brokenPackages.add(r.package);
        }
      });
      brokenPackages.forEach(pkg => {
        console.log(`  rudi install ${pkg} --force`);
      });
    }
  }

  // Fix mode
  if (subcommand === 'fix') {
    console.log('\n\x1b[33mAttempting to fix broken shims...\x1b[0m\n');

    const brokenWithPkg = results.filter(r => !r.valid && r.package);
    const orphaned = results.filter(r => !r.valid && !r.package);

    // Remove orphaned shims (no associated package)
    if (orphaned.length > 0) {
      console.log(`Removing ${orphaned.length} orphaned shims...`);
      for (const shim of orphaned) {
        const shimPath = path.join(PATHS.bins, shim.name);
        try {
          fs.unlinkSync(shimPath);
          console.log(`  \x1b[32m✓\x1b[0m Removed ${shim.name}`);
        } catch (err) {
          console.log(`  \x1b[31m✗\x1b[0m Failed to remove ${shim.name}: ${err.message}`);
        }
      }
      console.log('');
    }

    // Reinstall broken packages
    const brokenPackages = new Set(brokenWithPkg.map(r => r.package));

    if (brokenPackages.size === 0 && orphaned.length === 0) {
      console.log('No broken shims to fix.');
      process.exit(0);
    }

    if (brokenPackages.size > 0) {
      const { installPackage } = await import('@learnrudi/core');

      for (const pkg of brokenPackages) {
        console.log(`Reinstalling ${pkg}...`);
        try {
          await installPackage(pkg, { force: true, withShims: true });
          console.log(`\x1b[32m✓\x1b[0m Fixed ${pkg}`);
        } catch (err) {
          console.log(`\x1b[31m✗\x1b[0m Failed to fix ${pkg}: ${err.message}`);
        }
      }
    }

    console.log('\n\x1b[32m✓\x1b[0m Fix complete');
  }

  process.exit(hasIssues ? 1 : 0);
}
