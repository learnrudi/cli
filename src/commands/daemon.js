/**
 * Daemon lifecycle command.
 *
 * This is a local wrapper around `rudi serve`, with optional macOS LaunchAgent
 * management for always-on lifecycle.
 */

import fs from 'fs';
import path from 'path';
import { spawn } from 'child_process';
import { PATHS } from '@learnrudi/env';

import {
  SIDECAR_PORT_FILE,
  SIDECAR_TOKEN_FILE,
  getSidecarDaemonStatus,
} from './sidecar-client.js';
import {
  assertCanManageLaunchAgent,
  buildLaunchAgentPlan,
  getLaunchAgentStatus,
  installLaunchAgent,
  restartLaunchAgent,
  startLaunchAgent,
  stopLaunchAgent,
  uninstallLaunchAgent,
} from '../daemon/runtime/launch-agent.js';

const DEFAULT_START_TIMEOUT_MS = 45_000;
const DEFAULT_STOP_TIMEOUT_MS = 10_000;
const DEFAULT_POLL_INTERVAL_MS = 250;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isOfflineStatus(status) {
  return status?.reason === 'not_running'
    || status?.reason === 'unreachable'
    || status?.reason === 'invalid_connection_files';
}

function isReachableStatus(status) {
  return status?.reachable === true;
}

function isManagedByLaunchAgent(status) {
  return status?.supported === true && status?.loaded === true;
}

function hasLaunchAgentInstall(status) {
  return status?.supported === true && status?.installed === true;
}

function shouldDryRun(flags = {}) {
  return flags['dry-run'] === true || flags.dryRun === true;
}

export function formatDaemonState(status) {
  if (status?.ready) return 'ready';
  if (status?.reachable) return 'not ready';
  if (status?.reason === 'not_running') return 'not running';
  if (status?.reason === 'invalid_connection_files') return 'invalid connection files';
  if (status?.reason === 'unreachable') return 'unreachable';
  return 'unknown';
}

export function formatLaunchAgentState(status) {
  if (status?.supported === false) return 'unsupported';
  if (status?.loaded && status?.pid) return `loaded (pid ${status.pid})`;
  if (status?.loaded) return 'loaded';
  if (status?.installed) return 'installed, not loaded';
  return 'not installed';
}

export function removeDaemonConnectionFiles({
  portFile = SIDECAR_PORT_FILE,
  tokenFile = SIDECAR_TOKEN_FILE,
} = {}) {
  try { fs.unlinkSync(portFile); } catch {}
  try { fs.unlinkSync(tokenFile); } catch {}
}

export function getDaemonEntrypoint() {
  const entrypoint = process.argv[1];
  if (!entrypoint) {
    throw new Error('Cannot resolve current rudi entrypoint for daemon start');
  }
  return entrypoint;
}

export function buildServeArgs(flags = {}) {
  const args = ['serve'];
  if (flags.port) {
    args.push('--port', String(flags.port));
  }
  return args;
}

export function spawnDaemonProcess({
  entrypoint = getDaemonEntrypoint(),
  env = process.env,
  logsDir = PATHS.logs,
  nodePath = process.execPath,
  serveArgs = ['serve'],
  spawnImpl = spawn,
} = {}) {
  fs.mkdirSync(logsDir, { recursive: true });
  const stdoutPath = path.join(logsDir, 'daemon.out.log');
  const stderrPath = path.join(logsDir, 'daemon.err.log');
  const stdoutFd = fs.openSync(stdoutPath, 'a');
  const stderrFd = fs.openSync(stderrPath, 'a');

  try {
    const child = spawnImpl(nodePath, [entrypoint, ...serveArgs], {
      detached: true,
      env,
      stdio: ['ignore', stdoutFd, stderrFd],
    });
    child.unref?.();
    return {
      pid: child.pid,
      stderrPath,
      stdoutPath,
    };
  } finally {
    try { fs.closeSync(stdoutFd); } catch {}
    try { fs.closeSync(stderrFd); } catch {}
  }
}

