import assert from 'node:assert';
import test from 'node:test';

import {
  deriveRunGroupSessionStatus,
  evaluateDependencyExecution,
  evaluatePhaseExecution,
  normalizeRunGroupStatus,
} from '../../commands/agent/group-scheduler.js';

test('evaluatePhaseExecution launches the first phase before later phases', () => {
  const tasks = [
    { sessionId: 's-1' },
    { sessionId: 's-2' },
    { sessionId: 's-3' },
  ];

  const initial = evaluatePhaseExecution({
    coordinationMode: 'phased',
    tasks,
    phasePlan: [[0, 1], [2]],
    runtimeStatusBySessionId: new Map(),
  });

  assert.strictEqual(initial.action, 'launch');
  assert.strictEqual(initial.phaseIndex, 0);
  assert.deepStrictEqual(initial.tasks.map((task) => task.sessionId), ['s-1', 's-2']);

  const secondPhase = evaluatePhaseExecution({
    coordinationMode: 'phased',
    tasks,
    phasePlan: [[0, 1], [2]],
    runtimeStatusBySessionId: new Map([
      ['s-1', 'completed'],
      ['s-2', 'completed'],
    ]),
  });

  assert.strictEqual(secondPhase.action, 'launch');
  assert.strictEqual(secondPhase.phaseIndex, 1);
  assert.deepStrictEqual(secondPhase.tasks.map((task) => task.sessionId), ['s-3']);
});

test('evaluatePhaseExecution waits while a phase is still running', () => {
  const result = evaluatePhaseExecution({
    coordinationMode: 'phased',
    tasks: [{ sessionId: 's-1' }, { sessionId: 's-2' }, { sessionId: 's-3' }],
    phasePlan: [[0, 1], [2]],
    runtimeStatusBySessionId: new Map([
      ['s-1', 'running'],
      ['s-2', 'completed'],
    ]),
  });

  assert.strictEqual(result.action, 'wait');
  assert.strictEqual(result.phaseIndex, 0);
});

test('evaluatePhaseExecution blocks downstream phases after a failed phase completes', () => {
  const result = evaluatePhaseExecution({
    coordinationMode: 'phased',
    tasks: [{ sessionId: 's-1' }, { sessionId: 's-2' }, { sessionId: 's-3' }],
    phasePlan: [[0, 1], [2]],
    runtimeStatusBySessionId: new Map([
      ['s-1', 'completed'],
      ['s-2', 'error'],
    ]),
  });

  assert.strictEqual(result.action, 'block');
  assert.strictEqual(result.phaseIndex, 0);
  assert.strictEqual(result.reason, 'phase_failed');
  assert.deepStrictEqual(result.tasks.map((task) => task.sessionId), ['s-3']);
});

test('evaluateDependencyExecution launches tasks whose dependencies passed validation', () => {
  const tasks = [
    { taskIndex: 0, sessionId: 's-1', dependencies: [], failurePolicy: 'stop-downstream' },
    { taskIndex: 1, sessionId: 's-2', dependencies: [{ taskIndex: 0, artifact: 'context.md' }], failurePolicy: 'stop-downstream' },
  ];

  const result = evaluateDependencyExecution({
    tasks,
    runtimeStatusBySessionId: new Map([
      ['s-1', 'completed'],
    ]),
    validationBySessionId: new Map([
      ['s-1', { passed: true }],
    ]),
    artifactAvailabilityByTask: new Map([
      [0, new Set(['context.md'])],
    ]),
  });

  assert.strictEqual(result.action, 'launch');
  assert.deepStrictEqual(result.tasks.map((task) => task.sessionId), ['s-2']);
});

test('evaluateDependencyExecution waits for validation results before release', () => {
  const tasks = [
    { taskIndex: 0, sessionId: 's-1', dependencies: [], failurePolicy: 'stop-downstream' },
    { taskIndex: 1, sessionId: 's-2', dependencies: [{ taskIndex: 0, artifact: 'context.md' }], failurePolicy: 'stop-downstream' },
  ];

  const result = evaluateDependencyExecution({
    tasks,
    runtimeStatusBySessionId: new Map([
      ['s-1', 'completed'],
    ]),
    validationBySessionId: new Map(),
    artifactAvailabilityByTask: new Map(),
  });

  assert.strictEqual(result.action, 'wait');
});

