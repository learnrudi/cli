import {
  deriveRunGroupSessionStatus,
} from '../../commands/agent/group-scheduler.js';

function parseJsonArray(value) {
  return value ? JSON.parse(value) : [];
}

function getLiveState(liveEntry) {
  const alive = Boolean(liveEntry?.proc && !liveEntry.proc.killed);
  return {
    alive,
    turnActive: Boolean(liveEntry?.turnActive),
    pid: liveEntry?.proc?.pid || null,
  };
}

function normalizeProgress(progress = null) {
  return {
    snippet: progress?.snippet || null,
    type: progress?.type || null,
    ts: progress?.ts || null,
    source: progress?.source || null,
  };
}

export function projectRunGroupDetailSession(row, options = {}) {
  const live = getLiveState(options.liveEntry);
  const progress = normalizeProgress(options.progress);

  return {
    ...row,
    status: deriveRunGroupSessionStatus({
      alive: live.alive,
      runtimeStatus: row.runtime_status,
      sessionStatus: row.session_status,
      groupStatus: options.groupStatus,
    }),
    alive: live.alive,
    turn_active: live.turnActive,
    pid: live.pid,
    last_progress_snippet: progress.snippet,
    last_progress_type: progress.type,
    last_progress_at: progress.ts,
    last_progress_source: progress.source,
    validation_passed: row.validation_passed == null ? null : Number(row.validation_passed) === 1,
    validation_errors: parseJsonArray(row.validation_errors_json),
    validation_warnings: parseJsonArray(row.validation_warnings_json),
    validated_at: row.validated_at || null,
  };
}

export function projectRunGroupLiveSession(row, options = {}) {
  const live = getLiveState(options.liveEntry);
  const progress = normalizeProgress(options.progress);
  const status = deriveRunGroupSessionStatus({
    alive: live.alive,
    runtimeStatus: row.runtime_status,
    sessionStatus: row.session_status,
    groupStatus: options.groupStatus,
  });

  return {
    sessionId: row.id,
    name: row.title_override || row.title || row.id.slice(0, 8),
    status,
    alive: live.alive,
    turnActive: live.turnActive,
    turnCount: Number(row.runtime_turn_count || 0),
    costTotal: Number(row.runtime_cost_total || 0),
    tokensTotal: Number(row.runtime_tokens_total || 0),
    lastError: row.runtime_last_error || null,
    lastSnippet: progress.snippet,
    lastProgressType: progress.type,
    lastProgressAt: progress.ts,
    lastProgressSource: progress.source,
    worktreeBranch: row.worktree_branch || null,
    validationPassed: row.validation_passed == null ? null : Number(row.validation_passed) === 1,
  };
}
