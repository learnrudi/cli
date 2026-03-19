export const TERMINAL_RUNTIME_STATUSES = new Set(['completed', 'error', 'stopped', 'crashed']);

function normalizePhasePlan(phasePlan, taskCount) {
  if (Array.isArray(phasePlan) && phasePlan.length > 0) {
    return phasePlan
      .filter((phase) => Array.isArray(phase))
      .map((phase) => phase.filter((idx) => Number.isInteger(idx) && idx >= 0 && idx < taskCount))
      .filter((phase) => phase.length > 0);
  }

  return taskCount > 0
    ? [Array.from({ length: taskCount }, (_, idx) => idx)]
    : [];
}

export function parseRunGroupConfig(configJson) {
  if (typeof configJson !== 'string' || configJson.trim().length === 0) {
    return { tasks: [], phasePlan: [], coordinationMode: 'flat' };
  }

  try {
    const parsed = JSON.parse(configJson);
    return {
      ...parsed,
      tasks: Array.isArray(parsed?.tasks) ? parsed.tasks : [],
      phasePlan: normalizePhasePlan(parsed?.phasePlan, Array.isArray(parsed?.tasks) ? parsed.tasks.length : 0),
      coordinationMode: typeof parsed?.coordinationMode === 'string' ? parsed.coordinationMode : 'flat',
    };
  } catch {
    return { tasks: [], phasePlan: [], coordinationMode: 'flat' };
  }
}

export function getEffectivePhasePlan({ coordinationMode, phasePlan, tasks }) {
  const normalized = normalizePhasePlan(phasePlan, tasks.length);
  if (coordinationMode !== 'phased') {
    return tasks.length > 0
      ? [Array.from({ length: tasks.length }, (_, idx) => idx)]
      : [];
  }
  return normalized;
}

function createValidationMap(validationBySessionId) {
  if (validationBySessionId instanceof Map) return validationBySessionId;
  return new Map(Object.entries(validationBySessionId || {}));
}

function createArtifactLookup(artifactAvailabilityByTask) {
  if (artifactAvailabilityByTask instanceof Map) return artifactAvailabilityByTask;
  const lookup = new Map();
  if (!artifactAvailabilityByTask || typeof artifactAvailabilityByTask !== 'object') {
    return lookup;
  }
  for (const [key, value] of Object.entries(artifactAvailabilityByTask)) {
    const taskIndex = Number.parseInt(key, 10);
    if (!Number.isInteger(taskIndex)) continue;
    if (value instanceof Set) {
      lookup.set(taskIndex, value);
      continue;
    }
    if (Array.isArray(value)) {
      lookup.set(taskIndex, new Set(value.filter((entry) => typeof entry === 'string' && entry.trim())));
    }
  }
  return lookup;
}

export function evaluatePhaseExecution({ coordinationMode, tasks, phasePlan, runtimeStatusBySessionId }) {
  const effectivePhasePlan = getEffectivePhasePlan({ coordinationMode, phasePlan, tasks });
  const runtimeMap = runtimeStatusBySessionId instanceof Map
    ? runtimeStatusBySessionId
    : new Map(Object.entries(runtimeStatusBySessionId || {}));

  for (let phaseIndex = 0; phaseIndex < effectivePhasePlan.length; phaseIndex += 1) {
    const phaseTaskIndices = effectivePhasePlan[phaseIndex];
    const phaseTasks = phaseTaskIndices
      .map((taskIndex) => tasks[taskIndex])
      .filter(Boolean);

    if (phaseTasks.length === 0) continue;

    const pendingTasks = [];
    let hasActive = false;
    let hasFailure = false;
    let hasStopped = false;

    for (const task of phaseTasks) {
      const status = runtimeMap.get(task.sessionId) || null;
      if (!status) {
        pendingTasks.push(task);
        continue;
      }
      if (status === 'starting' || status === 'running' || status === 'retrying') {
        hasActive = true;
        continue;
      }
      if (status === 'error' || status === 'crashed') {
        hasFailure = true;
        continue;
      }
      if (status === 'stopped') {
        hasStopped = true;
      }
    }

    if (pendingTasks.length > 0) {
      return {
        action: 'launch',
        phaseIndex,
        tasks: pendingTasks,
      };
    }

    if (hasActive) {
      return {
        action: 'wait',
        phaseIndex,
        tasks: [],
      };
    }

    if (hasFailure || hasStopped) {
      const blockedTasks = [];
      for (let downstreamPhase = phaseIndex + 1; downstreamPhase < effectivePhasePlan.length; downstreamPhase += 1) {
        for (const taskIndex of effectivePhasePlan[downstreamPhase]) {
          const task = tasks[taskIndex];
          if (!task) continue;
          if (runtimeMap.get(task.sessionId)) continue;
          blockedTasks.push(task);
        }
      }

      return {
        action: blockedTasks.length > 0 ? 'block' : 'wait',
        phaseIndex,
        tasks: blockedTasks,
        reason: hasStopped ? 'phase_stopped' : 'phase_failed',
      };
    }
  }

  return {
    action: 'complete',
    phaseIndex: effectivePhasePlan.length > 0 ? effectivePhasePlan.length - 1 : -1,
    tasks: [],
  };
}

