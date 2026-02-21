/**
 * Apply command - execute organization plans safely
 *
 * Usage:
 *   rudi apply plan.json [--force]
 *   rudi apply --undo <planId>
 */

import { existsSync, readFileSync, writeFileSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';
import { randomUUID } from 'crypto';
import { getDb, isDatabaseInitialized } from '@learnrudi/db';

export async function cmdApply(args, flags) {
  const planFile = args[0];
  const force = flags.force;
  const undoPlanId = flags.undo;
  const only = flags.only; // Filter: 'move', 'rename', 'project'

  if (undoPlanId) {
    return undoPlan(undoPlanId);
  }

  if (!planFile) {
    console.log(`
rudi apply - Execute organization plans

USAGE
  rudi apply <plan.json>     Apply a plan file
  rudi apply --undo <id>     Undo a previously applied plan

OPTIONS
  --force                    Skip confirmation prompts
  --only <type>              Apply only specific operations:
                               move    - session moves only
                               rename  - title updates only
                               project - project creation only

EXAMPLES
  rudi session organize --dry-run --out plan.json
  rudi apply plan.json
  rudi apply plan.json --only move      # Moves first (low regret)
  rudi apply plan.json --only rename    # Renames second
  rudi apply --undo plan-20260109-abc123
`);
    return;
  }

  if (!existsSync(planFile)) {
    console.error(`Plan file not found: ${planFile}`);
    process.exit(1);
  }

  if (!isDatabaseInitialized()) {
    console.error('Database not initialized. Run: rudi db init');
    process.exit(1);
  }

  // Load the plan
  let plan;
  try {
    plan = JSON.parse(readFileSync(planFile, 'utf-8'));
  } catch (err) {
    console.error(`Invalid plan file: ${err.message}`);
    process.exit(1);
  }

  // Validate plan structure
  if (!plan.version || !plan.actions) {
    console.error('Invalid plan format: missing version or actions');
    process.exit(1);
  }

  console.log('═'.repeat(60));
  console.log('Apply Organization Plan');
  console.log('═'.repeat(60));
  console.log(`Plan file: ${planFile}`);
  console.log(`Created: ${plan.createdAt}`);
  console.log('═'.repeat(60));

  // Filter actions based on --only flag
  let { createProjects = [], moveSessions = [], updateTitles = [] } = plan.actions;

  if (only) {
    console.log(`\nFilter: --only ${only}`);
    if (only === 'move') {
      createProjects = [];
      updateTitles = [];
    } else if (only === 'rename') {
      createProjects = [];
      moveSessions = [];
    } else if (only === 'project') {
      moveSessions = [];
      updateTitles = [];
    } else {
      console.error(`Unknown filter: ${only}. Use: move, rename, project`);
      process.exit(1);
    }
  }

  // Show summary
  console.log('\nActions to apply:');
  console.log(`  Create projects: ${createProjects.length}`);
  console.log(`  Move sessions: ${moveSessions.length}`);
  console.log(`  Update titles: ${updateTitles.length}`);

  const totalActions = createProjects.length + moveSessions.length + updateTitles.length;
  if (totalActions === 0) {
    console.log('\nNo actions to apply (filtered out or empty).');
    return;
  }

  // Confirm unless --force
  if (!force) {
    console.log('\nThis will modify your database.');
    console.log('Add --force to skip this confirmation.\n');

    const readline = await import('readline');
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout
    });

    const answer = await new Promise(resolve => {
      rl.question('Apply this plan? (y/N): ', resolve);
    });
    rl.close();

    if (answer.toLowerCase() !== 'y') {
      console.log('Cancelled.');
      return;
    }
  }

  const db = getDb();
  const planId = `plan-${new Date().toISOString().slice(0, 10).replace(/-/g, '')}-${randomUUID().slice(0, 6)}`;
  const undoActions = [];

  console.log(`\nApplying plan ${planId}...\n`);

  // Step 1: Create projects
  if (createProjects.length > 0) {
    console.log('Creating projects...');
    const insertProject = db.prepare(`
      INSERT OR IGNORE INTO projects (id, provider, name, created_at)
      VALUES (?, 'claude', ?, datetime('now'))
    `);

    for (const p of createProjects) {
      const projectId = `proj-${p.name.toLowerCase().replace(/\s+/g, '-')}`;
      try {
        insertProject.run(projectId, p.name);
        console.log(`  ✓ Created: ${p.name}`);
        undoActions.push({ type: 'deleteProject', projectId, name: p.name });
      } catch (err) {
        console.log(`  ⚠ Skipped (exists): ${p.name}`);
      }
    }
  }

  // Step 2: Move sessions to projects
  if (moveSessions.length > 0) {
    console.log('\nMoving sessions...');

    // Get project IDs
    const projectIds = new Map();
    const projects = db.prepare('SELECT id, name FROM projects').all();
    for (const p of projects) {
      projectIds.set(p.name.toLowerCase(), p.id);
    }

    const updateSession = db.prepare(`
      UPDATE sessions SET project_id = ? WHERE id = ?
    `);

    let moved = 0;
    for (const m of moveSessions) {
      const projectId = projectIds.get(m.suggestedProject.toLowerCase());
      if (!projectId) {
        console.log(`  ⚠ Project not found: ${m.suggestedProject}`);
        continue;
      }

      // Get current project_id for undo
      const current = db.prepare('SELECT project_id FROM sessions WHERE id = ?').get(m.sessionId);

      try {
        updateSession.run(projectId, m.sessionId);
        moved++;
        undoActions.push({
          type: 'moveSession',
          sessionId: m.sessionId,
          fromProject: current?.project_id,
          toProject: projectId
        });
      } catch (err) {
        console.log(`  ⚠ Failed: ${m.sessionId} - ${err.message}`);
      }
    }
    console.log(`  ✓ Moved ${moved} sessions`);
  }

  // Step 3: Update titles
  if (updateTitles.length > 0) {
    console.log('\nUpdating titles...');

    const updateTitle = db.prepare(`
      UPDATE sessions
      SET title = ?, title_override = ?, title_source = 'user', title_generated_at = ?
      WHERE id = ?
    `);

    let updated = 0;
    for (const t of updateTitles) {
      // Get current title for undo
      const current = db.prepare(
        'SELECT title, title_override, title_source, title_generated_at FROM sessions WHERE id = ?'
      ).get(t.sessionId);

      try {
        const now = new Date().toISOString();
        updateTitle.run(t.suggestedTitle, t.suggestedTitle, now, t.sessionId);
        updated++;
        undoActions.push({
          type: 'updateTitle',
          sessionId: t.sessionId,
          fromTitle: current?.title,
          fromTitleOverride: current?.title_override,
          fromTitleSource: current?.title_source,
          fromTitleGeneratedAt: current?.title_generated_at,
          toTitle: t.suggestedTitle
        });
      } catch (err) {
        console.log(`  ⚠ Failed: ${t.sessionId} - ${err.message}`);
      }
    }
    console.log(`  ✓ Updated ${updated} titles`);
  }

  // Save undo file
  const undoDir = join(homedir(), '.rudi', 'plans');
  const { mkdirSync } = await import('fs');
  try {
    mkdirSync(undoDir, { recursive: true });
  } catch (e) {}

  const undoFile = join(undoDir, `${planId}.undo.json`);
  const undoPlan = {
    planId,
    appliedAt: new Date().toISOString(),
    sourceFile: planFile,
    actions: undoActions
  };
  writeFileSync(undoFile, JSON.stringify(undoPlan, null, 2));

  console.log('\n' + '═'.repeat(60));
  console.log('Plan applied successfully!');
  console.log('═'.repeat(60));
  console.log(`Plan ID: ${planId}`);
  console.log(`Undo file: ${undoFile}`);
  console.log(`\nTo undo: rudi apply --undo ${planId}`);
}

