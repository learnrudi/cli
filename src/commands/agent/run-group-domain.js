import { parseRunGroupConfig, normalizeRunGroupStatus } from './group-scheduler.js';

const TERMINAL_GROUP_STATUSES = new Set(['completed', 'partial', 'failed', 'stopped']);

export const RUN_GROUP_DOMAIN_ERRORS = Object.freeze({
  NOT_FOUND: Object.freeze({
    ok: false,
    code: 'RUN_GROUP_NOT_FOUND',
    statusCode: 404,
    message: 'Run group not found',
  }),
});

export function runGroupNotFound() {
  return { ...RUN_GROUP_DOMAIN_ERRORS.NOT_FOUND };
}

export function createRunGroupSuccessResult({
  groupId,
  status,
  sessionIds,
  startedSessionIds,
  errors,
}) {
  return {
    ok: true,
    groupId,
    status,
    sessionIds: Array.isArray(sessionIds) ? sessionIds : [],
    startedSessionIds: Array.isArray(startedSessionIds) ? startedSessionIds : [],
    errors: Array.isArray(errors) ? errors : [],
  };
}

export function createRunGroupFailureResult({
  code = null,
  error,
  message = null,
  statusCode = 400,
  details = undefined,
}) {
  const result = {
    ok: false,
    code,
    error,
    message,
    statusCode,
  };
  if (details !== undefined) {
    result.details = details;
  }
  return result;
}

export function withImmediateTransaction(db, fn) {
  const tx = db.transaction((work) => work()).immediate;
  return tx(() => fn(db));
}

export function loadRunGroup(db, groupId) {
  const group = db.prepare('SELECT * FROM run_groups WHERE id = ?').get(groupId);
  if (!group) return null;
  return {
    ...group,
    config: parseRunGroupConfig(group.config_json),
  };
}

export function stopActiveRunGroupSessions(db, agentProcesses, groupId, excludeSessionId = null) {
  const rows = db.prepare('SELECT id FROM sessions WHERE run_group_id = ?').all(groupId);
  let stopped = 0;

  for (const row of rows) {
    if (!row?.id || row.id === excludeSessionId) continue;
    const entry = agentProcesses.get(row.id);
    if (!entry?.proc || entry.proc.killed) continue;
    entry._terminationReason = 'stopped';
    entry.proc.kill('SIGTERM');
    const killTimer = setTimeout(() => {
      try { entry.proc.kill('SIGKILL'); } catch {}
    }, 3000);
    entry.proc.on('close', () => clearTimeout(killTimer));
    stopped += 1;
  }

  return stopped;
}

export function refreshRunGroupAggregates(db, groupId) {
  const stats = db.prepare(`
    SELECT
      COUNT(*) AS session_count,
      SUM(CASE WHEN srs.session_id IS NOT NULL THEN 1 ELSE 0 END) AS launched_count,
      SUM(CASE WHEN COALESCE(srs.status, '') = 'completed' THEN 1 ELSE 0 END) AS completed_count,
      SUM(CASE WHEN COALESCE(srs.status, '') IN ('error', 'crashed') THEN 1 ELSE 0 END) AS failed_count,
      SUM(CASE WHEN COALESCE(srs.status, '') = 'stopped' THEN 1 ELSE 0 END) AS stopped_count,
      SUM(CASE WHEN COALESCE(srs.status, '') IN ('completed', 'error', 'stopped', 'crashed') THEN 1 ELSE 0 END) AS done_count,
      SUM(CASE WHEN tvr.session_id IS NOT NULL AND COALESCE(tvr.passed, 0) = 0 THEN 1 ELSE 0 END) AS validation_failed_count,
      COALESCE(SUM(COALESCE(srs.cost_total, s.total_cost, 0)), 0) AS total_cost,
      COALESCE(SUM(COALESCE(
        srs.tokens_total,
        (COALESCE(s.total_input_tokens, 0) + COALESCE(s.total_output_tokens, 0)),
        0
      )), 0) AS total_tokens
    FROM sessions s
    LEFT JOIN session_runtime_state srs ON srs.session_id = s.id
    LEFT JOIN task_validation_results tvr ON tvr.session_id = s.id
    WHERE s.run_group_id = ?
  `).get(groupId) || {
    session_count: 0,
    launched_count: 0,
    completed_count: 0,
    failed_count: 0,
    stopped_count: 0,
    done_count: 0,
    validation_failed_count: 0,
    total_cost: 0,
    total_tokens: 0,
  };

  const now = new Date().toISOString();
  db.prepare(`
    UPDATE run_groups
    SET session_count = ?,
        completed_count = ?,
        failed_count = ?,
        total_cost = ?,
        total_tokens = ?,
        updated_at = ?
    WHERE id = ?
  `).run(
    Number(stats.session_count || 0),
    Number(stats.completed_count || 0),
    Number(stats.failed_count || 0),
    Number(stats.total_cost || 0),
    Number(stats.total_tokens || 0),
    now,
    groupId,
  );

  const group = db.prepare('SELECT * FROM run_groups WHERE id = ?').get(groupId);
  if (!group) return null;

  const nextStatus = normalizeRunGroupStatus({
    currentStatus: group.status,
    sessionCount: stats.session_count,
    launchedCount: stats.launched_count,
    doneCount: stats.done_count,
    completedCount: stats.completed_count,
    failedCount: stats.failed_count,
    stoppedCount: stats.stopped_count,
    validationFailedCount: stats.validation_failed_count,
  });
  const isDone = Number(stats.done_count || 0) >= Number(stats.session_count || 0) && Number(stats.session_count || 0) > 0;
  const completedAt = isDone && TERMINAL_GROUP_STATUSES.has(nextStatus)
    ? (group.completed_at || now)
    : null;

  db.prepare(`
    UPDATE run_groups
    SET status = ?,
        completed_at = ?,
        updated_at = ?
    WHERE id = ?
  `).run(nextStatus, completedAt, now, groupId);

  const updatedGroup = db.prepare('SELECT * FROM run_groups WHERE id = ?').get(groupId);
  if (!updatedGroup) return null;
  return {
    ...updatedGroup,
    validation_failed_count: Number(stats.validation_failed_count || 0),
  };
}

export function createRunGroupStartedEvent({ groupId, sessionIds, activeSessionIds }) {
  return {
    groupId,
    sessionIds: Array.isArray(sessionIds) ? sessionIds : [],
    activeSessionIds: Array.isArray(activeSessionIds) ? activeSessionIds : [],
  };
}

export function createRunGroupSessionDoneEvent({
  groupId,
  sessionId,
  status,
  contractValidation = null,
}) {
  return {
    groupId,
    sessionId,
    status,
    contractValidation,
  };
}

export function createRunGroupCompletedEvent({
  groupId,
  status,
  completedCount,
  failedCount,
}) {
  return {
    groupId,
    status,
    completedCount: Number(completedCount || 0),
    failedCount: Number(failedCount || 0),
  };
}

export function createRunGroupStoppedEvent({ groupId }) {
  return { groupId };
}

export function createRunGroupSessionActivityEvent({
  groupId,
  sessionId,
  turnCount,
  costTotal,
  lastSnippet = null,
}) {
  return {
    groupId,
    sessionId,
    turnCount: Number(turnCount || 0),
    costTotal: costTotal == null ? null : Number(costTotal),
    lastSnippet,
  };
}
