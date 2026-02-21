/**
 * Database Session Operations
 *
 * CRUD operations and queries for sessions.
 */

import * as path from 'path'
import * as fsSync from 'fs'
import { homedir } from 'os'
import { v4 as uuidv4 } from 'uuid'
import * as git from 'isomorphic-git'
import type BetterSqlite3 from 'better-sqlite3'
import type {
  RudiSession,
  SessionCreateOptions,
  SessionUpdateData,
  ProviderId,
} from './sessions-v2'
import type { DbSession, DbSessionFilters, UsageStats } from './types'

// Re-export for backwards compatibility
export type { DbSessionFilters }

// ============================================================================
// Constants
// ============================================================================

const DEFAULT_MODEL = 'claude-sonnet-4-5-20250929'

// ============================================================================
// Helpers
// ============================================================================

/**
 * Get current git branch if in a git repo (synchronous version)
 * Note: This returns undefined and relies on async version for actual branch detection
 */
function getGitBranch(cwd: string): string | undefined {
  // Check if .git exists first (fast sync check)
  try {
    const gitPath = path.join(cwd, '.git')
    if (!fsSync.existsSync(gitPath)) {
      return undefined
    }
    // Use isomorphic-git to get branch (async, but we can't await here)
    // Return undefined for sync callers - use getGitBranchAsync for actual branch
    return undefined
  } catch {
    return undefined
  }
}

/**
 * Get current git branch asynchronously using isomorphic-git
 */
async function getGitBranchAsync(cwd: string): Promise<string | undefined> {
  try {
    const gitPath = path.join(cwd, '.git')
    // Check if .git exists
    try {
      fsSync.accessSync(gitPath)
    } catch {
      return undefined
    }

    const branch = await git.currentBranch({
      fs: fsSync,
      dir: cwd,
      fullname: false,
    })
    return branch || undefined
  } catch {
    return undefined
  }
}

/**
 * Map database row to RudiSession type
 */
function mapDbSessionToRudiSession(row: DbSession): RudiSession {
  // Compute resolvedNativeFilePath based on provider and storage path
  let resolvedNativeFilePath: string | undefined
  const nativeStoragePath = row.native_storage_path
  const provider = row.provider as ProviderId
  const providerSessionId = row.provider_session_id

  if (nativeStoragePath) {
    if (path.isAbsolute(nativeStoragePath)) {
      resolvedNativeFilePath = nativeStoragePath
    } else if (nativeStoragePath.startsWith('~')) {
      resolvedNativeFilePath = nativeStoragePath.replace('~', homedir())
    } else if (providerSessionId) {
      const home = homedir()
      switch (provider) {
        case 'claude':
          resolvedNativeFilePath = path.join(
            home,
            '.claude',
            'projects',
            nativeStoragePath,
            `${providerSessionId}.jsonl`
          )
          break
        case 'codex':
        case 'gemini':
          resolvedNativeFilePath = row.origin_native_file?.replace('~', home) || undefined
          break
      }
    }
  }

  return {
    id: row.id,
    provider,
    providerSessionId: row.provider_session_id,
    projectId: row.project_id,
    runGroupId: row.run_group_id,
    origin: row.origin as 'rudi' | 'provider-import' | 'mixed',
    originDetail: row.origin_imported_at ? {
      type: row.origin as 'rudi' | 'provider-import' | 'mixed',
      importedAt: row.origin_imported_at,
      nativeFile: row.origin_native_file || undefined,
    } : undefined,
    title: row.title_override || row.title || '',
    snippet: row.snippet || '',
    status: row.status as 'active' | 'archived' | 'deleted',
    model: row.model || 'claude-sonnet-4-5-20250929',  // Default model if NULL
    systemPrompt: row.system_prompt || undefined,
    inheritProjectPrompt: row.inherit_project_prompt === 0 ? false : true,
    createdAt: row.created_at,
    lastActiveAt: row.last_active_at,
    deletedAt: row.deleted_at || undefined,
    turns: row.turn_count,
    totalCost: row.total_cost,
    totalDurationMs: row.total_duration_ms,
    cwd: row.cwd || undefined,
    dirScope: (row.dir_scope as 'project' | 'home') || 'project',  // Default to 'project'
    gitBranch: row.git_branch || undefined,
    nativeStoragePath: row.native_storage_path || undefined,
    resolvedNativeFilePath,
    tags: [],
  }
}

