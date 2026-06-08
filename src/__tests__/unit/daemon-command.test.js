import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import os from 'os';
import path from 'path';

import {
  buildServeArgs,
  formatDaemonState,
  formatLaunchAgentState,
  installDaemon,
  removeDaemonConnectionFiles,
  restartDaemonLifecycle,
  spawnDaemonProcess,
  startDaemon,
  stopDaemon,
  stopDaemonLifecycle,
} from '../../commands/daemon.js';

describe('daemon lifecycle command helpers', () => {
  test('formatDaemonState maps probe states to CLI labels', () => {
    assert.equal(formatDaemonState({ ready: true, reachable: true }), 'ready');
    assert.equal(formatDaemonState({ ready: false, reachable: true }), 'not ready');
    assert.equal(formatDaemonState({ reason: 'not_running' }), 'not running');
    assert.equal(formatDaemonState({ reason: 'invalid_connection_files' }), 'invalid connection files');
    assert.equal(formatDaemonState({ reason: 'unreachable' }), 'unreachable');
  });

  test('formatLaunchAgentState maps launchd states to CLI labels', () => {
    assert.equal(formatLaunchAgentState({ supported: false }), 'unsupported');
    assert.equal(formatLaunchAgentState({ supported: true, installed: false }), 'not installed');
    assert.equal(formatLaunchAgentState({ supported: true, installed: true, loaded: false }), 'installed, not loaded');
    assert.equal(formatLaunchAgentState({ supported: true, loaded: true, pid: 12345 }), 'loaded (pid 12345)');
  });

  test('buildServeArgs preserves optional port flag', () => {
    assert.deepEqual(buildServeArgs({}), ['serve']);
    assert.deepEqual(buildServeArgs({ port: '8123' }), ['serve', '--port', '8123']);
  });

  test('removeDaemonConnectionFiles removes explicit port and token files', () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'rudi-daemon-command-'));
    const portFile = path.join(tmp, '.rudi-lite-port');
    const tokenFile = path.join(tmp, '.rudi-lite-token');
    fs.writeFileSync(portFile, '8123');
    fs.writeFileSync(tokenFile, 'token');

    removeDaemonConnectionFiles({ portFile, tokenFile });

    assert.equal(fs.existsSync(portFile), false);
    assert.equal(fs.existsSync(tokenFile), false);
  });

  test('spawnDaemonProcess detaches current entrypoint and writes logs under logsDir', () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'rudi-daemon-command-'));
    const calls = [];
    const result = spawnDaemonProcess({
      entrypoint: '/tmp/rudi-entry.js',
      logsDir: tmp,
      nodePath: '/tmp/node',
      serveArgs: ['serve', '--port', '8123'],
      spawnImpl: (command, args, options) => {
        calls.push({ command, args, options });
        return { pid: 12345, unref() {} };
      },
    });

    assert.equal(result.pid, 12345);
    assert.equal(result.stdoutPath, path.join(tmp, 'daemon.out.log'));
    assert.equal(result.stderrPath, path.join(tmp, 'daemon.err.log'));
    assert.equal(calls[0].command, '/tmp/node');
    assert.deepEqual(calls[0].args, ['/tmp/rudi-entry.js', 'serve', '--port', '8123']);
    assert.equal(calls[0].options.detached, true);
  });

  test('startDaemon returns already_running without spawning when reachable', async () => {
    const result = await startDaemon({
      statusProvider: async () => ({
        reachable: true,
        ready: true,
        reason: 'ok',
        port: 8123,
      }),
      spawnImpl: () => {
        throw new Error('spawn should not be called');
      },
    });

    assert.equal(result.action, 'already_running');
    assert.equal(result.status.port, 8123);
  });

  test('startDaemon spawns and waits until ready when offline', async () => {
    const statuses = [
      { reachable: false, ready: false, reason: 'not_running' },
      { reachable: false, ready: false, reason: 'not_running' },
      { reachable: true, ready: true, reason: 'ok', port: 8123 },
    ];
    const calls = [];

    const result = await startDaemon({
      entrypoint: '/tmp/rudi-entry.js',
      intervalMs: 0,
      logsDir: fs.mkdtempSync(path.join(os.tmpdir(), 'rudi-daemon-command-')),
      nodePath: '/tmp/node',
      statusProvider: async () => statuses.shift() || { reachable: true, ready: true, reason: 'ok', port: 8123 },
      spawnImpl: (command, args) => {
        calls.push({ command, args });
        return { pid: 12345, unref() {} };
      },
      timeoutMs: 1000,
    });

    assert.equal(result.action, 'started');
    assert.equal(result.spawned.pid, 12345);
    assert.equal(result.status.port, 8123);
    assert.equal(calls.length, 1);
  });

  test('stopDaemon kills reachable daemon and waits until stopped', async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'rudi-daemon-command-'));
    const portFile = path.join(tmp, '.rudi-lite-port');
    const tokenFile = path.join(tmp, '.rudi-lite-token');
    fs.writeFileSync(portFile, '8123');
    fs.writeFileSync(tokenFile, 'token');
    const statuses = [
      { reachable: true, ready: true, reason: 'ok', status: { pid: 23456 } },
      { reachable: true, ready: true, reason: 'ok', status: { pid: 23456 } },
      { reachable: false, ready: false, reason: 'not_running' },
    ];
    const kills = [];

    const result = await stopDaemon({
      intervalMs: 0,
      killImpl: (pid, signal) => kills.push({ pid, signal }),
      portFile,
      statusProvider: async () => statuses.shift() || { reachable: false, ready: false, reason: 'not_running' },
      timeoutMs: 1000,
      tokenFile,
    });

    assert.equal(result.action, 'stopped');
    assert.equal(result.pid, 23456);
    assert.deepEqual(kills, [{ pid: 23456, signal: 'SIGTERM' }]);
    assert.equal(fs.existsSync(portFile), false);
    assert.equal(fs.existsSync(tokenFile), false);
  });

  test('stopDaemon cleans stale files without killing when daemon is unreachable', async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'rudi-daemon-command-'));
    const portFile = path.join(tmp, '.rudi-lite-port');
    const tokenFile = path.join(tmp, '.rudi-lite-token');
    fs.writeFileSync(portFile, '8123');
    fs.writeFileSync(tokenFile, 'token');

    const result = await stopDaemon({
      portFile,
      tokenFile,
      statusProvider: async () => ({ reachable: false, ready: false, reason: 'unreachable' }),
      killImpl: () => {
        throw new Error('kill should not be called');
      },
    });

    assert.equal(result.action, 'cleaned_stale_files');
    assert.equal(fs.existsSync(portFile), false);
    assert.equal(fs.existsSync(tokenFile), false);
  });

  test('stopDaemonLifecycle stops managed LaunchAgent instead of sending SIGTERM', async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'rudi-daemon-command-'));
    const portFile = path.join(tmp, '.rudi-lite-port');
    const tokenFile = path.join(tmp, '.rudi-lite-token');
    fs.writeFileSync(portFile, '8123');
    fs.writeFileSync(tokenFile, 'token');
    const statuses = [
      { reachable: true, ready: true, reason: 'ok' },
      { reachable: false, ready: false, reason: 'not_running' },
    ];
    const calls = [];

    const result = await stopDaemonLifecycle({
      execFileImpl: (command, args) => {
        calls.push({ args, command });
        return '';
      },
      intervalMs: 0,
      launchAgentStatus: {
        installed: true,
        label: 'com.learnrudi.daemon',
        loaded: true,
        supported: true,
      },
      platform: 'darwin',
      portFile,
      statusProvider: async () => statuses.shift() || { reachable: false, ready: false, reason: 'not_running' },
      timeoutMs: 1000,
      tokenFile,
      uid: 501,
    });

    assert.equal(result.action, 'launch_agent_stopped');
    assert.deepEqual(calls.map((call) => call.args[0]), ['disable', 'bootout']);
    assert.equal(fs.existsSync(portFile), false);
    assert.equal(fs.existsSync(tokenFile), false);
  });

  test('restartDaemonLifecycle uses LaunchAgent when installed', async () => {
    const statuses = [
      { reachable: false, ready: false, reason: 'not_running' },
      { reachable: true, ready: true, reason: 'ok', port: 8123 },
    ];
    const calls = [];

    const result = await restartDaemonLifecycle({
      execFileImpl: (command, args) => {
        calls.push({ args, command });
        return '';
      },
      intervalMs: 0,
      launchAgentStatus: {
        installed: true,
        label: 'com.learnrudi.daemon',
        loaded: true,
        plistPath: '/tmp/com.learnrudi.daemon.plist',
        supported: true,
      },
      platform: 'darwin',
      statusProvider: async () => statuses.shift() || { reachable: true, ready: true, reason: 'ok', port: 8123 },
      timeoutMs: 1000,
      uid: 501,
    });

    assert.equal(result.action, 'launch_agent_restarted');
    assert.equal(result.status.port, 8123);
    assert.deepEqual(calls.map((call) => call.args[0]), ['enable', 'kickstart']);
  });

  test('installDaemon dry-run returns LaunchAgent plan without status probing', async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'rudi-daemon-command-'));

    const result = await installDaemon({
      dryRun: true,
      entrypoint: '/tmp/rudi/dist/index.cjs',
      homeDir: tmp,
      launchAgentStatus: { installed: false, loaded: false, supported: true },
      logsDir: path.join(tmp, '.rudi', 'logs'),
      nodePath: '/usr/local/bin/node',
      platform: 'darwin',
      rudiHome: path.join(tmp, '.rudi'),
      statusProvider: async () => {
        throw new Error('status should not be probed for dry run');
      },
      uid: 501,
    });

    assert.equal(result.action, 'dry_run');
    assert.match(result.plan.plist, /com.learnrudi.daemon/);
    assert.equal(fs.existsSync(result.plan.config.plistPath), false);
  });
});