export async function waitForDaemonReady({
  intervalMs = DEFAULT_POLL_INTERVAL_MS,
  statusProvider = getSidecarDaemonStatus,
  timeoutMs = DEFAULT_START_TIMEOUT_MS,
} = {}) {
  const started = Date.now();
  let lastStatus = null;

  while (Date.now() - started <= timeoutMs) {
    lastStatus = await statusProvider();
    if (lastStatus.ready === true) {
      return lastStatus;
    }
    await sleep(intervalMs);
  }

  const error = new Error(`Daemon did not become ready within ${timeoutMs}ms`);
  error.status = lastStatus;
  throw error;
}

export async function waitForDaemonStopped({
  intervalMs = DEFAULT_POLL_INTERVAL_MS,
  statusProvider = getSidecarDaemonStatus,
  timeoutMs = DEFAULT_STOP_TIMEOUT_MS,
} = {}) {
  const started = Date.now();
  let lastStatus = null;

  while (Date.now() - started <= timeoutMs) {
    lastStatus = await statusProvider();
    if (isOfflineStatus(lastStatus)) {
      return lastStatus;
    }
    await sleep(intervalMs);
  }

  const error = new Error(`Daemon did not stop within ${timeoutMs}ms`);
  error.status = lastStatus;
  throw error;
}

export async function startDaemon(options = {}) {
  const statusProvider = options.statusProvider || getSidecarDaemonStatus;
  const current = await statusProvider();

  if (isReachableStatus(current)) {
    return {
      action: 'already_running',
      status: current,
    };
  }

  if (current.reason === 'unreachable' || current.reason === 'invalid_connection_files') {
    removeDaemonConnectionFiles(options);
  }

  const spawned = spawnDaemonProcess({
    entrypoint: options.entrypoint,
    env: options.env,
    logsDir: options.logsDir,
    nodePath: options.nodePath,
    serveArgs: buildServeArgs(options.flags || {}),
    spawnImpl: options.spawnImpl,
  });

  const status = await waitForDaemonReady({
    intervalMs: options.intervalMs,
    statusProvider,
    timeoutMs: options.timeoutMs,
  });

  return {
    action: 'started',
    spawned,
    status,
  };
}

export async function startDaemonLifecycle(options = {}) {
  const launchAgent = options.launchAgentStatus || getLaunchAgentStatus(options);
  if (hasLaunchAgentInstall(launchAgent)) {
    const launched = startLaunchAgent(options);
    const status = await waitForDaemonReady({
      intervalMs: options.intervalMs,
      statusProvider: options.statusProvider || getSidecarDaemonStatus,
      timeoutMs: options.timeoutMs,
    });
    return {
      action: launched.action,
      launchAgent: launched,
      status,
    };
  }

  return startDaemon(options);
}

export async function stopDaemon(options = {}) {
  const statusProvider = options.statusProvider || getSidecarDaemonStatus;
  const current = await statusProvider();

  if (current.reason === 'not_running') {
    return {
      action: 'not_running',
      status: current,
    };
  }

  if (!isReachableStatus(current)) {
    removeDaemonConnectionFiles(options);
    return {
      action: 'cleaned_stale_files',
      status: current,
    };
  }

  const pid = current.status?.pid;
  if (!Number.isInteger(pid) || pid <= 0) {
    throw new Error('Daemon status did not include a valid pid');
  }
  if (pid === process.pid) {
    throw new Error('Refusing to stop the current CLI process');
  }

  const killImpl = options.killImpl || process.kill.bind(process);
  killImpl(pid, 'SIGTERM');

  const status = await waitForDaemonStopped({
    intervalMs: options.intervalMs,
    statusProvider,
    timeoutMs: options.timeoutMs,
  });
  removeDaemonConnectionFiles(options);

  return {
    action: 'stopped',
    pid,
    status,
  };
}

export async function stopDaemonLifecycle(options = {}) {
  const launchAgent = options.launchAgentStatus || getLaunchAgentStatus(options);
  if (isManagedByLaunchAgent(launchAgent)) {
    const stopped = stopLaunchAgent(options);
    const status = await waitForDaemonStopped({
      intervalMs: options.intervalMs,
      statusProvider: options.statusProvider || getSidecarDaemonStatus,
      timeoutMs: options.timeoutMs,
    });
    removeDaemonConnectionFiles(options);
    return {
      action: 'launch_agent_stopped',
      launchAgent: stopped,
      status,
    };
  }

  return stopDaemon(options);
}

