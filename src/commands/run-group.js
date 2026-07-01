import { readSidecarInfo, sidecarRequest } from './sidecar-client.js';

function printRunGroupHelp() {
  console.log(`
rudi run-group - Inspect and manage parallel agent run groups

LEGACY COMPATIBILITY
  This command is retained for older RUDI sidecar/run-group workflows.
  Prefer native agent-host orchestration for new parallel agent work.

USAGE
  rudi run-group <command> [args] [options]

COMMANDS
  list                          List run groups
  show <group-id>               Show run-group details and sessions
  stop <group-id>               Stop all active sessions in a run group
  merge <group-id>              Merge successful session branches
  cleanup <group-id>            Remove run-group worktrees

OPTIONS
  --json                        Print raw JSON response
  --status <status>             Filter list by status
  --project-path <path>         Filter list by project path
  --limit <n>                   Limit list results
  --offset <n>                  Offset list results
  --to <branch>                 Target branch for merge
  --target-branch <branch>      Alias for --to
  --session-ids <a,b,c>         Explicit session IDs to merge
  --delete-branches             Delete worktree branches during cleanup

EXAMPLES
  rudi run-group list --status running
  rudi run-group show 3f7c...
  rudi run-group merge 3f7c... --to dev
  rudi run-group cleanup 3f7c... --delete-branches
`);
}

function printJson(data) {
  console.log(JSON.stringify(data, null, 2));
}

function formatDate(value) {
  if (!value) return '-';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return date.toISOString();
}

function boolLabel(value) {
  if (value === true) return 'pass';
  if (value === false) return 'fail';
  return 'n/a';
}

function getGroupLabel(group) {
  return group?.name || group?.id || 'unknown';
}

function normalizeCsvFlag(value) {
  if (!value || typeof value !== 'string') return [];
  return value
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean);
}

function resolveMergeTarget(flags) {
  const value = flags.to || flags['target-branch'] || flags.targetBranch;
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null;
}

export function selectDefaultMergeSessionIds(sessions) {
  return (Array.isArray(sessions) ? sessions : [])
    .filter((session) => session?.status === 'completed' && session?.validation_passed !== false)
    .map((session) => session.id)
    .filter(Boolean);
}

async function fetchRunGroupDetail(sidecar, groupId) {
  return sidecarRequest({
    ...sidecar,
    method: 'GET',
    pathname: `/agent/run-group/${encodeURIComponent(groupId)}`,
  });
}

async function runGroupList(flags) {
  const sidecar = readSidecarInfo();
  const params = new URLSearchParams();
  if (typeof flags.status === 'string' && flags.status.trim()) params.set('status', flags.status.trim());
  if (typeof flags['project-path'] === 'string' && flags['project-path'].trim()) {
    params.set('projectPath', flags['project-path'].trim());
  }
  if (typeof flags.projectPath === 'string' && flags.projectPath.trim()) {
    params.set('projectPath', flags.projectPath.trim());
  }
  if (typeof flags.limit === 'string' && flags.limit.trim()) params.set('limit', flags.limit.trim());
  if (typeof flags.offset === 'string' && flags.offset.trim()) params.set('offset', flags.offset.trim());

  const query = params.toString();
  const response = await sidecarRequest({
    ...sidecar,
    method: 'GET',
    pathname: `/agent/run-groups${query ? `?${query}` : ''}`,
  });

  if (flags.json) {
    printJson(response);
    return;
  }

  const groups = Array.isArray(response.groups) ? response.groups : [];
  if (groups.length === 0) {
    console.log('No run groups found.');
    return;
  }

  console.log(`Run groups (${groups.length}):\n`);
  for (const group of groups) {
    console.log(`${getGroupLabel(group)}`);
    console.log(`  ID: ${group.id}`);
    console.log(`  Status: ${group.status || '-'}`);
    console.log(`  Base branch: ${group.base_branch || '-'}`);
    console.log(`  Sessions: ${group.session_count ?? '-'}`);
    console.log(`  Created: ${formatDate(group.created_at)}`);
    console.log('');
  }
}

