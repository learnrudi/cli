import { describe, it } from 'node:test';
import assert from 'node:assert';
import Database from 'better-sqlite3';
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import {
  validateTaskContract,
  getTaskValidationResultMap,
  getTaskArtifactAvailabilityMap,
  getDependencyArtifacts,
} from '../../commands/agent/contract-validator.js';

/**
 * Creates an in-memory SQLite database with the required schema
 */
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
    CREATE INDEX IF NOT EXISTS idx_task_artifacts_group_name ON task_artifacts(run_group_id, artifact_name);
    CREATE INDEX IF NOT EXISTS idx_task_validation_group ON task_validation_results(run_group_id);
  `);

  return db;
}

/**
 * Creates a temporary directory for testing
 */
function createTempDir() {
  return mkdtempSync(join(tmpdir(), 'contract-validator-test-'));
}

describe('contract-validator', () => {
  describe('validateTaskContract', () => {
    it('passes when no evidence/output/validation defined', async () => {
      const db = createTestDatabase();
      const tempDir = createTempDir();

      db.prepare('INSERT INTO sessions (id) VALUES (?)').run('session-1');
      db.prepare('INSERT INTO run_groups (id) VALUES (?)').run('group-1');

      const task = {
        taskIndex: 0,
        prompt: 'Do something',
        evidence: null,
        output: null,
        validation: null,
      };

      const result = await validateTaskContract({
        db,
        sessionId: 'session-1',
        runGroupId: 'group-1',
        task,
        cwd: tempDir,
        log: null,
      });

      assert.strictEqual(result.passed, true);
      assert.strictEqual(result.errors.length, 0);
      assert.strictEqual(result.warnings.length, 0);

      db.close();
      rmSync(tempDir, { recursive: true, force: true });
    });

    it('checks artifact_exists evidence - success case', async () => {
      const db = createTestDatabase();
      const tempDir = createTempDir();

      db.prepare('INSERT INTO sessions (id) VALUES (?)').run('session-2');
      db.prepare('INSERT INTO run_groups (id) VALUES (?)').run('group-2');

      const testFile = join(tempDir, 'test.txt');
      writeFileSync(testFile, 'test content');

      const task = {
        taskIndex: 0,
        prompt: 'Create test file',
        evidence: {
          type: 'artifact_exists',
          path: 'test.txt',
        },
        output: null,
        validation: null,
      };

      const result = await validateTaskContract({
        db,
        sessionId: 'session-2',
        runGroupId: 'group-2',
        task,
        cwd: tempDir,
        log: null,
      });

      assert.strictEqual(result.passed, true);
      assert.strictEqual(result.errors.length, 0);

      db.close();
      rmSync(tempDir, { recursive: true, force: true });
    });

    it('checks artifact_exists evidence - failure case', async () => {
      const db = createTestDatabase();
      const tempDir = createTempDir();

      db.prepare('INSERT INTO sessions (id) VALUES (?)').run('session-3');
      db.prepare('INSERT INTO run_groups (id) VALUES (?)').run('group-3');

      const task = {
        taskIndex: 0,
        prompt: 'Create test file',
        evidence: {
          type: 'artifact_exists',
          path: 'nonexistent.txt',
        },
        output: null,
        validation: null,
      };

      const result = await validateTaskContract({
        db,
        sessionId: 'session-3',
        runGroupId: 'group-3',
        task,
        cwd: tempDir,
        log: null,
      });

      assert.strictEqual(result.passed, false);
      assert.ok(result.errors.length > 0);
      assert.ok(result.errors.some(e => e.includes('nonexistent.txt')));

      db.close();
      rmSync(tempDir, { recursive: true, force: true });
    });

    it('checks json_file evidence - success case', async () => {
      const db = createTestDatabase();
      const tempDir = createTempDir();

      db.prepare('INSERT INTO sessions (id) VALUES (?)').run('session-4');
      db.prepare('INSERT INTO run_groups (id) VALUES (?)').run('group-4');

      const jsonFile = join(tempDir, 'test.json');
      writeFileSync(jsonFile, JSON.stringify({ valid: true, data: [1, 2, 3] }));

      const task = {
        taskIndex: 0,
        prompt: 'Create JSON file',
        evidence: {
          type: 'json_file',
          path: 'test.json',
        },
        output: null,
        validation: null,
      };

      const result = await validateTaskContract({
        db,
        sessionId: 'session-4',
        runGroupId: 'group-4',
        task,
        cwd: tempDir,
        log: null,
      });

      assert.strictEqual(result.passed, true);
      assert.strictEqual(result.errors.length, 0);

      db.close();
      rmSync(tempDir, { recursive: true, force: true });
    });

    it('checks json_file evidence - invalid JSON', async () => {
      const db = createTestDatabase();
      const tempDir = createTempDir();

      db.prepare('INSERT INTO sessions (id) VALUES (?)').run('session-5');
      db.prepare('INSERT INTO run_groups (id) VALUES (?)').run('group-5');

      const jsonFile = join(tempDir, 'bad.json');
      writeFileSync(jsonFile, '{ invalid json syntax }');

      const task = {
        taskIndex: 0,
        prompt: 'Create JSON file',
        evidence: {
          type: 'json_file',
          path: 'bad.json',
        },
        output: null,
        validation: null,
      };

      const result = await validateTaskContract({
        db,
        sessionId: 'session-5',
        runGroupId: 'group-5',
        task,
        cwd: tempDir,
        log: null,
      });

      assert.strictEqual(result.passed, false);
      assert.ok(result.errors.length > 0);
      assert.ok(result.errors.some(e => e.includes('JSON') || e.includes('bad.json')));

      db.close();
      rmSync(tempDir, { recursive: true, force: true });
    });

    it('checks output existence - success case', async () => {
      const db = createTestDatabase();
      const tempDir = createTempDir();

      db.prepare('INSERT INTO sessions (id) VALUES (?)').run('session-6');
      db.prepare('INSERT INTO run_groups (id) VALUES (?)').run('group-6');

      const outputFile = join(tempDir, 'output.txt');
      writeFileSync(outputFile, 'output content');

      const task = {
        taskIndex: 0,
        prompt: 'Create output',
        evidence: null,
        output: {
          type: 'file',
          path: 'output.txt',
        },
        validation: null,
      };

      const result = await validateTaskContract({
        db,
        sessionId: 'session-6',
        runGroupId: 'group-6',
        task,
        cwd: tempDir,
        log: null,
      });

      assert.strictEqual(result.passed, true);
      assert.strictEqual(result.errors.length, 0);

      db.close();
      rmSync(tempDir, { recursive: true, force: true });
    });

    it('checks output existence - missing file', async () => {
      const db = createTestDatabase();
      const tempDir = createTempDir();

      db.prepare('INSERT INTO sessions (id) VALUES (?)').run('session-7');
      db.prepare('INSERT INTO run_groups (id) VALUES (?)').run('group-7');

      const task = {
        taskIndex: 0,
        prompt: 'Create output',
        evidence: null,
        output: {
          type: 'file',
          path: 'missing-output.txt',
        },
        validation: null,
      };

      const result = await validateTaskContract({
        db,
        sessionId: 'session-7',
        runGroupId: 'group-7',
        task,
        cwd: tempDir,
        log: null,
      });

      assert.strictEqual(result.passed, false);
      assert.ok(result.errors.length > 0);
      assert.ok(result.errors.some(e => e.includes('missing-output.txt')));

      db.close();
      rmSync(tempDir, { recursive: true, force: true });
    });

    it('blocks unknown validation commands', async () => {
      const db = createTestDatabase();
      const tempDir = createTempDir();

      db.prepare('INSERT INTO sessions (id) VALUES (?)').run('session-8');
      db.prepare('INSERT INTO run_groups (id) VALUES (?)').run('group-8');

      const task = {
        taskIndex: 0,
        prompt: 'Run validation',
        evidence: null,
        output: null,
        validation: {
          command: ['dangerous-cmd', 'arg'],
        },
      };

      const result = await validateTaskContract({
        db,
        sessionId: 'session-8',
        runGroupId: 'group-8',
        task,
        cwd: tempDir,
        log: null,
        allowValidationCommands: false,
      });

      assert.strictEqual(result.passed, false);
      assert.ok(result.errors.length > 0);
      assert.ok(result.errors.some(e => e.includes('blocked') || e.includes('dangerous-cmd')));

      db.close();
      rmSync(tempDir, { recursive: true, force: true });
    });

    it('allows allowlisted commands', async () => {
      const db = createTestDatabase();
      const tempDir = createTempDir();

      db.prepare('INSERT INTO sessions (id) VALUES (?)').run('session-9');
      db.prepare('INSERT INTO run_groups (id) VALUES (?)').run('group-9');

      const task = {
        taskIndex: 0,
        prompt: 'Run node command',
        evidence: {
          type: 'command',
          command: ['node', '-e', 'process.exit(0)'],
        },
        output: null,
        validation: null,
      };

      const result = await validateTaskContract({
        db,
        sessionId: 'session-9',
        runGroupId: 'group-9',
        task,
        cwd: tempDir,
        log: null,
      });

      assert.strictEqual(result.passed, true);
      assert.strictEqual(result.errors.length, 0);

      db.close();
      rmSync(tempDir, { recursive: true, force: true });
    });

    it('rejects path traversal', async () => {
      const db = createTestDatabase();
      const tempDir = createTempDir();

      db.prepare('INSERT INTO sessions (id) VALUES (?)').run('session-10');
      db.prepare('INSERT INTO run_groups (id) VALUES (?)').run('group-10');

      const task = {
        taskIndex: 0,
        prompt: 'Create output',
        evidence: null,
        output: {
          type: 'file',
          path: '../../etc/passwd',
        },
        validation: null,
      };

      const result = await validateTaskContract({
        db,
        sessionId: 'session-10',
        runGroupId: 'group-10',
        task,
        cwd: tempDir,
        log: null,
      });

      assert.strictEqual(result.passed, false);
      assert.ok(result.errors.length > 0);
      assert.ok(result.errors.some(e => e.includes('escapes task root') || e.includes('traversal')));

      db.close();
      rmSync(tempDir, { recursive: true, force: true });
    });

    it('registers artifacts in DB', async () => {
      const db = createTestDatabase();
      const tempDir = createTempDir();

      db.prepare('INSERT INTO sessions (id) VALUES (?)').run('session-11');
      db.prepare('INSERT INTO run_groups (id) VALUES (?)').run('group-11');

      const outputFile = join(tempDir, 'artifact.txt');
      writeFileSync(outputFile, 'artifact content');

      const task = {
        taskIndex: 0,
        prompt: 'Create artifact',
        evidence: null,
        output: {
          type: 'file',
          path: 'artifact.txt',
        },
        validation: null,
      };

      const result = await validateTaskContract({
        db,
        sessionId: 'session-11',
        runGroupId: 'group-11',
        task,
        cwd: tempDir,
        log: null,
      });

      assert.strictEqual(result.passed, true);

      const artifacts = db.prepare('SELECT * FROM task_artifacts WHERE session_id = ?').all('session-11');
      assert.strictEqual(artifacts.length, 1);
      assert.strictEqual(artifacts[0].artifact_name, 'artifact.txt');
      assert.strictEqual(artifacts[0].artifact_kind, 'file');
      assert.strictEqual(artifacts[0].run_group_id, 'group-11');
      assert.strictEqual(artifacts[0].task_index, 0);

      db.close();
      rmSync(tempDir, { recursive: true, force: true });
    });

    it('writes results to task_validation_results', async () => {
      const db = createTestDatabase();
      const tempDir = createTempDir();

      db.prepare('INSERT INTO sessions (id) VALUES (?)').run('session-12');
      db.prepare('INSERT INTO run_groups (id) VALUES (?)').run('group-12');

      const task = {
        taskIndex: 0,
        prompt: 'Simple task',
        evidence: null,
        output: null,
        validation: null,
      };

      const result = await validateTaskContract({
        db,
        sessionId: 'session-12',
        runGroupId: 'group-12',
        task,
        cwd: tempDir,
        log: null,
      });

      assert.strictEqual(result.passed, true);

      const validationResults = db.prepare('SELECT * FROM task_validation_results WHERE session_id = ?').get('session-12');
      assert.ok(validationResults);
      assert.strictEqual(validationResults.passed, 1);
      assert.strictEqual(validationResults.run_group_id, 'group-12');
      assert.strictEqual(validationResults.task_index, 0);
      assert.ok(validationResults.validated_at);

      const errors = JSON.parse(validationResults.errors_json || '[]');
      assert.strictEqual(errors.length, 0);

      db.close();
      rmSync(tempDir, { recursive: true, force: true });
    });

    it('checks directory output type', async () => {
      const db = createTestDatabase();
      const tempDir = createTempDir();

      db.prepare('INSERT INTO sessions (id) VALUES (?)').run('session-13');
      db.prepare('INSERT INTO run_groups (id) VALUES (?)').run('group-13');

      const outputDir = join(tempDir, 'output-dir');
      mkdirSync(outputDir, { recursive: true });
      writeFileSync(join(outputDir, 'file.txt'), 'content');

      const task = {
        taskIndex: 0,
        prompt: 'Create directory',
        evidence: null,
        output: {
          type: 'directory',
          path: 'output-dir',
        },
        validation: null,
      };

      const result = await validateTaskContract({
        db,
        sessionId: 'session-13',
        runGroupId: 'group-13',
        task,
        cwd: tempDir,
        log: null,
      });

      assert.strictEqual(result.passed, true);

      const artifacts = db.prepare('SELECT * FROM task_artifacts WHERE session_id = ?').all('session-13');
      assert.strictEqual(artifacts.length, 1);
      assert.strictEqual(artifacts[0].artifact_kind, 'directory');

      db.close();
      rmSync(tempDir, { recursive: true, force: true });
    });

    it('validation command with allowValidationCommands=true', async () => {
      const db = createTestDatabase();
      const tempDir = createTempDir();

      db.prepare('INSERT INTO sessions (id) VALUES (?)').run('session-14');
      db.prepare('INSERT INTO run_groups (id) VALUES (?)').run('group-14');

      const task = {
        taskIndex: 0,
        prompt: 'Run custom command',
        evidence: null,
        output: null,
        validation: {
          command: ['custom-tool', '--check'],
        },
      };

      const result = await validateTaskContract({
        db,
        sessionId: 'session-14',
        runGroupId: 'group-14',
        task,
        cwd: tempDir,
        log: null,
        allowValidationCommands: true,
      });

      // Command won't exist, but it should NOT be blocked - it should fail with execution error instead
      assert.strictEqual(result.passed, false);
      assert.ok(!result.errors.some(e => e.includes('blocked')));

      db.close();
      rmSync(tempDir, { recursive: true, force: true });
    });
  });

  describe('getTaskValidationResultMap', () => {
    it('returns correct map', () => {
      const db = createTestDatabase();

      db.prepare('INSERT INTO sessions (id) VALUES (?)').run('session-map-1');
      db.prepare('INSERT INTO sessions (id) VALUES (?)').run('session-map-2');
      db.prepare('INSERT INTO run_groups (id) VALUES (?)').run('group-map-1');

      const now = new Date().toISOString();

      db.prepare(`
        INSERT INTO task_validation_results
        (session_id, run_group_id, task_index, passed, errors_json, warnings_json, artifacts_json, validated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `).run('session-map-1', 'group-map-1', 0, 1, '[]', '[]', '["artifact1.txt"]', now);

      db.prepare(`
        INSERT INTO task_validation_results
        (session_id, run_group_id, task_index, passed, errors_json, warnings_json, artifacts_json, validated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `).run('session-map-2', 'group-map-1', 1, 0, '["error1"]', '["warning1"]', '[]', now);

      const resultMap = getTaskValidationResultMap(db, 'group-map-1');

      assert.ok(resultMap instanceof Map);
      assert.strictEqual(resultMap.size, 2);

      const result1 = resultMap.get('session-map-1');
      assert.ok(result1);
      assert.strictEqual(result1.passed, true);
      assert.strictEqual(result1.errors.length, 0);
      assert.strictEqual(result1.warnings.length, 0);
      assert.strictEqual(result1.artifacts.length, 1);
      assert.strictEqual(result1.artifacts[0], 'artifact1.txt');

      const result2 = resultMap.get('session-map-2');
      assert.ok(result2);
      assert.strictEqual(result2.passed, false);
      assert.strictEqual(result2.errors.length, 1);
      assert.strictEqual(result2.errors[0], 'error1');
      assert.strictEqual(result2.warnings.length, 1);
      assert.strictEqual(result2.warnings[0], 'warning1');

      db.close();
    });

    it('returns empty map when no results', () => {
      const db = createTestDatabase();
      db.prepare('INSERT INTO run_groups (id) VALUES (?)').run('group-empty');

      const resultMap = getTaskValidationResultMap(db, 'group-empty');

      assert.ok(resultMap instanceof Map);
      assert.strictEqual(resultMap.size, 0);

      db.close();
    });
  });

  describe('getTaskArtifactAvailabilityMap', () => {
    it('returns correct map', () => {
      const db = createTestDatabase();

      db.prepare('INSERT INTO sessions (id) VALUES (?)').run('session-artifact-1');
      db.prepare('INSERT INTO sessions (id) VALUES (?)').run('session-artifact-2');
      db.prepare('INSERT INTO run_groups (id) VALUES (?)').run('group-artifact-1');

      const now = new Date().toISOString();

      db.prepare(`
        INSERT INTO task_artifacts
        (id, session_id, run_group_id, task_index, artifact_name, artifact_path, artifact_kind, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `).run('art-1', 'session-artifact-1', 'group-artifact-1', 0, 'output.txt', '/tmp/output.txt', 'file', now);

      db.prepare(`
        INSERT INTO task_artifacts
        (id, session_id, run_group_id, task_index, artifact_name, artifact_path, artifact_kind, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `).run('art-2', 'session-artifact-1', 'group-artifact-1', 0, 'data.json', '/tmp/data.json', 'file', now);

      db.prepare(`
        INSERT INTO task_artifacts
        (id, session_id, run_group_id, task_index, artifact_name, artifact_path, artifact_kind, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `).run('art-3', 'session-artifact-2', 'group-artifact-1', 1, 'result.txt', '/tmp/result.txt', 'file', now);

      const availabilityMap = getTaskArtifactAvailabilityMap(db, 'group-artifact-1');

      assert.ok(availabilityMap instanceof Map);
      assert.strictEqual(availabilityMap.size, 2);

      const task0Artifacts = availabilityMap.get(0);
      assert.ok(task0Artifacts instanceof Set);
      assert.strictEqual(task0Artifacts.size, 2);
      assert.ok(task0Artifacts.has('output.txt'));
      assert.ok(task0Artifacts.has('data.json'));

      const task1Artifacts = availabilityMap.get(1);
      assert.ok(task1Artifacts instanceof Set);
      assert.strictEqual(task1Artifacts.size, 1);
      assert.ok(task1Artifacts.has('result.txt'));

      db.close();
    });

    it('returns empty map when no artifacts', () => {
      const db = createTestDatabase();
      db.prepare('INSERT INTO run_groups (id) VALUES (?)').run('group-no-artifacts');

      const availabilityMap = getTaskArtifactAvailabilityMap(db, 'group-no-artifacts');

      assert.ok(availabilityMap instanceof Map);
      assert.strictEqual(availabilityMap.size, 0);

      db.close();
    });
  });

  describe('getDependencyArtifacts', () => {
    it('filters by taskIndex and artifact name', () => {
      const db = createTestDatabase();

      db.prepare('INSERT INTO sessions (id) VALUES (?)').run('session-dep-1');
      db.prepare('INSERT INTO sessions (id) VALUES (?)').run('session-dep-2');
      db.prepare('INSERT INTO run_groups (id) VALUES (?)').run('group-dep-1');

      const now = new Date().toISOString();

      // Task 0 produces config.json
      db.prepare(`
        INSERT INTO task_artifacts
        (id, session_id, run_group_id, task_index, artifact_name, artifact_path, artifact_kind, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `).run('dep-1', 'session-dep-1', 'group-dep-1', 0, 'config.json', '/tmp/config.json', 'file', now);

      // Task 0 also produces output.txt
      db.prepare(`
        INSERT INTO task_artifacts
        (id, session_id, run_group_id, task_index, artifact_name, artifact_path, artifact_kind, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `).run('dep-2', 'session-dep-1', 'group-dep-1', 0, 'output.txt', '/tmp/output.txt', 'file', now);

      // Task 1 produces config.json (different task)
      db.prepare(`
        INSERT INTO task_artifacts
        (id, session_id, run_group_id, task_index, artifact_name, artifact_path, artifact_kind, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `).run('dep-3', 'session-dep-2', 'group-dep-1', 1, 'config.json', '/tmp/config2.json', 'file', now);

      // Query for task 0's config.json
      const dependency = {
        taskIndex: 0,
        artifact: 'config.json',
      };

      const artifacts = getDependencyArtifacts(db, 'group-dep-1', dependency);

      assert.strictEqual(artifacts.length, 1);
      assert.strictEqual(artifacts[0].name, 'config.json');
      assert.strictEqual(artifacts[0].path, '/tmp/config.json');
      assert.strictEqual(artifacts[0].kind, 'file');

      db.close();
    });

    it('returns empty array when no matching artifacts', () => {
      const db = createTestDatabase();
      db.prepare('INSERT INTO run_groups (id) VALUES (?)').run('group-dep-empty');

      const dependency = {
        taskIndex: 0,
        artifact: 'nonexistent.txt',
      };

      const artifacts = getDependencyArtifacts(db, 'group-dep-empty', dependency);

      assert.ok(Array.isArray(artifacts));
      assert.strictEqual(artifacts.length, 0);

      db.close();
    });

    it('returns multiple artifacts with same name from same task', () => {
      const db = createTestDatabase();

      db.prepare('INSERT INTO sessions (id) VALUES (?)').run('session-multi-1');
      db.prepare('INSERT INTO run_groups (id) VALUES (?)').run('group-multi-1');

      const now = new Date().toISOString();

      // Task 0 produces multiple files (edge case, but should handle)
      db.prepare(`
        INSERT INTO task_artifacts
        (id, session_id, run_group_id, task_index, artifact_name, artifact_path, artifact_kind, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `).run('multi-1', 'session-multi-1', 'group-multi-1', 0, 'output.txt', '/tmp/path1/output.txt', 'file', now);

      db.prepare(`
        INSERT INTO task_artifacts
        (id, session_id, run_group_id, task_index, artifact_name, artifact_path, artifact_kind, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `).run('multi-2', 'session-multi-1', 'group-multi-1', 0, 'output.txt', '/tmp/path2/output.txt', 'file', now);

      const dependency = {
        taskIndex: 0,
        artifact: 'output.txt',
      };

      const artifacts = getDependencyArtifacts(db, 'group-multi-1', dependency);

      assert.strictEqual(artifacts.length, 2);
      assert.ok(artifacts.every(a => a.name === 'output.txt'));

      db.close();
    });
  });
});
