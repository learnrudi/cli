import fs from 'fs';
import path from 'path';
import { execFileSync } from 'child_process';

import { getRepoRoot } from './agent/worktree.js';
import { parseWorktreeList } from './serve/git.js';

function printLanesHelp() {
  console.log(`
rudi lanes - Manage the local main/dev lane layout for solo-dev parallel work

USAGE
  rudi lanes <command> [options]

COMMANDS
  init                          Create or discover the dev lane worktree
  sync                          Fast-forward main and dev from upstreams

OPTIONS
  --cwd <path>                  Repository path (default: current directory)
  --main <branch>               Main lane branch (default: main)
  --dev <branch>                Dev lane branch (default: dev)
  --dev-path <path>             Override sibling dev worktree path
  --json                        Print raw JSON output

EXAMPLES
  rudi lanes init
  rudi lanes init --cwd /path/to/repo --dev staging
  rudi lanes sync
`);
}

function printJson(data) {
  console.log(JSON.stringify(data, null, 2));
}

function execGit(cwd, args) {
  return execFileSync('git', args, {
    cwd,
    encoding: 'utf-8',
    stdio: ['ignore', 'pipe', 'pipe'],
  }).trim();
}

function ensureGitRepo(cwd) {
  try {
    execGit(cwd, ['rev-parse', '--is-inside-work-tree']);
  } catch {
    throw new Error(`Not a git repository: ${cwd}`);
  }
}

function resolveOptions(flags) {
  const cwd = typeof flags.cwd === 'string' && flags.cwd.trim()
    ? path.resolve(flags.cwd.trim())
    : process.cwd();
  const mainBranch = typeof flags.main === 'string' && flags.main.trim()
    ? flags.main.trim()
    : 'main';
  const devBranch = typeof flags.dev === 'string' && flags.dev.trim()
    ? flags.dev.trim()
    : 'dev';

  return {
    cwd,
    mainBranch,
    devBranch,
  };
}

function defaultDevPath(repoRoot, devBranch) {
  return path.join(path.dirname(repoRoot), `${path.basename(repoRoot)}-${devBranch}`);
}

function resolveDevPath(repoRoot, devBranch, flags) {
  if (typeof flags['dev-path'] === 'string' && flags['dev-path'].trim()) {
    return path.resolve(flags['dev-path'].trim());
  }
  return defaultDevPath(repoRoot, devBranch);
}

function getCurrentBranch(cwd) {
  return execGit(cwd, ['rev-parse', '--abbrev-ref', 'HEAD']);
}

function ensureOnBranch(cwd, expectedBranch, label) {
  const currentBranch = getCurrentBranch(cwd);
  if (currentBranch !== expectedBranch) {
    throw new Error(`${label} must be on ${expectedBranch}; current branch is ${currentBranch}`);
  }
}

function localBranchExists(repoRoot, branch) {
  try {
    execFileSync('git', ['show-ref', '--verify', '--quiet', `refs/heads/${branch}`], {
      cwd: repoRoot,
      stdio: 'pipe',
    });
    return true;
  } catch {
    return false;
  }
}

function remoteBranchExists(repoRoot, remote, branch) {
  try {
    execFileSync('git', ['show-ref', '--verify', '--quiet', `refs/remotes/${remote}/${branch}`], {
      cwd: repoRoot,
      stdio: 'pipe',
    });
    return true;
  } catch {
    return false;
  }
}

function remoteExists(repoRoot, remote = 'origin') {
  try {
    execGit(repoRoot, ['remote', 'get-url', remote]);
    return true;
  } catch {
    return false;
  }
}

function readWorktrees(repoRoot) {
  return parseWorktreeList(execGit(repoRoot, ['worktree', 'list', '--porcelain']));
}

function findWorktreeByBranch(worktrees, branch) {
  return worktrees.find((entry) => entry.branch === branch) || null;
}

function ensureCleanWorktree(cwd, label) {
  const status = execGit(cwd, ['status', '--porcelain']);
  if (status) {
    throw new Error(`${label} has uncommitted changes. Commit or stash before syncing.`);
  }
}

function getUpstreamRef(cwd) {
  try {
    return execGit(cwd, ['rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{u}']);
  } catch {
    return null;
  }
}

function getHeadSha(cwd) {
  return execGit(cwd, ['rev-parse', 'HEAD']);
}

function ensureDevBranch(repoRoot, mainBranch, devBranch) {
  if (localBranchExists(repoRoot, devBranch)) {
    return { createdBranch: false, sourceRef: devBranch };
  }

  if (remoteBranchExists(repoRoot, 'origin', devBranch)) {
    execFileSync('git', ['branch', '--track', devBranch, `origin/${devBranch}`], {
      cwd: repoRoot,
      stdio: 'pipe',
    });
    return { createdBranch: true, sourceRef: `origin/${devBranch}` };
  }

  execFileSync('git', ['branch', devBranch, mainBranch], {
    cwd: repoRoot,
    stdio: 'pipe',
  });
  return { createdBranch: true, sourceRef: mainBranch };
}

