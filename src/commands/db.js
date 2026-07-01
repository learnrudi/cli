/**
 * Database command - database operations
 */

import { existsSync, copyFileSync, unlinkSync } from 'fs';
import { dirname, join } from 'path';
import {
  getDb,
  initSchema,
  isDatabaseInitialized,
  getDbPath,
  getDbSize,
  getStats,
  search
} from '@learnrudi/db';
import { formatBytes, formatDuration } from '@learnrudi/utils/args';

export async function cmdDb(args, flags) {
  const subcommand = args[0];

  switch (subcommand) {
    case 'stats':
      dbStats(flags);
      break;

    case 'search':
      dbSearch(args.slice(1), flags);
      break;

    case 'init':
      dbInit(flags);
      break;

    case 'path':
      console.log(getDbPath());
      break;

    case 'reset':
      await dbReset(flags);
      break;

    case 'vacuum':
      dbVacuum(flags);
      break;

    case 'backup':
      dbBackup(args.slice(1), flags);
      break;

    case 'prune':
      dbPrune(args.slice(1), flags);
      break;

    case 'tables':
      dbTables(flags);
      break;

    default:
      console.log(`
rudi db - Legacy session database operations

LEGACY COMPATIBILITY
  Core RUDI no longer initializes or requires rudi.db. These commands are
  retained for existing session/history/database workflows.

COMMANDS
  stats              Show usage statistics
  search <query>     Search conversation history
  init               Initialize or migrate database
  path               Show database file path
  reset              Delete all data (requires --force)
  vacuum             Compact database and reclaim space
  backup [file]      Create database backup
  prune [days]       Delete sessions older than N days (default: 90)
  tables             Show table row counts

OPTIONS
  --force            Required for destructive operations
  --dry-run          Preview without making changes

EXAMPLES
  rudi db stats
  rudi db search "authentication bug"
  rudi db init
  rudi db reset --force
  rudi db vacuum
  rudi db backup ~/backups/rudi-backup.db
  rudi db prune 30 --dry-run
`);
  }
}

function dbStats(flags) {
  if (!isDatabaseInitialized()) {
    console.log('Database not initialized.');
    console.log('Run: rudi db init');
    return;
  }

  try {
    const stats = getStats();

    if (flags.json) {
      console.log(JSON.stringify(stats, null, 2));
      return;
    }

    console.log('\nDatabase Statistics');
    console.log('═'.repeat(50));

    // Overview
    console.log('\nOVERVIEW');
    console.log('─'.repeat(30));
    console.log(`  Total Sessions:     ${stats.totalSessions}`);
    console.log(`  Total Turns:        ${stats.totalTurns}`);
    console.log(`  Total Cost:         $${(stats.totalCost || 0).toFixed(4)}`);
    console.log(`  Total Tokens:       ${formatNumber(stats.totalInputTokens + stats.totalOutputTokens)}`);

    if (stats.totalDurationMs > 0) {
      console.log(`  Total Time:         ${formatDuration(stats.totalDurationMs)}`);
    }

    // By provider
    if (Object.keys(stats.byProvider).length > 0) {
      console.log('\nBY PROVIDER');
      console.log('─'.repeat(30));

      for (const [provider, data] of Object.entries(stats.byProvider)) {
        console.log(`  ${provider}:`);
        console.log(`    Sessions: ${data.sessions}, Turns: ${data.turns}, Cost: $${(data.cost || 0).toFixed(4)}`);
      }
    }

    // Top models
    if (stats.byModel?.length > 0) {
      console.log('\nTOP MODELS');
      console.log('─'.repeat(30));

      for (const model of stats.byModel.slice(0, 5)) {
        console.log(`  ${model.model || 'unknown'}: ${model.turns} turns, $${(model.cost || 0).toFixed(4)}`);
      }
    }

    // Database info
    const dbSize = getDbSize();
    if (dbSize) {
      console.log('\nDATABASE');
      console.log('─'.repeat(30));
      console.log(`  Size: ${formatBytes(dbSize)}`);
      console.log(`  Path: ${getDbPath()}`);
    }

  } catch (error) {
    console.error(`Failed to get stats: ${error.message}`);
    process.exit(1);
  }
}

