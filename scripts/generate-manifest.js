#!/usr/bin/env node
/**
 * Generate packages-manifest.json from registry catalog
 *
 * This script reads all package definitions from the registry catalog
 * and generates a unified manifest for shim generation.
 *
 * Run at build time: node scripts/generate-manifest.js
 * Output: src/packages-manifest.json (bundled with CLI)
 */

import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const REGISTRY_PATHS = [
  process.env.RUDI_REGISTRY_CATALOG,
  path.resolve(__dirname, '../../registry/catalog'),
].filter(Boolean).map((registryPath) => path.resolve(registryPath));

function findRegistryPath() {
  for (const p of REGISTRY_PATHS) {
    if (fs.existsSync(p)) {
      return p;
    }
  }
  throw new Error(`Registry catalog not found. Tried: ${REGISTRY_PATHS.join(', ')}`);
}

/**
 * Read all JSON files from a directory
 */
function readCatalogDir(dirPath) {
  if (!fs.existsSync(dirPath)) {
    return [];
  }

  const files = fs.readdirSync(dirPath).filter(f => f.endsWith('.json'));
  return files.map(f => {
    const content = fs.readFileSync(path.join(dirPath, f), 'utf-8');
    return JSON.parse(content);
  });
}

/**
 * Extract commands from a package definition
 * Handles multiple formats:
 * - commands: [{ name, bin, args? }] - new explicit format
 * - binary: "name" - single binary
 * - binaries: ["a", "b"] - multiple binaries with same name
 */
function extractCommands(pkg, kind) {
  // New format: explicit commands array
  if (pkg.commands && Array.isArray(pkg.commands)) {
    return pkg.commands.map(cmd => ({
      name: cmd.name,
      bin: cmd.bin,
      args: cmd.args || null,
    }));
  }

  // Legacy format: binaries array (ffmpeg has ["ffmpeg", "ffprobe"])
  if (pkg.binaries && Array.isArray(pkg.binaries)) {
    return pkg.binaries.map(name => ({
      name,
      bin: name,
      args: null,
    }));
  }

  // Legacy format: single binary field
  if (pkg.binary) {
    const id = pkg.id.replace(/^(runtime|binary|agent):/, '');
    return [{
      name: id,
      bin: pkg.binary,
      args: null,
    }];
  }

  // Fallback: use id as command name
  const id = pkg.id.replace(/^(runtime|binary|agent):/, '');
  return [{
    name: id,
    bin: id,
    args: null,
  }];
}

/**
 * Get install directory for a package
 */
function getInstallDir(pkg, kind) {
  if (pkg.installDir) {
    return pkg.installDir;
  }
  const id = pkg.id.replace(/^(runtime|binary|agent):/, '');
  return id;
}

/**
 * Get the base path where this kind of package is installed
 */
function getKindBasePath(kind) {
  switch (kind) {
    case 'runtime': return 'runtimes';
    case 'agent': return 'agents';
    case 'binary': return 'binaries';
    default: return kind + 's';
  }
}

function normalizeGlobalNpmCommands(commands) {
  return commands.map(cmd => {
    const binName = path.basename(cmd.bin || cmd.name);
    return {
      name: cmd.name,
      bin: path.posix.join('bin', binName),
      args: cmd.args || null,
    };
  });
}

/**
 * Process packages from a catalog directory
 */
function processPackages(catalogPath, kind) {
  const dirPath = path.join(catalogPath, kind + 's'); // runtimes, agents, binaries
  const packages = readCatalogDir(dirPath);

  return packages.map(pkg => {
    const id = pkg.id.replace(/^(runtime|binary|agent):/, '');
    let installDir = getInstallDir(pkg, kind);
    let basePath = getKindBasePath(kind);
    let installType = pkg.installType || 'binary';
    let commands = extractCommands(pkg, kind);

    const isGlobalNpmAgent = kind === 'agent' && (installType === 'npm' || pkg.npmPackage);
    if (isGlobalNpmAgent) {
      basePath = 'runtimes';
      installDir = 'node';
      installType = 'npm-global';
      commands = normalizeGlobalNpmCommands(commands);
    }

    const entry = {
      id,
      name: pkg.name,
      kind,
      installDir,
      basePath,
      installType,
      commands,
    };

    // Carry native installer fields for native-installer packages
    if (installType === 'native-installer') {
      if (pkg.nativeInstaller) entry.nativeInstaller = pkg.nativeInstaller;
      if (pkg.nativeBinPath) entry.nativeBinPath = pkg.nativeBinPath;
    }

    return entry;
  });
}

/**
 * Generate the manifest
 */
function generateManifest() {
  const catalogPath = findRegistryPath();
  console.log(`Reading catalog from: ${catalogPath}`);

  const manifest = {
    version: '1.0.0',
    generated: new Date().toISOString(),
    packages: {
      runtimes: processPackages(catalogPath, 'runtime'),
      agents: processPackages(catalogPath, 'agent'),
      binaries: processPackages(catalogPath, 'binary'),
    },
  };

  // Summary
  const counts = {
    runtimes: manifest.packages.runtimes.length,
    agents: manifest.packages.agents.length,
    binaries: manifest.packages.binaries.length,
  };
  console.log(`Found: ${counts.runtimes} runtimes, ${counts.agents} agents, ${counts.binaries} binaries`);

  // Count total commands
  let totalCommands = 0;
  for (const kind of Object.values(manifest.packages)) {
    for (const pkg of kind) {
      totalCommands += pkg.commands.length;
    }
  }
  console.log(`Total commands: ${totalCommands}`);

  return manifest;
}

/**
 * Main
 */
function main() {
  try {
    const manifest = generateManifest();

    // Write to src directory (will be bundled with CLI)
    const outputPath = path.resolve(__dirname, '../src/packages-manifest.json');
    fs.writeFileSync(outputPath, JSON.stringify(manifest, null, 2));
    console.log(`\nWrote manifest to: ${outputPath}`);

  } catch (err) {
    console.error('Error generating manifest:', err.message);
    process.exit(1);
  }
}

main();
