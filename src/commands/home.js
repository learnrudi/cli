/**
 * Home command - show ~/.rudi structure and status
 *
 * Shows what's in the RUDI home directory
 */

import fs from 'fs';
import path from 'path';
import Database from 'better-sqlite3';
import { PATHS, getInstalledPackages } from '@learnrudi/core';

const HOME_LAYOUT = [
  {
    key: 'stacks',
    name: 'stacks/',
    type: 'directory',
    section: 'Installed Packages',
    path: () => PATHS.stacks,
    lifecycle: 'installed-code',
    sensitivity: 'normal',
    cleanable: 'rudi-remove',
    description: 'Installed MCP stack package code and dependencies.'
  },
  {
    key: 'skills',
    name: 'skills/',
    type: 'directory',
    section: 'Installed Packages',
    path: () => PATHS.skills,
    lifecycle: 'installed-definitions',
    sensitivity: 'normal',
    cleanable: 'rudi-remove',
    description: 'Installed reusable skill definitions.'
  },
  {
    key: 'workflows',
    name: 'workflows/',
    type: 'directory',
    section: 'Installed Packages',
    path: () => PATHS.workflows,
    lifecycle: 'installed-definitions',
    sensitivity: 'normal',
    cleanable: 'rudi-remove',
    description: 'Installed repeatable workflow definitions.'
  },
  {
    key: 'runtimes',
    name: 'runtimes/',
    type: 'directory',
    section: 'Installed Packages',
    path: () => PATHS.runtimes,
    lifecycle: 'managed-runtime',
    sensitivity: 'normal',
    cleanable: 'reinstallable',
    description: 'RUDI-managed language runtimes such as Node and Python.'
  },
  {
    key: 'binaries',
    name: 'binaries/',
    type: 'directory',
    section: 'Installed Packages',
    path: () => PATHS.binaries,
    lifecycle: 'managed-tool-install',
    sensitivity: 'normal',
    cleanable: 'reinstallable',
    description: 'RUDI-managed third-party CLI tools and binaries.'
  },
  {
    key: 'agents',
    name: 'agents/',
    type: 'directory',
    section: 'Installed Packages',
    path: () => PATHS.agents,
    lifecycle: 'managed-agent-install',
    sensitivity: 'normal',
    cleanable: 'reinstallable',
    description: 'RUDI-managed AI agent CLI installations.'
  },
  {
    key: 'bins',
    name: 'bins/',
    type: 'directory',
    section: 'Entrypoints',
    path: () => PATHS.bins,
    lifecycle: 'generated-shims',
    sensitivity: 'normal',
    cleanable: 'rudi-shims-rebuild',
    description: 'Current command shims and RUDI router entrypoints.'
  },
  {
    key: 'shims',
    name: 'shims/',
    type: 'directory',
    section: 'Entrypoints',
    path: () => path.join(PATHS.home, 'shims'),
    lifecycle: 'legacy-shims',
    sensitivity: 'normal',
    cleanable: 'legacy-compat',
    description: 'Older shim directory kept for compatibility with existing integrations.'
  },
  {
    key: 'router',
    name: 'router/',
    type: 'directory',
    section: 'Entrypoints',
    path: () => path.join(PATHS.home, 'router'),
    lifecycle: 'router-runtime',
    sensitivity: 'normal',
    cleanable: 'rudi-shims-rebuild',
    description: 'Local MCP router and permission hook runtime files.'
  },
  {
    key: 'state',
    name: 'state/',
    type: 'directory',
    section: 'Persistent State And Secrets',
    path: () => path.join(PATHS.home, 'state'),
    lifecycle: 'persistent-state',
    sensitivity: 'sensitive',
    cleanable: 'no',
    description: 'Per-stack mutable state such as selected accounts and OAuth tokens.'
  },
  {
    key: 'secretsDir',
    name: 'secrets/',
    type: 'directory',
    section: 'Persistent State And Secrets',
    path: () => path.join(PATHS.home, 'secrets'),
    lifecycle: 'stack-secret-files',
    sensitivity: 'secret',
    cleanable: 'no',
    description: 'Stack-specific secret and environment files.'
  },
  {
    key: 'secretsJson',
    name: 'secrets.json',
    type: 'file',
    section: 'Persistent State And Secrets',
    path: () => path.join(PATHS.home, 'secrets.json'),
    lifecycle: 'secret-store',
    sensitivity: 'secret',
    cleanable: 'no',
    description: 'Primary RUDI secret store; values must stay local and masked.'
  },
  {
    key: 'rudiJson',
    name: 'rudi.json',
    type: 'file',
    section: 'Database And Config',
    path: () => path.join(PATHS.home, 'rudi.json'),
    lifecycle: 'package-config',
    sensitivity: 'sensitive',
    cleanable: 'no',
    description: 'Installed package and stack configuration.'
  },
  {
    key: 'settingsJson',
    name: 'settings.json',
    type: 'file',
    section: 'Database And Config',
    path: () => path.join(PATHS.home, 'settings.json'),
    lifecycle: 'user-settings',
    sensitivity: 'normal',
    cleanable: 'no',
    description: 'Local RUDI settings.'
  },
  {
    key: 'rudiDb',
    name: 'rudi.db',
    type: 'file',
    section: 'Legacy Session State',
    path: () => path.join(PATHS.home, 'rudi.db'),
    lifecycle: 'legacy-session-database',
    sensitivity: 'sensitive',
    cleanable: 'rudi-db-vacuum',
    description: 'Legacy SQLite database for session, usage, log, and run-group surfaces.'
  },
  {
    key: 'rudiDbWal',
    name: 'rudi.db-wal',
    type: 'file',
    section: 'Legacy Session State',
    path: () => path.join(PATHS.home, 'rudi.db-wal'),
    lifecycle: 'legacy-session-database-journal',
    sensitivity: 'sensitive',
    cleanable: 'sqlite-managed',
    description: 'SQLite write-ahead log for the legacy session database.'
  },
  {
    key: 'rudiDbShm',
    name: 'rudi.db-shm',
    type: 'file',
    section: 'Legacy Session State',
    path: () => path.join(PATHS.home, 'rudi.db-shm'),
    lifecycle: 'legacy-session-database-journal',
    sensitivity: 'sensitive',
    cleanable: 'sqlite-managed',
    description: 'SQLite shared-memory file for the legacy session database.'
  },
  {
    key: 'cache',
    name: 'cache/',
    type: 'directory',
    section: 'Generated And Operational',
    path: () => PATHS.cache,
    lifecycle: 'cache',
    sensitivity: 'normal',
    cleanable: 'rebuildable',
    description: 'Registry, package manager, download, and router tool-index cache.'
  },
  {
    key: 'locks',
    name: 'locks/',
    type: 'directory',
    section: 'Generated And Operational',
    path: () => PATHS.locks,
    lifecycle: 'install-locks',
    sensitivity: 'normal',
    cleanable: 'no',
    description: 'Package install lock files.'
  },
  {
    key: 'logs',
    name: 'logs/',
    type: 'directory',
    section: 'Generated And Operational',
    path: () => PATHS.logs,
    lifecycle: 'operational-logs',
    sensitivity: 'sensitive',
    cleanable: 'rotate-or-archive',
    description: 'Daemon and runtime logs. Rotate or archive large files.'
  },
  {
    key: 'notes',
    name: 'notes/',
    type: 'directory',
    section: 'Generated And Operational',
    path: () => path.join(PATHS.home, 'notes'),
    lifecycle: 'user-artifacts',
    sensitivity: 'sensitive',
    cleanable: 'archive-with-care',
    description: 'Local notes and attachments created through RUDI workflows.'
  },
  {
    key: 'archive',
    name: 'archive/',
    type: 'directory',
    section: 'Generated And Operational',
    path: () => path.join(PATHS.home, 'archive'),
    lifecycle: 'manual-archive',
    sensitivity: 'sensitive',
    cleanable: 'after-retention',
    description: 'Manual cleanup archives and manifests.'
  },
  {
    key: 'legacyPrompts',
    name: 'prompts/',
    type: 'directory',
    section: 'Legacy Compatibility',
    path: () => path.join(PATHS.home, 'prompts'),
    lifecycle: 'legacy-compat',
    sensitivity: 'normal',
    cleanable: 'migrate-to-skills',
    description: 'Legacy prompt directory; new prompt-style assets map to skills/.'
  },
  {
    key: 'legacySidecarPort',
    name: '.rudi-lite-port',
    type: 'file',
    section: 'Legacy Compatibility',
    path: () => path.join(PATHS.home, '.rudi-lite-port'),
    lifecycle: 'daemon-runtime',
    sensitivity: 'sensitive',
    cleanable: 'no',
    description: 'Current daemon port file with legacy Lite naming.'
  },
  {
    key: 'legacySidecarToken',
    name: '.rudi-lite-token',
    type: 'file',
    section: 'Legacy Compatibility',
    path: () => path.join(PATHS.home, '.rudi-lite-token'),
    lifecycle: 'daemon-runtime',
    sensitivity: 'secret',
    cleanable: 'no',
    description: 'Current daemon auth token file with legacy Lite naming.'
  }
];

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
      const stats = fs.lstatSync(fullPath);
      if (stats.isDirectory()) {
        size += getDirSize(fullPath);
      } else {
        size += stats.size;
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

function isDatabaseInitializedAt(dbPath) {
  if (!fs.existsSync(dbPath)) return false;

  try {
    const db = new Database(dbPath, { readonly: true });
    const result = db.prepare(`
      SELECT name FROM sqlite_master
      WHERE type='table' AND name='schema_version'
    `).get();
    db.close();
    return !!result;
  } catch {
    return false;
  }
}

function getFileSize(filePath) {
  try {
    return fs.lstatSync(filePath).size;
  } catch {
    return 0;
  }
}

function getEntryInfo(entry) {
  const entryPath = entry.path();
  const exists = fs.existsSync(entryPath);
  const info = {
    path: entryPath,
    type: entry.type,
    section: entry.section,
    lifecycle: entry.lifecycle,
    sensitivity: entry.sensitivity,
    cleanable: entry.cleanable,
    description: entry.description,
    exists,
    size: 0
  };

  if (!exists) {
    if (entry.type === 'directory') info.items = 0;
    return info;
  }

  if (entry.type === 'directory') {
    info.items = countItems(entryPath);
    info.size = getDirSize(entryPath);
    return info;
  }

  info.size = getFileSize(entryPath);
  return info;
}

function getHomeEntries() {
  const entries = {};
  for (const entry of HOME_LAYOUT) {
    entries[entry.key] = getEntryInfo(entry);
  }
  return entries;
}

function getDatabaseInfo() {
  const dbPath = path.join(PATHS.home, 'rudi.db');
  return {
    path: dbPath,
    exists: fs.existsSync(dbPath),
    initialized: isDatabaseInitializedAt(dbPath),
    size: getFileSize(dbPath)
  };
}

function printHomeEntry(name, info) {
  const status = info.exists
    ? `${info.type === 'directory' ? `${info.items} items, ` : ''}${formatBytes(info.size)}`
    : '(not created)';
  const sensitivity = info.sensitivity === 'normal' ? '' : `, ${info.sensitivity}`;

  console.log(`  ${name}`);
  console.log(`     ${info.description}`);
  console.log(`     ${status}`);
  console.log(`     lifecycle: ${info.lifecycle}, cleanup: ${info.cleanable}${sensitivity}`);
}

export async function cmdHome(args, flags) {
  const entries = getHomeEntries();

  if (flags.json) {
    const data = {
      home: PATHS.home,
      entries,
      directories: {},
      files: {},
      packages: {},
      database: {}
    };

    // Collect directory info
    for (const [key, info] of Object.entries(entries)) {
      if (info.type === 'directory') {
        data.directories[key] = info;
      } else {
        data.files[key] = info;
      }
    }

    // Collect package counts
    for (const kind of ['stack', 'skill', 'workflow', 'runtime', 'binary', 'agent']) {
      data.packages[kind] = getInstalledPackages(kind).length;
    }

    // Database info
    data.database = getDatabaseInfo();

    console.log(JSON.stringify(data, null, 2));
    return;
  }

  console.log('═'.repeat(60));
  console.log('RUDI Home: ' + PATHS.home);
  console.log('═'.repeat(60));

  // Show directory structure
  console.log('\n📁 Home Storage Map\n');

  const sections = [...new Set(HOME_LAYOUT.map(entry => entry.section))];
  for (const section of sections) {
    console.log(section);
    console.log('─'.repeat(section.length));
    for (const entry of HOME_LAYOUT.filter(item => item.section === section)) {
      printHomeEntry(entry.name, entries[entry.key]);
    }
    console.log();
  }

  // Show database
  console.log('💾 Database');
  const database = getDatabaseInfo();
  if (database.exists) {
    console.log(`   ${formatBytes(database.size)}`);
    console.log(`   initialized: ${database.initialized ? 'yes' : 'unknown'}`);
    console.log(`   ${database.path}`);
  } else {
    console.log(`   Not initialized`);
  }
  console.log();

  // Show installed packages summary
  console.log('═'.repeat(60));
  console.log('Installed Packages');
  console.log('═'.repeat(60));

  const kinds = ['stack', 'skill', 'workflow', 'runtime', 'binary', 'agent'];
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
  console.log('  rudi list workflows   Show installed workflows');
  console.log('  rudi list runtimes    Show installed runtimes');
  console.log('  rudi list binaries    Show installed binaries');
  console.log('  rudi doctor --all     Check system dependencies');
  console.log('  rudi db stats         Database statistics');
}
