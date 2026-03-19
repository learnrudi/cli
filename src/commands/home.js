/**
 * Home command - show ~/.rudi structure and status
 *
 * Shows what's in the RUDI home directory
 */

import fs from 'fs';
import path from 'path';
import { PATHS, getInstalledPackages } from '@learnrudi/core';
import { getDbSize, isDatabaseInitialized } from '@learnrudi/db';

function formatBytes(bytes) {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
}

function getDirSize(dir) {
  if (!fs.existsSync(dir)) return 0;

  let size = 0;
  try {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        size += getDirSize(fullPath);
      } else {
        size += fs.statSync(fullPath).size;
      }
    }
  } catch {
    // Skip unreadable dirs
  }
  return size;
}

function countItems(dir) {
  if (!fs.existsSync(dir)) return 0;
  try {
    return fs.readdirSync(dir).filter(f => !f.startsWith('.')).length;
  } catch {
    return 0;
  }
}

export async function cmdHome(args, flags) {
  console.log('═'.repeat(60));
  console.log('RUDI Home: ' + PATHS.home);
  console.log('═'.repeat(60));

  if (flags.json) {
    const data = {
      home: PATHS.home,
      directories: {},
      packages: {},
      database: {}
    };

    // Collect directory info
    const dirs = [
      { key: 'stacks', path: PATHS.stacks },
      { key: 'skills', path: PATHS.prompts },
      { key: 'runtimes', path: PATHS.runtimes },
      { key: 'binaries', path: PATHS.binaries },
      { key: 'agents', path: PATHS.agents },
      { key: 'cache', path: PATHS.cache }
    ];

    for (const dir of dirs) {
      data.directories[dir.key] = {
        path: dir.path,
        exists: fs.existsSync(dir.path),
        items: countItems(dir.path),
        size: getDirSize(dir.path)
      };
    }

    // Collect package counts
    for (const kind of ['stack', 'skill', 'runtime', 'binary', 'agent']) {
      data.packages[kind] = getInstalledPackages(kind).length;
    }

    // Database info
    data.database = {
      initialized: isDatabaseInitialized(),
      size: getDbSize() || 0
    };

    console.log(JSON.stringify(data, null, 2));
    return;
  }

  // Show directory structure
  console.log('\n📁 Directory Structure\n');

  const dirs = [
    { name: 'stacks', path: PATHS.stacks, icon: '📦', desc: 'MCP server stacks' },
    { name: 'skills', path: PATHS.prompts, icon: '📝', desc: 'Skill templates' },
    { name: 'runtimes', path: PATHS.runtimes, icon: '⚙️', desc: 'Node, Python, Deno, Bun' },
    { name: 'binaries', path: PATHS.binaries, icon: '🔧', desc: 'ffmpeg, ripgrep, etc.' },
    { name: 'agents', path: PATHS.agents, icon: '🤖', desc: 'Claude, Codex, Gemini CLIs' },
    { name: 'cache', path: PATHS.cache, icon: '💾', desc: 'Registry cache' }
  ];

  for (const dir of dirs) {
    const exists = fs.existsSync(dir.path);
    const count = countItems(dir.path);
    const size = getDirSize(dir.path);

    console.log(`${dir.icon} ${dir.name}/`);
    console.log(`   ${dir.desc}`);
    if (exists) {
      console.log(`   ${count} items, ${formatBytes(size)}`);
    } else {
      console.log(`   (not created)`);
    }
    console.log();
  }

  // Show database
  console.log('💾 Database');
  const dbPath = path.join(PATHS.home, 'rudi.db');
  if (fs.existsSync(dbPath)) {
    const dbSize = getDbSize() || fs.statSync(dbPath).size;
    console.log(`   ${formatBytes(dbSize)}`);
    console.log(`   ${dbPath}`);
  } else {
    console.log(`   Not initialized`);
  }
  console.log();

  // Show installed packages summary
  console.log('═'.repeat(60));
  console.log('Installed Packages');
  console.log('═'.repeat(60));

  const kinds = ['stack', 'skill', 'runtime', 'binary', 'agent'];
  let total = 0;

  for (const kind of kinds) {
    const packages = getInstalledPackages(kind);
    const label = kind === 'binary' ? 'Binaries' : `${kind.charAt(0).toUpperCase() + kind.slice(1)}s`;
    console.log(`  ${label.padEnd(12)} ${packages.length}`);

    // Show first few items
    if (packages.length > 0 && flags.verbose) {
      for (const pkg of packages.slice(0, 3)) {
        console.log(`    - ${pkg.name || pkg.id}`);
      }
      if (packages.length > 3) {
        console.log(`    ... and ${packages.length - 3} more`);
      }
    }
    total += packages.length;
  }

  console.log('─'.repeat(30));
  console.log(`  ${'Total'.padEnd(12)} ${total}`);

  // Show helpful commands
  console.log('\n📋 Quick Commands');
  console.log('─'.repeat(30));
  console.log('  rudi list stacks      Show installed stacks');
  console.log('  rudi list runtimes    Show installed runtimes');
  console.log('  rudi list binaries    Show installed binaries');
  console.log('  rudi doctor --all     Check system dependencies');
  console.log('  rudi db stats         Database statistics');
}
