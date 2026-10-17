import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

// Promotion and discard are workspace ownership operations. Provider process
// supervision lives separately in process-lifecycle.js.

import {
  assertLaunchId,
  assertOwnedLaunchDirectory,
} from './artifacts.js';
import { createLaunchStore } from './launch-store.js';
import {
  compareWorkspaceManifests,
  createWorkspaceManifest,
  readWorkspaceBaseline,
  workspaceManifestsEqual,
} from './workspace-manifest.js';

const TERMINAL_STATUSES = new Set(['completed', 'failed', 'stopped']);
const MAX_DIFF_BYTES = 20 * 1024 * 1024;

function git(execFileSyncImpl, cwd, args) {
  return String(execFileSyncImpl('git', args, {
    cwd,
    encoding: 'utf8',
    maxBuffer: MAX_DIFF_BYTES,
    stdio: ['ignore', 'pipe', 'pipe'],
  }));
}

function noIndexDiff(execFileSyncImpl, left, right) {
  try {
    return git(execFileSyncImpl, path.dirname(left), [
      'diff', '--no-index', '--binary', '--full-index', '--', left, right,
    ]);
  } catch (error) {
    if (error?.status === 1) return String(error.stdout || '').trimEnd();
    throw error;
  }
}

function isInside(candidate, parent) {
  const relative = path.relative(parent, candidate);
  return relative === '' || (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative));
}

function safeRelative(root, relativePath) {
  if (typeof relativePath !== 'string' || relativePath === '' || relativePath.includes('\0')) {
    throw new Error('Launch change contains an invalid path');
  }
  const platformPath = relativePath.split('/').join(path.sep);
  const destination = path.resolve(root, platformPath);
  if (!isInside(destination, path.resolve(root)) || destination === path.resolve(root)) {
    throw new Error(`Launch change escapes the workspace: ${relativePath}`);
  }
  return destination;
}

function requireManagedLaunch(store, launchId, { terminal = false } = {}) {
  assertLaunchId(launchId);
  const launch = store.get(launchId);
  if (!launch) throw new Error(`Launch not found: ${launchId}`);
  if (launch.workspaceMode === 'registered-shared') throw new Error('shared task workspaces are externally owned; lifecycle mutation is forbidden');
  if (terminal && !TERMINAL_STATUSES.has(launch.status)) {
    throw new Error(`Launch must be terminal before this operation: ${launchId} (${launch.status})`);
  }
  if (launch.disposition !== 'retained') {
    throw new Error(`Launch is already ${launch.disposition}: ${launchId}`);
  }
  assertOwnedLaunchDirectory({
    launchDirectory: launch.outputDestination,
    launchId,
  });
  return launch;
}

function parseNullSeparated(value) {
  return String(value || '').split('\0').filter(Boolean).sort();
}

function getGitChangeSet(launch, execFileSyncImpl) {
  if (!fs.existsSync(launch.executionWorkspace)) {
    throw new Error(`Execution workspace no longer exists: ${launch.executionWorkspace}`);
  }
  const trackedPatch = git(execFileSyncImpl, launch.executionWorkspace, [
    'diff', '--binary', '--full-index', launch.baseRef, '--',
  ]);
  const untracked = parseNullSeparated(git(execFileSyncImpl, launch.executionWorkspace, [
    'ls-files', '--others', '--exclude-standard', '-z',
  ]));
  const status = parseNullSeparated(git(execFileSyncImpl, launch.executionWorkspace, [
    'status', '--porcelain=v1', '-z', '--untracked-files=all',
  ]));
  const untrackedPatch = untracked
    .map(relativePath => noIndexDiff(
      execFileSyncImpl,
      '/dev/null',
      safeRelative(launch.executionWorkspace, relativePath),
    ))
    .filter(Boolean)
    .join('\n');
  return {
    patch: [trackedPatch, untrackedPatch].filter(Boolean).join('\n'),
    status,
    trackedPatch,
    untracked,
    untrackedPatch,
  };
}

function assertSafeSymlinks(workspace, relativePaths) {
  const root = fs.realpathSync(workspace);
  for (const relativePath of relativePaths) {
    const candidate = safeRelative(root, relativePath);
    let stat;
    try { stat = fs.lstatSync(candidate); } catch { continue; }
    if (!stat.isSymbolicLink()) continue;
    let target;
    try { target = fs.realpathSync(candidate); } catch {
      throw new Error(`Launch change contains a broken symlink: ${relativePath}`);
    }
    if (!isInside(target, root)) {
      throw new Error(`Launch change contains a symlink outside the workspace: ${relativePath}`);
    }
  }
}

