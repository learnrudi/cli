import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Worker, isMainThread, workerData } from 'node:worker_threads';
import Database from 'better-sqlite3';

// Explicit global.gc() does not reproduce Node's context-free GC cleanup bug.
// Keep allocation pressure high and allow V8 to collect unreachable wrappers.
let allocation = [];
for (let index = 0; index < 4_000; index += 1) {
  const database = new Database(':memory:');
  assert.equal(database.prepare('SELECT ? AS value').get(index).value, index);
  database.close();
  for (let item = 0; item < 100; item += 1) allocation.push({ index, item });
  if (allocation.length > 1_000) allocation = [];
}

if (isMainThread) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'rudi-sqlite-teardown-'));
  const databasePath = path.join(root, 'fixture.db');
  try {
    // The worker deliberately retains an open database and statement until its
    // environment exits. Both cleanup paths must leave committed data readable.
    await new Promise((resolve, reject) => {
      const worker = new Worker(new URL(import.meta.url), { workerData: { databasePath } });
      worker.once('error', reject);
      worker.once('exit', code => code === 0 ? resolve() : reject(new Error(`SQLite worker exited ${code}`)));
    });
    for (let iteration = 0; iteration < 30; iteration += 1) {
      const database = new Database(databasePath);
      try {
        assert.equal(database.prepare('SELECT value FROM fixture').get().value, 42);
        assert.equal(database.pragma('integrity_check', { simple: true }), 'ok');
        database.exec('BEGIN; UPDATE fixture SET value = 0; ROLLBACK;');
      } finally {
        database.close();
      }
    }
    console.log('sqlite teardown passed: allocation GC, worker exit, 30 reopen/integrity/rollback checks');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
} else {
  const database = new Database(workerData.databasePath);
  database.pragma('journal_mode = WAL');
  database.exec('CREATE TABLE fixture (value INTEGER); INSERT INTO fixture VALUES (42);');
  globalThis.sqliteTeardownFixture = { database, statement: database.prepare('SELECT value FROM fixture') };
}
