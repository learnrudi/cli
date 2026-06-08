import fs from 'fs';
import os from 'os';
import path from 'path';
import { execFileSync } from 'child_process';
import { PATHS } from '@learnrudi/env';

export const LAUNCH_AGENT_LABEL = 'com.learnrudi.daemon';
export const LEGACY_LAUNCH_AGENT_LABELS = ['com.rudi.sidecar'];

function getUid() {
  return typeof process.getuid === 'function' ? process.getuid() : null;
}

function escapeXml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&apos;');
}

function renderStringArray(values) {
  const lines = ['  <array>'];
  for (const value of values) {
    lines.push(`    <string>${escapeXml(value)}</string>`);
  }
  lines.push('  </array>');
  return lines.join('\n');
}

function renderStringDict(values) {
  const lines = ['  <dict>'];
  for (const [key, value] of Object.entries(values).sort(([a], [b]) => a.localeCompare(b))) {
    lines.push(`    <key>${escapeXml(key)}</key>`);
    lines.push(`    <string>${escapeXml(value)}</string>`);
  }
  lines.push('  </dict>');
  return lines.join('\n');
}

function launchctlError(error) {
  const stderr = error?.stderr ? String(error.stderr).trim() : '';
  const stdout = error?.stdout ? String(error.stdout).trim() : '';
  return stderr || stdout || error?.message || 'launchctl failed';
}

function isLaunchctlMissingService(errorMessage) {
  return /could not find service/i.test(errorMessage) || /service .*not found/i.test(errorMessage);
}

export function getLaunchAgentPaths({
  homeDir = os.homedir(),
  label = LAUNCH_AGENT_LABEL,
  logsDir = PATHS.logs,
} = {}) {
  const agentsDir = path.join(homeDir, 'Library', 'LaunchAgents');
  return {
    agentsDir,
    plistPath: path.join(agentsDir, `${label}.plist`),
    stderrPath: path.join(logsDir, 'daemon.err.log'),
    stdoutPath: path.join(logsDir, 'daemon.out.log'),
  };
}

export function getLaunchAgentDomain({ uid = getUid() } = {}) {
  if (!Number.isInteger(uid) || uid < 0) {
    throw new Error('Cannot resolve current user id for LaunchAgent management');
  }
  return `gui/${uid}`;
}

export function getLaunchAgentServiceTarget({
  label = LAUNCH_AGENT_LABEL,
  uid = getUid(),
} = {}) {
  return `${getLaunchAgentDomain({ uid })}/${label}`;
}

export function resolveLaunchAgentProgramArguments({
  entrypoint = process.argv[1],
  nodePath = process.execPath,
  rudiBin = null,
  serveArgs = ['serve'],
} = {}) {
  if (rudiBin) {
    return [path.resolve(rudiBin), ...serveArgs];
  }
  if (!entrypoint) {
    throw new Error('Cannot resolve current rudi entrypoint for LaunchAgent install');
  }

  const resolvedEntrypoint = path.isAbsolute(entrypoint)
    ? entrypoint
    : path.resolve(entrypoint);
  return [nodePath, resolvedEntrypoint, ...serveArgs];
}

export function buildLaunchAgentConfig(options = {}) {
  const label = options.label || LAUNCH_AGENT_LABEL;
  const paths = getLaunchAgentPaths({
    homeDir: options.homeDir,
    label,
    logsDir: options.logsDir,
  });

  return {
    environmentVariables: {
      RUDI_DAEMON_SUPERVISOR: 'launchd',
      RUDI_HOME: options.rudiHome || PATHS.home,
      ...(options.environmentVariables || {}),
    },
    keepAlive: true,
    label,
    plistPath: paths.plistPath,
    programArguments: resolveLaunchAgentProgramArguments(options),
    runAtLoad: true,
    stderrPath: paths.stderrPath,
    stdoutPath: paths.stdoutPath,
  };
}

export function renderLaunchAgentPlist(config) {
  const lines = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">',
    '<plist version="1.0">',
    '<dict>',
    '  <key>Label</key>',
    `  <string>${escapeXml(config.label)}</string>`,
    '  <key>ProgramArguments</key>',
    renderStringArray(config.programArguments),
    '  <key>RunAtLoad</key>',
    config.runAtLoad ? '  <true/>' : '  <false/>',
    '  <key>KeepAlive</key>',
    config.keepAlive ? '  <true/>' : '  <false/>',
    '  <key>StandardOutPath</key>',
    `  <string>${escapeXml(config.stdoutPath)}</string>`,
    '  <key>StandardErrorPath</key>',
    `  <string>${escapeXml(config.stderrPath)}</string>`,
  ];

  if (config.environmentVariables && Object.keys(config.environmentVariables).length > 0) {
    lines.push('  <key>EnvironmentVariables</key>');
    lines.push(renderStringDict(config.environmentVariables));
  }

  lines.push('</dict>');
  lines.push('</plist>');
  lines.push('');
  return lines.join('\n');
}