export function evaluateDependencyExecution({
  tasks,
  runtimeStatusBySessionId,
  validationBySessionId,
  artifactAvailabilityByTask,
}) {
  const runtimeMap = runtimeStatusBySessionId instanceof Map
    ? runtimeStatusBySessionId
    : new Map(Object.entries(runtimeStatusBySessionId || {}));
  const validationMap = createValidationMap(validationBySessionId);
  const artifactLookup = createArtifactLookup(artifactAvailabilityByTask);

  const taskStateCache = new Map();
  const cycleTaskIndexes = new Set();
  const visiting = new Set();

  function dependencyAllowsContinue(depTask, validationState) {
    if (depTask?.failurePolicy === 'continue') return true;
    if (!validationState) return false;
    return validationState.passed === true && validationState.skipped !== true;
  }

  function evaluatePendingTask(taskIndex) {
    if (taskStateCache.has(taskIndex)) return taskStateCache.get(taskIndex);
    if (visiting.has(taskIndex)) {
      cycleTaskIndexes.add(taskIndex);
      return 'cycle';
    }

    const task = tasks[taskIndex];
    if (!task) return 'blocked';

    visiting.add(taskIndex);
    let state = 'ready';

    for (const dependency of Array.isArray(task.dependencies) ? task.dependencies : []) {
      const depTask = tasks[dependency.taskIndex];
      if (!depTask) {
        state = 'blocked';
        break;
      }

      const depRuntime = runtimeMap.get(depTask.sessionId) || null;
      if (!depRuntime) {
        const depState = evaluatePendingTask(dependency.taskIndex);
        if (depState === 'cycle') {
          cycleTaskIndexes.add(taskIndex);
          state = 'cycle';
          break;
        }
        if (depState === 'blocked') {
          state = 'blocked';
          break;
        }
        state = 'waiting';
        continue;
      }

      if (depRuntime === 'starting' || depRuntime === 'running' || depRuntime === 'retrying') {
        state = 'waiting';
        continue;
      }

      if (depRuntime === 'error' || depRuntime === 'crashed' || depRuntime === 'stopped') {
        if (dependency.artifact) {
          state = 'blocked';
          break;
        }
        if (!dependencyAllowsContinue(depTask, null)) {
          state = 'blocked';
          break;
        }
        continue;
      }

      if (depRuntime === 'completed') {
        const validationState = validationMap.get(depTask.sessionId) || null;
        if (!validationState) {
          state = 'waiting';
          continue;
        }
        if (!dependencyAllowsContinue(depTask, validationState)) {
          state = 'blocked';
          break;
        }
        if (dependency.artifact) {
          const availableArtifacts = artifactLookup.get(dependency.taskIndex) || new Set();
          if (!availableArtifacts.has(dependency.artifact)) {
            state = 'blocked';
            break;
          }
        }
      }
    }

    visiting.delete(taskIndex);
    taskStateCache.set(taskIndex, state);
    return state;
  }

  const pendingTasks = [];
  const readyTasks = [];
  const blockedTasks = [];
  let hasActive = false;

  for (let taskIndex = 0; taskIndex < tasks.length; taskIndex += 1) {
    const task = tasks[taskIndex];
    if (!task) continue;

    const runtimeStatus = runtimeMap.get(task.sessionId) || null;
    if (runtimeStatus) {
      if (runtimeStatus === 'starting' || runtimeStatus === 'running' || runtimeStatus === 'retrying') {
        hasActive = true;
      }
      continue;
    }

    pendingTasks.push(task);
    const taskState = evaluatePendingTask(taskIndex);
    if (taskState === 'ready') {
      readyTasks.push(task);
    } else if (taskState === 'blocked') {
      blockedTasks.push(task);
    }
  }

  if (readyTasks.length > 0) {
    return {
      action: 'launch',
      phaseIndex: 0,
      tasks: readyTasks,
    };
  }

  if (hasActive) {
    return {
      action: 'wait',
      phaseIndex: 0,
      tasks: [],
    };
  }

  if (blockedTasks.length > 0) {
    return {
      action: 'block',
      phaseIndex: 0,
      tasks: blockedTasks,
      reason: 'dependency_failed',
    };
  }

  if (pendingTasks.length > 0 && cycleTaskIndexes.size > 0) {
    return {
      action: 'deadlock',
      phaseIndex: 0,
      tasks: pendingTasks.filter((task) => cycleTaskIndexes.has(task.taskIndex)),
      reason: 'dependency_cycle',
    };
  }

  if (pendingTasks.length > 0) {
    return {
      action: 'wait',
      phaseIndex: 0,
      tasks: [],
    };
  }

  return {
    action: 'complete',
    phaseIndex: 0,
    tasks: [],
  };
}

export function normalizeRunGroupStatus({
  currentStatus,
  sessionCount,
  launchedCount,
  doneCount,
  completedCount,
  failedCount,
  stoppedCount,
  validationFailedCount = 0,
}) {
  const totalSessions = Number(sessionCount || 0);
  const launchedSessions = Number(launchedCount || 0);
  const doneSessions = Number(doneCount || 0);
  const completedSessions = Number(completedCount || 0);
  const failedSessions = Number(failedCount || 0);
  const stoppedSessions = Number(stoppedCount || 0);
  const validationFailures = Number(validationFailedCount || 0);

  if (currentStatus === 'stopped') return 'stopped';
  if (totalSessions === 0) return 'pending';
  if (launchedSessions === 0) return 'pending';
  if (doneSessions < totalSessions) return 'running';
  if (validationFailures > 0) return 'partial';
  if (failedSessions > 0 && completedSessions > 0) return 'partial';
  if (stoppedSessions > 0 && completedSessions > 0) return 'partial';
  if (failedSessions > 0) return 'failed';
  if (stoppedSessions > 0) return 'stopped';
  return 'completed';
}

export function deriveRunGroupSessionStatus({ alive, runtimeStatus, sessionStatus, groupStatus }) {
  if (alive) return 'running';
  if (runtimeStatus) return runtimeStatus;
  if (groupStatus === 'stopped') return 'stopped';
  if (sessionStatus === 'active') return 'pending';
  return sessionStatus || 'unknown';
}
