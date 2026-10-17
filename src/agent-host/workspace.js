import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

import { assertLaunchId, createLaunchOwnershipMarker } from './artifacts.js';
import { assertTaskProfile, TASK_MODE } from './task-profile.js';
import { writeWorkspaceBaseline } from './workspace-manifest.js';

export const WORKSPACE_MODES = Object.freeze({
  AUTO: 'auto',
  ISOLATED_COPY: 'isolated-copy',
  READ_ONLY: 'read-only',
  WORKTREE: 'worktree',
  REGISTERED_SHARED: TASK_MODE,
});

const VALID_MODES = new Set(Object.values(WORKSPACE_MODES));

function existingDirectory(candidate, label) {
  const resolved = path.resolve(candidate);
  let stat;
  try {
    stat = fs.statSync(resolved);
  } catch {
    throw new Error(`${label} does not exist: ${resolved}`);
  }
  if (!stat.isDirectory()) {
    throw new Error(`${label} is not a directory: ${resolved}`);
  }
  return fs.realpathSync(resolved);
}

function isInside(candidate, parent) {
  const relative = path.relative(parent, candidate);
  return relative === '' || (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative));
}

function findGitProjectRoot(workspace, execFileSyncImpl) {
  try {
    const output = execFileSyncImpl('git', ['rev-parse', '--show-toplevel'], {
      cwd: workspace,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    return existingDirectory(String(output).trim(), 'Git project root');
  } catch {
    return null;
  }
}

function gitOutput(execFileSyncImpl, cwd, args) {
  return String(execFileSyncImpl('git', args, {
    cwd,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  })).trim();
}

function assertOutputOutsideProject(outputDestination, projectRoot) {
  if (isInside(outputDestination, projectRoot)) {
    throw new Error(`Output destination must be outside the project: ${outputDestination}`);
  }
}

function createGitWorktree({
  destination,
  execFileSyncImpl,
  launchId,
  projectRoot,
}) {
  const branch = `rudi/agent/${launchId}`;
  const baseRef = gitOutput(execFileSyncImpl, projectRoot, ['rev-parse', '--verify', 'HEAD']);

  try {
    execFileSyncImpl('git', ['show-ref', '--verify', '--quiet', `refs/heads/${branch}`], {
      cwd: projectRoot,
      stdio: 'ignore',
    });
    throw new Error(`Worktree branch already exists: ${branch}`);
  } catch (error) {
    if (error?.message?.startsWith('Worktree branch already exists:')) throw error;
  }

  fs.mkdirSync(path.dirname(destination), { recursive: true, mode: 0o700 });
  try {
    execFileSyncImpl('git', ['worktree', 'add', '-b', branch, destination, baseRef], {
      cwd: projectRoot,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
  } catch (error) {
    try {
      execFileSyncImpl('git', ['worktree', 'remove', '--force', destination], {
        cwd: projectRoot,
        stdio: 'ignore',
      });
    } catch {}
    fs.rmSync(destination, { recursive: true, force: true });
    try {
      execFileSyncImpl('git', ['branch', '-D', '--', branch], {
        cwd: projectRoot,
        stdio: 'ignore',
      });
    } catch {}
    throw new Error(`Unable to create isolated Git worktree: ${error.message}`);
  }

  return { baseRef, branch };
}

function copyIsolatedWorkspace({ destination, projectRoot }) {
  if (isInside(destination, projectRoot)) {
    throw new Error('Isolated workspace destination cannot be inside the source project');
  }

  try {
    fs.cpSync(projectRoot, destination, {
      errorOnExist: true,
      filter(candidate) {
        const relative = path.relative(projectRoot, candidate);
        const firstPart = relative.split(path.sep)[0];
        if (firstPart === '.git' || firstPart === '.rudi') return false;

        const stat = fs.lstatSync(candidate);
        if (stat.isSymbolicLink()) {
          const target = fs.realpathSync(candidate);
          if (!isInside(target, projectRoot)) {
            throw new Error(`Workspace contains a symlink outside the project: ${candidate}`);
          }
        }
        return true;
      },
      force: false,
      recursive: true,
    });
  } catch (error) {
    fs.rmSync(destination, { recursive: true, force: true });
    throw new Error(`Unable to create isolated workspace copy: ${error.message}`);
  }
}

export function resolveAgentWorkspace(options, dependencies = {}) {
  const {
    artifactsRoot,
    launchId,
    mode = WORKSPACE_MODES.AUTO,
    originDirectory = process.cwd(),
    outputDirectory = null,
    privateAutomation = false,
    taskProfile = null,
    workspace = null,
  } = options || {};
  const { execFileSyncImpl = execFileSync } = dependencies;

  assertLaunchId(launchId);
  if (mode === TASK_MODE) assertTaskProfile(taskProfile);
  if (!VALID_MODES.has(mode)) {
    throw new Error(`Unknown workspace mode: ${mode}. Available: ${[...VALID_MODES].join(', ')}`);
  }
  if (privateAutomation === true && mode !== WORKSPACE_MODES.READ_ONLY) {
    throw new Error('private automation requires read-only workspace mode');
  }
  if (typeof artifactsRoot !== 'string' || artifactsRoot.trim() === '') {
    throw new Error('artifactsRoot is required');
  }

  const resolvedOrigin = existingDirectory(originDirectory, 'Origin directory');
  const requestedWorkspace = workspace == null
    ? resolvedOrigin
    : path.resolve(resolvedOrigin, workspace);
  const validWorkspace = existingDirectory(requestedWorkspace, 'Workspace');
  const gitProjectRoot = findGitProjectRoot(validWorkspace, execFileSyncImpl);
  const projectRoot = gitProjectRoot || validWorkspace;
  if (mode === TASK_MODE && validWorkspace !== taskProfile.working_directory) {
    throw new Error("registered shared workspace differs from profile");
  }
  const isGitRepository = Boolean(gitProjectRoot);
  const launchDirectory = outputDirectory == null
    ? path.resolve(artifactsRoot, launchId)
    : path.resolve(resolvedOrigin, outputDirectory);

  let resolvedMode = mode;
  if (resolvedMode === WORKSPACE_MODES.AUTO) {
    resolvedMode = isGitRepository
      ? WORKSPACE_MODES.WORKTREE
      : WORKSPACE_MODES.ISOLATED_COPY;
  }

  if (resolvedMode === WORKSPACE_MODES.WORKTREE && !isGitRepository) {
    throw new Error('Workspace mode worktree requires a Git repository');
  }

  assertOutputOutsideProject(launchDirectory, projectRoot);
  if (fs.existsSync(launchDirectory)) {
    throw new Error(`Output destination already exists: ${launchDirectory}`);
  }
  fs.mkdirSync(launchDirectory, { recursive: true, mode: 0o700 });
  createLaunchOwnershipMarker({ launchDirectory, launchId });

  let executionWorkspace = mode === TASK_MODE ? validWorkspace : projectRoot;
  let worktreeBranch = null;
  let baseRef = null;

  try {
    if (privateAutomation === true) {
      executionWorkspace = path.join(launchDirectory, 'private-workspace');
      fs.mkdirSync(executionWorkspace, { mode: 0o500 });
      fs.chmodSync(executionWorkspace, 0o500);
    } else if (resolvedMode === WORKSPACE_MODES.WORKTREE) {
      executionWorkspace = path.join(launchDirectory, 'workspace');
      const created = createGitWorktree({
        destination: executionWorkspace,
        execFileSyncImpl,
        launchId,
        projectRoot,
      });
      worktreeBranch = created.branch;
      baseRef = created.baseRef;
    } else if (resolvedMode === WORKSPACE_MODES.ISOLATED_COPY) {
      executionWorkspace = path.join(launchDirectory, 'workspace');
      copyIsolatedWorkspace({ destination: executionWorkspace, projectRoot });
      writeWorkspaceBaseline({ launchDirectory, workspace: executionWorkspace });
    }
  } catch (error) {
    fs.rmSync(launchDirectory, { recursive: true, force: true });
    throw error;
  }

  return Object.freeze({
    baseRef,
    executionWorkspace: existingDirectory(executionWorkspace, 'Execution workspace'),
    isGitRepository,
    mode: resolvedMode,
    originDirectory: resolvedOrigin,
    outputDestination: launchDirectory,
    projectRoot,
    privateAutomation: privateAutomation === true,
    worktreeBranch,
  });
}

export function cleanupUnstartedWorkspace(workspace, dependencies = {}) {
  if (!workspace || typeof workspace !== 'object') return;
  const { execFileSyncImpl = execFileSync } = dependencies;
  const outputDestination = path.resolve(workspace.outputDestination);
  const executionWorkspace = path.resolve(workspace.executionWorkspace);
  if (!isInside(executionWorkspace, outputDestination) && ! [WORKSPACE_MODES.READ_ONLY, TASK_MODE].includes(workspace.mode)) {
    throw new Error('Refusing to clean an execution workspace outside its launch output destination');
  }

  if (workspace.mode === WORKSPACE_MODES.WORKTREE) {
    if (!/^rudi\/agent\/launch_[A-Za-z0-9_-]+$/.test(workspace.worktreeBranch || '')) {
      throw new Error('Refusing to clean an unexpected worktree branch');
    }
    try {
      execFileSyncImpl('git', ['worktree', 'remove', '--force', executionWorkspace], {
        cwd: workspace.projectRoot,
        stdio: 'ignore',
      });
    } catch {}
    try {
      execFileSyncImpl('git', ['branch', '-D', '--', workspace.worktreeBranch], {
        cwd: workspace.projectRoot,
        stdio: 'ignore',
      });
    } catch {}
  }

  fs.rmSync(outputDestination, { recursive: true, force: true });
}
