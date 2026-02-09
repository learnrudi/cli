#!/usr/bin/env node
/**
 * Post-install script for @learnrudi/cli
 *
 * Fetches runtime manifests from registry and downloads:
 * 1. Node.js runtime → ~/.rudi/runtimes/node/
 * 2. Python runtime → ~/.rudi/runtimes/python/
 * 3. (Optional) Creates shims → ~/.rudi/bins/ (opt-in)
 * 4. Initializes rudi.json → ~/.rudi/rudi.json
 */

import { execSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

const RUDI_HOME = path.join(os.homedir(), '.rudi');
const RUDI_JSON_PATH = path.join(RUDI_HOME, 'rudi.json');
const RUDI_JSON_TMP = path.join(RUDI_HOME, 'rudi.json.tmp');
const REGISTRY_BASE = 'https://raw.githubusercontent.com/learn-rudi/registry/main';

// Use 'bins' (consistent with @learnrudi/env) not 'shims'
const BINS_DIR = path.join(RUDI_HOME, 'bins');
const CREATE_SHIMS = process.env.RUDI_CREATE_SHIMS === '1' || process.env.RUDI_WITH_SHIMS === '1';

// =============================================================================
// RUDI.JSON CONFIG MANAGEMENT
// =============================================================================

/**
 * Create a new empty RudiConfig
 */
function createRudiConfig() {
  const now = new Date().toISOString();
  return {
    version: '1.0.0',
    schemaVersion: 1,
    installed: false,
    installedAt: now,
    updatedAt: now,
    runtimes: {},
    stacks: {},
    binaries: {},
    secrets: {}
  };
}

/**
 * Read rudi.json
 */
function readRudiConfig() {
  try {
    const content = fs.readFileSync(RUDI_JSON_PATH, 'utf-8');
    return JSON.parse(content);
  } catch (err) {
    if (err.code === 'ENOENT') {
      return null;
    }
    console.log(`  ⚠ Failed to read rudi.json: ${err.message}`);
    return null;
  }
}

/**
 * Write rudi.json atomically with secure permissions
 */
function writeRudiConfig(config) {
  config.updatedAt = new Date().toISOString();
  const content = JSON.stringify(config, null, 2);

  // Write to temp file
  fs.writeFileSync(RUDI_JSON_TMP, content, { mode: 0o600 });

  // Atomic rename
  fs.renameSync(RUDI_JSON_TMP, RUDI_JSON_PATH);

  // Ensure permissions (rename may not preserve them)
  fs.chmodSync(RUDI_JSON_PATH, 0o600);
}

/**
 * Initialize rudi.json if it doesn't exist
 */
function initRudiConfig() {
  if (fs.existsSync(RUDI_JSON_PATH)) {
    console.log(`  ✓ rudi.json already exists`);
    return readRudiConfig();
  }

  const config = createRudiConfig();
  writeRudiConfig(config);
  console.log(`  ✓ Created rudi.json`);
  return config;
}

/**
 * Update rudi.json with runtime info after successful download
 */
function updateRudiConfigRuntime(runtimeId, runtimePath, version) {
  const config = readRudiConfig() || createRudiConfig();
  const platform = process.platform;

  let bin;
  if (runtimeId === 'node') {
    bin = platform === 'win32' ? 'node.exe' : 'bin/node';
  } else if (runtimeId === 'python') {
    bin = platform === 'win32' ? 'python.exe' : 'bin/python3';
  } else {
    bin = runtimeId;
  }

  config.runtimes[runtimeId] = {
    path: runtimePath,
    bin: path.join(runtimePath, bin),
    version: version
  };

  writeRudiConfig(config);
}

/**
 * Update rudi.json with binary info after successful download
 */
function updateRudiConfigBinary(binaryName, binaryPath, version) {
  const config = readRudiConfig() || createRudiConfig();

  config.binaries[binaryName] = {
    path: binaryPath,
    bin: path.join(binaryPath, binaryName),
    version: version,
    installed: true,
    installedAt: new Date().toISOString()
  };

  writeRudiConfig(config);
}

/**
 * Mark rudi.json as fully installed
 */
function markRudiConfigInstalled() {
  const config = readRudiConfig() || createRudiConfig();
  config.installed = true;
  writeRudiConfig(config);
}

// Detect platform
function getPlatformArch() {
  const platform = process.platform;
  const arch = process.arch;

  if (platform === 'darwin') {
    return arch === 'arm64' ? 'darwin-arm64' : 'darwin-x64';
  } else if (platform === 'linux') {
    return arch === 'arm64' ? 'linux-arm64' : 'linux-x64';
  } else if (platform === 'win32') {
    return 'win32-x64';
  }
  return null;
}

// Create directory structure
function ensureDirectories() {
  const dirs = [
    RUDI_HOME,
    path.join(RUDI_HOME, 'runtimes'),
    path.join(RUDI_HOME, 'stacks'),
    path.join(RUDI_HOME, 'binaries'),
    path.join(RUDI_HOME, 'agents'),
    BINS_DIR,  // Use bins/ (consistent with @learnrudi/env)
    path.join(RUDI_HOME, 'cache'),
    path.join(RUDI_HOME, 'router'),
  ];

  for (const dir of dirs) {
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
  }
}

// Fetch JSON from URL
async function fetchJson(url) {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Failed to fetch ${url}: ${response.status}`);
  }
  return response.json();
}

// Download and extract a tarball
async function downloadAndExtract(url, destDir, name) {
  const tempFile = path.join(RUDI_HOME, 'cache', `${name}.tar.gz`);

  console.log(`  Downloading ${name}...`);

  try {
    // Download using curl
    execSync(`curl -fsSL "${url}" -o "${tempFile}"`, { stdio: 'pipe' });

    // Create dest directory
    if (fs.existsSync(destDir)) {
      fs.rmSync(destDir, { recursive: true });
    }
    fs.mkdirSync(destDir, { recursive: true });

    // Extract - strip first component to avoid nested dirs
    execSync(`tar -xzf "${tempFile}" -C "${destDir}" --strip-components=1`, { stdio: 'pipe' });

    // Clean up
    fs.unlinkSync(tempFile);

    console.log(`  ✓ ${name} installed`);
    return true;
  } catch (error) {
    console.log(`  ⚠ Failed to install ${name}: ${error.message}`);
    if (fs.existsSync(tempFile)) {
      fs.unlinkSync(tempFile);
    }
    return false;
  }
}

// Download runtime from manifest
async function downloadRuntime(runtimeId, platformArch) {
  const manifestUrl = `${REGISTRY_BASE}/catalog/runtimes/${runtimeId}.json`;

  try {
    const manifest = await fetchJson(manifestUrl);
    const downloadUrl = manifest.download?.[platformArch];

    if (!downloadUrl) {
      console.log(`  ⚠ No ${runtimeId} available for ${platformArch}`);
      return false;
    }

    const destDir = path.join(RUDI_HOME, 'runtimes', runtimeId);
    const binaryPath = path.join(destDir, manifest.binary || `bin/${runtimeId}`);

    // Skip if already installed
    if (fs.existsSync(binaryPath)) {
      console.log(`  ✓ ${manifest.name} already installed`);
      // Still update rudi.json in case it's missing this runtime
      updateRudiConfigRuntime(runtimeId, destDir, manifest.version);
      return true;
    }

    const success = await downloadAndExtract(downloadUrl, destDir, manifest.name);
    if (success) {
      // Update rudi.json with runtime info
      updateRudiConfigRuntime(runtimeId, destDir, manifest.version);
    }
    return success;
  } catch (error) {
    console.log(`  ⚠ Failed to fetch ${runtimeId} manifest: ${error.message}`);
    return false;
  }
}

// =============================================================================
// SHIM GENERATION
// =============================================================================

/**
 * Load packages manifest (generated at build time from registry catalog)
 * Falls back to empty manifest if not found
 */
function loadPackagesManifest() {
  const possiblePaths = [
    // When running from npm install (dist directory)
    path.join(path.dirname(process.argv[1]), '..', 'dist', 'packages-manifest.json'),
    // When running from source/dev
    path.join(path.dirname(process.argv[1]), '..', 'src', 'packages-manifest.json'),
  ];

  for (const manifestPath of possiblePaths) {
    try {
      if (fs.existsSync(manifestPath)) {
        const content = fs.readFileSync(manifestPath, 'utf-8');
        return JSON.parse(content);
      }
    } catch {
      // Try next path
    }
  }

  console.log('  ⚠ packages-manifest.json not found, using minimal shims');
  return { packages: { runtimes: [], agents: [], binaries: [] } };
}

function resolveNodeRuntimeBinDir() {
  const isWindows = process.platform === 'win32';
  const arch = process.arch === 'arm64' ? 'arm64' : 'x64';
  const binDir = isWindows ? 'Scripts' : 'bin';
  const nodeRoot = path.join(RUDI_HOME, 'runtimes', 'node');
  const archBin = path.join(nodeRoot, arch, binDir);
  const flatBin = path.join(nodeRoot, binDir);
  const nodeExe = isWindows ? 'node.exe' : 'node';

  if (fs.existsSync(path.join(archBin, nodeExe))) {
    return archBin;
  }

  return flatBin;
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

/**
 * Build a shim script that executes a target binary
 * Shows helpful error if binary not installed
 */
function buildExecShim(targetPath, notInstalledMessage) {
  const target = targetPath.replace(/"/g, '\\"');
  const message = notInstalledMessage.replace(/"/g, '\\"');
  return `#!/bin/sh
TARGET="${target}"
if [ ! -x "$TARGET" ]; then
  echo "RUDI: ${message}" 1>&2
  exit 127
fi
exec "$TARGET" "$@"
`;
}

/**
 * Build a shim script that runs a binary with extra args prepended
 * Used for things like "pip" which runs "python3 -m pip"
 */
function buildArgsShim(targetPath, args, notInstalledMessage) {
  const target = targetPath.replace(/"/g, '\\"');
  const argsStr = args.map(a => `"${a.replace(/"/g, '\\"')}"`).join(' ');
  const message = notInstalledMessage.replace(/"/g, '\\"');
  return `#!/bin/sh
TARGET="${target}"
if [ ! -x "$TARGET" ]; then
  echo "RUDI: ${message}" 1>&2
  exit 127
fi
exec "$TARGET" ${argsStr} "$@"
`;
}

