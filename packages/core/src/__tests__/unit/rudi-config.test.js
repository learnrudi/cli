import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '../../../../..');
const rudiConfigUrl = pathToFileURL(path.join(repoRoot, 'packages/core/src/rudi-config.js')).href;

test('stack config normalizes secret key definitions and preserves shared metadata', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'rudi-config-'));
  const rudiHome = path.join(root, '.rudi');

  try {
    fs.mkdirSync(rudiHome, { recursive: true });

    const script = `
      const {
        addStack,
        readRudiConfig,
        removeStack
      } = await import(process.argv[1]);

      addStack('stack:slack', {
        path: '/tmp/slack',
        runtime: 'node',
        command: ['node', 'index.js'],
        secrets: [
          { key: 'SHARED_TOKEN', required: false },
          { name: 'SLACK_BOT_TOKEN', required: true },
          null
        ],
        version: '1.0.0'
      });
      addStack('stack:notion', {
        path: '/tmp/notion',
        runtime: 'node',
        command: ['node', 'index.js'],
        secrets: [{ name: 'SHARED_TOKEN', required: true }],
        version: '1.0.0'
      });
      removeStack('stack:slack');
      console.log(JSON.stringify(readRudiConfig()));
    `;

    const output = execFileSync(process.execPath, ['--input-type=module', '-e', script, rudiConfigUrl], {
      cwd: repoRoot,
      env: {
        ...process.env,
        RUDI_HOME: rudiHome,
      },
      encoding: 'utf8',
    });

    const config = JSON.parse(output);
    assert.deepEqual(config.stacks['stack:notion'].secrets, [
      { name: 'SHARED_TOKEN', required: true },
    ]);
    assert.ok(!config.stacks['stack:slack']);
    assert.equal(config.secrets.SHARED_TOKEN.required, false);
    assert.equal(config.secrets.SLACK_BOT_TOKEN, undefined);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
