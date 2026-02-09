/**
 * Drop-in adapter: bun:sqlite → better-sqlite3 API
 *
 * esbuild's --alias flag swaps `import Database from 'better-sqlite3'`
 * for this module at build time. The existing @learnrudi/db code stays
 * untouched — it sees the same .prepare()/.exec()/.transaction()/.pragma() API.
 *
 * bun:sqlite is built into the Bun runtime and compiles into the binary,
 * so no native .node addon is needed.
 */

import { Database as BunDatabase } from "bun:sqlite";

export default class Database {
  constructor(filename, options = {}) {
    this._db = new BunDatabase(filename, {
      readonly: options.readonly || false,
      create: true,
    });
  }

  /**
   * Polyfill for better-sqlite3's .pragma() method.
   *
   * Usage patterns in @learnrudi/db:
   *   db.pragma('journal_mode = WAL')       → SET pragma
   *   db.pragma('foreign_keys = ON')        → SET pragma
   *   db.pragma('cache_size = -64000')      → SET pragma
   *   db.pragma('table_info(sessions)')     → returns array of column info rows
   *   db.pragma('journal_mode', {simple:true}) → returns single value
   */
  pragma(str, options) {
    // SET form: contains '='
    if (str.includes('=')) {
      this._db.run(`PRAGMA ${str}`);
      return;
    }

    // Query form: may return rows or a single value
    const rows = this._db.query(`PRAGMA ${str}`).all();

    // table_info() returns multiple rows — return as-is
    if (str.includes('(') && rows.length > 1) {
      return rows;
    }

    // {simple: true} or single-value pragmas — return scalar
    if (options?.simple || rows.length <= 1) {
      if (rows.length === 0) return undefined;
      const vals = Object.values(rows[0]);
      return vals.length === 1 ? vals[0] : rows[0];
    }

    return rows;
  }

  prepare(sql) {
    return this._db.prepare(sql);
  }

  exec(sql) {
    return this._db.exec(sql);
  }

  close() {
    return this._db.close();
  }

  transaction(fn) {
    return this._db.transaction(fn);
  }
}
