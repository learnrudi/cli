/**
 * Database connection module for RUDI
 * Uses better-sqlite3 for synchronous, fast SQLite access
 */

import Database from 'better-sqlite3';
import path from 'path';
import fs from 'fs';
import { PATHS } from '@learnrudi/env';

// Re-export for convenience
export const DB_PATH = PATHS.dbFile;

let db = null;

/**
 * Get or create the database connection
 * @param {Object} options - Connection options
 * @param {boolean} options.readonly - Open in read-only mode
 * @returns {Database.Database} SQLite database instance
 */
export function getDb(options = {}) {
  if (!db) {
    // Ensure directory exists
    const dbDir = path.dirname(DB_PATH);
    if (!fs.existsSync(dbDir)) {
      fs.mkdirSync(dbDir, { recursive: true });
    }

    db = new Database(DB_PATH, {
      readonly: options.readonly || false
    });

    // Enable WAL mode for better concurrent access
    db.pragma('journal_mode = WAL');

    // Enable foreign keys
    db.pragma('foreign_keys = ON');

    // Performance optimizations
    db.pragma('synchronous = NORMAL');
    db.pragma('cache_size = -64000'); // 64MB cache
  }
  return db;
}

/**
 * Close the database connection
 */
export function closeDb() {
  if (db) {
    db.close();
    db = null;
  }
}

/**
 * Check if database exists and is initialized
 * @returns {boolean}
 */
export function isDatabaseInitialized() {
  if (!fs.existsSync(DB_PATH)) {
    return false;
  }

  try {
    const testDb = new Database(DB_PATH, { readonly: true });
    const result = testDb.prepare(`
      SELECT name FROM sqlite_master
      WHERE type='table' AND name='schema_version'
    `).get();
    testDb.close();
    return !!result;
  } catch {
    return false;
  }
}

/**
 * Get database file path
 * @returns {string}
 */
export function getDbPath() {
  return DB_PATH;
}

/**
 * Get database file size in bytes
 * @returns {number|null}
 */
export function getDbSize() {
  try {
    const stats = fs.statSync(DB_PATH);
    return stats.size;
  } catch {
    return null;
  }
}

// Re-export from other modules for convenience
export * from './schema.js';
export * from './search.js';
export * from './stats.js';
export * from './logs.js';
export * from './import.js';
export * from './session-identity.js';