// ============================================================================
// Session Operations
// ============================================================================

/**
 * List sessions with optional filters
 */
export function listSessions(db: BetterSqlite3.Database, filters: DbSessionFilters = {}): RudiSession[] {
  let sql = `SELECT * FROM sessions WHERE 1=1`
  const params: (string | number)[] = []

  if (filters.provider) {
    sql += ' AND provider = ?'
    params.push(filters.provider)
  }

  if (filters.projectId !== undefined) {
    if (filters.projectId === null) {
      sql += ' AND project_id IS NULL'
    } else {
      sql += ' AND project_id = ?'
      params.push(filters.projectId)
    }
  }

  if (filters.status) {
    sql += ' AND status = ?'
    params.push(filters.status)
  } else if (filters.excludeDeleted !== false) {
    sql += ' AND status != ?'
    params.push('deleted')
  }

  if (filters.origin) {
    sql += ' AND origin = ?'
    params.push(filters.origin)
  }

  if (filters.search) {
    sql += ' AND (title LIKE ? OR cwd LIKE ?)'
    params.push(`%${filters.search}%`, `%${filters.search}%`)
  }

  // Exclude warmup/meta sessions by default
  if (filters.excludeWarmup !== false) {
    sql += ' AND (is_warmup IS NULL OR is_warmup = 0)'
    sql += ' AND (is_sidechain IS NULL OR is_sidechain = 0)'
    sql += " AND (session_type IS NULL OR session_type = 'main')"
  }

  // Exclude empty sessions (0 turns) - these are typically internal CLI artifacts
  // like context summaries or queue operations with no actual conversation
  if (filters.excludeEmpty !== false) {
    sql += ' AND turn_count > 0'
  }

  sql += ' ORDER BY last_active_at DESC'

  if (filters.limit) {
    sql += ' LIMIT ?'
    params.push(filters.limit)
  }

  if (filters.offset) {
    sql += ' OFFSET ?'
    params.push(filters.offset)
  }

  const rows = db.prepare(sql).all(...params) as DbSession[]
  return rows.map(mapDbSessionToRudiSession)
}

/**
 * Count sessions matching filters (for pagination)
 */
export function countSessions(db: BetterSqlite3.Database, filters: DbSessionFilters = {}): number {
  let sql = `SELECT COUNT(*) as count FROM sessions WHERE 1=1`
  const params: (string | number)[] = []

  if (filters.provider) {
    sql += ' AND provider = ?'
    params.push(filters.provider)
  }

  if (filters.projectId !== undefined) {
    if (filters.projectId === null) {
      sql += ' AND project_id IS NULL'
    } else {
      sql += ' AND project_id = ?'
      params.push(filters.projectId)
    }
  }

  if (filters.status) {
    sql += ' AND status = ?'
    params.push(filters.status)
  } else if (filters.excludeDeleted !== false) {
    sql += ' AND status != ?'
    params.push('deleted')
  }

  if (filters.origin) {
    sql += ' AND origin = ?'
    params.push(filters.origin)
  }

  if (filters.search) {
    sql += ' AND (title LIKE ? OR cwd LIKE ?)'
    params.push(`%${filters.search}%`, `%${filters.search}%`)
  }

  // Exclude warmup/meta sessions by default
  if (filters.excludeWarmup !== false) {
    sql += ' AND (is_warmup IS NULL OR is_warmup = 0)'
    sql += ' AND (is_sidechain IS NULL OR is_sidechain = 0)'
    sql += " AND (session_type IS NULL OR session_type = 'main')"
  }

  // Exclude empty sessions (0 turns)
  if (filters.excludeEmpty !== false) {
    sql += ' AND turn_count > 0'
  }

  const result = db.prepare(sql).get(...params) as { count: number }
  return result.count
}