/**
 * Create all shims for runtimes, agents, and binaries
 * Reads from packages-manifest.json (generated from registry catalog)
 */
function createShims() {
  const platform = process.platform;
  const isWindows = platform === 'win32';

  // Skip shim creation on Windows (uses different mechanism)
  if (isWindows) {
    console.log(`  ⚠ Shim creation skipped on Windows`);
    return;
  }

  const manifest = loadPackagesManifest();
  const shimDefs = [];
  const nodeBinDir = resolveNodeRuntimeBinDir();

  // ---------------------------------------------------------------------------
  // GENERATE SHIMS FROM MANIFEST (only for installed packages)
  // ---------------------------------------------------------------------------

  const allPackages = [
    ...manifest.packages.runtimes,
    ...manifest.packages.agents,
    ...manifest.packages.binaries,
  ];

  for (const pkg of allPackages) {
    const isAgentNpm = pkg.kind === 'agent' && (pkg.installType === 'npm' || pkg.installType === 'npm-global');
    const installPath = isAgentNpm
      ? path.join(RUDI_HOME, 'runtimes', 'node')
      : path.join(RUDI_HOME, pkg.basePath, pkg.installDir);

    // Only create shims for packages that are actually installed
    // Check if the install directory exists
    if (!fs.existsSync(installPath)) {
      continue;
    }

    for (const cmd of pkg.commands) {
      const binName = isAgentNpm ? path.basename(cmd.bin) : cmd.bin;
      const binPath = isAgentNpm
        ? path.join(nodeBinDir, binName)
        : path.join(installPath, cmd.bin);

      // Only create shim if the target binary exists
      if (!fs.existsSync(binPath)) {
        continue;
      }

      if (cmd.args && cmd.args.length > 0) {
        // Command with prepended args (like pip -> python3 -m pip)
        shimDefs.push({
          name: cmd.name,
          script: buildArgsShim(binPath, cmd.args, `${pkg.name} binary not found`),
        });
      } else {
        // Simple exec shim
        shimDefs.push({
          name: cmd.name,
          script: buildExecShim(binPath, `${pkg.name} binary not found`),
        });
      }
    }
  }

  // ---------------------------------------------------------------------------
  // RUDI SHIMS (router, mcp) - always included
  // ---------------------------------------------------------------------------

  const cliEntryPath = getCliEntryPath();
  if (cliEntryPath) {
    const nodeBin = path.join(nodeBinDir, isWindows ? 'node.exe' : 'node');
    shimDefs.push({
      name: 'rudi',
      script: `#!/bin/sh
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
`
    });
  }

  // rudi-mcp shim for direct stack access
  shimDefs.push({
    name: 'rudi-mcp',
    script: `#!/bin/bash
# RUDI MCP Shim - Routes agent calls to rudi mcp command
# Usage: rudi-mcp <stack-name>
exec rudi mcp "$@"
`
  });

  // rudi-router shim for aggregated MCP server
  const routerNodeBin = path.join(nodeBinDir, isWindows ? 'node.exe' : 'node');
  shimDefs.push({
    name: 'rudi-router',
    script: `#!/bin/bash
# RUDI Router - Master MCP server for all installed stacks
# Reads ~/.rudi/rudi.json and proxies tool calls to correct stack
RUDI_HOME="$HOME/.rudi"
NODE_BIN="${routerNodeBin.replace(/"/g, '\\"')}"
if [ -x "$NODE_BIN" ]; then
  exec "$NODE_BIN" "$RUDI_HOME/router/router-mcp.js" "$@"
else
  exec node "$RUDI_HOME/router/router-mcp.js" "$@"
fi
`
  });

  // ---------------------------------------------------------------------------
  // WRITE ALL SHIMS
  // ---------------------------------------------------------------------------

  let created = 0;
  for (const { name, script } of shimDefs) {
    const shimPath = path.join(BINS_DIR, name);
    fs.writeFileSync(shimPath, script, { encoding: 'utf-8' });
    fs.chmodSync(shimPath, 0o755);
    created++;
  }

  console.log(`  ✓ Created ${created} shims in ~/.rudi/bins/`);

  // ---------------------------------------------------------------------------
  // ROUTER SETUP
  // ---------------------------------------------------------------------------

  // Create package.json for ES module support
  const routerDir = path.join(RUDI_HOME, 'router');
  const routerPackageJson = path.join(routerDir, 'package.json');
  fs.writeFileSync(routerPackageJson, JSON.stringify({
    name: 'rudi-router',
    type: 'module',
    private: true
  }, null, 2));

  // Copy router-mcp.js to ~/.rudi/router/
  copyRouterMcp();
}