export function getLaunchctlCommands({
  label = LAUNCH_AGENT_LABEL,
  plistPath,
  uid = getUid(),
} = {}) {
  const domain = getLaunchAgentDomain({ uid });
  const serviceTarget = `${domain}/${label}`;
  return {
    bootout: ['bootout', domain, plistPath],
    bootstrap: ['bootstrap', domain, plistPath],
    disable: ['disable', serviceTarget],
    enable: ['enable', serviceTarget],
    kickstart: ['kickstart', '-k', serviceTarget],
    print: ['print', serviceTarget],
    serviceTarget,
  };
}

export function runLaunchctl(args, {
  allowFailure = false,
  execFileImpl = execFileSync,
} = {}) {
  try {
    const output = execFileImpl('launchctl', args, {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    return {
      args,
      ok: true,
      output: output || '',
    };
  } catch (error) {
    if (allowFailure) {
      return {
        args,
        error: launchctlError(error),
        ok: false,
        status: error?.status ?? null,
      };
    }
    throw new Error(`launchctl ${args.join(' ')} failed: ${launchctlError(error)}`);
  }
}

export function parseLaunchctlPrint(output = '') {
  const pidMatch = output.match(/\bpid\s*=\s*(\d+)/);
  const stateMatch = output.match(/\bstate\s*=\s*([^\n]+)/);
  const lastExitMatch = output.match(/\blast exit (?:code|status)\s*=\s*(-?\d+)/);
  return {
    lastExitStatus: lastExitMatch ? Number.parseInt(lastExitMatch[1], 10) : null,
    pid: pidMatch ? Number.parseInt(pidMatch[1], 10) : null,
    state: stateMatch ? stateMatch[1].trim() : null,
  };
}

export function getLaunchAgentStatus(options = {}) {
  const platform = options.platform || process.platform;
  const label = options.label || LAUNCH_AGENT_LABEL;
  const paths = getLaunchAgentPaths({
    homeDir: options.homeDir,
    label,
    logsDir: options.logsDir,
  });
  const fsImpl = options.fsImpl || fs;

  if (platform !== 'darwin') {
    return {
      domain: null,
      error: null,
      installed: false,
      label,
      loaded: false,
      pid: null,
      plistPath: paths.plistPath,
      serviceTarget: null,
      state: 'unsupported',
      supported: false,
    };
  }

  const uid = options.uid ?? getUid();
  const commands = getLaunchctlCommands({ label, plistPath: paths.plistPath, uid });
  const installed = fsImpl.existsSync(paths.plistPath);

  try {
    const output = (options.execFileImpl || execFileSync)('launchctl', commands.print, {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    const parsed = parseLaunchctlPrint(output);
    return {
      domain: getLaunchAgentDomain({ uid }),
      error: null,
      installed,
      label,
      lastExitStatus: parsed.lastExitStatus,
      loaded: true,
      pid: parsed.pid,
      plistPath: paths.plistPath,
      serviceTarget: commands.serviceTarget,
      state: parsed.state || 'loaded',
      supported: true,
    };
  } catch (error) {
    const errorMessage = launchctlError(error);
    const expectedUnloadedService = installed && isLaunchctlMissingService(errorMessage);
    return {
      domain: getLaunchAgentDomain({ uid }),
      error: installed && !expectedUnloadedService ? errorMessage : null,
      installed,
      label,
      lastExitStatus: null,
      loaded: false,
      pid: null,
      plistPath: paths.plistPath,
      serviceTarget: commands.serviceTarget,
      state: installed ? 'installed' : 'not_installed',
      supported: true,
    };
  }
}

export function assertCanManageLaunchAgent({
  platform = process.platform,
  uid = getUid(),
} = {}) {
  if (platform !== 'darwin') {
    throw new Error('LaunchAgent management is only supported on macOS');
  }
  if (uid === 0) {
    throw new Error('Refusing to install RUDI as root; use a per-user LaunchAgent');
  }
  if (!Number.isInteger(uid) || uid < 0) {
    throw new Error('Cannot resolve current user id for LaunchAgent management');
  }
}

export function buildLaunchAgentPlan(options = {}) {
  const config = buildLaunchAgentConfig(options);
  const commands = getLaunchctlCommands({
    label: config.label,
    plistPath: config.plistPath,
    uid: options.uid ?? getUid(),
  });
  return {
    commands,
    config,
    plist: renderLaunchAgentPlist(config),
  };
}

export function stopLegacyLaunchAgents(options = {}) {
  const platform = options.platform || process.platform;
  const uid = options.uid ?? getUid();
  assertCanManageLaunchAgent({ platform, uid });

  const labels = options.legacyLabels || LEGACY_LAUNCH_AGENT_LABELS;
  const stopped = [];

  for (const label of labels) {
    const paths = getLaunchAgentPaths({
      homeDir: options.homeDir,
      label,
      logsDir: options.logsDir,
    });
    const commands = getLaunchctlCommands({ label, plistPath: paths.plistPath, uid });
    const disable = runLaunchctl(commands.disable, {
      allowFailure: true,
      execFileImpl: options.execFileImpl,
    });
    const bootout = runLaunchctl(commands.bootout, {
      allowFailure: true,
      execFileImpl: options.execFileImpl,
    });
    stopped.push({
      bootout,
      disable,
      label,
      plistPath: paths.plistPath,
      serviceTarget: commands.serviceTarget,
    });
  }

  return stopped;
}

export function installLaunchAgent(options = {}) {
  const platform = options.platform || process.platform;
  const uid = options.uid ?? getUid();
  assertCanManageLaunchAgent({ platform, uid });

  const fsImpl = options.fsImpl || fs;
  const plan = buildLaunchAgentPlan(options);
  const paths = getLaunchAgentPaths({
    homeDir: options.homeDir,
    label: plan.config.label,
    logsDir: options.logsDir,
  });

  if (options.dryRun) {
    return {
      action: 'dry_run',
      plan,
    };
  }

  const legacyLaunchAgents = stopLegacyLaunchAgents(options);

  fsImpl.mkdirSync(paths.agentsDir, { recursive: true });
  fsImpl.mkdirSync(path.dirname(plan.config.stdoutPath), { recursive: true });

  const bootout = runLaunchctl(plan.commands.bootout, {
    allowFailure: true,
    execFileImpl: options.execFileImpl,
  });
  const tmpPath = `${plan.config.plistPath}.tmp-${process.pid}`;
  fsImpl.writeFileSync(tmpPath, plan.plist, { mode: 0o644 });
  fsImpl.renameSync(tmpPath, plan.config.plistPath);

  const enable = runLaunchctl(plan.commands.enable, {
    execFileImpl: options.execFileImpl,
  });
  const bootstrap = runLaunchctl(plan.commands.bootstrap, {
    execFileImpl: options.execFileImpl,
  });

  return {
    action: 'installed',
    bootout,
    bootstrap,
    enable,
    legacyLaunchAgents,
    plistPath: plan.config.plistPath,
    serviceTarget: plan.commands.serviceTarget,
  };
}

export function stopLaunchAgent(options = {}) {
  const platform = options.platform || process.platform;
  const uid = options.uid ?? getUid();
  assertCanManageLaunchAgent({ platform, uid });

  const label = options.label || LAUNCH_AGENT_LABEL;
  const paths = getLaunchAgentPaths({
    homeDir: options.homeDir,
    label,
    logsDir: options.logsDir,
  });
  const commands = getLaunchctlCommands({ label, plistPath: paths.plistPath, uid });

  const disable = runLaunchctl(commands.disable, {
    allowFailure: true,
    execFileImpl: options.execFileImpl,
  });
  const bootout = runLaunchctl(commands.bootout, {
    allowFailure: true,
    execFileImpl: options.execFileImpl,
  });

  return {
    action: 'launch_agent_stopped',
    bootout,
    disable,
    plistPath: paths.plistPath,
    serviceTarget: commands.serviceTarget,
  };
}

export function startLaunchAgent(options = {}) {
  const platform = options.platform || process.platform;
  const uid = options.uid ?? getUid();
  assertCanManageLaunchAgent({ platform, uid });

  const status = options.launchAgentStatus || getLaunchAgentStatus(options);
  if (!status.installed) {
    throw new Error(`LaunchAgent plist is not installed: ${status.plistPath}`);
  }

  const commands = getLaunchctlCommands({
    label: status.label,
    plistPath: status.plistPath,
    uid,
  });
  const enable = runLaunchctl(commands.enable, {
    execFileImpl: options.execFileImpl,
  });
  const bootstrap = status.loaded
    ? null
    : runLaunchctl(commands.bootstrap, {
      execFileImpl: options.execFileImpl,
    });
  const kickstart = runLaunchctl(commands.kickstart, {
    execFileImpl: options.execFileImpl,
  });

  return {
    action: status.loaded ? 'launch_agent_kickstarted' : 'launch_agent_started',
    bootstrap,
    enable,
    kickstart,
    plistPath: status.plistPath,
    serviceTarget: commands.serviceTarget,
  };
}

export function restartLaunchAgent(options = {}) {
  return startLaunchAgent(options);
}

export function uninstallLaunchAgent(options = {}) {
  const platform = options.platform || process.platform;
  const uid = options.uid ?? getUid();
  assertCanManageLaunchAgent({ platform, uid });

  const fsImpl = options.fsImpl || fs;
  const status = options.launchAgentStatus || getLaunchAgentStatus(options);
  const commands = getLaunchctlCommands({
    label: status.label,
    plistPath: status.plistPath,
    uid,
  });

  const disable = runLaunchctl(commands.disable, {
    allowFailure: true,
    execFileImpl: options.execFileImpl,
  });
  const bootout = runLaunchctl(commands.bootout, {
    allowFailure: true,
    execFileImpl: options.execFileImpl,
  });

  if (fsImpl.existsSync(status.plistPath)) {
    fsImpl.unlinkSync(status.plistPath);
  }

  return {
    action: status.installed || status.loaded ? 'uninstalled' : 'not_installed',
    bootout,
    disable,
    plistPath: status.plistPath,
    serviceTarget: commands.serviceTarget,
  };
}
