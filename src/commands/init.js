/**
 * Init command - Bootstrap RUDI environment
 *
 * Creates ~/.rudi structure and downloads essential runtimes/binaries:
 * - Runtimes: node, python (bundled)
 * - Binaries: sqlite3, ripgrep (essential)
 * - Shims (opt-in): symlinks to installed tools in ~/.rudi/bins
 * - Database: rudi.db with schema
 */

import fs from 'fs';
import path from 'path';
import { pipeline } from 'stream/promises';
import { createWriteStream } from 'fs';
import { createGunzip } from 'zlib';
import { PATHS, ensureDirectories, getPlatformArch } from '@learnrudi/env';
import { fetchIndex } from '@learnrudi/registry-client';
import { initSchema } from '@learnrudi/db';
import { runCommand } from '../utils/subprocess.js';

// Download base URL for RUDI registry releases
const RELEASES_BASE = 'https://github.com/learnrudi/registry/releases/download/v1.0.0';

// Essential packages to install on init
const BUNDLED_RUNTIMES = ['node', 'python'];
const ESSENTIAL_BINARIES = ['sqlite', 'ripgrep'];

export async function cmdInit(args, flags) {
  const force = flags.force || false;
  const skipDownloads = flags['skip-downloads'] || false;
  const quiet = flags.quiet || false;
  const withShims = flags['with-shims'] || flags.withShims || false;

  if (!quiet) {
    console.log('═'.repeat(60));
    console.log('RUDI Initialization');
    console.log('═'.repeat(60));
    console.log(`Home: ${PATHS.home}`);
    console.log();
  }

  // Track what we do for summary
  const actions = { created: [], skipped: [], failed: [] };

  // Step 1: Create directory structure
  if (!quiet) console.log('1. Checking directory structure...');
  ensureDirectories();

  const dirs = [
    PATHS.stacks,
    PATHS.prompts,
    PATHS.workflows,
    PATHS.runtimes,
    PATHS.binaries,
    PATHS.agents,
    PATHS.cache,
    PATHS.bins
  ];

  for (const dir of dirs) {
    const dirName = path.basename(dir);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
      actions.created.push(`dir:${dirName}`);
      if (!quiet) console.log(`   + ${dirName}/ (created)`);
    } else {
      actions.skipped.push(`dir:${dirName}`);
      if (!quiet) console.log(`   ✓ ${dirName}/ (exists)`);
    }
  }

  // Step 2: Download bundled runtimes
  if (!skipDownloads) {
    if (!quiet) console.log('\n2. Checking runtimes...');
    const index = await fetchIndex();
    const platform = getPlatformArch();

    for (const runtimeName of BUNDLED_RUNTIMES) {
      const runtime = index.packages?.runtimes?.official?.find(
        r => r.id === `runtime:${runtimeName}` || r.id === runtimeName
      );

      if (!runtime) {
        actions.failed.push(`runtime:${runtimeName}`);
        if (!quiet) console.log(`   ⚠ ${runtimeName}: not found in registry`);
        continue;
      }

      const destPath = path.join(PATHS.runtimes, runtimeName);
      if (fs.existsSync(destPath) && !force) {
        actions.skipped.push(`runtime:${runtimeName}`);
        if (!quiet) console.log(`   ✓ ${runtimeName}: already installed`);
        continue;
      }

      try {
        await downloadRuntime(runtime, runtimeName, destPath, platform);
        actions.created.push(`runtime:${runtimeName}`);
        if (!quiet) console.log(`   + ${runtimeName}: installed`);
      } catch (error) {
        actions.failed.push(`runtime:${runtimeName}`);
        if (!quiet) console.log(`   ✗ ${runtimeName}: ${error.message}`);
      }
    }

    // Step 3: Download essential binaries
    if (!quiet) console.log('\n3. Checking essential binaries...');

    for (const binaryName of ESSENTIAL_BINARIES) {
      const binary = index.packages?.binaries?.official?.find(
        b => b.id === `binary:${binaryName}` || b.id === binaryName || b.name?.toLowerCase() === binaryName
      );

      if (!binary) {
        actions.failed.push(`binary:${binaryName}`);
        if (!quiet) console.log(`   ⚠ ${binaryName}: not found in registry`);
        continue;
      }

      const destPath = path.join(PATHS.binaries, binaryName);
      if (fs.existsSync(destPath) && !force) {
        actions.skipped.push(`binary:${binaryName}`);
        if (!quiet) console.log(`   ✓ ${binaryName}: already installed`);
        continue;
      }

      try {
        await downloadBinary(binary, binaryName, destPath, platform);
        actions.created.push(`binary:${binaryName}`);
        if (!quiet) console.log(`   + ${binaryName}: installed`);
      } catch (error) {
        actions.failed.push(`binary:${binaryName}`);
        if (!quiet) console.log(`   ✗ ${binaryName}: ${error.message}`);
      }
    }
  } else {
    if (!quiet) console.log('\n2-3. Skipping downloads (--skip-downloads)');
  }

  // Step 4: Create shims
  if (!quiet) console.log('\n4. Shims (opt-in)...');
  if (withShims) {
    const shimCount = await createShims(PATHS.bins, quiet);
    if (shimCount > 0) {
      actions.created.push(`shims:${shimCount}`);
    }
  } else if (!quiet) {
    console.log('   ⚠ Shims not created (opt-in). Run: rudi shims rebuild');
  }

  // Step 5: Initialize database
  if (!quiet) console.log('\n5. Checking database...');
  const dbPath = path.join(PATHS.home, 'rudi.db');
  const dbExists = fs.existsSync(dbPath);
  try {
    const result = initSchema();
    if (dbExists) {
      actions.skipped.push('database');
      if (!quiet) console.log(`   ✓ Database exists (v${result.version})`);
    } else {
      actions.created.push('database');
      if (!quiet) console.log(`   + Database created (v${result.version})`);
    }
  } catch (error) {
    actions.failed.push('database');
    if (!quiet) console.log(`   ✗ Database error: ${error.message}`);
  }

  // Step 6: Write settings
  if (!quiet) console.log('\n6. Checking settings...');
  const settingsPath = path.join(PATHS.home, 'settings.json');
  if (!fs.existsSync(settingsPath)) {
    const settings = {
      version: '1.0.0',
      initialized: new Date().toISOString(),
      theme: 'system'
    };
    fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2));
    actions.created.push('settings');
    if (!quiet) console.log('   + settings.json created');
  } else {
    actions.skipped.push('settings');
    if (!quiet) console.log('   ✓ settings.json exists');
  }

  // Done - show summary
  if (!quiet) {
    console.log('\n' + '═'.repeat(60));
    if (actions.created.length > 0) {
      console.log(`✓ RUDI initialized! (${actions.created.length} items created, ${actions.skipped.length} already existed)`);
    } else {
      console.log('✓ RUDI is up to date! (all items already existed)');
    }
    console.log('═'.repeat(60));

    // Show PATH instructions only on first run
    if (actions.created.includes('settings') && withShims) {
      const shimsPath = PATHS.bins;
      console.log('\nAdd to your shell profile (~/.zshrc or ~/.bashrc):');
      console.log(`  export PATH="${shimsPath}:$PATH"`);
      console.log('\nThen run:');
      console.log('  rudi home     # View your setup');
      console.log('  rudi doctor   # Check health');
    }
  }

  // Return actions for programmatic use
  return actions;
}