function cleanupGitWorktree(launch, execFileSyncImpl) {
  const expectedBranch = `rudi/agent/${launch.launchId}`;
  if (launch.worktreeBranch !== expectedBranch) {
    throw new Error(`Refusing to clean unexpected worktree branch: ${launch.worktreeBranch || 'none'}`);
  }
  if (fs.existsSync(launch.executionWorkspace)) {
    git(execFileSyncImpl, launch.projectRoot, [
      'worktree', 'remove', '--force', launch.executionWorkspace,
    ]);
  } else {
    try { git(execFileSyncImpl, launch.projectRoot, ['worktree', 'prune']); } catch {}
  }
  const branch = git(execFileSyncImpl, launch.projectRoot, ['branch', '--list', launch.worktreeBranch]);
  if (branch.trim()) git(execFileSyncImpl, launch.projectRoot, ['branch', '-D', '--', launch.worktreeBranch]);
}

function copyWorkspaceEntry(sourceRoot, destinationRoot, relativePath, entry) {
  const source = safeRelative(sourceRoot, relativePath);
  const destination = safeRelative(destinationRoot, relativePath);
  if (entry.type === 'directory') {
    fs.mkdirSync(destination, { recursive: true, mode: entry.mode });
    fs.chmodSync(destination, entry.mode);
    return;
  }

  fs.mkdirSync(path.dirname(destination), { recursive: true });
  const temporary = path.join(
    path.dirname(destination),
    `.${path.basename(destination)}.rudi-promote-${process.pid}`,
  );
  fs.rmSync(temporary, { recursive: true, force: true });
  if (entry.type === 'file') {
    fs.copyFileSync(source, temporary, fs.constants.COPYFILE_EXCL);
    fs.chmodSync(temporary, entry.mode);
  } else if (entry.type === 'symlink') {
    fs.symlinkSync(entry.target, temporary);
  } else {
    throw new Error(`Unsupported promoted entry type: ${entry.type}`);
  }
  fs.rmSync(destination, { recursive: true, force: true });
  fs.renameSync(temporary, destination);
}

function restoreDirectoryFromBackup(projectRoot, backup) {
  for (const entry of fs.readdirSync(projectRoot)) {
    fs.rmSync(path.join(projectRoot, entry), { recursive: true, force: true });
  }
  for (const entry of fs.readdirSync(backup)) {
    fs.cpSync(path.join(backup, entry), path.join(projectRoot, entry), {
      errorOnExist: true,
      force: false,
      recursive: true,
    });
  }
}

function applyIsolatedChanges(launch, baseline, current) {
  const projectCurrent = createWorkspaceManifest(launch.projectRoot);
  if (!workspaceManifestsEqual(baseline, projectCurrent)) {
    throw new Error('Cannot promote because the destination project changed after launch');
  }
  assertSafeSymlinks(launch.executionWorkspace, Object.keys(current.entries));

  const changes = compareWorkspaceManifests(baseline, current);
  const backup = path.join(launch.outputDestination, 'promotion-backup');
  if (fs.existsSync(backup)) throw new Error(`Promotion backup already exists: ${backup}`);
  fs.cpSync(launch.projectRoot, backup, { errorOnExist: true, force: false, recursive: true });

  try {
    const removals = changes
      .filter(change => change.after == null)
      .sort((left, right) => right.path.split('/').length - left.path.split('/').length);
    for (const change of removals) {
      fs.rmSync(safeRelative(launch.projectRoot, change.path), { recursive: true, force: true });
    }

    const directories = changes.filter(change => change.after?.type === 'directory');
    const otherEntries = changes.filter(change => change.after && change.after.type !== 'directory');
    for (const change of directories) {
      copyWorkspaceEntry(
        launch.executionWorkspace,
        launch.projectRoot,
        change.path,
        change.after,
      );
    }
    for (const change of otherEntries) {
      copyWorkspaceEntry(
        launch.executionWorkspace,
        launch.projectRoot,
        change.path,
        change.after,
      );
    }

    if (!workspaceManifestsEqual(current, createWorkspaceManifest(launch.projectRoot))) {
      throw new Error('Promoted project does not match the isolated workspace');
    }
  } catch (error) {
    try {
      restoreDirectoryFromBackup(launch.projectRoot, backup);
    } catch (restoreError) {
      throw new Error(`Promotion failed (${error.message}) and rollback failed (${restoreError.message})`);
    }
    throw error;
  } finally {
    fs.rmSync(backup, { recursive: true, force: true });
  }
  return changes;
}

function withLaunchStore(dependencies, operation) {
  const ownsStore = !dependencies.store;
  const store = dependencies.store || createLaunchStore();
  try {
    return operation(store);
  } finally {
    if (ownsStore) store.close();
  }
}

