/**
 * Init command - Bootstrap RUDI environment
 *
 * Creates ~/.rudi structure and downloads essential runtimes/binaries:
 * - Runtimes: node, python (bundled)
 * - Binaries: sqlite3, ripgrep (essential)
 * - Shims (opt-in): symlinks to installed tools in ~/.rudi/bins
 */

import fs from 'fs';
import path from 'path';
import { PATHS, ensureDirectories } from '@learnrudi/env';
import { createShimsForTool, installPackage } from '@learnrudi/core';
import {
  buildRudiInstructionBlock,
  patchManagedInstructionBlock,
  resolveInstructionTarget
} from './instructions.js';

// Essential packages to install on init
const BUNDLED_RUNTIMES = ['node', 'python'];
const ESSENTIAL_BINARIES = ['sqlite', 'ripgrep'];
const CODEX_INSTRUCTIONS_ACTION = 'codex-instructions';

export function shouldInstallAgentInstructions(flags = {}) {
  return !(
    flags['no-agent-instructions'] === true ||
    flags.noAgentInstructions === true ||
    flags['no-codex-instructions'] === true ||
    flags.noCodexInstructions === true
  );
}

export function installCodexInstructionBlock({ actions = null, quiet = false, env = {} } = {}) {
  const targetPath = resolveInstructionTarget('codex', {}, env);
  let backupPath = null;

  try {
    const existing = fs.existsSync(targetPath)
      ? fs.readFileSync(targetPath, 'utf-8')
      : '';
    const result = patchManagedInstructionBlock(existing, buildRudiInstructionBlock('codex'));

    if (!result.changed) {
      actions?.skipped?.push(CODEX_INSTRUCTIONS_ACTION);
      if (!quiet) console.log('   ✓ Codex AGENTS RUDI block unchanged');
      return {
        ...result,
        targetPath,
        backupPath
      };
    }

    fs.mkdirSync(path.dirname(targetPath), { recursive: true });
    if (fs.existsSync(targetPath)) {
      backupPath = `${targetPath}.backup.${Date.now()}`;
      fs.copyFileSync(targetPath, backupPath);
    }
    fs.writeFileSync(targetPath, result.content);
    actions?.created?.push(CODEX_INSTRUCTIONS_ACTION);
    if (!quiet) {
      const label = result.action === 'updated' ? 'updated' : 'installed';
      console.log(`   + Codex AGENTS RUDI block ${label}`);
    }
    return {
      ...result,
      targetPath,
      backupPath
    };
  } catch (error) {
    actions?.failed?.push(CODEX_INSTRUCTIONS_ACTION);
    if (!quiet) console.log(`   ✗ Codex AGENTS RUDI block: ${error.message}`);
    return {
      changed: false,
      action: 'failed',
      targetPath,
      backupPath,
      error
    };
  }
}

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

  // Use the same schema-aware, verified installer as `rudi install`.
  if (!skipDownloads) {
    if (!quiet) console.log('\n2. Checking runtimes...');
    await installBootstrapPackages('runtime', BUNDLED_RUNTIMES, actions, { force, quiet });
    if (!quiet) console.log('\n3. Checking essential binaries...');
    await installBootstrapPackages('binary', ESSENTIAL_BINARIES, actions, { force, quiet });
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

  // Step 5: Write settings
  if (!quiet) console.log('\n5. Checking settings...');
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

  // Step 6: Seed Codex instructions so agents can discover RUDI capabilities.
  if (!quiet) console.log('\n6. Checking Codex agent instructions...');
  if (shouldInstallAgentInstructions(flags)) {
    installCodexInstructionBlock({ actions, quiet });
  } else {
    actions.skipped.push(CODEX_INSTRUCTIONS_ACTION);
    if (!quiet) console.log('   ⚠ Codex AGENTS RUDI block skipped (--no-agent-instructions)');
  }

  // Successful packages remain installed so a retry can complete the setup.
  // Never print a success summary when any required action failed.
  if (actions.failed.length > 0) {
    throw new Error(`RUDI initialization incomplete: ${actions.failed.join(', ')}`);
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

async function installBootstrapPackages(kind, names, actions, options) {
  for (const name of names) {
    const id = `${kind}:${name}`;
    try {
      const result = await installPackage(id, {
        force: options.force,
        // Init reconciles optional shims once below, including repeat runs.
        withShims: false,
      });
      if (!result.success) throw new Error(result.error || 'Installation failed');
      const skipped = result.alreadyInstalled === true;
      actions[skipped ? 'skipped' : 'created'].push(id);
      if (!options.quiet) console.log(`   ✓ ${name}: ${skipped ? 'already installed' : 'installed'}`);
    } catch (error) {
      actions.failed.push(id);
      console.error(`   ✗ ${id}: ${error.message}`);
    }
  }
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

  // Use manifest-aware shims for both downloads and system packages (macOS
  // SQLite). This also supports opting in after an earlier shim-free init.
  for (const name of ESSENTIAL_BINARIES) {
    const installDir = path.join(PATHS.binaries, name);
    const manifestPath = path.join(installDir, 'manifest.json');
    if (!fs.existsSync(manifestPath)) continue;
    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    if (!['system', 'binary'].includes(manifest.installType)) continue;
    const result = await createShimsForTool({ ...manifest, installDir }, { quiet });
    shims.push(...result.created);
  }

  // Keep legacy layouts and the ripgrep alias working without a manifest.
  for (const [shimName, targetPath] of Object.entries(binaryShims)) {
    if (shims.includes(shimName)) continue;
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

  // Keep the same target when RUDI_HOME is reached through another mount path.
  fs.symlinkSync(path.relative(path.dirname(shimPath), targetPath), shimPath);
}