/**
 * Get a single session by ID
 */
export function getSession(db: BetterSqlite3.Database, id: string): RudiSession | null {
  const row = db.prepare('SELECT * FROM sessions WHERE id = ?').get(id) as DbSession | undefined
  return row ? mapDbSessionToRudiSession(row) : null
}

/**
 * Get a session by provider session ID
 * Excludes deleted sessions by default to match UNIQUE constraint behavior
 */
export function getSessionByProviderSessionId(
  db: BetterSqlite3.Database,
  providerSessionId: string,
  provider: ProviderId,
  includeDeleted = false
): RudiSession | null {
  const sql = includeDeleted
    ? 'SELECT * FROM sessions WHERE provider_session_id = ? AND provider = ?'
    : "SELECT * FROM sessions WHERE provider_session_id = ? AND provider = ? AND status != 'deleted'"
  const row = db.prepare(sql).get(providerSessionId, provider) as DbSession | undefined
  return row ? mapDbSessionToRudiSession(row) : null
}

/**
 * Find an unclaimed session - one that was created by RUDI
 * but hasn't been linked to a provider session ID yet.
 *
 * Criteria:
 * - Same provider
 * - origin = 'rudi' (created in our UI, not imported)
 * - provider_session_id IS NULL (not yet linked)
 * - status != 'deleted'
 * - created within the last 5 minutes (to avoid stale matches)
 * - cwd matches (to avoid matching wrong project)
 *
 * This is used by AgentService to claim sessions before SessionWatcher
 * can create duplicates from JSONL file detection.
 */
export function findUnclaimedSession(
  db: BetterSqlite3.Database,
  provider: ProviderId,
  cwd: string
): RudiSession | null {
  // Look for sessions created in the last 5 minutes
  const cutoffTime = new Date(Date.now() - 5 * 60 * 1000).toISOString()

  const sql = `
    SELECT * FROM sessions
    WHERE provider = ?
      AND origin = 'rudi'
      AND provider_session_id IS NULL
      AND status != 'deleted'
      AND cwd = ?
      AND created_at > ?
    ORDER BY created_at DESC
    LIMIT 1
  `
  const row = db.prepare(sql).get(provider, cwd, cutoffTime) as DbSession | undefined
  return row ? mapDbSessionToRudiSession(row) : null
}

/**
 * Link result from atomic claim operation
 */
export interface LinkProviderSessionResult {
  sessionId: string
  action: 'found' | 'claimed' | 'created'
}

/**
 * Atomically link a provider session ID to a session
 *
 * This is the SINGLE entry point for correlating provider sessions to RUDI sessions.
 * It handles the race condition between AgentService and SessionWatcher by using atomic SQL.
 *
 * Flow:
 * 1. Check if providerSessionId already linked → return existing session
 * 2. Try atomic claim of unclaimed rudi session (UPDATE with subquery)
 * 3. If no claim, create new session with INSERT OR IGNORE (handles concurrent creates)
 *
 * The unique index on (provider, provider_session_id) guarantees no duplicates.
 */
