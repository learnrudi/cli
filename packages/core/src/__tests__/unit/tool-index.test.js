import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '../../../../..');
const toolIndexUrl = pathToFileURL(path.join(repoRoot, 'packages/core/src/tool-index.js')).href;

test('removeStackFromToolIndex prunes one cached stack entry', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'rudi-tool-index-'));
  const rudiHome = path.join(root, '.rudi');

  try {
    const script = `
      const fs = await import('node:fs');
      const path = await import('node:path');
      const { readToolIndex, removeStackFromToolIndex, writeToolIndex } = await import(process.argv[1]);
      writeToolIndex({
        version: 1,
        updatedAt: 'old',
        byStack: {
          'stack:slack': { indexedAt: 'old', tools: [], error: null },
          'stack:notion': { indexedAt: 'old', tools: [{ name: 'notion_search' }], error: null }
        }
      });
      const removed = removeStackFromToolIndex('stack:slack');
      const missing = removeStackFromToolIndex('stack:missing');
      console.log(JSON.stringify({ removed, missing, index: readToolIndex() }));
    `;

    const output = execFileSync(process.execPath, ['--input-type=module', '-e', script, toolIndexUrl], {
      cwd: repoRoot,
      env: {
        ...process.env,
        RUDI_HOME: rudiHome,
      },
      encoding: 'utf8',
    });

    const result = JSON.parse(output);
    assert.equal(result.removed, true);
    assert.equal(result.missing, false);
    assert.deepEqual(Object.keys(result.index.byStack), ['stack:notion']);
    assert.equal(result.index.byStack['stack:notion'].tools[0].name, 'notion_search');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