/**
 * Copy router-mcp.js to ~/.rudi/router/
 * Looks for the file relative to this script's location
 */
function copyRouterMcp() {
  const routerDir = path.join(RUDI_HOME, 'router');
  const destPath = path.join(routerDir, 'router-mcp.js');

  // Try multiple possible source locations
  const possibleSources = [
    // When running from npm install (scripts dir)
    path.join(path.dirname(process.argv[1]), '..', 'src', 'router-mcp.js'),
    // When running from npm link or local dev
    path.join(path.dirname(process.argv[1]), '..', 'dist', 'router-mcp.js'),
    // Relative to this script
    path.resolve(import.meta.url.replace('file://', '').replace('/scripts/postinstall.js', ''), 'src', 'router-mcp.js'),
  ];

  for (const srcPath of possibleSources) {
    try {
      if (fs.existsSync(srcPath)) {
        fs.copyFileSync(srcPath, destPath);
        console.log(`  ✓ Installed router-mcp.js`);
        return;
      }
    } catch {
      // Try next path
    }
  }

  // Create a minimal placeholder if source not found
  // This will be updated on next CLI update
  const placeholderContent = `#!/usr/bin/env node
// RUDI Router MCP Server - Placeholder
// This file should be replaced by the actual router-mcp.js from @learnrudi/cli
console.error('[rudi-router] Router not properly installed. Run: npm update -g @learnrudi/cli');
process.exit(1);
`;

  fs.writeFileSync(destPath, placeholderContent, { mode: 0o755 });
  console.log(`  ⚠ Created router placeholder (will be updated on next CLI install)`);
}