export function linkProviderSession(
  db: BetterSqlite3.Database,
  options: {
    provider: ProviderId
    providerSessionId: string
    cwd: string
    // Origin tracking - where this session came from
    origin?: 'rudi' | 'provider-import' | 'mixed'
    // Optional metadata for new session creation
    title?: string
    gitBranch?: string
    nativeStoragePath?: string
    parentSessionId?: string
    agentId?: string
    isSidechain?: boolean
    sessionType?: 'main' | 'agent' | 'task'
    slug?: string
    version?: string
    userType?: string
    isWarmup?: boolean
  }
): LinkProviderSessionResult {
  const { provider, providerSessionId, cwd } = options

  // 1. Check if already linked (fast path)
  const existing = getSessionByProviderSessionId(db, providerSessionId, provider)
  if (existing) {
    console.log('[DbSessions] Provider session already linked:', providerSessionId, '→', existing.id)
    return { sessionId: existing.id, action: 'found' }
  }

  // 2. Try atomic claim: UPDATE unclaimed session in one statement
  //    Uses subquery to find candidate and claim atomically
  //    IMPORTANT: Only MAIN sessions can claim rudi sessions.
  //    Agent sessions (agentId set or providerSessionId starts with 'agent-')
  //    should NOT claim - they create their own sessions with parent_session_id.
  const isAgentSession = options.agentId || options.sessionType === 'agent' ||
    providerSessionId.startsWith('agent-')
  const now = new Date().toISOString()

  if (!isAgentSession) {
    const cutoffTime = new Date(Date.now() - 5 * 60 * 1000).toISOString()

    const claimSql = `
      UPDATE sessions
      SET provider_session_id = ?,
          native_storage_path = COALESCE(?, native_storage_path),
          git_branch = COALESCE(?, git_branch),
          title = COALESCE(?, title),
          last_active_at = ?
      WHERE id = (
        SELECT id FROM sessions
        WHERE provider = ?
          AND origin = 'rudi'
          AND provider_session_id IS NULL
          AND status != 'deleted'
          AND cwd = ?
          AND created_at > ?
        ORDER BY created_at DESC
        LIMIT 1
      )
    `

    const claimResult = db.prepare(claimSql).run(
      providerSessionId,
      options.nativeStoragePath || null,
      options.gitBranch || null,
      options.title || null,
      now,
      provider,
      cwd,
      cutoffTime
    )

    if (claimResult.changes > 0) {
      // Claimed! Now find the session we just claimed
      const claimed = getSessionByProviderSessionId(db, providerSessionId, provider)
      if (claimed) {
        console.log('[DbSessions] Atomically claimed unclaimed session:', claimed.id, '→', providerSessionId)
        return { sessionId: claimed.id, action: 'claimed' }
      }
    }
  } else {
    console.log('[DbSessions] Skipping claim for agent session:', providerSessionId)
  }

  // 3. No unclaimed session found - create new with specified origin
  //    Use INSERT OR IGNORE to handle race with another caller
  //    Default to 'provider-import' for backward compatibility
  const id = uuidv4()
  const sessionType = options.sessionType || (options.agentId ? 'agent' : 'main')
  const origin = options.origin || 'provider-import'

  const insertSql = `
    INSERT OR IGNORE INTO sessions (
      id, provider, provider_session_id, origin, origin_imported_at, origin_native_file,
      title, status, cwd, git_branch, native_storage_path,
      created_at, last_active_at, turn_count, total_cost,
      parent_session_id, agent_id, is_sidechain, session_type, slug, version, user_type, is_warmup
    ) VALUES (?, ?, ?, ?, ?, ?, ?, 'active', ?, ?, ?, ?, ?, 0, 0.0, ?, ?, ?, ?, ?, ?, ?, ?)
  `

  const insertResult = db.prepare(insertSql).run(
    id,
    provider,
    providerSessionId,
    origin,  // Use the origin parameter instead of hardcoded value
    now,
    options.nativeStoragePath || null,
    options.title || 'Imported Session',
    cwd,
    options.gitBranch || null,
    options.nativeStoragePath || null,
    now,
    now,
    options.parentSessionId || null,
    options.agentId || null,
    options.isSidechain ? 1 : 0,
    sessionType,
    options.slug || null,
    options.version || null,
    options.userType || null,
    options.isWarmup ? 1 : 0
  )

  if (insertResult.changes > 0) {
    console.log(`[DbSessions] Created new ${origin} session:`, id, 'for', providerSessionId)
    return { sessionId: id, action: 'created' }
  }

  // INSERT OR IGNORE did nothing - another caller created it. Fetch and return.
  const raced = getSessionByProviderSessionId(db, providerSessionId, provider)
  if (raced) {
    console.log('[DbSessions] Race resolved - returning existing:', raced.id)
    return { sessionId: raced.id, action: 'found' }
  }

  // Should never happen due to unique index, but defensive
  throw new Error(`Failed to link provider session: ${providerSessionId}`)
}

