import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import Database from 'better-sqlite3';

import { seedModelPricing } from '../../../packages/db/src/schema.js';

function createPricingTable(db) {
  db.exec(`
    CREATE TABLE model_pricing (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      provider TEXT NOT NULL,
      model_pattern TEXT NOT NULL,
      display_name TEXT,
      input_cost_per_mtok REAL NOT NULL,
      output_cost_per_mtok REAL NOT NULL,
      cache_read_cost_per_mtok REAL DEFAULT 0,
      cache_write_cost_per_mtok REAL DEFAULT 0,
      effective_from TEXT NOT NULL,
      effective_until TEXT,
      notes TEXT,
      UNIQUE(provider, model_pattern, effective_from)
    );
  `);
}

describe('model pricing seed data', () => {
  test('seeds current Codex GPT-5.4 pricing rows with cached input rates', () => {
    const db = new Database(':memory:');
    createPricingTable(db);

    seedModelPricing(db);

    const gpt54 = db.prepare(`
      SELECT input_cost_per_mtok, output_cost_per_mtok, cache_read_cost_per_mtok
      FROM model_pricing
      WHERE provider = 'codex' AND model_pattern = 'gpt-5.4'
    `).get();
    const gpt54Mini = db.prepare(`
      SELECT input_cost_per_mtok, output_cost_per_mtok, cache_read_cost_per_mtok
      FROM model_pricing
      WHERE provider = 'codex' AND model_pattern = 'gpt-5.4-mini'
    `).get();

    assert.deepEqual(gpt54, {
      input_cost_per_mtok: 2.5,
      output_cost_per_mtok: 15,
      cache_read_cost_per_mtok: 0.25,
    });
    assert.deepEqual(gpt54Mini, {
      input_cost_per_mtok: 0.75,
      output_cost_per_mtok: 4.5,
      cache_read_cost_per_mtok: 0.075,
    });

    db.close();
  });
});
