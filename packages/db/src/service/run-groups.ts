/**
 * Database Run Group Operations
 *
 * CRUD + aggregate helpers for parallel run orchestration.
 */

import { v4 as uuidv4 } from 'uuid'
import type BetterSqlite3 from 'better-sqlite3'
import type {
  DbRunGroup,
  RunGroupCoordinationMode,
  RunGroupExecutionMode,
  RunGroupStatus,
} from './types'

export interface RunGroupCreateOptions {
  id?: string
  name?: string | null
  status?: RunGroupStatus
  projectPath?: string | null
  baseBranch?: string | null
  executionMode?: RunGroupExecutionMode
  coordinationMode?: RunGroupCoordinationMode
  requiresGit?: boolean
  workspaceRoot?: string | null
  provider?: string | null
  model?: string | null
  permissionMode?: string | null
  sessionCount?: number
  completedCount?: number
  failedCount?: number
  totalCost?: number
  totalTokens?: number
  configJson?: string | null
  startedAt?: string | null
  completedAt?: string | null
}

export interface RunGroupListFilters {
  projectPath?: string
  status?: RunGroupStatus
  limit?: number
  offset?: number
}

function mapDbRunGroup(row: DbRunGroup): DbRunGroup {
  return {
    ...row,
    session_count: Number(row.session_count || 0),
    completed_count: Number(row.completed_count || 0),
    failed_count: Number(row.failed_count || 0),
    requires_git: Number(row.requires_git || 0),
    total_cost: Number(row.total_cost || 0),
    total_tokens: Number(row.total_tokens || 0),
  }
}

export function createRunGroup(
  db: BetterSqlite3.Database,
  options: RunGroupCreateOptions = {},
): DbRunGroup {
  const id = options.id || uuidv4()
  const now = new Date().toISOString()
  const status = options.status || 'pending'
  db.prepare(`
    INSERT INTO run_groups (
      id, name, status, project_path, base_branch, execution_mode, coordination_mode, requires_git, workspace_root,
      provider, model, permission_mode,
      session_count, completed_count, failed_count, total_cost, total_tokens, config_json,
      created_at, started_at, completed_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    id,
    options.name ?? null,
    status,
    options.projectPath ?? null,
    options.baseBranch ?? null,
    options.executionMode ?? 'worktree',
    options.coordinationMode ?? 'flat',
    options.requiresGit === false ? 0 : 1,
    options.workspaceRoot ?? null,
    options.provider ?? null,
    options.model ?? null,
    options.permissionMode ?? null,
    options.sessionCount ?? 0,
    options.completedCount ?? 0,
    options.failedCount ?? 0,
    options.totalCost ?? 0,
    options.totalTokens ?? 0,
    options.configJson ?? null,
    now,
    options.startedAt ?? null,
    options.completedAt ?? null,
    now,
  )

  return getRunGroup(db, id)!
}

export function getRunGroup(db: BetterSqlite3.Database, runGroupId: string): DbRunGroup | null {
  const row = db.prepare('SELECT * FROM run_groups WHERE id = ?').get(runGroupId) as DbRunGroup | undefined
  return row ? mapDbRunGroup(row) : null
}

export function listRunGroups(
  db: BetterSqlite3.Database,
  filters: RunGroupListFilters = {},
): DbRunGroup[] {
  let sql = 'SELECT * FROM run_groups WHERE 1=1'
  const params: Array<string | number> = []

  if (filters.projectPath) {
    sql += ' AND project_path = ?'
    params.push(filters.projectPath)
  }

  if (filters.status) {
    sql += ' AND status = ?'
    params.push(filters.status)
  }

  sql += ' ORDER BY created_at DESC'

  if (filters.limit && Number.isFinite(filters.limit)) {
    sql += ' LIMIT ?'
    params.push(filters.limit)
  }

  if (filters.offset && Number.isFinite(filters.offset)) {
    sql += ' OFFSET ?'
    params.push(filters.offset)
  }

  const rows = db.prepare(sql).all(...params) as DbRunGroup[]
  return rows.map(mapDbRunGroup)
}

export function updateRunGroupStatus(
  db: BetterSqlite3.Database,
  runGroupId: string,
  status: RunGroupStatus,
  extras: {
    startedAt?: string | null
    completedAt?: string | null
  } = {},
): DbRunGroup | null {
  const updates = ['status = ?', 'updated_at = ?']
  const values: Array<string | null> = [status, new Date().toISOString()]

  if (extras.startedAt !== undefined) {
    updates.push('started_at = ?')
    values.push(extras.startedAt)
  }
  if (extras.completedAt !== undefined) {
    updates.push('completed_at = ?')
    values.push(extras.completedAt)
  }

  values.push(runGroupId)
  db.prepare(`UPDATE run_groups SET ${updates.join(', ')} WHERE id = ?`).run(...values)
  return getRunGroup(db, runGroupId)
}

export function refreshRunGroupAggregates(
  db: BetterSqlite3.Database,
  runGroupId: string,
): DbRunGroup | null {
  const stats = db.prepare(`
    SELECT
      COUNT(*) AS session_count,
      SUM(CASE WHEN COALESCE(srs.status, '') = 'completed' THEN 1 ELSE 0 END) AS completed_count,
      SUM(CASE WHEN COALESCE(srs.status, '') IN ('error', 'crashed') THEN 1 ELSE 0 END) AS failed_count,
      COALESCE(SUM(COALESCE(srs.cost_total, s.total_cost, 0)), 0) AS total_cost,
      COALESCE(SUM(COALESCE(
        srs.tokens_total,
        (COALESCE(s.total_input_tokens, 0) + COALESCE(s.total_output_tokens, 0)),
        0
      )), 0) AS total_tokens
    FROM sessions s
    LEFT JOIN session_runtime_state srs ON srs.session_id = s.id
    WHERE s.run_group_id = ?
  `).get(runGroupId) as {
    session_count: number
    completed_count: number
    failed_count: number
    total_cost: number
    total_tokens: number
  } | undefined

  if (!stats) return getRunGroup(db, runGroupId)

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
    new Date().toISOString(),
    runGroupId,
  )

  return getRunGroup(db, runGroupId)
}
