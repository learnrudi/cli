/**
 * Unit tests for permission system helpers
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  deriveBatchId,
  toolMatchesPattern,
  generatePermissionPattern,
  loadProjectPermissions,
  isToolAllowedByProject,
} from '../../commands/agent/permissions.js';
import fs from 'fs';
import path from 'path';
import os from 'os';

describe('deriveBatchId', () => {
  it('creates same batch ID for same tool within 500ms', () => {
    const sessionId = 'session-123';
    const toolName = 'Read';
    const time1 = 1000000;
    const time2 = 1000400;

    const batch1 = deriveBatchId(sessionId, toolName, time1);
    const batch2 = deriveBatchId(sessionId, toolName, time2);

    assert.strictEqual(batch1, batch2);
  });

  it('creates different batch ID for different tools', () => {
    const sessionId = 'session-123';
    const time = 1000000;

    const batch1 = deriveBatchId(sessionId, 'Read', time);
    const batch2 = deriveBatchId(sessionId, 'Write', time);

    assert.notStrictEqual(batch1, batch2);
  });

  it('creates different batch ID for same tool after 500ms', () => {
    const sessionId = 'session-123';
    const toolName = 'Read';
    const time1 = 1000000;
    const time2 = 1000600; // 600ms later

    const batch1 = deriveBatchId(sessionId, toolName, time1);
    const batch2 = deriveBatchId(sessionId, toolName, time2);

    assert.notStrictEqual(batch1, batch2);
  });
});

describe('toolMatchesPattern', () => {
  it('matches simple tool name', () => {
    assert.strictEqual(toolMatchesPattern('Read', {}, 'Read'), true);
    assert.strictEqual(toolMatchesPattern('Write', {}, 'Write'), true);
    assert.strictEqual(toolMatchesPattern('Edit', {}, 'Edit'), true);
  });

  it('does not match different tool name', () => {
    assert.strictEqual(toolMatchesPattern('Read', {}, 'Write'), false);
    assert.strictEqual(toolMatchesPattern('Edit', {}, 'Bash'), false);
  });

  it('matches Bash with prefix wildcard', () => {
    assert.strictEqual(
      toolMatchesPattern('Bash', { command: 'cd /foo/bar' }, 'Bash(cd:*)'),
      true
    );
    assert.strictEqual(
      toolMatchesPattern('Bash', { command: 'git status' }, 'Bash(git:*)'),
      true
    );
    assert.strictEqual(
      toolMatchesPattern('Bash', { command: 'npm install' }, 'Bash(npm:*)'),
      true
    );
  });

  it('does not match Bash with wrong prefix', () => {
    assert.strictEqual(
      toolMatchesPattern('Bash', { command: 'cd /foo' }, 'Bash(git:*)'),
      false
    );
    assert.strictEqual(
      toolMatchesPattern('Bash', { command: 'npm test' }, 'Bash(cd:*)'),
      false
    );
  });

  it('matches Bash with exact command', () => {
    assert.strictEqual(
      toolMatchesPattern('Bash', { command: 'ls -la' }, 'Bash(ls -la)'),
      true
    );
  });

  it('does not match Bash with different command', () => {
    assert.strictEqual(
      toolMatchesPattern('Bash', { command: 'ls -la' }, 'Bash(pwd)'),
      false
    );
  });

  it('returns false for invalid pattern format', () => {
    assert.strictEqual(toolMatchesPattern('Read', {}, 'Invalid(Pattern'), false);
    assert.strictEqual(toolMatchesPattern('Read', {}, 'NoParens)'), false);
  });
});

describe('generatePermissionPattern', () => {
  it('generates wildcard pattern for simple Bash commands', () => {
    assert.strictEqual(generatePermissionPattern('Bash', { command: 'ls -la' }), 'Bash(ls:*)');
    assert.strictEqual(generatePermissionPattern('Bash', { command: 'cd /foo/bar' }), 'Bash(cd:*)');
    assert.strictEqual(generatePermissionPattern('Bash', { command: 'pwd' }), 'Bash(pwd:*)');
  });

  it('generates compound pattern for git/npm/etc commands', () => {
    assert.strictEqual(generatePermissionPattern('Bash', { command: 'git status' }), 'Bash(git status:*)');
    assert.strictEqual(generatePermissionPattern('Bash', { command: 'npm install foo' }), 'Bash(npm install:*)');
    assert.strictEqual(generatePermissionPattern('Bash', { command: 'docker ps -a' }), 'Bash(docker ps:*)');
    assert.strictEqual(generatePermissionPattern('Bash', { command: 'cargo build --release' }), 'Bash(cargo build:*)');
  });

  it('returns simple tool name for non-Bash tools', () => {
    assert.strictEqual(generatePermissionPattern('Read', { file_path: '/foo/bar.txt' }), 'Read');
    assert.strictEqual(generatePermissionPattern('Write', { file_path: '/foo/baz.txt' }), 'Write');
    assert.strictEqual(generatePermissionPattern('Edit', {}), 'Edit');
  });
});

describe('loadProjectPermissions', () => {
  it('returns empty array when settings file does not exist', () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rudi-test-'));
    const permissions = loadProjectPermissions(tempDir);
    assert.deepStrictEqual(permissions, []);
    fs.rmSync(tempDir, { recursive: true });
  });

  it('loads permissions from .claude/settings.local.json', () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rudi-test-'));
    const settingsPath = path.join(tempDir, '.claude', 'settings.local.json');
    fs.mkdirSync(path.dirname(settingsPath), { recursive: true });
    fs.writeFileSync(
      settingsPath,
      JSON.stringify({
        permissions: {
          allow: ['Read', 'Write', 'Bash(git:*)'],
        },
      })
    );

    const permissions = loadProjectPermissions(tempDir);
    assert.deepStrictEqual(permissions, ['Read', 'Write', 'Bash(git:*)']);

    fs.rmSync(tempDir, { recursive: true });
  });

  it('returns empty array when permissions.allow is missing', () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rudi-test-'));
    const settingsPath = path.join(tempDir, '.claude', 'settings.local.json');
    fs.mkdirSync(path.dirname(settingsPath), { recursive: true });
    fs.writeFileSync(settingsPath, JSON.stringify({}));

    const permissions = loadProjectPermissions(tempDir);
    assert.deepStrictEqual(permissions, []);

    fs.rmSync(tempDir, { recursive: true });
  });
});

describe('isToolAllowedByProject', () => {
  it('returns false when projectCwd is not provided', () => {
    assert.strictEqual(isToolAllowedByProject(null, 'Read', {}), false);
    assert.strictEqual(isToolAllowedByProject(undefined, 'Read', {}), false);
  });

  it('returns false when no settings file exists', () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rudi-test-'));
    assert.strictEqual(isToolAllowedByProject(tempDir, 'Read', {}), false);
    fs.rmSync(tempDir, { recursive: true });
  });

  it('returns true when tool matches project settings', () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rudi-test-'));
    const settingsPath = path.join(tempDir, '.claude', 'settings.local.json');
    fs.mkdirSync(path.dirname(settingsPath), { recursive: true });
    fs.writeFileSync(
      settingsPath,
      JSON.stringify({
        permissions: {
          allow: ['Read', 'Bash(git:*)'],
        },
      })
    );

    assert.strictEqual(isToolAllowedByProject(tempDir, 'Read', {}), true);
    assert.strictEqual(isToolAllowedByProject(tempDir, 'Bash', { command: 'git status' }), true);

    fs.rmSync(tempDir, { recursive: true });
  });

  it('returns false when tool does not match project settings', () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rudi-test-'));
    const settingsPath = path.join(tempDir, '.claude', 'settings.local.json');
    fs.mkdirSync(path.dirname(settingsPath), { recursive: true });
    fs.writeFileSync(
      settingsPath,
      JSON.stringify({
        permissions: {
          allow: ['Read'],
        },
      })
    );

    assert.strictEqual(isToolAllowedByProject(tempDir, 'Write', {}), false);
    assert.strictEqual(isToolAllowedByProject(tempDir, 'Bash', { command: 'rm -rf /' }), false);

    fs.rmSync(tempDir, { recursive: true });
  });
});