export function diffAgentLaunch(launchId, dependencies = {}) {
  return withLaunchStore(dependencies, (store) => {
    const launch = requireManagedLaunch(store, launchId);
    const execFileSyncImpl = dependencies.execFileSyncImpl || execFileSync;
    if (launch.workspaceMode === 'worktree') {
      return {
        ...getGitChangeSet(launch, execFileSyncImpl),
        launchId,
        workspaceMode: launch.workspaceMode,
      };
    }
    if (launch.workspaceMode === 'isolated-copy') {
      const baseline = readWorkspaceBaseline(launch.outputDestination);
      const current = createWorkspaceManifest(launch.executionWorkspace);
      return {
        changes: compareWorkspaceManifests(baseline, current),
        launchId,
        patch: noIndexDiff(execFileSyncImpl, launch.projectRoot, launch.executionWorkspace),
        workspaceMode: launch.workspaceMode,
      };
    }
    return { changes: [], launchId, patch: '', workspaceMode: launch.workspaceMode };
  });
}

export function promoteAgentLaunch(launchId, dependencies = {}) {
  return withLaunchStore(dependencies, (store) => {
    const existing = store.get(assertLaunchId(launchId));
    if (existing?.disposition === 'promoted') {
      return { alreadyPromoted: true, changes: null, launch: existing };
    }
    const launch = requireManagedLaunch(store, launchId, { terminal: true });
    const execFileSyncImpl = dependencies.execFileSyncImpl || execFileSync;
    let changes;

    if (launch.workspaceMode === 'worktree') {
      const targetStatus = git(execFileSyncImpl, launch.projectRoot, [
        'status', '--porcelain=v1', '--untracked-files=all',
      ]);
      if (targetStatus.trim()) {
        throw new Error('Cannot promote because the destination project has uncommitted changes');
      }
      const targetHead = git(execFileSyncImpl, launch.projectRoot, ['rev-parse', '--verify', 'HEAD']).trim();
      if (targetHead !== launch.baseRef) {
        throw new Error('Cannot promote because the destination project HEAD changed after launch');
      }

      changes = getGitChangeSet(launch, execFileSyncImpl);
      const changedTracked = parseNullSeparated(git(execFileSyncImpl, launch.executionWorkspace, [
        'diff', '--name-only', '-z', launch.baseRef, '--',
      ]));
      assertSafeSymlinks(launch.executionWorkspace, [...changedTracked, ...changes.untracked]);
      for (const relativePath of changes.untracked) {
        const destination = safeRelative(launch.projectRoot, relativePath);
        if (fs.existsSync(destination)) {
          throw new Error(`Cannot promote untracked file because the destination exists: ${relativePath}`);
        }
      }
      if (changes.trackedPatch) {
        execFileSyncImpl('git', ['apply', '--check', '--binary', '-'], {
          cwd: launch.projectRoot,
          encoding: 'utf8',
          input: changes.trackedPatch,
          maxBuffer: MAX_DIFF_BYTES,
          stdio: ['pipe', 'pipe', 'pipe'],
        });
        execFileSyncImpl('git', ['apply', '--binary', '-'], {
          cwd: launch.projectRoot,
          encoding: 'utf8',
          input: changes.trackedPatch,
          maxBuffer: MAX_DIFF_BYTES,
          stdio: ['pipe', 'pipe', 'pipe'],
        });
      }
      for (const relativePath of changes.untracked) {
        const source = safeRelative(launch.executionWorkspace, relativePath);
        const destination = safeRelative(launch.projectRoot, relativePath);
        fs.mkdirSync(path.dirname(destination), { recursive: true });
        fs.cpSync(source, destination, { errorOnExist: true, force: false, recursive: true });
      }
      const updated = store.setDisposition(launchId, 'promoted');
      cleanupGitWorktree(updated, execFileSyncImpl);
      return { changes, launch: store.get(launchId) };
    }

    if (launch.workspaceMode === 'isolated-copy') {
      const baseline = readWorkspaceBaseline(launch.outputDestination);
      const current = createWorkspaceManifest(launch.executionWorkspace);
      changes = applyIsolatedChanges(launch, baseline, current);
      const updated = store.setDisposition(launchId, 'promoted');
      fs.rmSync(updated.executionWorkspace, { recursive: true, force: true });
      return { changes, launch: store.get(launchId) };
    }

    throw new Error('Read-only launches have no isolated changes to promote');
  });
}

export function discardAgentLaunch(launchId, dependencies = {}) {
  return withLaunchStore(dependencies, (store) => {
    const existing = store.get(assertLaunchId(launchId));
    if (existing?.disposition === 'discarded') {
      return { alreadyDiscarded: true, launch: existing };
    }
    const launch = requireManagedLaunch(store, launchId, { terminal: true });
    const execFileSyncImpl = dependencies.execFileSyncImpl || execFileSync;
    if (launch.workspaceMode === 'worktree') cleanupGitWorktree(launch, execFileSyncImpl);
    fs.rmSync(launch.outputDestination, { recursive: true, force: true });
    const updated = store.setDisposition(launchId, 'discarded');
    return { launch: updated };
  });
}
