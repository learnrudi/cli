import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import {
  installCodexGlobalInstructions,
  patchCodexTomlRouter,
} from '../../commands/integrate.js';

test('patchCodexTomlRouter adds rudi router to Codex config.toml', () => {
  const result = patchCodexTomlRouter('model = "gpt-5.3-codex"\n', '/Users/test/.rudi/bins/rudi-router', {
    rudiStacksPath: '/Users/test/.rudi/stacks',
  });

  assert.equal(result.action, 'added');
  assert.deepEqual(result.removed, []);
  assert.match(result.content, /model = "gpt-5\.3-codex"/);
  assert.match(result.content, /\[mcp_servers\.rudi]/);
  assert.match(result.content, /command = "\/Users\/test\/\.rudi\/bins\/rudi-router"/);
  assert.match(result.content, /args = \[]/);
});

test('patchCodexTomlRouter removes direct RUDI stack entries and nested subtables', () => {
  const input = [
    'model = "gpt-5.3-codex"',
    '',
    '[mcp_servers.slack]',
    'command = "node"',
    'cwd = "/Users/test/.rudi/stacks/slack"',
    'args = ["dist/index.js"]',
    '',
    '[mcp_servers.slack.env]',
    'SLACK_BOT_TOKEN = "redacted"',
    '',
    '[mcp_servers.content-extractor]',
    'command = "tsx"',
    'args = ["/Users/test/.rudi/stacks/content-extractor/src/index.ts"]',
    '',
    '[projects."/Users/test/dev"]',
    'trust_level = "trusted"',
    '',
  ].join('\n');

  const result = patchCodexTomlRouter(input, '/Users/test/.rudi/bins/rudi-router', {
    rudiStacksPath: '/Users/test/.rudi/stacks',
  });

  assert.equal(result.action, 'added');
  assert.deepEqual(result.removed, ['content-extractor', 'slack']);
  assert.doesNotMatch(result.content, /\[mcp_servers\.slack]/);
  assert.doesNotMatch(result.content, /\[mcp_servers\.slack\.env]/);
  assert.doesNotMatch(result.content, /\[mcp_servers\.content-extractor]/);
  assert.match(result.content, /\[projects\."\/Users\/test\/dev"]/);
  assert.match(result.content, /\[mcp_servers\.rudi]/);
});

test('patchCodexTomlRouter updates existing rudi router entry idempotently', () => {
  const input = [
    '[mcp_servers.rudi]',
    'command = "/old/rudi-router"',
    'args = []',
    '',
    '[mcp_servers.github]',
    'command = "github-mcp"',
    '',
  ].join('\n');

  const result = patchCodexTomlRouter(input, '/Users/test/.rudi/bins/rudi-router', {
    rudiStacksPath: '/Users/test/.rudi/stacks',
  });

  assert.equal(result.action, 'updated');
  assert.deepEqual(result.removed, []);
  assert.doesNotMatch(result.content, /\/old\/rudi-router/);
  assert.match(result.content, /\[mcp_servers\.github]/);
  assert.match(result.content, /command = "\/Users\/test\/\.rudi\/bins\/rudi-router"/);
});

test('patchCodexTomlRouter leaves matching rudi router entry unchanged', () => {
  const input = [
    'model = "gpt-5.3-codex"',
    '',
    '[mcp_servers.rudi]',
    'command = "/Users/test/.rudi/bins/rudi-router"',
    'args = []',
    '',
  ].join('\n');

  const result = patchCodexTomlRouter(input, '/Users/test/.rudi/bins/rudi-router', {
    rudiStacksPath: '/Users/test/.rudi/stacks',
  });

  assert.equal(result.action, 'none');
  assert.deepEqual(result.removed, []);
  assert.equal(result.content, input);
});

test('installCodexGlobalInstructions creates missing global AGENTS.md', async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'rudi-codex-instructions-'));

  try {
    const result = await installCodexGlobalInstructions({}, { home: tmp, cwd: tmp });
    const targetPath = path.join(tmp, '.codex', 'AGENTS.md');

    assert.equal(result.action, 'added');
    assert.equal(result.changed, true);
    assert.equal(result.targetPath, targetPath);
    assert.equal(result.backupPath, null);
    assert.match(fs.readFileSync(targetPath, 'utf-8'), /RUDI Local Capabilities/);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('installCodexGlobalInstructions appends to existing global AGENTS.md', async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'rudi-codex-instructions-'));

  try {
    const targetPath = path.join(tmp, '.codex', 'AGENTS.md');
    fs.mkdirSync(path.dirname(targetPath), { recursive: true });
    fs.writeFileSync(targetPath, '# Existing Codex Instructions\n\nKeep this line.\n');

    const result = await installCodexGlobalInstructions({}, { home: tmp, cwd: tmp });
    const content = fs.readFileSync(targetPath, 'utf-8');

    assert.equal(result.action, 'added');
    assert.equal(result.changed, true);
    assert.match(content, /# Existing Codex Instructions/);
    assert.match(content, /Keep this line\./);
    assert.match(content, /RUDI Local Capabilities/);
    assert.ok(result.backupPath);
    assert.equal(fs.existsSync(result.backupPath), true);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});