// Initialize secrets file with secure permissions
function initSecrets() {
  const secretsPath = path.join(RUDI_HOME, 'secrets.json');

  if (!fs.existsSync(secretsPath)) {
    fs.writeFileSync(secretsPath, '{}', { mode: 0o600 });
    console.log(`  ✓ Created secrets store`);
  }
}

// Initialize database
function initDatabase() {
  const dbPath = path.join(RUDI_HOME, 'rudi.db');

  if (fs.existsSync(dbPath)) {
    console.log(`  ✓ Database already exists`);
    return;
  }

  try {
    // Use rudi CLI to init the database (it has the schema)
    execSync('node -e "require(\'@learnrudi/db\').initSchema()"', {
      stdio: 'pipe',
      cwd: path.dirname(process.argv[1])
    });
    console.log(`  ✓ Database initialized`);
  } catch (error) {
    console.log(`  ⚠ Database init deferred (run 'rudi init' later)`);
  }
}

// Download a binary from manifest
async function downloadBinary(binaryName, platformArch) {
  const manifestUrl = `${REGISTRY_BASE}/catalog/binaries/${binaryName}.json`;

  try {
    const manifest = await fetchJson(manifestUrl);
    const upstream = manifest.upstream?.[platformArch];

    if (!upstream) {
      console.log(`  ⚠ No ${binaryName} available for ${platformArch}`);
      return false;
    }

    const destDir = path.join(RUDI_HOME, 'binaries', binaryName);
    const binaryPath = path.join(destDir, manifest.binary || binaryName);

    // Skip if already installed
    if (fs.existsSync(binaryPath)) {
      console.log(`  ✓ ${manifest.name || binaryName} already installed`);
      // Still update rudi.json in case it's missing this binary
      updateRudiConfigBinary(binaryName, destDir, manifest.version);
      return true;
    }

    const success = await downloadAndExtract(upstream, destDir, manifest.name || binaryName);
    if (success) {
      // Update rudi.json with binary info
      updateRudiConfigBinary(binaryName, destDir, manifest.version);
    }
    return success;
  } catch (error) {
    console.log(`  ⚠ Failed to fetch ${binaryName} manifest: ${error.message}`);
    return false;
  }
}