async function downloadRuntime(runtime, name, destPath, platform) {
  // Get download URL
  let url;
  if (runtime.upstream?.[platform]) {
    url = runtime.upstream[platform];
  } else if (runtime.download?.[platform]) {
    url = `${RELEASES_BASE}/${runtime.download[platform]}`;
  } else {
    throw new Error(`No download for ${platform}`);
  }

  await downloadAndExtract(url, destPath, name);
}

async function downloadBinary(binary, name, destPath, platform) {
  // Get download URL
  let url;
  if (binary.upstream?.[platform]) {
    url = binary.upstream[platform];
  } else if (binary.download?.[platform]) {
    url = `${RELEASES_BASE}/${binary.download[platform]}`;
  } else {
    throw new Error(`No download for ${platform}`);
  }

  await downloadAndExtract(url, destPath, name, binary.extract);
}

async function downloadAndExtract(url, destPath, name, extractConfig) {
  const tempFile = path.join(PATHS.cache, `${name}-download.tar.gz`);

  // Download
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}`);
  }

  // Ensure dest exists
  if (!fs.existsSync(destPath)) {
    fs.mkdirSync(destPath, { recursive: true });
  }

  // Save to temp file
  const fileStream = createWriteStream(tempFile);
  await pipeline(response.body, fileStream);

  // Extract
  try {
    runCommand('tar', ['-xzf', tempFile, '-C', destPath, '--strip-components=1'], {
      stdio: 'pipe'
    });
  } catch {
    // Try without strip-components for flat archives
    runCommand('tar', ['-xzf', tempFile, '-C', destPath], { stdio: 'pipe' });
  }

  // Cleanup
  fs.unlinkSync(tempFile);
}

async function createShims(shimsDir, quiet = false) {
  const shims = [];

  // Runtime shims
  const runtimeShims = {
    node: 'runtimes/node/bin/node',
    npm: 'runtimes/node/bin/npm',
    npx: 'runtimes/node/bin/npx',
    python: 'runtimes/python/bin/python3',
    python3: 'runtimes/python/bin/python3',
    pip: 'runtimes/python/bin/pip3',
    pip3: 'runtimes/python/bin/pip3'
  };

  // Binary shims
  const binaryShims = {
    sqlite3: 'binaries/sqlite/sqlite3',
    rg: 'binaries/ripgrep/rg',
    ripgrep: 'binaries/ripgrep/rg'
  };

  // Create runtime shims
  for (const [shimName, targetPath] of Object.entries(runtimeShims)) {
    const fullTarget = path.join(PATHS.home, targetPath);
    const shimPath = path.join(shimsDir, shimName);

    if (fs.existsSync(fullTarget)) {
      createShim(shimPath, fullTarget);
      shims.push(shimName);
    }
  }

  // Create binary shims
  for (const [shimName, targetPath] of Object.entries(binaryShims)) {
    const fullTarget = path.join(PATHS.home, targetPath);
    const shimPath = path.join(shimsDir, shimName);

    if (fs.existsSync(fullTarget)) {
      createShim(shimPath, fullTarget);
      shims.push(shimName);
    }
  }

  if (!quiet) {
    if (shims.length > 0) {
      console.log(`   ✓ ${shims.length} shims: ${shims.join(', ')}`);
    } else {
      console.log('   ⚠ No shims (runtimes/binaries not installed)');
    }
  }

  return shims.length;
}

function createShim(shimPath, targetPath) {
  // Remove existing
  if (fs.existsSync(shimPath)) {
    fs.unlinkSync(shimPath);
  }

  // Create symlink
  fs.symlinkSync(targetPath, shimPath);
}

async function showStatus() {
  console.log('Current status:');

  const checks = [
    { name: 'Home', path: PATHS.home },
    { name: 'Runtimes', path: PATHS.runtimes },
    { name: 'Binaries', path: PATHS.binaries },
    { name: 'Database', path: path.join(PATHS.home, 'rudi.db') }
  ];

  for (const check of checks) {
    const exists = fs.existsSync(check.path);
    console.log(`  ${exists ? '✓' : '✗'} ${check.name}: ${check.path}`);
  }

  console.log('\nRun: rudi home (for details)');
}