export async function restartDaemonLifecycle(options = {}) {
  const launchAgent = options.launchAgentStatus || getLaunchAgentStatus(options);
  if (hasLaunchAgentInstall(launchAgent)) {
    const restarted = restartLaunchAgent(options);
    const status = await waitForDaemonReady({
      intervalMs: options.intervalMs,
      statusProvider: options.statusProvider || getSidecarDaemonStatus,
      timeoutMs: options.timeoutMs,
    });
    return {
      action: 'launch_agent_restarted',
      launchAgent: restarted,
      status,
    };
  }

  const stopResult = await stopDaemon(options);
  const startResult = await startDaemon(options);
  return {
    action: 'restarted',
    start: startResult,
    stop: stopResult,
  };
}

export async function installDaemon(options = {}) {
  const launchAgent = options.launchAgentStatus || getLaunchAgentStatus(options);
  if (launchAgent.supported === false) {
    throw new Error('LaunchAgent management is only supported on macOS');
  }
  assertCanManageLaunchAgent(options);

  if (options.dryRun || shouldDryRun(options.flags)) {
    return {
      action: 'dry_run',
      plan: buildLaunchAgentPlan(options),
    };
  }

  const statusProvider = options.statusProvider || getSidecarDaemonStatus;
  let stopped = null;

  if (isManagedByLaunchAgent(launchAgent)) {
    stopped = stopLaunchAgent(options);
    await waitForDaemonStopped({
      intervalMs: options.intervalMs,
      statusProvider,
      timeoutMs: options.timeoutMs,
    });
    removeDaemonConnectionFiles(options);
  } else {
    const current = await statusProvider();
    if (isReachableStatus(current) || current.reason === 'unreachable' || current.reason === 'invalid_connection_files') {
      stopped = await stopDaemon(options);
    }
  }

  const launchAgentInstall = installLaunchAgent(options);
  const status = await waitForDaemonReady({
    intervalMs: options.intervalMs,
    statusProvider,
    timeoutMs: options.timeoutMs,
  });

  return {
    action: 'installed',
    launchAgent: launchAgentInstall,
    status,
    stopped,
  };
}

export async function uninstallDaemon(options = {}) {
  const launchAgent = options.launchAgentStatus || getLaunchAgentStatus(options);
  if (launchAgent.supported === false) {
    throw new Error('LaunchAgent management is only supported on macOS');
  }
  assertCanManageLaunchAgent(options);

  if (options.dryRun || shouldDryRun(options.flags)) {
    return {
      action: 'dry_run',
      launchAgent,
      plan: buildLaunchAgentPlan(options),
    };
  }

  const removed = uninstallLaunchAgent(options);
  let status = await (options.statusProvider || getSidecarDaemonStatus)();

  if (launchAgent.loaded) {
    status = await waitForDaemonStopped({
      intervalMs: options.intervalMs,
      statusProvider: options.statusProvider || getSidecarDaemonStatus,
      timeoutMs: options.timeoutMs,
    });
    removeDaemonConnectionFiles(options);
  } else if (!isReachableStatus(status)) {
    removeDaemonConnectionFiles(options);
  }

  return {
    action: removed.action,
    launchAgent: removed,
    status,
  };
}

function buildStatusJson(status, launchAgent) {
  return {
    launchAgent,
    state: formatDaemonState(status),
    ...status,
  };
}

function printStatus(status, launchAgent) {
  console.log('RUDI Daemon');
  console.log('═'.repeat(50));
  if (launchAgent) {
    console.log(`  LaunchAgent: ${formatLaunchAgentState(launchAgent)}`);
    if (launchAgent.plistPath) console.log(`  Plist: ${launchAgent.plistPath}`);
  }
  console.log(`  State: ${formatDaemonState(status)}`);
  if (status.port) console.log(`  Port: ${status.port}`);
  if (status.version) console.log(`  Version: ${status.version}`);
  if (status.status?.pid) console.log(`  PID: ${status.status.pid}`);
  if (status.status?.uptimeMs !== undefined) {
    console.log(`  Uptime: ${Math.round(status.status.uptimeMs / 1000)}s`);
  }
  if (status.toolIndexStatus) {
    const toolCount = Number.isInteger(status.toolIndexStatus.toolCount)
      ? ` (${status.toolIndexStatus.toolCount} tools)`
      : '';
    console.log(`  Tool index: ${status.toolIndexStatus.status || 'unknown'}${toolCount}`);
  }
  if (status.dbStatus) {
    console.log(`  Database: ${status.dbStatus.status || 'unknown'}`);
  }
  if (status.error) console.log(`  Detail: ${status.error}`);
}