test('evaluateDependencyExecution blocks downstream tasks after failed dependency validation', () => {
  const tasks = [
    { taskIndex: 0, sessionId: 's-1', dependencies: [], failurePolicy: 'stop-downstream' },
    { taskIndex: 1, sessionId: 's-2', dependencies: [{ taskIndex: 0, artifact: 'context.md' }], failurePolicy: 'stop-downstream' },
  ];

  const result = evaluateDependencyExecution({
    tasks,
    runtimeStatusBySessionId: new Map([
      ['s-1', 'completed'],
    ]),
    validationBySessionId: new Map([
      ['s-1', { passed: false }],
    ]),
    artifactAvailabilityByTask: new Map([
      [0, new Set(['context.md'])],
    ]),
  });

  assert.strictEqual(result.action, 'block');
  assert.strictEqual(result.reason, 'dependency_failed');
  assert.deepStrictEqual(result.tasks.map((task) => task.sessionId), ['s-2']);
});

test('evaluateDependencyExecution keeps artifact dependencies blocked after upstream failure', () => {
  const tasks = [
    { taskIndex: 0, sessionId: 's-1', dependencies: [], failurePolicy: 'continue' },
    { taskIndex: 1, sessionId: 's-2', dependencies: [{ taskIndex: 0, artifact: 'context.md' }], failurePolicy: 'stop-downstream' },
  ];

  const result = evaluateDependencyExecution({
    tasks,
    runtimeStatusBySessionId: new Map([
      ['s-1', 'error'],
    ]),
    validationBySessionId: new Map(),
    artifactAvailabilityByTask: new Map(),
  });

  assert.strictEqual(result.action, 'block');
  assert.strictEqual(result.reason, 'dependency_failed');
});

test('evaluateDependencyExecution detects dependency cycles', () => {
  const tasks = [
    { taskIndex: 0, sessionId: 's-1', dependencies: [{ taskIndex: 1 }], failurePolicy: 'stop-downstream' },
    { taskIndex: 1, sessionId: 's-2', dependencies: [{ taskIndex: 0 }], failurePolicy: 'stop-downstream' },
  ];

  const result = evaluateDependencyExecution({
    tasks,
    runtimeStatusBySessionId: new Map(),
    validationBySessionId: new Map(),
    artifactAvailabilityByTask: new Map(),
  });

  assert.strictEqual(result.action, 'deadlock');
  assert.strictEqual(result.reason, 'dependency_cycle');
  assert.deepStrictEqual(result.tasks.map((task) => task.sessionId), ['s-1', 's-2']);
});

test('normalizeRunGroupStatus keeps pending groups pending until something launches', () => {
  assert.strictEqual(normalizeRunGroupStatus({
    currentStatus: 'pending',
    sessionCount: 3,
    launchedCount: 0,
    doneCount: 0,
    completedCount: 0,
    failedCount: 0,
    stoppedCount: 0,
  }), 'pending');

  assert.strictEqual(normalizeRunGroupStatus({
    currentStatus: 'running',
    sessionCount: 3,
    launchedCount: 1,
    doneCount: 0,
    completedCount: 0,
    failedCount: 0,
    stoppedCount: 0,
  }), 'running');

  assert.strictEqual(normalizeRunGroupStatus({
    currentStatus: 'running',
    sessionCount: 3,
    launchedCount: 3,
    doneCount: 3,
    completedCount: 2,
    failedCount: 1,
    stoppedCount: 0,
  }), 'partial');

  assert.strictEqual(normalizeRunGroupStatus({
    currentStatus: 'stopped',
    sessionCount: 3,
    launchedCount: 1,
    doneCount: 1,
    completedCount: 0,
    failedCount: 0,
    stoppedCount: 1,
  }), 'stopped');

  assert.strictEqual(normalizeRunGroupStatus({
    currentStatus: 'running',
    sessionCount: 2,
    launchedCount: 2,
    doneCount: 2,
    completedCount: 2,
    failedCount: 0,
    stoppedCount: 0,
    validationFailedCount: 1,
  }), 'partial');
});

test('deriveRunGroupSessionStatus exposes pending and stopped sessions correctly', () => {
  assert.strictEqual(deriveRunGroupSessionStatus({
    alive: false,
    runtimeStatus: null,
    sessionStatus: 'active',
    groupStatus: 'running',
  }), 'pending');

  assert.strictEqual(deriveRunGroupSessionStatus({
    alive: false,
    runtimeStatus: null,
    sessionStatus: 'active',
    groupStatus: 'stopped',
  }), 'stopped');

  assert.strictEqual(deriveRunGroupSessionStatus({
    alive: true,
    runtimeStatus: 'starting',
    sessionStatus: 'active',
    groupStatus: 'running',
  }), 'running');
});