// Check if RUDI is already initialized (by Studio or previous install)
function isRudiInitialized() {
  const nodeBin = path.join(RUDI_HOME, 'runtimes', 'node', 'bin', 'node');
  const pythonBin = path.join(RUDI_HOME, 'runtimes', 'python', 'bin', 'python3');
  const db = path.join(RUDI_HOME, 'rudi.db');

  return fs.existsSync(nodeBin) &&
         fs.existsSync(pythonBin) &&
         fs.existsSync(db);
}

// Main setup
async function setup() {
  console.log('\nSetting up RUDI...\n');

  const platformArch = getPlatformArch();
  if (!platformArch) {
    console.log('⚠ Unsupported platform. Skipping runtime download.');
    console.log('  You can manually install runtimes later with: rudi install runtime:node\n');
    return;
  }

  // Check if already initialized (by Studio or previous install)
  if (isRudiInitialized()) {
    console.log('✓ RUDI already initialized');
    // Still init rudi.json in case it's missing (migration from older version)
    console.log('\nUpdating configuration...');
    initRudiConfig();
    if (CREATE_SHIMS) {
      console.log('\nUpdating shims...');
      createShims();
    }
    console.log('  Skipping runtime and binary downloads\n');
    console.log('Run `rudi doctor` to check system health\n');
    return;
  }

  // Create directories
  ensureDirectories();
  console.log('✓ Created ~/.rudi directory structure\n');

  // Initialize rudi.json (single source of truth)
  console.log('Initializing configuration...');
  initRudiConfig();

  // Download runtimes from registry manifests
  console.log('\nInstalling runtimes...');
  await downloadRuntime('node', platformArch);
  await downloadRuntime('python', platformArch);

  // Download essential binaries
  console.log('\nInstalling essential binaries...');
  await downloadBinary('sqlite', platformArch);
  await downloadBinary('ripgrep', platformArch);

  // Create shims (opt-in)
  if (CREATE_SHIMS) {
    console.log('\nSetting up shims...');
    createShims();
  }

  // Initialize secrets
  initSecrets();

  // Initialize database
  console.log('\nInitializing database...');
  initDatabase();

  // Mark config as fully installed
  markRudiConfigInstalled();

  console.log('\n✓ RUDI setup complete!\n');
  console.log('Get started:');
  console.log('  rudi search --all      # See available stacks');
  console.log('  rudi install slack     # Install a stack');
  console.log('  rudi doctor            # Check system health\n');
  if (!CREATE_SHIMS) {
    console.log('Shims are opt-in. To expose installed tools on PATH:');
    console.log('  rudi shims rebuild\n');
  }
}

// Run
setup().catch(err => {
  console.error('Setup error:', err.message);
  // Don't fail npm install - user can run rudi doctor later
  process.exit(0);
});
