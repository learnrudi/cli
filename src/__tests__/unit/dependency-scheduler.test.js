import { describe, it } from 'node:test';
import assert from 'node:assert';
import { evaluateDependencyExecution } from '../../commands/agent/group-scheduler.js';

// Helper to create task objects
function makeTask(index, { deps = [], failurePolicy = null } = {}) {
  return {
    sessionId: `session-${index}`,
    taskIndex: index,
    dependencies: deps.map(d => typeof d === 'number' ? { taskIndex: d } : d),
    failurePolicy,
  };
}

describe('evaluateDependencyExecution', () => {
  it('launches tasks with no dependencies immediately', () => {
    const tasks = [
      makeTask(0),
      makeTask(1),
      makeTask(2),
    ];

    const result = evaluateDependencyExecution({
      tasks,
      runtimeStatusBySessionId: new Map(),
      validationBySessionId: new Map(),
      artifactAvailabilityByTask: new Map(),
    });

    assert.strictEqual(result.action, 'launch');
    assert.strictEqual(result.phaseIndex, 0);
    assert.strictEqual(result.tasks.length, 3);
    assert.deepStrictEqual(result.tasks.map(t => t.taskIndex), [0, 1, 2]);
  });

  it('launches downstream task after dependency completes and validates', () => {
    const tasks = [
      makeTask(0),
      makeTask(1, { deps: [0] }),
    ];

    const runtimeStatusBySessionId = new Map([
      ['session-0', 'completed'],
    ]);

    const validationBySessionId = new Map([
      ['session-0', { passed: true }],
    ]);

    const result = evaluateDependencyExecution({
      tasks,
      runtimeStatusBySessionId,
      validationBySessionId,
      artifactAvailabilityByTask: new Map(),
    });

    assert.strictEqual(result.action, 'launch');
    assert.strictEqual(result.tasks.length, 1);
    assert.strictEqual(result.tasks[0].taskIndex, 1);
  });

  it('waits when dependency is still running', () => {
    const tasks = [
      makeTask(0),
      makeTask(1, { deps: [0] }),
    ];

    const runtimeStatusBySessionId = new Map([
      ['session-0', 'running'],
    ]);

    const result = evaluateDependencyExecution({
      tasks,
      runtimeStatusBySessionId,
      validationBySessionId: new Map(),
      artifactAvailabilityByTask: new Map(),
    });

    assert.strictEqual(result.action, 'wait');
  });

  it('waits when dependency completed but no validation result yet', () => {
    const tasks = [
      makeTask(0),
      makeTask(1, { deps: [0] }),
    ];

    const runtimeStatusBySessionId = new Map([
      ['session-0', 'completed'],
    ]);

    const result = evaluateDependencyExecution({
      tasks,
      runtimeStatusBySessionId,
      validationBySessionId: new Map(), // No validation entry
      artifactAvailabilityByTask: new Map(),
    });

    assert.strictEqual(result.action, 'wait');
  });

  it('blocks when dependency failed (error)', () => {
    const tasks = [
      makeTask(0),
      makeTask(1, { deps: [0] }),
    ];

    const runtimeStatusBySessionId = new Map([
      ['session-0', 'error'],
    ]);

    const result = evaluateDependencyExecution({
      tasks,
      runtimeStatusBySessionId,
      validationBySessionId: new Map(),
      artifactAvailabilityByTask: new Map(),
    });

    assert.strictEqual(result.action, 'block');
    assert.strictEqual(result.reason, 'dependency_failed');
  });

  it('blocks when dependency crashed', () => {
    const tasks = [
      makeTask(0),
      makeTask(1, { deps: [0] }),
    ];

    const runtimeStatusBySessionId = new Map([
      ['session-0', 'crashed'],
    ]);

    const result = evaluateDependencyExecution({
      tasks,
      runtimeStatusBySessionId,
      validationBySessionId: new Map(),
      artifactAvailabilityByTask: new Map(),
    });

    assert.strictEqual(result.action, 'block');
  });

  it('blocks when dependency validation failed', () => {
    const tasks = [
      makeTask(0),
      makeTask(1, { deps: [0] }),
    ];

    const runtimeStatusBySessionId = new Map([
      ['session-0', 'completed'],
    ]);

    const validationBySessionId = new Map([
      ['session-0', { passed: false }],
    ]);

    const result = evaluateDependencyExecution({
      tasks,
      runtimeStatusBySessionId,
      validationBySessionId,
      artifactAvailabilityByTask: new Map(),
    });

    assert.strictEqual(result.action, 'block');
  });

  it('continues past failed dependency when failurePolicy is continue', () => {
    const tasks = [
      makeTask(0, { failurePolicy: 'continue' }),
      makeTask(1, { deps: [0] }),
    ];

    const runtimeStatusBySessionId = new Map([
      ['session-0', 'error'],
    ]);

    const result = evaluateDependencyExecution({
      tasks,
      runtimeStatusBySessionId,
      validationBySessionId: new Map(),
      artifactAvailabilityByTask: new Map(),
    });

    assert.strictEqual(result.action, 'launch');
    assert.strictEqual(result.tasks.length, 1);
    assert.strictEqual(result.tasks[0].taskIndex, 1);
  });

  it('blocks when required artifact is missing', () => {
    const tasks = [
      makeTask(0),
      makeTask(1, { deps: [{ taskIndex: 0, artifact: 'context.md' }] }),
    ];

    const runtimeStatusBySessionId = new Map([
      ['session-0', 'completed'],
    ]);

    const validationBySessionId = new Map([
      ['session-0', { passed: true }],
    ]);

    const result = evaluateDependencyExecution({
      tasks,
      runtimeStatusBySessionId,
      validationBySessionId,
      artifactAvailabilityByTask: new Map(), // No artifacts registered
    });

    assert.strictEqual(result.action, 'block');
  });

  it('launches when required artifact is available', () => {
    const tasks = [
      makeTask(0),
      makeTask(1, { deps: [{ taskIndex: 0, artifact: 'context.md' }] }),
    ];

    const runtimeStatusBySessionId = new Map([
      ['session-0', 'completed'],
    ]);

    const validationBySessionId = new Map([
      ['session-0', { passed: true }],
    ]);

    const artifactAvailabilityByTask = new Map([
      [0, new Set(['context.md'])],
    ]);

    const result = evaluateDependencyExecution({
      tasks,
      runtimeStatusBySessionId,
      validationBySessionId,
      artifactAvailabilityByTask,
    });

    assert.strictEqual(result.action, 'launch');
    assert.strictEqual(result.tasks.length, 1);
    assert.strictEqual(result.tasks[0].taskIndex, 1);
  });

  it('detects circular dependency deadlock', () => {
    const tasks = [
      makeTask(0, { deps: [1] }),
      makeTask(1, { deps: [0] }),
    ];

    const result = evaluateDependencyExecution({
      tasks,
      runtimeStatusBySessionId: new Map(),
      validationBySessionId: new Map(),
      artifactAvailabilityByTask: new Map(),
    });

    assert.strictEqual(result.action, 'deadlock');
    assert.strictEqual(result.reason, 'dependency_cycle');
  });

  it('returns complete when all tasks finished', () => {
    const tasks = [
      makeTask(0),
      makeTask(1),
    ];

    const runtimeStatusBySessionId = new Map([
      ['session-0', 'completed'],
      ['session-1', 'completed'],
    ]);

    const result = evaluateDependencyExecution({
      tasks,
      runtimeStatusBySessionId,
      validationBySessionId: new Map(),
      artifactAvailabilityByTask: new Map(),
    });

    assert.strictEqual(result.action, 'complete');
  });

  it('launches independent tasks while dependent tasks wait', () => {
    const tasks = [
      makeTask(0),
      makeTask(1),
      makeTask(2, { deps: [0] }),
    ];

    const result = evaluateDependencyExecution({
      tasks,
      runtimeStatusBySessionId: new Map(),
      validationBySessionId: new Map(),
      artifactAvailabilityByTask: new Map(),
    });

    assert.strictEqual(result.action, 'launch');
    assert.strictEqual(result.tasks.length, 2);
    assert.deepStrictEqual(result.tasks.map(t => t.taskIndex), [0, 1]);
  });

  it('handles mixed: some tasks launched, some waiting, some blocked', () => {
    const tasks = [
      makeTask(0),
      makeTask(1, { deps: [0] }),
      makeTask(2),
    ];

    const runtimeStatusBySessionId = new Map([
      ['session-0', 'running'],
    ]);

    const result = evaluateDependencyExecution({
      tasks,
      runtimeStatusBySessionId,
      validationBySessionId: new Map(),
      artifactAvailabilityByTask: new Map(),
    });

    assert.strictEqual(result.action, 'launch');
    assert.strictEqual(result.tasks.length, 1);
    assert.strictEqual(result.tasks[0].taskIndex, 2);
  });
});
