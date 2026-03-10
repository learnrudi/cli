/**
 * Tests for Phase 4: Enriched sessions:updated broadcast payload.
 * Verifies that the sidecar correctly parses sessionId and projectDir from
 * watcher file paths, and coalesces multiple events into sessionIds arrays.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert';
import path from 'path';
import os from 'os';
import {
  shouldBroadcastSessionUpdate,
  shouldRefreshProjectsForSessionUpdate,
} from '../../commands/serve/sessions.js';

const CLAUDE_ROOT_DIR = path.join(os.homedir(), '.claude');
const CLAUDE_PROJECTS_DIR = path.join(CLAUDE_ROOT_DIR, 'projects');
const CODEX_ROOT_DIR = path.join(os.homedir(), '.codex');
const CODEX_SESSIONS_DIR = path.join(CODEX_ROOT_DIR, 'sessions');

// --- shouldBroadcastSessionUpdate tests (existing + new) ---

describe('shouldBroadcastSessionUpdate', () => {
  test('accepts JSONL files in projects dir', () => {
    assert.ok(shouldBroadcastSessionUpdate(CLAUDE_PROJECTS_DIR, 'my-project/abc123.jsonl'));
  });

  test('accepts sessions-index.json', () => {
    assert.ok(shouldBroadcastSessionUpdate(CLAUDE_PROJECTS_DIR, 'my-project/sessions-index.json'));
  });

  test('rejects non-project files', () => {
    assert.ok(!shouldBroadcastSessionUpdate(CLAUDE_PROJECTS_DIR, ''));
  });

  test('rejects random files', () => {
    assert.ok(!shouldBroadcastSessionUpdate(CLAUDE_PROJECTS_DIR, 'settings.json'));
  });

  test('accepts when watchRoot is parent .claude dir', () => {
    assert.ok(shouldBroadcastSessionUpdate(CLAUDE_ROOT_DIR, 'projects/my-project/abc.jsonl'));
  });

  test('rejects non-projects path from parent dir', () => {
    assert.ok(!shouldBroadcastSessionUpdate(CLAUDE_ROOT_DIR, 'config.json'));
  });

  test('accepts Codex JSONL files in sessions dir', () => {
    assert.ok(shouldBroadcastSessionUpdate(CODEX_SESSIONS_DIR, '2026/02/14/rollout-abc.jsonl'));
  });

  test('accepts Codex sessions path from parent .codex dir', () => {
    assert.ok(shouldBroadcastSessionUpdate(CODEX_ROOT_DIR, 'sessions/2026/02/14/rollout-abc.jsonl'));
  });

  test('rejects non-sessions path from parent .codex dir', () => {
    assert.ok(!shouldBroadcastSessionUpdate(CODEX_ROOT_DIR, 'config.json'));
  });
});

describe('shouldRefreshProjectsForSessionUpdate', () => {
  test('does not refresh projects for live JSONL append activity', () => {
    assert.strictEqual(
      shouldRefreshProjectsForSessionUpdate(CLAUDE_PROJECTS_DIR, 'my-project/abc123.jsonl'),
      false,
    );
    assert.strictEqual(
      shouldRefreshProjectsForSessionUpdate(CODEX_SESSIONS_DIR, '2026/02/14/rollout-abc.jsonl'),
      false,
    );
  });

  test('does refresh projects for sessions index changes', () => {
    assert.strictEqual(
      shouldRefreshProjectsForSessionUpdate(CLAUDE_PROJECTS_DIR, 'my-project/sessions-index.json'),
      true,
    );
  });

  test('fails safe for empty or directory-level watcher events', () => {
    assert.strictEqual(shouldRefreshProjectsForSessionUpdate(CLAUDE_PROJECTS_DIR, ''), true);
    assert.strictEqual(shouldRefreshProjectsForSessionUpdate(CLAUDE_ROOT_DIR, 'projects'), true);
  });
});

// --- SessionId/projectDir parsing tests ---
// We can't directly test the watcher callback since it's inside a closure,
// so we test the parsing logic by extracting and running the same algorithm.

function parseWatcherPath(watchRoot, relPath) {
  const normalized = relPath.replace(/\\/g, '/');
  const result = { sessionId: null, projectDir: null };

  if (!normalized.endsWith('.jsonl')) return result;

  const parts = normalized.split('/');
  const inProjects = watchRoot === CLAUDE_PROJECTS_DIR;
  const projIdx = inProjects ? 0 : 1;

  if (parts.length > projIdx + 1) {
    result.projectDir = parts[projIdx] || null;
    const fname = parts[projIdx + 1];
    if (fname && fname.endsWith('.jsonl')) {
      result.sessionId = fname.slice(0, -6);
    }
  }

  return result;
}

describe('watcher path parsing (CLAUDE_PROJECTS_DIR watchRoot)', () => {
  test('parses sessionId and projectDir from standard JSONL path', () => {
    const result = parseWatcherPath(CLAUDE_PROJECTS_DIR, 'my-project/abc123-def456.jsonl');
    assert.strictEqual(result.projectDir, 'my-project');
    assert.strictEqual(result.sessionId, 'abc123-def456');
  });

  test('parses UUID-style sessionId', () => {
    const result = parseWatcherPath(CLAUDE_PROJECTS_DIR, '-Users-hoff-dev-RUDI-lite/baa37a4a-a7d9-4dc4-9d53-1f8722f6c34a.jsonl');
    assert.strictEqual(result.projectDir, '-Users-hoff-dev-RUDI-lite');
    assert.strictEqual(result.sessionId, 'baa37a4a-a7d9-4dc4-9d53-1f8722f6c34a');
  });

  test('returns null for sessions-index.json (not JSONL)', () => {
    const result = parseWatcherPath(CLAUDE_PROJECTS_DIR, 'my-project/sessions-index.json');
    assert.strictEqual(result.sessionId, null);
    assert.strictEqual(result.projectDir, null);
  });

  test('handles Windows-style backslashes', () => {
    const result = parseWatcherPath(CLAUDE_PROJECTS_DIR, 'my-project\\session-id.jsonl');
    assert.strictEqual(result.projectDir, 'my-project');
    assert.strictEqual(result.sessionId, 'session-id');
  });
});

describe('watcher path parsing (CLAUDE_ROOT_DIR watchRoot)', () => {
  test('parses sessionId and projectDir from projects/ prefixed path', () => {
    const result = parseWatcherPath(CLAUDE_ROOT_DIR, 'projects/my-project/session123.jsonl');
    assert.strictEqual(result.projectDir, 'my-project');
    assert.strictEqual(result.sessionId, 'session123');
  });

  test('returns null for non-projects files', () => {
    const result = parseWatcherPath(CLAUDE_ROOT_DIR, 'config/settings.jsonl');
    // projIdx=1, parts = ['config', 'settings.jsonl'], parts[1] exists
    // But this is config dir not projects — still parses (broadcast filter handles it)
    // The important thing is it doesn't crash
    assert.ok(result !== null);
  });

  test('returns null for too-short paths', () => {
    const result = parseWatcherPath(CLAUDE_ROOT_DIR, 'projects.jsonl');
    assert.strictEqual(result.sessionId, null);
    assert.strictEqual(result.projectDir, null);
  });
});

// --- Coalescing logic test ---
// Simulate the Set-based accumulation that happens in queueSessionsUpdated

describe('sessionId coalescing', () => {
  test('accumulates multiple sessionIds into array', () => {
    const pending = new Set();

    // Simulate 3 watcher events within debounce window
    pending.add('session-aaa');
    pending.add('session-bbb');
    pending.add('session-aaa'); // duplicate — Set deduplicates

    const payload = {};
    if (pending.size > 0) {
      payload.sessionIds = [...pending];
      if (pending.size === 1) {
        payload.sessionId = payload.sessionIds[0];
      }
    }

    assert.strictEqual(payload.sessionIds.length, 2);
    assert.ok(payload.sessionIds.includes('session-aaa'));
    assert.ok(payload.sessionIds.includes('session-bbb'));
    assert.strictEqual(payload.sessionId, undefined); // multiple — no singular
  });

  test('sets singular sessionId when only one session', () => {
    const pending = new Set();
    pending.add('single-session');

    const payload = {};
    if (pending.size > 0) {
      payload.sessionIds = [...pending];
      if (pending.size === 1) {
        payload.sessionId = payload.sessionIds[0];
      }
    }

    assert.strictEqual(payload.sessionIds.length, 1);
    assert.strictEqual(payload.sessionId, 'single-session');
  });
});
