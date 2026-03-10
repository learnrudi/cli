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

export function normalizeRunGroupStatus({
  currentStatus,
  sessionCount,
  launchedCount,
  doneCount,
  completedCount,
  failedCount,
  stoppedCount,
}) {
  const totalSessions = Number(sessionCount || 0);
  const launchedSessions = Number(launchedCount || 0);
  const doneSessions = Number(doneCount || 0);
  const completedSessions = Number(completedCount || 0);
  const failedSessions = Number(failedCount || 0);
  const stoppedSessions = Number(stoppedCount || 0);

  if (currentStatus === 'stopped') return 'stopped';
  if (totalSessions === 0) return 'pending';
  if (launchedSessions === 0) return 'pending';
  if (doneSessions < totalSessions) return 'running';
  if (failedSessions > 0 && completedSessions > 0) return 'partial';
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
