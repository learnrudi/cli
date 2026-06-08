import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import os from 'os';
import path from 'path';

import {
  LAUNCH_AGENT_LABEL,
  buildLaunchAgentConfig,
  buildLaunchAgentPlan,
  getLaunchAgentPaths,
  getLaunchAgentStatus,
  getLaunchctlCommands,
  installLaunchAgent,
  parseLaunchctlPrint,
  renderLaunchAgentPlist,
  startLaunchAgent,
  stopLegacyLaunchAgents,
  uninstallLaunchAgent,
} from '../../daemon/runtime/launch-agent.js';

describe('launch-agent runtime helpers', () => {
  test('getLaunchAgentPaths resolves per-user plist and RUDI log paths', () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'rudi-launch-agent-'));
    const logsDir = path.join(tmp, '.rudi', 'logs');

    const paths = getLaunchAgentPaths({ homeDir: tmp, logsDir });

    assert.equal(paths.agentsDir, path.join(tmp, 'Library', 'LaunchAgents'));
    assert.equal(paths.plistPath, path.join(tmp, 'Library', 'LaunchAgents', `${LAUNCH_AGENT_LABEL}.plist`));
    assert.equal(paths.stdoutPath, path.join(logsDir, 'daemon.out.log'));
    assert.equal(paths.stderrPath, path.join(logsDir, 'daemon.err.log'));
  });

  test('renderLaunchAgentPlist writes launchd-safe config without secrets', () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'rudi-launch-agent-'));
    const config = buildLaunchAgentConfig({
      entrypoint: '/tmp/RUDI & CLI/dist/index.cjs',
      environmentVariables: { SAFE_VALUE: '<ready>' },
      homeDir: tmp,
      logsDir: path.join(tmp, '.rudi', 'logs'),
      nodePath: '/usr/local/bin/node',
      rudiHome: path.join(tmp, '.rudi'),
    });

    const plist = renderLaunchAgentPlist(config);

    assert.match(plist, /<key>Label<\/key>/);
    assert.match(plist, new RegExp(`<string>${LAUNCH_AGENT_LABEL}</string>`));
    assert.match(plist, /<key>RunAtLoad<\/key>\n  <true\/>/);
    assert.match(plist, /<key>KeepAlive<\/key>\n  <true\/>/);
    assert.match(plist, /\/tmp\/RUDI &amp; CLI\/dist\/index.cjs/);
    assert.match(plist, /&lt;ready&gt;/);
    assert.doesNotMatch(plist, /token/i);
    assert.doesNotMatch(plist, /secret/i);
  });

  test('getLaunchctlCommands builds modern per-user launchctl commands', () => {
    const commands = getLaunchctlCommands({
      plistPath: '/Users/test/Library/LaunchAgents/com.learnrudi.daemon.plist',
      uid: 501,
    });

    assert.deepEqual(commands.bootstrap, [
      'bootstrap',
      'gui/501',
      '/Users/test/Library/LaunchAgents/com.learnrudi.daemon.plist',
    ]);
    assert.deepEqual(commands.enable, ['enable', 'gui/501/com.learnrudi.daemon']);
    assert.deepEqual(commands.kickstart, ['kickstart', '-k', 'gui/501/com.learnrudi.daemon']);
    assert.deepEqual(commands.bootout, [
      'bootout',
      'gui/501',
      '/Users/test/Library/LaunchAgents/com.learnrudi.daemon.plist',
    ]);
  });

  test('parseLaunchctlPrint extracts pid, state, and exit status', () => {
    const parsed = parseLaunchctlPrint(`
      state = running
      pid = 12345
      last exit code = 0
    `);

    assert.deepEqual(parsed, {
      lastExitStatus: 0,
      pid: 12345,
      state: 'running',
    });
  });

  test('getLaunchAgentStatus reports unsupported platforms without shelling out', () => {
    const status = getLaunchAgentStatus({
      execFileImpl: () => {
        throw new Error('launchctl should not be called');
      },
      platform: 'linux',
      uid: 501,
    });

    assert.equal(status.supported, false);
    assert.equal(status.installed, false);
    assert.equal(status.loaded, false);
    assert.equal(status.state, 'unsupported');
  });

  test('getLaunchAgentStatus combines plist presence with launchctl print state', () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'rudi-launch-agent-'));
    const paths = getLaunchAgentPaths({ homeDir: tmp, logsDir: path.join(tmp, '.rudi', 'logs') });
    fs.mkdirSync(paths.agentsDir, { recursive: true });
    fs.writeFileSync(paths.plistPath, '<plist/>');

    const status = getLaunchAgentStatus({
      execFileImpl: () => 'state = running\npid = 24680\nlast exit code = 0\n',
      homeDir: tmp,
      logsDir: path.join(tmp, '.rudi', 'logs'),
      platform: 'darwin',
      uid: 501,
    });

    assert.equal(status.supported, true);
    assert.equal(status.installed, true);
    assert.equal(status.loaded, true);
    assert.equal(status.pid, 24680);
    assert.equal(status.state, 'running');
  });

  test('getLaunchAgentStatus treats missing plist as normal not-installed state', () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'rudi-launch-agent-'));

    const status = getLaunchAgentStatus({
      execFileImpl: () => {
        const error = new Error('service not found');
        error.stderr = 'Could not find service';
        throw error;
      },
      homeDir: tmp,
      logsDir: path.join(tmp, '.rudi', 'logs'),
      platform: 'darwin',
      uid: 501,
    });

    assert.equal(status.supported, true);
    assert.equal(status.installed, false);
    assert.equal(status.loaded, false);
    assert.equal(status.error, null);
    assert.equal(status.state, 'not_installed');
  });

  test('getLaunchAgentStatus treats installed but unloaded service as stopped state', () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'rudi-launch-agent-'));
    const paths = getLaunchAgentPaths({ homeDir: tmp, logsDir: path.join(tmp, '.rudi', 'logs') });
    fs.mkdirSync(paths.agentsDir, { recursive: true });
    fs.writeFileSync(paths.plistPath, '<plist/>');

    const status = getLaunchAgentStatus({
      execFileImpl: () => {
        const error = new Error('service not found');
        error.stderr = 'Bad request.\nCould not find service "com.learnrudi.daemon" in domain for user gui: 501';
        throw error;
      },
      homeDir: tmp,
      logsDir: path.join(tmp, '.rudi', 'logs'),
      platform: 'darwin',
      uid: 501,
    });

    assert.equal(status.supported, true);
    assert.equal(status.installed, true);
    assert.equal(status.loaded, false);
    assert.equal(status.error, null);
    assert.equal(status.state, 'installed');
  });

  test('installLaunchAgent writes plist and enables before bootstrap', () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'rudi-launch-agent-'));
    const calls = [];

    const result = installLaunchAgent({
      entrypoint: '/tmp/rudi/dist/index.cjs',
      execFileImpl: (command, args) => {
        calls.push({ args, command });
        return '';
      },
      homeDir: tmp,
      logsDir: path.join(tmp, '.rudi', 'logs'),
      legacyLabels: [],
      nodePath: '/usr/local/bin/node',
      platform: 'darwin',
      rudiHome: path.join(tmp, '.rudi'),
      uid: 501,
    });

    assert.equal(result.action, 'installed');
    assert.equal(fs.existsSync(result.plistPath), true);
    assert.deepEqual(calls.map((call) => call.args[0]), ['bootout', 'enable', 'bootstrap']);
  });

  test('stopLegacyLaunchAgents disables and boots out legacy sidecar labels', () => {
    const calls = [];

    const result = stopLegacyLaunchAgents({
      execFileImpl: (command, args) => {
        calls.push({ args, command });
        return '';
      },
      legacyLabels: ['com.rudi.sidecar'],
      platform: 'darwin',
      uid: 501,
    });

    assert.equal(result.length, 1);
    assert.equal(result[0].label, 'com.rudi.sidecar');
    assert.deepEqual(calls.map((call) => call.args[0]), ['disable', 'bootout']);
    assert.deepEqual(calls.map((call) => call.args.at(-1)), [
      'gui/501/com.rudi.sidecar',
      result[0].plistPath,
    ]);
  });

  test('startLaunchAgent enables service before bootstrapping an unloaded plist', () => {
    const calls = [];

    const result = startLaunchAgent({
      execFileImpl: (command, args) => {
        calls.push({ args, command });
        return '';
      },
      launchAgentStatus: {
        installed: true,
        label: LAUNCH_AGENT_LABEL,
        loaded: false,
        plistPath: '/Users/test/Library/LaunchAgents/com.learnrudi.daemon.plist',
        supported: true,
      },
      platform: 'darwin',
      uid: 501,
    });

    assert.equal(result.action, 'launch_agent_started');
    assert.deepEqual(calls.map((call) => call.args[0]), ['enable', 'bootstrap', 'kickstart']);
  });

  test('buildLaunchAgentPlan dry-run data is inspectable without writing files', () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'rudi-launch-agent-'));
    const plan = buildLaunchAgentPlan({
      entrypoint: '/tmp/rudi/dist/index.cjs',
      homeDir: tmp,
      logsDir: path.join(tmp, '.rudi', 'logs'),
      nodePath: '/usr/local/bin/node',
      rudiHome: path.join(tmp, '.rudi'),
      uid: 501,
    });

    assert.equal(plan.config.label, LAUNCH_AGENT_LABEL);
    assert.equal(plan.commands.serviceTarget, 'gui/501/com.learnrudi.daemon');
    assert.match(plan.plist, /ProgramArguments/);
    assert.equal(fs.existsSync(plan.config.plistPath), false);
  });

  test('uninstallLaunchAgent boots out and removes installed plist', () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'rudi-launch-agent-'));
    const paths = getLaunchAgentPaths({ homeDir: tmp, logsDir: path.join(tmp, '.rudi', 'logs') });
    fs.mkdirSync(paths.agentsDir, { recursive: true });
    fs.writeFileSync(paths.plistPath, '<plist/>');
    const calls = [];

    const result = uninstallLaunchAgent({
      execFileImpl: (command, args) => {
        calls.push({ args, command });
        return '';
      },
      homeDir: tmp,
      launchAgentStatus: {
        installed: true,
        label: LAUNCH_AGENT_LABEL,
        loaded: true,
        plistPath: paths.plistPath,
        supported: true,
      },
      logsDir: path.join(tmp, '.rudi', 'logs'),
      platform: 'darwin',
      uid: 501,
    });

    assert.equal(result.action, 'uninstalled');
    assert.equal(fs.existsSync(paths.plistPath), false);
    assert.deepEqual(calls.map((call) => call.args[0]), ['disable', 'bootout']);
  });
});
