import { describe, it } from 'node:test';
import assert from 'node:assert';
import Database from 'better-sqlite3';
import { mkdtempSync, writeFileSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { loadRunGroupTemplate } from '../../commands/agent/templates.js';
import {
  validateTaskContract,
  getTaskValidationResultMap,
  getTaskArtifactAvailabilityMap,
  getDependencyArtifacts,
} from '../../commands/agent/contract-validator.js';
import { evaluateDependencyExecution } from '../../commands/agent/group-scheduler.js';

function createTestDatabase() {
  const db = new Database(':memory:');

  db.exec(`
    CREATE TABLE IF NOT EXISTS sessions (id TEXT PRIMARY KEY);
    CREATE TABLE IF NOT EXISTS run_groups (id TEXT PRIMARY KEY);
    CREATE TABLE IF NOT EXISTS task_artifacts (
      id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL,
      run_group_id TEXT NOT NULL,
      task_index INTEGER NOT NULL,
      artifact_name TEXT NOT NULL,
      artifact_path TEXT NOT NULL,
      artifact_kind TEXT NOT NULL CHECK (artifact_kind IN ('file', 'directory')),
      created_at TEXT NOT NULL,
      FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE,
      FOREIGN KEY (run_group_id) REFERENCES run_groups(id) ON DELETE CASCADE
    );
    CREATE TABLE IF NOT EXISTS task_validation_results (
      session_id TEXT PRIMARY KEY,
      run_group_id TEXT NOT NULL,
      task_index INTEGER NOT NULL,
      passed INTEGER NOT NULL DEFAULT 0,
      errors_json TEXT,
      warnings_json TEXT,
      artifacts_json TEXT,
      validated_at TEXT NOT NULL,
      FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE,
      FOREIGN KEY (run_group_id) REFERENCES run_groups(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_task_artifacts_group_task ON task_artifacts(run_group_id, task_index);
    CREATE INDEX IF NOT EXISTS idx_task_validation_group ON task_validation_results(run_group_id);
  `);

  return db;
}

function seedRunGroup(db, runGroupId, sessionIds) {
  db.prepare('INSERT INTO run_groups (id) VALUES (?)').run(runGroupId);
  const insertSession = db.prepare('INSERT INTO sessions (id) VALUES (?)');
  for (const sessionId of sessionIds) {
    insertSession.run(sessionId);
  }
}

describe('non-code run-group simulations', () => {
  it('releases a vendor comparison task after both vendor briefs validate and register artifacts', async () => {
    const template = loadRunGroupTemplate('vendor-eval-3task');
    const db = createTestDatabase();
    const tempDir = mkdtempSync(join(tmpdir(), 'vendor-eval-sim-'));
    const runGroupId = 'group-vendor-eval';
    const sessionIds = ['vendor-a', 'vendor-b', 'comparison'];

    try {
      seedRunGroup(db, runGroupId, sessionIds);

      writeFileSync(join(tempDir, 'vendor-a.json'), JSON.stringify({
        vendor: 'Vendor A',
        pricing: 'mid',
        security: 'strong',
        integrations: ['salesforce'],
        support: '24/7',
        risks: ['limited eu region'],
        recommendation_score: 8,
        sources: ['https://example.com/vendor-a'],
      }));
      writeFileSync(join(tempDir, 'vendor-b.json'), JSON.stringify({
        vendor: 'Vendor B',
        pricing: 'high',
        security: 'strong',
        integrations: ['hubspot'],
        support: 'business hours',
        risks: ['higher cost'],
        recommendation_score: 7,
        sources: ['https://example.com/vendor-b'],
      }));

      const [vendorATask, vendorBTask, comparisonTask] = template.tasks.map((task, taskIndex) => ({
        ...task,
        taskIndex,
      }));

      const validationA = await validateTaskContract({
        db,
        sessionId: sessionIds[0],
        runGroupId,
        task: vendorATask,
        cwd: tempDir,
        log: null,
      });
      const validationB = await validateTaskContract({
        db,
        sessionId: sessionIds[1],
        runGroupId,
        task: vendorBTask,
        cwd: tempDir,
        log: null,
      });

      assert.strictEqual(validationA.passed, true, 'vendor A brief should validate');
      assert.strictEqual(validationB.passed, true, 'vendor B brief should validate');

      const validationBySessionId = getTaskValidationResultMap(db, runGroupId);
      const artifactAvailabilityByTask = getTaskArtifactAvailabilityMap(db, runGroupId);
      const result = evaluateDependencyExecution({
        tasks: [
          { ...vendorATask, sessionId: sessionIds[0] },
          { ...vendorBTask, sessionId: sessionIds[1] },
          { ...comparisonTask, sessionId: sessionIds[2] },
        ],
        runtimeStatusBySessionId: new Map([
          [sessionIds[0], 'completed'],
          [sessionIds[1], 'completed'],
        ]),
        validationBySessionId,
        artifactAvailabilityByTask,
      });

      assert.strictEqual(result.action, 'launch', 'comparison task should be ready to launch');
      assert.strictEqual(result.tasks.length, 1, 'only the comparison task should be released');
      assert.strictEqual(result.tasks[0].name, 'Recommendation Writer');

      const dependencyArtifacts = comparisonTask.dependencies.flatMap((dependency) =>
        getDependencyArtifacts(db, runGroupId, dependency)
      );
      const artifactNames = dependencyArtifacts.map((artifact) => artifact.name).sort();
      assert.deepStrictEqual(
        artifactNames,
        ['vendor-a.json', 'vendor-b.json'],
        'comparison task should receive both vendor artifacts'
      );
      assert.ok(
        dependencyArtifacts.every((artifact) => artifact.path.startsWith(tempDir)),
        'resolved artifacts should stay within the task root'
      );
    } finally {
      db.close();
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it('blocks meeting prep synthesis when one upstream artifact fails validation', async () => {
    const template = loadRunGroupTemplate('meeting-prep-3task');
    const db = createTestDatabase();
    const tempDir = mkdtempSync(join(tmpdir(), 'meeting-prep-sim-'));
    const runGroupId = 'group-meeting-prep';
    const sessionIds = ['company', 'news', 'briefing'];

    try {
      seedRunGroup(db, runGroupId, sessionIds);

      writeFileSync(join(tempDir, 'company-brief.json'), JSON.stringify({
        company: 'Acme',
        business_model: 'SaaS',
        products: ['Platform'],
        executives: ['CEO'],
        current_priorities: ['Expansion'],
        recent_metrics: ['ARR up 20%'],
        sources: ['https://example.com/company'],
      }));
      writeFileSync(join(tempDir, 'company-news.json'), '{invalid-json');

      const [companyTask, newsTask, briefingTask] = template.tasks.map((task, taskIndex) => ({
        ...task,
        taskIndex,
      }));

      const validationA = await validateTaskContract({
        db,
        sessionId: sessionIds[0],
        runGroupId,
        task: companyTask,
        cwd: tempDir,
        log: null,
      });
      const validationB = await validateTaskContract({
        db,
        sessionId: sessionIds[1],
        runGroupId,
        task: newsTask,
        cwd: tempDir,
        log: null,
      });

      assert.strictEqual(validationA.passed, true, 'company brief should validate');
      assert.strictEqual(validationB.passed, false, 'invalid news JSON should fail validation');

      const result = evaluateDependencyExecution({
        tasks: [
          { ...companyTask, sessionId: sessionIds[0] },
          { ...newsTask, sessionId: sessionIds[1] },
          { ...briefingTask, sessionId: sessionIds[2] },
        ],
        runtimeStatusBySessionId: new Map([
          [sessionIds[0], 'completed'],
          [sessionIds[1], 'completed'],
        ]),
        validationBySessionId: getTaskValidationResultMap(db, runGroupId),
        artifactAvailabilityByTask: getTaskArtifactAvailabilityMap(db, runGroupId),
      });

      assert.strictEqual(result.action, 'block', 'briefing task should remain blocked');
      assert.strictEqual(result.reason, 'dependency_failed');
      assert.strictEqual(result.tasks.length, 1, 'only the synthesis task should be blocked');
      assert.strictEqual(result.tasks[0].name, 'Briefing Writer');
    } finally {
      db.close();
      rmSync(tempDir, { recursive: true, force: true });
    }
  });
});