/**
 * Create a new session
 *
 * Uses INSERT ... ON CONFLICT DO NOTHING to handle race conditions.
 * If a session with the same (provider, provider_session_id) already exists,
 * returns the existing session instead of creating a duplicate.
 */
export function createSession(db: BetterSqlite3.Database, options: SessionCreateOptions): RudiSession {
  const now = new Date().toISOString()
  const cwdPath = options.cwd || homedir()

  // Derive native storage path based on provider
  let nativeStoragePath: string | undefined
  if (options.nativeStoragePath) {
    nativeStoragePath = options.nativeStoragePath
  } else if (options.provider === 'claude') {
    nativeStoragePath = cwdPath.replace(/[/ ]/g, '-')
  } else if (options.provider === 'gemini' && options.providerSessionId) {
    nativeStoragePath = options.providerSessionId
  }

  // If providerSessionId is provided, check for existing session first
  // This avoids generating a new UUID if we're going to return an existing session
  if (options.providerSessionId) {
    const existing = getSessionByProviderSessionId(db, options.providerSessionId, options.provider || 'claude')
    if (existing) {
      console.log('[DbSessions] Session already exists for provider_session_id:', options.providerSessionId, '→', existing.id)
      return existing
    }
  }

  const id = uuidv4()
  const origin = options.origin || 'rudi'

  // Use INSERT OR IGNORE to handle race conditions where another process
  // inserts the same (provider, provider_session_id) between our check and insert
  const stmt = db.prepare(`
    INSERT OR IGNORE INTO sessions (
      id, provider, provider_session_id, project_id,
      run_group_id,
      origin, origin_imported_at, origin_native_file,
      title, snippet, status, model, system_prompt, inherit_project_prompt,
      cwd, git_branch, native_storage_path,
      created_at, last_active_at,
      turn_count, total_cost, total_input_tokens, total_output_tokens, total_duration_ms,
      parent_session_id, agent_id, is_sidechain, session_type, slug, version, user_type,
      is_warmup
    ) VALUES (
      ?, ?, ?, ?,
      ?,
      ?, ?, ?,
      ?, ?, ?, ?, ?, ?,
      ?, ?, ?,
      ?, ?,
      ?, ?, ?, ?, ?,
      ?, ?, ?, ?, ?, ?, ?,
      ?
    )
  `)

  const result = stmt.run(
    id,
    options.provider,
    options.providerSessionId ?? null,
    options.projectId ?? null,
    options.runGroupId ?? null,
    origin,
    options.originDetail?.importedAt ?? null,
    options.originDetail?.nativeFile ?? null,
    options.title || 'New Session',
    '',
    'active',
    options.model || DEFAULT_MODEL,
    options.systemPrompt ?? null,
    options.inheritProjectPrompt === undefined ? 1 : (options.inheritProjectPrompt ? 1 : 0),
    cwdPath,
    options.gitBranch || getGitBranch(cwdPath) || null,
    nativeStoragePath ?? null,
    now,
    now,
    0, 0, 0, 0, 0,
    // v4 columns
    options.parentSessionId ?? null,
    options.agentId ?? null,
    options.isSidechain ? 1 : 0,
    options.sessionType ?? 'main',
    options.slug ?? null,
    options.version ?? null,
    options.userType ?? null,
    options.isWarmup ? 1 : 0
  )

  // If no rows were inserted (conflict occurred), return the existing session
  if (result.changes === 0 && options.providerSessionId) {
    const existing = getSessionByProviderSessionId(db, options.providerSessionId, options.provider || 'claude')
    if (existing) {
      console.log('[DbSessions] Race condition resolved - returning existing session:', existing.id)
      return existing
    }
    // This shouldn't happen, but fall through to return the new session attempt
    console.warn('[DbSessions] INSERT OR IGNORE returned 0 changes but no existing session found')
  }

  console.log('[DbSessions] Created session:', id, 'provider:', options.provider)

  return getSession(db, id)!
}

/**
 * Update a session
 */
