/**
 * Parallel command - launch a run group and monitor progress.
 *
 * Usage:
 *   rudi parallel "task one" "task two" --name "Batch A"
 */

import { readSidecarInfo, sidecarRequest } from './sidecar-client.js';
import {
  listRunGroupTemplates,
  loadRunGroupTemplate,
  resolveTemplateToRunGroupBody,
} from './agent/templates.js';
const TERMINAL_GROUP_STATES = new Set(['completed', 'partial', 'failed', 'stopped']);
const POLL_INTERVAL_MS = 2000;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function fmtUsd(value) {
  const num = Number(value || 0);
  return `$${num.toFixed(2)}`;
}

function pad(text, width) {
  const str = String(text ?? '');
  return str.length >= width ? str.slice(0, width) : str + ' '.repeat(width - str.length);
}

function extractSessionStatus(session) {
  return session.status || session.runtime_status || session.session_status || 'unknown';
}

function extractSessionTurns(session) {
  return Number(session.runtime_turn_count ?? session.turn_count ?? 0);
}

function extractSessionCost(session) {
  return Number(session.runtime_cost_total ?? session.total_cost ?? 0);
}

function extractSessionName(session) {
  return (
    session.title_override
    || session.title
    || session.provider_session_id
    || session.id
  );
}

function clearTerminal() {
  if (process.stdout.isTTY) {
    process.stdout.write('\x1b[2J\x1b[H');
  }
}

function renderProgress(group, sessions) {
  const done = Number(group.completed_count || 0) + Number(group.failed_count || 0);
  const total = Number(group.session_count || sessions.length || 0);
  const title = group.name || group.id;

  clearTerminal();
  console.log(`RUDI Parallel: "${title}" (${total} tasks)\n`);
  sessions.forEach((session, idx) => {
    const status = extractSessionStatus(session);
    const turns = extractSessionTurns(session);
    const cost = extractSessionCost(session);
    const name = extractSessionName(session);
    const doneMark = status === 'completed' ? ' ✓' : '';
    console.log(
      `  [${idx + 1}] ${pad(name, 12)} ${pad(status, 10)} ${pad(`${turns} turns`, 10)} ${fmtUsd(cost)}${doneMark}`
    );
  });

  console.log(`\nTotal: ${fmtUsd(group.total_cost || 0)} | ${done}/${total} completed`);
}

function printMergeHints(group, sessions) {
  const baseBranch = group.base_branch || 'main';
  const lines = sessions
    .map((session) => ({
      id: session.id,
      branch: session.worktree_branch,
      status: extractSessionStatus(session),
    }))
    .filter((row) => row.branch);

  if (lines.length === 0) return;

  console.log('\nBranches:');
  for (const row of lines) {
    const shortId = String(row.id).slice(0, 8);
    console.log(`  - ${shortId} (${row.status}): ${row.branch}`);
    console.log(`    git diff ${baseBranch}...${row.branch}`);
  }
}

function printTemplates() {
  const templates = listRunGroupTemplates();
  if (templates.length === 0) {
    console.log('No run-group templates found.');
    return;
  }

  console.log('Run-group templates:\n');
  for (const template of templates) {
    const suffix = template.description ? ` - ${template.description}` : '';
    console.log(`  ${template.name} (${template.source})${suffix}`);
  }
}

export async function cmdParallel(args, flags) {
  if (flags['list-templates']) {
    printTemplates();
    return;
  }

  const tasks = args.map((value) => String(value || '').trim()).filter(Boolean);
  const templateName = typeof flags.template === 'string' ? flags.template.trim() : '';

  let sidecar;
  try {
    sidecar = readSidecarInfo();
  } catch (err) {
    console.error(`Error: ${err.message}`);
    process.exit(1);
  }

  const explicitExecutionMode = typeof flags['execution-mode'] === 'string'
    ? flags['execution-mode']
    : (flags['no-worktree'] ? 'shared_cwd' : null);
  const commonOverrides = {
    name: typeof flags.name === 'string' ? flags.name : null,
    provider: typeof flags.provider === 'string' ? flags.provider : null,
    model: typeof flags.model === 'string' ? flags.model : null,
    baseBranch: typeof flags['base-branch'] === 'string' ? flags['base-branch'] : null,
    cwd: typeof flags.cwd === 'string' ? flags.cwd : process.cwd(),
    permissionMode: typeof flags['permission-mode'] === 'string' ? flags['permission-mode'] : null,
    systemPrompt: typeof flags['system-prompt'] === 'string' ? flags['system-prompt'] : null,
    coordinationMode: typeof flags['coordination-mode'] === 'string' ? flags['coordination-mode'] : null,
    executionMode: explicitExecutionMode,
    useWorktree: flags['no-worktree'] ? false : null,
    allowValidationCommands: flags['allow-validation-commands'] === true ? true : null,
  };

  let payload;
  if (templateName) {
    if (tasks.length > 0) {
      console.error('Positional tasks cannot be combined with --template');
      process.exit(1);
    }
    try {
      const template = loadRunGroupTemplate(templateName);
      payload = resolveTemplateToRunGroupBody(template, commonOverrides);
    } catch (err) {
      console.error(`Error loading template: ${err.message}`);
      process.exit(1);
    }
  } else {
    if (tasks.length < 2) {
      console.error('Usage: rudi parallel "task one" "task two" [more tasks] [--name "Batch"] [--provider claude] [--model sonnet]');
      console.error('   or: rudi parallel --template <name> [options]');
      process.exit(1);
    }
    if (tasks.length > 10) {
      console.error('rudi parallel supports at most 10 tasks per run-group');
      process.exit(1);
    }
    payload = {
      ...commonOverrides,
      provider: commonOverrides.provider || 'claude',
      executionMode: commonOverrides.executionMode || 'worktree',
      useWorktree: commonOverrides.useWorktree === false ? false : true,
      tasks: tasks.map((prompt) => ({ prompt })),
    };
  }

  let created;
  try {
    created = await sidecarRequest({
      ...sidecar,
      method: 'POST',
      pathname: '/agent/run-group',
      body: payload,
    });
  } catch (err) {
    console.error(`Error creating run-group: ${err.message}`);
    process.exit(1);
  }

  const groupId = created.groupId;
  if (!groupId) {
    console.error('Error: sidecar did not return a run-group id');
    process.exit(1);
  }

  let latest = null;
  while (true) {
    try {
      latest = await sidecarRequest({
        ...sidecar,
        method: 'GET',
        pathname: `/agent/run-group/${encodeURIComponent(groupId)}`,
      });
    } catch (err) {
      console.error(`Error polling run-group: ${err.message}`);
      process.exit(1);
    }

    const group = latest.group || {};
    const sessions = Array.isArray(latest.sessions) ? latest.sessions : [];
    renderProgress(group, sessions);

    if (TERMINAL_GROUP_STATES.has(group.status)) break;
    await sleep(POLL_INTERVAL_MS);
  }

  const group = latest.group || {};
  const sessions = Array.isArray(latest.sessions) ? latest.sessions : [];
  console.log(`\nRun group finished with status: ${group.status}`);
  printMergeHints(group, sessions);

  if (group.status === 'failed') process.exit(1);
}