function printLifecycleResult(result) {
  if (result.action === 'started') {
    console.log(`Daemon started on port ${result.status.port}`);
  } else if (result.action === 'launch_agent_started') {
    console.log(`LaunchAgent started daemon on port ${result.status.port}`);
  } else if (result.action === 'launch_agent_kickstarted') {
    console.log(`LaunchAgent daemon is running on port ${result.status.port}`);
  } else if (result.action === 'launch_agent_restarted') {
    console.log(`LaunchAgent restarted daemon on port ${result.status.port}`);
  } else if (result.action === 'installed') {
    console.log(`LaunchAgent installed and daemon ready on port ${result.status.port}`);
  } else if (result.action === 'uninstalled') {
    console.log('LaunchAgent uninstalled');
  } else if (result.action === 'dry_run') {
    console.log('LaunchAgent dry run');
    if (result.plan?.config?.plistPath) console.log(`  Plist: ${result.plan.config.plistPath}`);
    if (result.plan?.commands?.bootstrap) {
      console.log(`  Install: launchctl ${result.plan.commands.bootstrap.join(' ')}`);
    }
    if (result.plan?.commands?.kickstart) {
      console.log(`  Restart: launchctl ${result.plan.commands.kickstart.join(' ')}`);
    }
  } else if (result.action === 'already_running') {
    console.log(`Daemon already running (${formatDaemonState(result.status)}${result.status.port ? `, port ${result.status.port}` : ''})`);
  } else if (result.action === 'stopped') {
    console.log(`Daemon stopped (pid ${result.pid})`);
  } else if (result.action === 'launch_agent_stopped') {
    console.log('LaunchAgent stopped');
  } else if (result.action === 'not_running') {
    console.log('Daemon is not running');
  } else if (result.action === 'cleaned_stale_files') {
    console.log('Removed stale daemon connection files');
  }
}

export async function cmdDaemon(args, flags) {
  const subcommand = args[0] || 'status';
  const launchAgentOptions = {
    flags,
    serveArgs: buildServeArgs(flags),
  };

  if (subcommand === 'status') {
    const status = await getSidecarDaemonStatus();
    const launchAgent = getLaunchAgentStatus();
    if (flags.json) {
      console.log(JSON.stringify(buildStatusJson(status, launchAgent), null, 2));
    } else {
      printStatus(status, launchAgent);
    }
    return;
  }

  if (subcommand === 'start') {
    const result = await startDaemonLifecycle(launchAgentOptions);
    if (flags.json) {
      console.log(JSON.stringify(result, null, 2));
    } else {
      printLifecycleResult(result);
    }
    return;
  }

  if (subcommand === 'stop') {
    const result = await stopDaemonLifecycle(launchAgentOptions);
    if (flags.json) {
      console.log(JSON.stringify(result, null, 2));
    } else {
      printLifecycleResult(result);
    }
    return;
  }

  if (subcommand === 'restart') {
    const result = await restartDaemonLifecycle(launchAgentOptions);
    if (flags.json) {
      console.log(JSON.stringify(result, null, 2));
    } else {
      if (result.action === 'restarted') {
        printLifecycleResult(result.stop);
        printLifecycleResult(result.start);
      } else {
        printLifecycleResult(result);
      }
    }
    return;
  }

  if (subcommand === 'install') {
    const result = await installDaemon(launchAgentOptions);
    if (flags.json) {
      console.log(JSON.stringify(result, null, 2));
    } else {
      printLifecycleResult(result);
    }
    return;
  }

  if (subcommand === 'uninstall' || subcommand === 'remove') {
    const result = await uninstallDaemon(launchAgentOptions);
    if (flags.json) {
      console.log(JSON.stringify(result, null, 2));
    } else {
      printLifecycleResult(result);
    }
    return;
  }

  throw new Error(`Unknown daemon command: ${subcommand}`);
}