export function updateSession(db: BetterSqlite3.Database, sessionId: string, data: SessionUpdateData): void {
  const updates: string[] = []
  const values: (string | number | null)[] = []

  if (data.title !== undefined) {
    updates.push('title = ?')
    values.push(data.title)
  }
  if (data.title_override !== undefined) {
    updates.push('title_override = ?')
    values.push(data.title_override)
  }
  if (data.systemPrompt !== undefined) {
    updates.push('system_prompt = ?')
    values.push(data.systemPrompt.trim() ? data.systemPrompt : null)
  }
  if (data.inheritProjectPrompt !== undefined) {
    updates.push('inherit_project_prompt = ?')
    values.push(data.inheritProjectPrompt ? 1 : 0)
  }
  if (data.snippet !== undefined) {
    updates.push('snippet = ?')
    values.push(data.snippet)
  }
  if (data.status !== undefined) {
    updates.push('status = ?')
    values.push(data.status)
  }
  if (data.projectId !== undefined) {
    updates.push('project_id = ?')
    values.push(data.projectId)
  }
  if (data.model !== undefined) {
    updates.push('model = ?')
    values.push(data.model)
  }
  if (data.providerSessionId !== undefined) {
    // Check for conflict: another session already has this provider_session_id
    // Get current session's provider to query correctly
    const currentSession = getSession(db, sessionId)
    if (currentSession) {
      const existing = getSessionByProviderSessionId(db, data.providerSessionId, currentSession.provider)
      if (existing && existing.id !== sessionId) {
        // Another session already owns this provider_session_id (race condition)
        // Log and skip rather than throw UNIQUE constraint error
        console.warn('[DbSessions] Skipping update: provider_session_id', data.providerSessionId, 'already claimed by session', existing.id)
        // Remove providerSessionId from this update to avoid constraint violation
        // Continue with other updates if any
      } else {
        updates.push('provider_session_id = ?')
        values.push(data.providerSessionId)
      }
    }
  }
  if (data.nativeStoragePath !== undefined) {
    updates.push('native_storage_path = ?')
    values.push(data.nativeStoragePath)
  }
  if (data.origin !== undefined) {
    updates.push('origin = ?')
    values.push(data.origin)
  }
  if (data.originDetail !== undefined) {
    updates.push('origin_imported_at = ?')
    values.push(data.originDetail?.importedAt ?? null)
    updates.push('origin_native_file = ?')
    values.push(data.originDetail?.nativeFile ?? null)
  }
  if (data.turns !== undefined) {
    updates.push('turn_count = ?')
    values.push(data.turns)
  }
  if (data.totalCost !== undefined) {
    updates.push('total_cost = ?')
    // Normalize SessionCost to number for database storage
    const costValue = typeof data.totalCost === 'number' ? data.totalCost : data.totalCost.totalUsd
    values.push(costValue)
  }
  if (data.totalDurationMs !== undefined) {
    updates.push('total_duration_ms = ?')
    values.push(data.totalDurationMs)
  }
  if (data.lastActiveAt !== undefined) {
    updates.push('last_active_at = ?')
    values.push(data.lastActiveAt)
  }
  if (data.deletedAt !== undefined) {
    updates.push('deleted_at = ?')
    values.push(data.deletedAt)
  }

  if (updates.length === 0) {
    return
  }

  values.push(sessionId)
  const sql = `UPDATE sessions SET ${updates.join(', ')} WHERE id = ?`
  db.prepare(sql).run(...values)

  console.log('[DbSessions] Updated session:', sessionId)
}

/**
 * Soft delete a session (mark as deleted with timestamp)
 */
export function deleteSession(db: BetterSqlite3.Database, sessionId: string): void {
  updateSession(db, sessionId, {
    status: 'deleted',
    deletedAt: new Date().toISOString(),
  })
  console.log('[DbSessions] Soft deleted session:', sessionId)
}

/**
 * Hard delete a session from the database
 */
export function hardDeleteSession(db: BetterSqlite3.Database, sessionId: string): void {
  db.prepare('DELETE FROM sessions WHERE id = ?').run(sessionId)
  console.log('[DbSessions] Hard deleted session:', sessionId)
}

