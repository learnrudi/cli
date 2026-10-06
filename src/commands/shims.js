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

import { PATHS, createShimsForTool, ensureDirectories, getNodeRuntimeBinDir, getNodeRuntimeRoot, getShimOwner, validateShim } from '@learnrudi/core';
import fs from 'fs';
import path from 'path';

const LEGACY_AGENT_SHIM_IDS = new Map([
  ['agy', 'antigravity'],
  ['antigravity', 'antigravity'],
  ['claude', 'claude'],
  ['claude-code', 'claude'],
  ['codex', 'codex'],
  ['copilot', 'copilot'],
  ['gemini', 'gemini'],
  ['github-copilot-cli', 'copilot'],
]);

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
    if (/^#![^\r\n]*(?:^|[\/\s])(?:ba|z|k)?sh(?:\s|$)/.test(content)) {
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
    path.join(path.dirname(process.argv[1]), '..', 'dist', 'router-mcp.js'),
    path.join(path.dirname(process.argv[1]), '..', 'src', 'router-mcp.js'),
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
export function getPackageFromShim(shimName, target) {
  const legacyAgentId = LEGACY_AGENT_SHIM_IDS.get(shimName);
  if (legacyAgentId) {
    const legacyPackageId = `agent:${legacyAgentId}`;
    const recordedOwner = getShimOwner(shimName);
    const targetIsLegacyRudiPayload = typeof target === 'string'
      && path.isAbsolute(target)
      && path.basename(target) === shimName
      && [PATHS.agents, getNodeRuntimeRoot()].some(root => {
        const relativeTarget = path.relative(root, target);
        return relativeTarget === '' || (
          relativeTarget !== '..'
          && !relativeTarget.startsWith(`..${path.sep}`)
          && !path.isAbsolute(relativeTarget)
        );
      });
    if (recordedOwner?.owner === legacyPackageId || targetIsLegacyRudiPayload) {
      return legacyPackageId;
    }
  }
  if (!target) return null;

  // Check manifest files to find which package provides this shim
  const manifestDirs = [
    path.join(PATHS.binaries),
    path.join(PATHS.runtimes),
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

export function getBrokenShimGuidance(packageIds) {
  return [...new Set([...packageIds].map(pkg => (
    pkg.startsWith('agent:')
      ? 'rudi shims fix'
      : `rudi install ${pkg} --force`
  )))];
}

export function removeBrokenLegacyAgentShims(pkg, shims, dependencies = {}) {
  const binsPath = dependencies.binsPath || PATHS.bins;
  const unlinkSyncImpl = dependencies.unlinkSyncImpl || fs.unlinkSync;
  const result = { failed: [], removed: [] };

  for (const shim of shims) {
    if (shim.valid || shim.package !== pkg) continue;
    try {
      unlinkSyncImpl(path.join(binsPath, shim.name));
      result.removed.push(shim.name);
    } catch (error) {
      result.failed.push({ error: error.message, name: shim.name });
    }
  }
  return result;
}

export async function repairBrokenShimPackage(pkg, installPackageImpl) {
  if (pkg.startsWith('agent:')) {
    return {
      error: 'Legacy Agent Host shims are removal-only.',
      package: pkg,
      removalOnly: true,
      success: false,
    };
  }

  try {
    const result = await installPackageImpl(pkg, { force: true, withShims: true });
    return {
      ...result,
      package: pkg,
      success: result?.success === true,
      ...(result?.success === true ? {} : { error: result?.error || 'Package reinstall failed.' }),
    };
  } catch (error) {
    return { error: error.message, package: pkg, success: false };
  }
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
        nodeRuntime: manifest?.nodeRuntime,
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
      console.log('\n\x1b[33mTo resolve broken shims:\x1b[0m');
      const brokenPackages = new Set();
      results.forEach(r => {
        if (!r.valid && r.package) {
          brokenPackages.add(r.package);
        }
      });
      getBrokenShimGuidance(brokenPackages).forEach(command => {
        console.log(`  ${command}`);
      });
    }
  }

  let fixUnresolved = 0;

  // Fix mode
  if (subcommand === 'fix') {
    console.log('\n\x1b[33mAttempting to fix broken shims...\x1b[0m\n');

    const brokenWithPkg = results.filter(r => !r.valid && r.package);
    const orphaned = results.filter(r => !r.valid && !r.package && r.type === 'symlink');
    const preservedUnknown = results.filter(r => !r.valid && !r.package && r.type !== 'symlink');

    // An unowned regular file may be a hand-written or generated wrapper that
    // this CLI version does not understand. Preserve it rather than turning a
    // parser limitation into destructive cleanup.
    for (const shim of preservedUnknown) {
      fixUnresolved += 1;
      console.log(`\x1b[33m!\x1b[0m Preserved ${shim.name}: ${shim.error || 'unrecognized wrapper'}`);
    }

    // Remove orphaned shims (no associated package)
    if (orphaned.length > 0) {
      console.log(`Removing ${orphaned.length} orphaned shims...`);
      for (const shim of orphaned) {
        const shimPath = path.join(PATHS.bins, shim.name);
        try {
          fs.unlinkSync(shimPath);
          console.log(`  \x1b[32m✓\x1b[0m Removed ${shim.name}`);
        } catch (err) {
          fixUnresolved += 1;
          console.log(`  \x1b[31m✗\x1b[0m Failed to remove ${shim.name}: ${err.message}`);
        }
      }
      console.log('');
    }

    // Reinstall broken packages
    const brokenPackages = new Set(brokenWithPkg.map(r => r.package));

    if (brokenPackages.size === 0 && orphaned.length === 0 && preservedUnknown.length === 0) {
      console.log('No broken shims to fix.');
      process.exit(0);
    }

    if (brokenPackages.size > 0) {
      const { installPackage } = await import('@learnrudi/core');

      for (const pkg of brokenPackages) {
        if (pkg.startsWith('agent:')) {
          const cleanup = removeBrokenLegacyAgentShims(pkg, brokenWithPkg);
          for (const name of cleanup.removed) {
            console.log(`\x1b[32m✓\x1b[0m Removed legacy Agent Host shim ${name}`);
          }
          for (const failure of cleanup.failed) {
            fixUnresolved += 1;
            console.log(`\x1b[31m✗\x1b[0m Failed to remove ${failure.name}: ${failure.error}`);
          }
          continue;
        }
        console.log(`Reinstalling ${pkg}...`);
        const repair = await repairBrokenShimPackage(pkg, installPackage);
        if (repair.success) {
          console.log(`\x1b[32m✓\x1b[0m Fixed ${pkg}`);
        } else {
          fixUnresolved += 1;
          console.log(`\x1b[31m✗\x1b[0m Failed to fix ${pkg}: ${repair.error}`);
        }
      }
    }

    if (fixUnresolved > 0) {
      console.log(`\n\x1b[33m!\x1b[0m Fix incomplete: ${fixUnresolved} item(s) still need attention`);
    } else {
      console.log('\n\x1b[32m✓\x1b[0m Fix complete');
    }
  }

  process.exit(subcommand === 'fix' ? (fixUnresolved > 0 ? 1 : 0) : (hasIssues ? 1 : 0));
}
