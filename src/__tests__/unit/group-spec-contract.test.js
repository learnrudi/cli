import { describe, it } from 'node:test';
import assert from 'node:assert';
import {
  normalizeTaskSpec,
  normalizeGroupTasks,
  normalizeCoordinationMode,
} from '../../commands/agent/group-spec.js';

describe('group-spec contract fields', () => {
  describe('normalizeTaskSpec', () => {
    it('sets scope from task', () => {
      const result = normalizeTaskSpec({ prompt: 'x', scope: 'Auth module' }, 0);
      assert.strictEqual(result.scope, 'Auth module');
    });

    it('trims scope whitespace', () => {
      const result = normalizeTaskSpec({ prompt: 'x', scope: '  spaces  ' }, 0);
      assert.strictEqual(result.scope, 'spaces');
    });

    it('normalizes inputs array', () => {
      const task = {
        prompt: 'x',
        inputs: [
          { type: 'file', path: 'a.txt' },
          { type: 'directory', path: 'src/' },
        ],
      };
      const result = normalizeTaskSpec(task, 0);
      assert.deepStrictEqual(result.inputs, [
        { type: 'file', path: 'a.txt', optional: false },
        { type: 'directory', path: 'src/', optional: false },
      ]);
    });

    it('handles optional input flag', () => {
      const task = {
        prompt: 'x',
        inputs: [{ type: 'file', path: 'a.txt', optional: true }],
      };
      const result = normalizeTaskSpec(task, 0);
      assert.strictEqual(result.inputs[0].optional, true);
    });

    it('normalizes tools to unique array', () => {
      const task = { prompt: 'x', tools: ['Read', 'Write', 'Read'] };
      const result = normalizeTaskSpec(task, 0);
      assert.deepStrictEqual(result.tools, ['Read', 'Write']);
    });

    it('normalizes evidence artifact_exists', () => {
      const task = {
        prompt: 'x',
        evidence: { type: 'artifact_exists', path: 'out.txt' },
      };
      const result = normalizeTaskSpec(task, 0);
      assert.deepStrictEqual(result.evidence, {
        type: 'artifact_exists',
        path: 'out.txt',
        command: [],
      });
    });

    it('normalizes evidence json_file', () => {
      const task = {
        prompt: 'x',
        evidence: { type: 'json_file', path: 'data.json' },
      };
      const result = normalizeTaskSpec(task, 0);
      assert.strictEqual(result.evidence.type, 'json_file');
      assert.strictEqual(result.evidence.path, 'data.json');
    });

    it('normalizes evidence command', () => {
      const task = {
        prompt: 'x',
        evidence: { type: 'command', command: ['npm', 'test'] },
      };
      const result = normalizeTaskSpec(task, 0);
      assert.deepStrictEqual(result.evidence, {
        type: 'command',
        path: null,
        command: ['npm', 'test'],
      });
    });

    it('rejects invalid evidence type', () => {
      const task = {
        prompt: 'x',
        evidence: { type: 'invalid' },
      };
      const result = normalizeTaskSpec(task, 0);
      assert.strictEqual(result.evidence, null);
    });

    it('normalizes output', () => {
      const task = {
        prompt: 'x',
        output: { type: 'file', path: 'report.md' },
      };
      const result = normalizeTaskSpec(task, 0);
      assert.deepStrictEqual(result.output, {
        type: 'file',
        path: 'report.md',
      });
    });

    it('rejects output with missing path', () => {
      const task = {
        prompt: 'x',
        output: { type: 'file' },
      };
      const result = normalizeTaskSpec(task, 0);
      assert.strictEqual(result.output, null);
    });

    it('normalizes dependencies from array', () => {
      const task = {
        prompt: 'x',
        dependencies: [
          { taskIndex: 0, artifact: 'ctx.md' },
          { taskIndex: 1 },
        ],
      };
      const result = normalizeTaskSpec(task, 0);
      assert.deepStrictEqual(result.dependencies, [
        { taskIndex: 0, artifact: 'ctx.md' },
        { taskIndex: 1, artifact: null },
      ]);
    });

    it('normalizes dependsOn into dependencies', () => {
      const task = {
        prompt: 'x',
        depends_on: [0, 2],
      };
      const result = normalizeTaskSpec(task, 0);
      assert.ok(Array.isArray(result.dependencies));
      assert.ok(
        result.dependencies.some(
          (d) => d.taskIndex === 0 && d.artifact === null
        )
      );
      assert.ok(
        result.dependencies.some(
          (d) => d.taskIndex === 2 && d.artifact === null
        )
      );
    });

    it('normalizes failurePolicy - all valid values', () => {
      const policies = ['stop-all', 'stop-downstream', 'continue', 'escalate'];
      for (const policy of policies) {
        const result = normalizeTaskSpec(
          { prompt: 'x', failurePolicy: policy },
          0
        );
        assert.strictEqual(result.failurePolicy, policy);
      }
    });

    it('rejects invalid failurePolicy', () => {
      const task = {
        prompt: 'x',
        failurePolicy: 'invalid',
      };
      const result = normalizeTaskSpec(task, 0);
      assert.strictEqual(result.failurePolicy, null);
    });

    it('handles snake_case failure_policy', () => {
      const task = {
        prompt: 'x',
        failure_policy: 'escalate',
      };
      const result = normalizeTaskSpec(task, 0);
      assert.strictEqual(result.failurePolicy, 'escalate');
    });

    it('normalizes mergePolicy', () => {
      const task = {
        prompt: 'x',
        mergePolicy: 'git',
      };
      const result = normalizeTaskSpec(task, 0);
      assert.strictEqual(result.mergePolicy, 'git');
    });

    it('normalizes validation command', () => {
      const task = {
        prompt: 'x',
        validation: { command: ['npm', 'run', 'build'] },
      };
      const result = normalizeTaskSpec(task, 0);
      assert.deepStrictEqual(result.validation, {
        command: ['npm', 'run', 'build'],
      });
    });

    it('normalizes validationCommand shorthand', () => {
      const task = {
        prompt: 'x',
        validationCommand: ['tsc'],
      };
      const result = normalizeTaskSpec(task, 0);
      assert.deepStrictEqual(result.validation, {
        command: ['tsc'],
      });
    });

    it('returns null validation when command is empty', () => {
      const task = {
        prompt: 'x',
        validation: { command: [] },
      };
      const result = normalizeTaskSpec(task, 0);
      assert.strictEqual(result.validation, null);
    });

    it('for string task returns all contract fields as defaults', () => {
      const result = normalizeTaskSpec('just a prompt', 0);
      assert.strictEqual(result.scope, null);
      assert.deepStrictEqual(result.inputs, []);
      assert.deepStrictEqual(result.tools, []);
      assert.strictEqual(result.evidence, null);
      assert.strictEqual(result.output, null);
      assert.deepStrictEqual(result.dependencies, []);
      assert.strictEqual(result.failurePolicy, null);
      assert.strictEqual(result.mergePolicy, null);
      assert.strictEqual(result.validation, null);
    });

    it('normalizeGroupTasks preserves contract fields across all tasks', () => {
      const body = {
        tasks: [
          {
            prompt: 'Task 1',
            scope: 'Module A',
            inputs: [{ type: 'file', path: 'input.txt' }],
            tools: ['Read', 'Write'],
            evidence: { type: 'artifact_exists', path: 'output1.txt' },
            output: { type: 'file', path: 'result1.md' },
            dependencies: [{ taskIndex: 0, artifact: 'ctx.md' }],
            failurePolicy: 'stop-all',
            mergePolicy: 'git',
            validation: { command: ['npm', 'test'] },
          },
          {
            prompt: 'Task 2',
            scope: 'Module B',
            inputs: [{ type: 'directory', path: 'src/', optional: true }],
            tools: ['Bash', 'Grep'],
            evidence: { type: 'command', command: ['make', 'verify'] },
            output: { type: 'directory', path: 'dist/' },
            depends_on: [0],
            failure_policy: 'continue',
            merge_policy: 'manual',
            validationCommand: ['tsc', '--noEmit'],
          },
        ],
      };

      const result = normalizeGroupTasks(body);

      // Task 1 assertions
      assert.strictEqual(result[0].scope, 'Module A');
      assert.deepStrictEqual(result[0].inputs, [
        { type: 'file', path: 'input.txt', optional: false },
      ]);
      assert.deepStrictEqual(result[0].tools, ['Read', 'Write']);
      assert.deepStrictEqual(result[0].evidence, {
        type: 'artifact_exists',
        path: 'output1.txt',
        command: [],
      });
      assert.deepStrictEqual(result[0].output, {
        type: 'file',
        path: 'result1.md',
      });
      assert.deepStrictEqual(result[0].dependencies, [
        { taskIndex: 0, artifact: 'ctx.md' },
      ]);
      assert.strictEqual(result[0].failurePolicy, 'stop-all');
      assert.strictEqual(result[0].mergePolicy, 'git');
      assert.deepStrictEqual(result[0].validation, {
        command: ['npm', 'test'],
      });

      // Task 2 assertions
      assert.strictEqual(result[1].scope, 'Module B');
      assert.deepStrictEqual(result[1].inputs, [
        { type: 'directory', path: 'src/', optional: true },
      ]);
      assert.deepStrictEqual(result[1].tools, ['Bash', 'Grep']);
      assert.deepStrictEqual(result[1].evidence, {
        type: 'command',
        path: null,
        command: ['make', 'verify'],
      });
      assert.deepStrictEqual(result[1].output, {
        type: 'directory',
        path: 'dist/',
      });
      assert.ok(
        result[1].dependencies.some(
          (d) => d.taskIndex === 0 && d.artifact === null
        )
      );
      assert.strictEqual(result[1].failurePolicy, 'continue');
      assert.strictEqual(result[1].mergePolicy, 'manual');
      assert.deepStrictEqual(result[1].validation, {
        command: ['tsc', '--noEmit'],
      });
    });
  });

  describe('normalizeCoordinationMode', () => {
    it('accepts dependency', () => {
      const result = normalizeCoordinationMode('dependency');
      assert.strictEqual(result, 'dependency');
    });
  });
});