/**
 * List sessions by project ID
 */
export function listSessionsByProject(
  db: BetterSqlite3.Database,
  projectId: string | null,
  provider?: ProviderId
): RudiSession[] {
  return listSessions(db, {
    projectId,
    provider,
    excludeDeleted: true,
  })
}

/**
 * Get Inbox sessions (projectId === null) for a provider
 */
export function getInboxSessions(db: BetterSqlite3.Database, provider?: ProviderId): RudiSession[] {
  return listSessionsByProject(db, null, provider)
}

/**
 * Move a session to a different project
 */
export function moveSessionToProject(db: BetterSqlite3.Database, sessionId: string, projectId: string | null): void {
  updateSession(db, sessionId, { projectId })
  console.log('[DbSessions] Moved session:', sessionId, 'to project:', projectId || 'Inbox')
}

// ============================================================================
// Statistics
// ============================================================================

/**
 * Get comprehensive usage statistics
 */
export function getStats(db: BetterSqlite3.Database): UsageStats {
  const totals = db.prepare(`
    SELECT
      COUNT(*) as total_sessions,
      SUM(turn_count) as total_turns,
      SUM(total_cost) as total_cost,
      SUM(total_input_tokens) as total_input_tokens,
      SUM(total_output_tokens) as total_output_tokens
    FROM sessions
    WHERE status != 'deleted'
  `).get() as {
    total_sessions: number
    total_turns: number
    total_cost: number
    total_input_tokens: number
    total_output_tokens: number
  }

  const byProvider = db.prepare(`
    SELECT
      provider,
      COUNT(*) as sessions,
      SUM(turn_count) as turns,
      SUM(total_cost) as cost,
      SUM(total_input_tokens) as input_tokens,
      SUM(total_output_tokens) as output_tokens
    FROM sessions
    WHERE status != 'deleted'
    GROUP BY provider
    ORDER BY cost DESC
  `).all() as Array<{
    provider: string
    sessions: number
    turns: number
    cost: number
    input_tokens: number
    output_tokens: number
  }>

  const byModel = db.prepare(`
    SELECT
      model,
      COUNT(*) as turns,
      SUM(cost) as cost,
      SUM(input_tokens) as input_tokens,
      SUM(output_tokens) as output_tokens
    FROM turns
    WHERE model IS NOT NULL
    GROUP BY model
    ORDER BY cost DESC
    LIMIT 10
  `).all() as Array<{
    model: string
    turns: number
    cost: number
    input_tokens: number
    output_tokens: number
  }>

  const recentActivity = db.prepare(`
    SELECT
      DATE(last_active_at) as date,
      COUNT(*) as sessions,
      SUM(total_cost) as cost,
      SUM(turn_count) as turns
    FROM sessions
    WHERE last_active_at > datetime('now', '-30 days')
      AND status != 'deleted'
    GROUP BY DATE(last_active_at)
    ORDER BY date DESC
  `).all() as Array<{
    date: string
    sessions: number
    cost: number
    turns: number
  }>

  return {
    totalSessions: totals.total_sessions || 0,
    totalTurns: totals.total_turns || 0,
    totalCost: totals.total_cost || 0,
    totalInputTokens: totals.total_input_tokens || 0,
    totalOutputTokens: totals.total_output_tokens || 0,
    byProvider: byProvider.reduce((acc, row) => {
      acc[row.provider] = {
        sessions: row.sessions,
        turns: row.turns || 0,
        cost: row.cost || 0,
        inputTokens: row.input_tokens || 0,
        outputTokens: row.output_tokens || 0,
      }
      return acc
    }, {} as Record<string, { sessions: number; turns: number; cost: number; inputTokens: number; outputTokens: number }>),
    byModel: byModel.map(row => ({
      model: row.model,
      turns: row.turns,
      cost: row.cost || 0,
      inputTokens: row.input_tokens || 0,
      outputTokens: row.output_tokens || 0,
    })),
    recentActivity,
  }
}