async function undoPlan(planId) {
  const undoDir = join(homedir(), '.rudi', 'plans');
  const undoFile = join(undoDir, `${planId}.undo.json`);

  if (!existsSync(undoFile)) {
    console.error(`Undo file not found: ${undoFile}`);
    console.log('\nAvailable plans:');
    try {
      const { readdirSync } = await import('fs');
      const files = readdirSync(undoDir).filter(f => f.endsWith('.undo.json'));
      for (const f of files) {
        console.log(`  ${f.replace('.undo.json', '')}`);
      }
    } catch (e) {
      console.log('  (none)');
    }
    process.exit(1);
  }

  const undoPlan = JSON.parse(readFileSync(undoFile, 'utf-8'));
  const db = getDb();

  console.log('═'.repeat(60));
  console.log('Undo Organization Plan');
  console.log('═'.repeat(60));
  console.log(`Plan ID: ${planId}`);
  console.log(`Applied: ${undoPlan.appliedAt}`);
  console.log(`Actions to undo: ${undoPlan.actions.length}`);
  console.log('═'.repeat(60));

  // Reverse the actions
  const actions = [...undoPlan.actions].reverse();

  for (const action of actions) {
    switch (action.type) {
      case 'deleteProject':
        db.prepare('DELETE FROM projects WHERE id = ?').run(action.projectId);
        console.log(`  ✓ Deleted project: ${action.name}`);
        break;

      case 'moveSession':
        db.prepare('UPDATE sessions SET project_id = ? WHERE id = ?')
          .run(action.fromProject, action.sessionId);
        console.log(`  ✓ Restored session project: ${action.sessionId.slice(0, 8)}...`);
        break;

      case 'updateTitle':
        db.prepare('UPDATE sessions SET title = ?, title_override = ?, title_source = ?, title_generated_at = ? WHERE id = ?')
          .run(
            action.fromTitle,
            action.fromTitleOverride,
            action.fromTitleSource || null,
            action.fromTitleGeneratedAt || null,
            action.sessionId,
          );
        console.log(`  ✓ Restored title: ${action.sessionId.slice(0, 8)}...`);
        break;
    }
  }

  // Remove undo file
  const { unlinkSync } = await import('fs');
  unlinkSync(undoFile);

  console.log('\n' + '═'.repeat(60));
  console.log('Plan undone successfully!');
  console.log('═'.repeat(60));
}
