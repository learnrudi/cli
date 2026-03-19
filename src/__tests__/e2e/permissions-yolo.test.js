/**
 * End-to-end tests for YOLO mode and permission system
 */

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import path from 'path';
import os from 'os';

// Mock sidecar server state
let sidecarPort;
let sidecarToken;
let testProjectDir;
let sidecarAvailable = false;
let skipReason = 'Sidecar not running';

describe('Permissions E2E', () => {
  before(async () => {
    // Read sidecar connection info
    const portPath = path.join(os.homedir(), '.rudi', '.rudi-lite-port');
    const tokenPath = path.join(os.homedir(), '.rudi', '.rudi-lite-token');

    if (!fs.existsSync(portPath) || !fs.existsSync(tokenPath)) {
      skipReason = 'Sidecar not running — start RUDI Lite first';
      return;
    }

    sidecarPort = fs.readFileSync(portPath, 'utf-8').trim();
    sidecarToken = fs.readFileSync(tokenPath, 'utf-8').trim();

    try {
      await fetch(`http://127.0.0.1:${sidecarPort}/`, {
        headers: { 'x-rudi-token': sidecarToken },
      });
      sidecarAvailable = true;
    } catch {
      skipReason = 'Sidecar not reachable';
      return;
    }

    // Create temp project directory
    testProjectDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rudi-perm-test-'));
  });

  after(async () => {
    // Cleanup temp project
    if (testProjectDir && fs.existsSync(testProjectDir)) {
      fs.rmSync(testProjectDir, { recursive: true });
    }
  });

  function skipIfSidecarUnavailable(t) {
    if (sidecarAvailable) return false;
    t.skip(skipReason);
    return true;
  }

  describe('YOLO mode', () => {
    it('auto-approves tools without permission prompts', async (t) => {
      if (skipIfSidecarUnavailable(t)) return;
      const response = await fetch(`http://127.0.0.1:${sidecarPort}/agent/start`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-rudi-token': sidecarToken,
        },
        body: JSON.stringify({
          prompt: 'Test YOLO mode',
          cwd: testProjectDir,
          permissionMode: 'dangerouslySkipPermissions',
        }),
      });

      assert.strictEqual(response.ok, true);
      const data = await response.json();
      assert.ok(data.sessionId);

      const sessionId = data.sessionId;

      // Simulate a permission request for a Read tool
      const permResponse = await fetch(`http://127.0.0.1:${sidecarPort}/agent/permission-request`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-rudi-token': sidecarToken,
        },
        body: JSON.stringify({
          rudiSessionId: sessionId,
          claudeSessionId: 'test-claude-session',
          requestId: 'test-request-1',
          toolName: 'Read',
          toolInput: { file_path: '/test/file.txt' },
        }),
      });

      assert.strictEqual(permResponse.ok, true);

      // Check pending permissions — should have zero pending (auto-approved)
      const pendingResponse = await fetch(
        `http://127.0.0.1:${sidecarPort}/agent/permissions?sessionId=${sessionId}`,
        {
          headers: { 'x-rudi-token': sidecarToken },
        }
      );

      assert.strictEqual(pendingResponse.ok, true);
      const pendingData = await pendingResponse.json();
      assert.strictEqual(pendingData.pending.length, 0);

      // Cleanup session
      await fetch(`http://127.0.0.1:${sidecarPort}/agent/stop`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-rudi-token': sidecarToken,
        },
        body: JSON.stringify({ sessionId }),
      });
    }, 10000);
  });

  describe('ASK mode', () => {
    it('creates permission prompts for user approval', async (t) => {
      if (skipIfSidecarUnavailable(t)) return;
      const response = await fetch(`http://127.0.0.1:${sidecarPort}/agent/start`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-rudi-token': sidecarToken,
        },
        body: JSON.stringify({
          prompt: 'Test ASK mode',
          cwd: testProjectDir,
          permissionMode: 'bypassPermissions',
        }),
      });

      assert.strictEqual(response.ok, true);
      const data = await response.json();
      assert.ok(data.sessionId);

      const sessionId = data.sessionId;

      // Simulate a permission request
      const permResponse = await fetch(`http://127.0.0.1:${sidecarPort}/agent/permission-request`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-rudi-token': sidecarToken,
        },
        body: JSON.stringify({
          rudiSessionId: sessionId,
          claudeSessionId: 'test-claude-session',
          requestId: 'test-request-2',
          toolName: 'Write',
          toolInput: { file_path: '/test/file.txt' },
        }),
      });

      assert.strictEqual(permResponse.ok, true);

      // Check pending permissions — should have 1 pending (waiting for user)
      const pendingResponse = await fetch(
        `http://127.0.0.1:${sidecarPort}/agent/permissions?sessionId=${sessionId}`,
        {
          headers: { 'x-rudi-token': sidecarToken },
        }
      );

      assert.strictEqual(pendingResponse.ok, true);
      const pendingData = await pendingResponse.json();
      assert.strictEqual(pendingData.pending.length, 1);
      assert.strictEqual(pendingData.pending[0].toolName, 'Write');
      assert.strictEqual(pendingData.pending[0].requestId, 'test-request-2');

      // Approve the permission
      await fetch(`http://127.0.0.1:${sidecarPort}/agent/permission-response`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-rudi-token': sidecarToken,
        },
        body: JSON.stringify({
          sessionId,
          requestId: 'test-request-2',
          response: 'y',
        }),
      });

      // Cleanup session
      await fetch(`http://127.0.0.1:${sidecarPort}/agent/stop`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-rudi-token': sidecarToken,
        },
        body: JSON.stringify({ sessionId }),
      });
    }, 10000);
  });

  describe('Project settings', () => {
    it('auto-allows tools in project allowlist', async (t) => {
      if (skipIfSidecarUnavailable(t)) return;
      // Create project settings file
      const settingsPath = path.join(testProjectDir, '.claude', 'settings.local.json');
      fs.mkdirSync(path.dirname(settingsPath), { recursive: true });
      fs.writeFileSync(
        settingsPath,
        JSON.stringify({
          permissions: {
            allow: ['Read', 'Bash(git:*)'],
          },
        })
      );

      const response = await fetch(`http://127.0.0.1:${sidecarPort}/agent/start`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-rudi-token': sidecarToken,
        },
        body: JSON.stringify({
          prompt: 'Test project settings',
          cwd: testProjectDir,
          permissionMode: 'bypassPermissions', // ASK mode
        }),
      });

      assert.strictEqual(response.ok, true);
      const data = await response.json();
      const sessionId = data.sessionId;

      // Request Read permission (should auto-allow via project settings)
      const permResponse = await fetch(`http://127.0.0.1:${sidecarPort}/agent/permission-request`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-rudi-token': sidecarToken,
        },
        body: JSON.stringify({
          rudiSessionId: sessionId,
          claudeSessionId: 'test-claude-session',
          requestId: 'test-request-3',
          toolName: 'Read',
          toolInput: { file_path: '/test/file.txt' },
        }),
      });

      assert.strictEqual(permResponse.ok, true);

      // Check pending permissions — should be auto-approved
      const pendingResponse = await fetch(
        `http://127.0.0.1:${sidecarPort}/agent/permissions?sessionId=${sessionId}`,
        {
          headers: { 'x-rudi-token': sidecarToken },
        }
      );

      const pendingData = await pendingResponse.json();
      assert.strictEqual(pendingData.pending.length, 0);

      // Cleanup
      await fetch(`http://127.0.0.1:${sidecarPort}/agent/stop`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-rudi-token': sidecarToken,
        },
        body: JSON.stringify({ sessionId }),
      });

      fs.unlinkSync(settingsPath);
    }, 10000);
  });

  describe('Session always-allowed', () => {
    it('remembers "Always" approval for subsequent requests', async (t) => {
      if (skipIfSidecarUnavailable(t)) return;
      const response = await fetch(`http://127.0.0.1:${sidecarPort}/agent/start`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-rudi-token': sidecarToken,
        },
        body: JSON.stringify({
          prompt: 'Test session always-allowed',
          cwd: testProjectDir,
          permissionMode: 'bypassPermissions',
        }),
      });

      const data = await response.json();
      const sessionId = data.sessionId;

      // First request
      await fetch(`http://127.0.0.1:${sidecarPort}/agent/permission-request`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-rudi-token': sidecarToken,
        },
        body: JSON.stringify({
          rudiSessionId: sessionId,
          claudeSessionId: 'test-claude-session',
          requestId: 'test-request-4',
          toolName: 'Edit',
          toolInput: { file_path: '/test/file.txt' },
        }),
      });

      // Approve with "Always"
      await fetch(`http://127.0.0.1:${sidecarPort}/agent/permission-response`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-rudi-token': sidecarToken,
        },
        body: JSON.stringify({
          sessionId,
          requestId: 'test-request-4',
          response: 'a', // Always
        }),
      });

      // Second request for same tool — should auto-allow
      await fetch(`http://127.0.0.1:${sidecarPort}/agent/permission-request`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-rudi-token': sidecarToken,
        },
        body: JSON.stringify({
          rudiSessionId: sessionId,
          claudeSessionId: 'test-claude-session',
          requestId: 'test-request-5',
          toolName: 'Edit',
          toolInput: { file_path: '/test/other.txt' },
        }),
      });

      // Check pending — should be zero (auto-approved)
      const pendingResponse = await fetch(
        `http://127.0.0.1:${sidecarPort}/agent/permissions?sessionId=${sessionId}`,
        {
          headers: { 'x-rudi-token': sidecarToken },
        }
      );

      const pendingData = await pendingResponse.json();
      assert.strictEqual(pendingData.pending.length, 0);

      // Cleanup
      await fetch(`http://127.0.0.1:${sidecarPort}/agent/stop`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-rudi-token': sidecarToken,
        },
        body: JSON.stringify({ sessionId }),
      });
    }, 15000);
  });

  describe('Run-group with explicit mode', () => {
    it('auto-allows tools when run-group has dangerouslySkipPermissions', async (t) => {
      if (skipIfSidecarUnavailable(t)) return;
      // Create a run-group
      const groupResponse = await fetch(`http://127.0.0.1:${sidecarPort}/agent/run-group`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-rudi-token': sidecarToken,
        },
        body: JSON.stringify({
          name: 'test-group',
          cwd: testProjectDir,
          permissionMode: 'dangerouslySkipPermissions',
          executionMode: 'shared_cwd',
          useWorktree: false,
          tasks: [
            {
              label: 'task-1',
              prompt: 'Test task one',
            },
            {
              label: 'task-2',
              prompt: 'Test task two',
            },
          ],
        }),
      });

      assert.strictEqual(groupResponse.ok, true);
      const groupData = await groupResponse.json();
      const groupId = groupData.groupId;
      const sessionId = Array.isArray(groupData.sessionIds) ? groupData.sessionIds[0] : null;

      assert.ok(sessionId);

      // Wait for task to start
      await new Promise((resolve) => setTimeout(resolve, 2000));

      // Simulate permission request for the run-group session
      await fetch(`http://127.0.0.1:${sidecarPort}/agent/permission-request`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-rudi-token': sidecarToken,
        },
        body: JSON.stringify({
          rudiSessionId: sessionId,
          claudeSessionId: 'test-claude-session',
          requestId: 'test-request-6',
          toolName: 'Bash',
          toolInput: { command: 'echo test' },
        }),
      });

      // Check pending — should be auto-approved
      const pendingResponse = await fetch(
        `http://127.0.0.1:${sidecarPort}/agent/permissions?sessionId=${sessionId}`,
        {
          headers: { 'x-rudi-token': sidecarToken },
        }
      );

      const pendingData = await pendingResponse.json();
      assert.strictEqual(pendingData.pending.length, 0);

      // Cleanup run-group
      await fetch(`http://127.0.0.1:${sidecarPort}/agent/run-group/${groupId}/stop`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-rudi-token': sidecarToken,
        },
      });
    }, 20000);
  });
});