function dbSearch(args, flags) {
  const query = args.join(' ');

  if (!query) {
    console.error('Usage: rudi db search <query>');
    process.exit(1);
  }

  if (!isDatabaseInitialized()) {
    console.log('Database not initialized.');
    return;
  }

  try {
    const results = search(query, {
      limit: flags.limit ? parseInt(flags.limit) : 20,
      provider: flags.provider
    });

    if (flags.json) {
      console.log(JSON.stringify(results, null, 2));
      return;
    }

    if (results.length === 0) {
      console.log('No results found.');
      return;
    }

    console.log(`\nFound ${results.length} result(s):\n`);

    for (const result of results) {
      console.log(`─`.repeat(60));
      console.log(`Session: ${result.session_title || result.session_id}`);
      console.log(`Turn #${result.turn_number} | ${result.provider} | ${result.ts}`);

      if (result.user_highlighted) {
        console.log(`\nUser: ${truncate(stripHighlight(result.user_highlighted), 200)}`);
      }

      if (result.assistant_highlighted) {
        console.log(`\nAssistant: ${truncate(stripHighlight(result.assistant_highlighted), 200)}`);
      }

      console.log();
    }

  } catch (error) {
    console.error(`Search failed: ${error.message}`);
    process.exit(1);
  }
}

function dbInit(flags) {
  console.log('Initializing database...');

  try {
    const result = initSchema();

    if (result.migrated) {
      console.log(`✓ Migrated from v${result.from} to v${result.version}`);
    } else {
      console.log(`✓ Database at v${result.version}`);
    }

    console.log(`  Path: ${getDbPath()}`);

  } catch (error) {
    console.error(`Failed to initialize: ${error.message}`);
    process.exit(1);
  }
}

function formatNumber(n) {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return String(n);
}

function truncate(str, len) {
  if (!str) return '';
  if (str.length <= len) return str;
  return str.slice(0, len) + '...';
}

function stripHighlight(str) {
  return str.replace(/>>>/g, '').replace(/<<</g, '');
}

async function dbReset(flags) {
  if (!isDatabaseInitialized()) {
    console.log('Database not initialized.');
    return;
  }

  if (!flags.force) {
    console.error('This will delete ALL data from the database.');
    console.error('Use --force to confirm.');
    process.exit(1);
  }

  const db = getDb();
  const dbPath = getDbPath();

  // Get counts before deletion
  const tables = ['sessions', 'turns', 'tool_calls', 'projects'];
  const counts = {};

  for (const table of tables) {
    try {
      const row = db.prepare(`SELECT COUNT(*) as count FROM ${table}`).get();
      counts[table] = row.count;
    } catch (e) {
      counts[table] = 0;
    }
  }

  console.log('Deleting all data...');
  console.log('─'.repeat(40));

  // Delete in order (respecting foreign keys)
  const deleteOrder = ['tool_calls', 'turns', 'sessions', 'projects'];

  for (const table of deleteOrder) {
    try {
      db.prepare(`DELETE FROM ${table}`).run();
      console.log(`  ${table}: ${counts[table]} rows deleted`);
    } catch (e) {
      // Table might not exist
    }
  }

  // Also clear FTS tables
  try {
    db.prepare('DELETE FROM turns_fts').run();
    console.log('  turns_fts: cleared');
  } catch (e) {
    // FTS might not exist
  }

  console.log('─'.repeat(40));
  console.log('Database reset complete.');
  console.log(`Path: ${dbPath}`);
}

function dbVacuum(flags) {
  if (!isDatabaseInitialized()) {
    console.log('Database not initialized.');
    return;
  }

  const dbPath = getDbPath();
  const sizeBefore = getDbSize();

  console.log('Compacting database...');
  console.log(`  Before: ${formatBytes(sizeBefore)}`);

  const db = getDb();
  db.exec('VACUUM');

  const sizeAfter = getDbSize();
  const saved = sizeBefore - sizeAfter;

  console.log(`  After:  ${formatBytes(sizeAfter)}`);

  if (saved > 0) {
    console.log(`  Saved:  ${formatBytes(saved)} (${((saved / sizeBefore) * 100).toFixed(1)}%)`);
  } else {
    console.log('  No space reclaimed.');
  }
}

function dbBackup(args, flags) {
  if (!isDatabaseInitialized()) {
    console.log('Database not initialized.');
    return;
  }

  const dbPath = getDbPath();

  // Default backup path
  let backupPath = args[0];
  if (!backupPath) {
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    backupPath = join(dirname(dbPath), `rudi-backup-${timestamp}.db`);
  }

  // Expand ~ to home directory
  if (backupPath.startsWith('~')) {
    backupPath = join(process.env.HOME || '', backupPath.slice(1));
  }

  if (existsSync(backupPath) && !flags.force) {
    console.error(`Backup file already exists: ${backupPath}`);
    console.error('Use --force to overwrite.');
    process.exit(1);
  }

  console.log('Creating backup...');
  console.log(`  Source: ${dbPath}`);
  console.log(`  Dest:   ${backupPath}`);

  try {
    // Use SQLite backup API for consistency
    const db = getDb();
    db.exec('VACUUM INTO ?', [backupPath]);
  } catch (e) {
    // Fallback to file copy
    copyFileSync(dbPath, backupPath);
  }

  const size = getDbSize();
  console.log(`  Size:   ${formatBytes(size)}`);
  console.log('Backup complete.');
}