async function runGroupShow(args, flags) {
  const groupId = args[0];
  if (!groupId) {
    throw new Error('Usage: rudi run-group show <group-id>');
  }

  const sidecar = readSidecarInfo();
  const response = await fetchRunGroupDetail(sidecar, groupId);

  if (flags.json) {
    printJson(response);
    return;
  }

  const { group, sessions } = response;
  console.log(`Run group: ${getGroupLabel(group)}`);
  console.log(`  ID: ${group.id}`);
  console.log(`  Status: ${group.status}`);
  console.log(`  Base branch: ${group.base_branch || '-'}`);
  console.log(`  Sessions: ${group.session_count ?? 0}`);
  console.log(`  Completed: ${group.completed_count ?? 0}`);
  console.log(`  Failed: ${group.failed_count ?? 0}`);
  console.log(`  Validation failed: ${group.validation_failed_count ?? 0}`);
  console.log(`  Created: ${formatDate(group.created_at)}`);
  console.log(`  Updated: ${formatDate(group.updated_at)}`);

  if (!Array.isArray(sessions) || sessions.length === 0) {
    console.log('\nNo sessions found.');
    return;
  }

  console.log('\nSessions:');
  for (const session of sessions) {
    console.log(`  ${session.id}`);
    console.log(`    Status: ${session.status}`);
    console.log(`    Branch: ${session.worktree_branch || '-'}`);
    console.log(`    Validation: ${boolLabel(session.validation_passed)}`);
    console.log(`    Cost: $${Number(session.runtime_cost_total || session.total_cost || 0).toFixed(2)}`);
  }
}

async function runGroupStop(args, flags) {
  const groupId = args[0];
  if (!groupId) {
    throw new Error('Usage: rudi run-group stop <group-id>');
  }

  const sidecar = readSidecarInfo();
  const response = await sidecarRequest({
    ...sidecar,
    method: 'POST',
    pathname: `/agent/run-group/${encodeURIComponent(groupId)}/stop`,
  });

  if (flags.json) {
    printJson(response);
    return;
  }

  console.log(`Stopped run group ${response.groupId}: ${response.stopped} session(s) signaled, status=${response.status}`);
}

async function runGroupMerge(args, flags) {
  const groupId = args[0];
  if (!groupId) {
    throw new Error('Usage: rudi run-group merge <group-id> [--to <branch>] [--session-ids <a,b,c>]');
  }

  const sidecar = readSidecarInfo();
  const detail = await fetchRunGroupDetail(sidecar, groupId);
  const explicitSessionIds = normalizeCsvFlag(flags['session-ids'] || flags.sessionIds);
  const sessionIds = explicitSessionIds.length > 0
    ? explicitSessionIds
    : selectDefaultMergeSessionIds(detail.sessions);

  if (sessionIds.length === 0) {
    throw new Error('No mergeable sessions found. Use --session-ids to select explicit session IDs.');
  }

  const targetBranch = resolveMergeTarget(flags);
  const response = await sidecarRequest({
    ...sidecar,
    method: 'POST',
    pathname: `/agent/run-group/${encodeURIComponent(groupId)}/merge`,
    body: {
      sessionIds,
      ...(targetBranch ? { targetBranch } : {}),
    },
  });

  if (flags.json) {
    printJson(response);
    return;
  }

  const results = Array.isArray(response.results) ? response.results : [];
  const failures = results.filter((row) => row.ok === false);
  console.log(`Merge results for ${groupId}:`);
  for (const result of results) {
    const status = result.ok ? 'ok' : 'failed';
    console.log(`  ${result.sessionId}: ${status} (${result.branch || 'unknown'})`);
    if (result.error) {
      console.log(`    Error: ${result.error}`);
    }
  }

  if (failures.length > 0) {
    process.exitCode = 1;
  }
}

async function runGroupCleanup(args, flags) {
  const groupId = args[0];
  if (!groupId) {
    throw new Error('Usage: rudi run-group cleanup <group-id> [--delete-branches]');
  }

  const sidecar = readSidecarInfo();
  const response = await sidecarRequest({
    ...sidecar,
    method: 'POST',
    pathname: `/agent/run-group/${encodeURIComponent(groupId)}/cleanup`,
    body: {
      deleteBranches: flags['delete-branches'] === true,
    },
  });

  if (flags.json) {
    printJson(response);
    return;
  }

  console.log(`Cleanup results for ${groupId}: cleaned ${response.cleaned || 0} worktree(s)`);
  if (Array.isArray(response.errors) && response.errors.length > 0) {
    process.exitCode = 1;
    for (const row of response.errors) {
      console.log(`  ${row.sessionId || 'unknown'}: ${row.error}`);
    }
  }
}

export async function cmdRunGroup(args, flags) {
  const subcommand = args[0];

  switch (subcommand) {
    case 'list':
    case 'ls':
      await runGroupList(flags);
      break;

    case 'show':
      await runGroupShow(args.slice(1), flags);
      break;

    case 'stop':
      await runGroupStop(args.slice(1), flags);
      break;

    case 'merge':
      await runGroupMerge(args.slice(1), flags);
      break;

    case 'cleanup':
      await runGroupCleanup(args.slice(1), flags);
      break;

    default:
      printRunGroupHelp();
  }
}