function ensureDevWorktree(repoRoot, devBranch, requestedDevPath) {
  const worktrees = readWorktrees(repoRoot);
  const existing = findWorktreeByBranch(worktrees, devBranch);
  if (existing) {
    return {
      createdWorktree: false,
      devPath: existing.path,
    };
  }

  if (fs.existsSync(requestedDevPath)) {
    throw new Error(`Dev worktree path already exists but is not registered: ${requestedDevPath}`);
  }

  execFileSync('git', ['worktree', 'add', requestedDevPath, devBranch], {
    cwd: repoRoot,
    stdio: 'pipe',
  });

  return {
    createdWorktree: true,
    devPath: requestedDevPath,
  };
}

async function lanesInit(flags) {
  const { cwd, mainBranch, devBranch } = resolveOptions(flags);
  ensureGitRepo(cwd);

  const repoRoot = getRepoRoot(cwd);
  ensureOnBranch(repoRoot, mainBranch, 'Repo worktree');
  if (remoteExists(repoRoot, 'origin')) {
    execFileSync('git', ['fetch', 'origin'], {
      cwd: repoRoot,
      stdio: 'pipe',
    });
  }

  const branchResult = ensureDevBranch(repoRoot, mainBranch, devBranch);
  const requestedDevPath = resolveDevPath(repoRoot, devBranch, flags);
  const worktreeResult = ensureDevWorktree(repoRoot, devBranch, requestedDevPath);

  const result = {
    ok: true,
    repoRoot,
    mainBranch,
    devBranch,
    devPath: worktreeResult.devPath,
    createdBranch: branchResult.createdBranch,
    createdWorktree: worktreeResult.createdWorktree,
    branchSource: branchResult.sourceRef,
  };

  if (flags.json) {
    printJson(result);
    return;
  }

  console.log(`Lanes ready for ${path.basename(repoRoot)}:`);
  console.log(`  Main branch: ${mainBranch}`);
  console.log(`  Dev branch: ${devBranch} ${branchResult.createdBranch ? `(created from ${branchResult.sourceRef})` : '(existing)'}`);
  console.log(`  Dev worktree: ${worktreeResult.devPath} ${worktreeResult.createdWorktree ? '(created)' : '(existing)'}`);
  console.log('');
  console.log(`Run your integrated local app from ${worktreeResult.devPath}`);
  console.log(`Run parallel agents with: rudi parallel --cwd ${worktreeResult.devPath} --base-branch ${devBranch} "task 1" "task 2"`);
}

function fastForwardLane(cwd, upstreamRef) {
  const before = getHeadSha(cwd);
  execFileSync('git', ['merge', '--ff-only', upstreamRef], {
    cwd,
    stdio: 'pipe',
  });
  const after = getHeadSha(cwd);
  return {
    before,
    after,
    changed: before !== after,
  };
}

async function lanesSync(flags) {
  const { cwd, mainBranch, devBranch } = resolveOptions(flags);
  ensureGitRepo(cwd);

  const repoRoot = getRepoRoot(cwd);
  ensureOnBranch(repoRoot, mainBranch, 'Repo worktree');

  if (!localBranchExists(repoRoot, devBranch)) {
    throw new Error(`Missing ${devBranch} branch. Run: rudi lanes init`);
  }

  const requestedDevPath = resolveDevPath(repoRoot, devBranch, flags);
  const { devPath } = ensureDevWorktree(repoRoot, devBranch, requestedDevPath);
  ensureOnBranch(devPath, devBranch, 'Dev worktree');
  ensureCleanWorktree(repoRoot, 'Main worktree');
  ensureCleanWorktree(devPath, 'Dev worktree');

  const notices = [];
  if (remoteExists(repoRoot, 'origin')) {
    execFileSync('git', ['fetch', 'origin'], {
      cwd: repoRoot,
      stdio: 'pipe',
    });
  } else {
    notices.push('No origin remote configured; skipped fetch.');
  }

  const mainUpstream = getUpstreamRef(repoRoot);
  const devUpstream = getUpstreamRef(devPath);

  const mainResult = mainUpstream
    ? fastForwardLane(repoRoot, mainUpstream)
    : { before: getHeadSha(repoRoot), after: getHeadSha(repoRoot), changed: false };
  if (!mainUpstream) {
    notices.push(`${mainBranch} has no upstream; skipped fast-forward.`);
  }

  const devResult = devUpstream
    ? fastForwardLane(devPath, devUpstream)
    : { before: getHeadSha(devPath), after: getHeadSha(devPath), changed: false };
  if (!devUpstream) {
    notices.push(`${devBranch} has no upstream; skipped fast-forward.`);
  }

  const result = {
    ok: true,
    repoRoot,
    mainBranch,
    devBranch,
    devPath,
    mainUpstream,
    devUpstream,
    main: mainResult,
    dev: devResult,
    notices,
  };

  if (flags.json) {
    printJson(result);
    return;
  }

  console.log(`Lanes synced for ${path.basename(repoRoot)}:`);
  console.log(`  Main: ${mainResult.changed ? 'updated' : 'already current'}${mainUpstream ? ` (${mainUpstream})` : ''}`);
  console.log(`  Dev: ${devResult.changed ? 'updated' : 'already current'}${devUpstream ? ` (${devUpstream})` : ''}`);
  console.log(`  Dev worktree: ${devPath}`);
  for (const notice of notices) {
    console.log(`  Note: ${notice}`);
  }
}

export async function cmdLanes(args, flags) {
  const subcommand = args[0];

  switch (subcommand) {
    case 'init':
      await lanesInit(flags);
      break;

    case 'sync':
      await lanesSync(flags);
      break;

    default:
      printLanesHelp();
  }
}