function dbPrune(args, flags) {
  if (!isDatabaseInitialized()) {
    console.log('Database not initialized.');
    return;
  }

  const days = parseInt(args[0]) || 90;
  const dryRun = flags['dry-run'] || flags.dryRun;
  const cutoffDate = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();

  const db = getDb();

  // Count sessions to be deleted
  const toDelete = db.prepare(`
    SELECT COUNT(*) as count FROM sessions
    WHERE last_active_at < ? OR (last_active_at IS NULL AND created_at < ?)
  `).get(cutoffDate, cutoffDate);

  const total = db.prepare('SELECT COUNT(*) as count FROM sessions').get();

  console.log(`Sessions older than ${days} days: ${toDelete.count}`);
  console.log(`Total sessions: ${total.count}`);
  console.log(`Cutoff date: ${cutoffDate.slice(0, 10)}`);

  if (toDelete.count === 0) {
    console.log('\nNo sessions to prune.');
    return;
  }

  if (dryRun) {
    console.log('\n(Dry run - no changes made)');
    return;
  }

  if (!flags.force) {
    console.error(`\nThis will delete ${toDelete.count} sessions and their turns.`);
    console.error('Use --force to confirm, or --dry-run to preview.');
    process.exit(1);
  }

  console.log('\nDeleting old sessions...');

  // Get session IDs to delete
  const sessionIds = db.prepare(`
    SELECT id FROM sessions
    WHERE last_active_at < ? OR (last_active_at IS NULL AND created_at < ?)
  `).all(cutoffDate, cutoffDate).map(r => r.id);

  // Delete related data
  let turnsDeleted = 0;
  let toolCallsDeleted = 0;

  for (const sessionId of sessionIds) {
    // Delete tool calls for this session's turns
    const turnIds = db.prepare('SELECT id FROM turns WHERE session_id = ?').all(sessionId).map(r => r.id);
    for (const turnId of turnIds) {
      const result = db.prepare('DELETE FROM tool_calls WHERE turn_id = ?').run(turnId);
      toolCallsDeleted += result.changes;
    }

    // Delete turns
    const turnResult = db.prepare('DELETE FROM turns WHERE session_id = ?').run(sessionId);
    turnsDeleted += turnResult.changes;
  }

  // Delete sessions
  const sessionResult = db.prepare(`
    DELETE FROM sessions
    WHERE last_active_at < ? OR (last_active_at IS NULL AND created_at < ?)
  `).run(cutoffDate, cutoffDate);

  console.log(`  Sessions deleted: ${sessionResult.changes}`);
  console.log(`  Turns deleted: ${turnsDeleted}`);
  console.log(`  Tool calls deleted: ${toolCallsDeleted}`);
  console.log('\nPrune complete. Run "rudi db vacuum" to reclaim disk space.');
}

function dbTables(flags) {
  if (!isDatabaseInitialized()) {
    console.log('Database not initialized.');
    return;
  }

  const db = getDb();

  // Get all tables
  const tables = db.prepare(`
    SELECT name FROM sqlite_master
    WHERE type = 'table' AND name NOT LIKE 'sqlite_%'
    ORDER BY name
  `).all();

  if (flags.json) {
    const result = {};
    for (const { name } of tables) {
      try {
        const row = db.prepare(`SELECT COUNT(*) as count FROM "${name}"`).get();
        result[name] = row.count;
      } catch (e) {
        result[name] = -1;
      }
    }
    console.log(JSON.stringify(result, null, 2));
    return;
  }

  console.log('\nDatabase Tables');
  console.log('═'.repeat(40));

  let totalRows = 0;
  for (const { name } of tables) {
    try {
      const row = db.prepare(`SELECT COUNT(*) as count FROM "${name}"`).get();
      console.log(`  ${name.padEnd(25)} ${row.count.toLocaleString().padStart(10)}`);
      totalRows += row.count;
    } catch (e) {
      console.log(`  ${name.padEnd(25)} ${'error'.padStart(10)}`);
    }
  }

  console.log('─'.repeat(40));
  console.log(`  ${'Total'.padEnd(25)} ${totalRows.toLocaleString().padStart(10)}`);
  console.log(`\n  Size: ${formatBytes(getDbSize())}`);
}
