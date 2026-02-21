/**
 * Database Turn Operations
 *
 * CRUD operations for turns with automatic session aggregate updates.
 */

import { v4 as uuidv4 } from 'uuid'
import type BetterSqlite3 from 'better-sqlite3'
import type { TurnEvent, ProviderId } from './sessions-v2'
import type { DbTurn, TurnCreateOptions, TurnUpdateOptions, SearchResult, SessionSearchResult } from './types'

// ============================================================================
// Statement Cache (per-connection, cleared on DB close/migrations)
// ============================================================================

let statementCache: Map<string, BetterSqlite3.Statement> | null = null

function getStatement(
  db: BetterSqlite3.Database,
  key: string,
  sql: string
): BetterSqlite3.Statement {
  if (!statementCache) {
    statementCache = new Map()
  }
  if (!statementCache.has(key)) {
    statementCache.set(key, db.prepare(sql))
  }
  return statementCache.get(key)!
}

/**
 * Clear statement cache (call on DB close or after migrations)
 */
export function clearStatementCache(): void {
  statementCache = null
}

// ============================================================================
// Pricing Cache (in-memory, avoids per-turn DB queries)
// ============================================================================

export interface PricingEntry {
  provider: string | null
  modelPattern: string
  inputCostPerMtok: number
  outputCostPerMtok: number
  cacheReadCostPerMtok: number
  cacheWriteCostPerMtok: number
}

export type PricingMap = PricingEntry[]

/**
 * Load all pricing entries into memory for fast lookup
 * Call once per sync batch, not per turn
 */
export function getPricingMap(db: BetterSqlite3.Database): PricingMap {
  const rows = db.prepare(`
    SELECT
      provider,
      model_pattern,
      COALESCE(input_cost_per_mtok, 0) as input_cost_per_mtok,
      COALESCE(output_cost_per_mtok, 0) as output_cost_per_mtok,
      COALESCE(cache_read_cost_per_mtok, 0) as cache_read_cost_per_mtok,
      COALESCE(cache_write_cost_per_mtok, 0) as cache_write_cost_per_mtok
    FROM model_pricing
    ORDER BY
      (provider IS NOT NULL) DESC,
      LENGTH(model_pattern) DESC,
      effective_from DESC
  `).all() as Array<{
    provider: string | null
    model_pattern: string
    input_cost_per_mtok: number
    output_cost_per_mtok: number
    cache_read_cost_per_mtok: number
    cache_write_cost_per_mtok: number
  }>

  return rows.map(row => ({
    provider: row.provider,
    modelPattern: row.model_pattern,
    inputCostPerMtok: row.input_cost_per_mtok,
    outputCostPerMtok: row.output_cost_per_mtok,
    cacheReadCostPerMtok: row.cache_read_cost_per_mtok,
    cacheWriteCostPerMtok: row.cache_write_cost_per_mtok,
  }))
}

/**
 * Calculate cost from in-memory pricing map (no DB query)
 */
export function calculateCostFromPricing(
  pricing: PricingMap,
  provider: string | undefined,
  model: string | undefined,
  inputTokens: number | undefined,
  outputTokens: number | undefined,
  cacheReadTokens?: number,
  cacheCreationTokens?: number
): number {
  if (!model || (!inputTokens && !outputTokens && !cacheReadTokens && !cacheCreationTokens)) {
    return 0
  }

  // Find matching pricing entry (already sorted by specificity)
  const entry = pricing.find(p => {
    if (p.provider !== null && p.provider !== (provider || 'claude')) {
      return false
    }
    // model_pattern uses SQL LIKE patterns - convert to regex
    const pattern = p.modelPattern
      .replace(/%/g, '.*')
      .replace(/_/g, '.')
    return new RegExp(`^${pattern}$`).test(model)
  })

  if (!entry) {
    return 0
  }

  const input = (inputTokens || 0) * entry.inputCostPerMtok / 1_000_000
  const output = (outputTokens || 0) * entry.outputCostPerMtok / 1_000_000
  const cacheRead = (cacheReadTokens || 0) * entry.cacheReadCostPerMtok / 1_000_000
  const cacheWrite = (cacheCreationTokens || 0) * entry.cacheWriteCostPerMtok / 1_000_000

  return input + output + cacheRead + cacheWrite
}

// ============================================================================
// Helpers
// ============================================================================

/**
 * Map database row to TurnEvent type
 */
function mapDbTurnToTurnEvent(row: DbTurn): TurnEvent {
  return {
    id: row.id,
    ts: row.ts,
    tsMs: row.ts_ms ?? undefined,
    provider: row.provider as ProviderId,
    sessionId: row.session_id,
    providerSessionId: row.provider_session_id,
    providerTurnId: row.provider_turn_id ?? undefined,
    kind: row.kind ?? 'message',
    model: row.model || '',
    permissionMode: row.permission_mode ?? undefined,
    systemPrompt: row.system_prompt ?? undefined,
    userMessage: row.user_message || '',
    assistantResponse: row.assistant_response ?? undefined,
    thinking: row.thinking ?? undefined,
    turnNumber: row.turn_number,
    // Use ?? for numeric fields to preserve 0 values (|| would convert 0 to undefined)
    cost: row.cost ?? undefined,
    durationMs: row.duration_ms ?? undefined,
    durationApiMs: row.duration_api_ms ?? undefined,
    inputTokens: row.input_tokens ?? undefined,
    outputTokens: row.output_tokens ?? undefined,
    cacheReadTokens: row.cache_read_tokens ?? undefined,
    cacheCreationTokens: row.cache_creation_tokens ?? undefined,
    finishReason: row.finish_reason ?? undefined,
    error: row.error ?? undefined,
    toolsUsed: row.tools_used ? JSON.parse(row.tools_used) : undefined,
    toolResults: row.tool_results ? JSON.parse(row.tool_results) : undefined,
  }
}

// ============================================================================
// Session Aggregate Updates
// ============================================================================

/**
 * Calculate cost for a turn based on model pricing
 * Returns cost in dollars, or 0 if model not found
 */
export function calculateTurnCost(
  db: BetterSqlite3.Database,
  provider: string | undefined,
  model: string | undefined,
  inputTokens: number | undefined,
  outputTokens: number | undefined,
  cacheReadTokens?: number,
  cacheCreationTokens?: number
): number {
  if (!model || (!inputTokens && !outputTokens && !cacheReadTokens && !cacheCreationTokens)) {
    return 0
  }

  // Look up pricing with provider filter for specificity
  // model_pattern uses SQL LIKE patterns (e.g., 'claude-opus-4-5-%')
  // Order by pattern length DESC to prefer more specific matches
  const pricing = db.prepare(`
    SELECT
      COALESCE(input_cost_per_mtok, 0) as input_cost_per_mtok,
      COALESCE(output_cost_per_mtok, 0) as output_cost_per_mtok,
      COALESCE(cache_read_cost_per_mtok, 0) as cache_read_cost_per_mtok,
      COALESCE(cache_write_cost_per_mtok, 0) as cache_write_cost_per_mtok
    FROM model_pricing
    WHERE (provider = ? OR provider IS NULL)
      AND ? LIKE model_pattern
    ORDER BY
      (provider IS NOT NULL) DESC,
      LENGTH(model_pattern) DESC,
      effective_from DESC
    LIMIT 1
  `).get(provider || 'claude', model) as {
    input_cost_per_mtok: number
    output_cost_per_mtok: number
    cache_read_cost_per_mtok: number
    cache_write_cost_per_mtok: number
  } | undefined

  if (!pricing) {
    return 0
  }

  const input = (inputTokens || 0) * pricing.input_cost_per_mtok / 1_000_000
  const output = (outputTokens || 0) * pricing.output_cost_per_mtok / 1_000_000
  const cacheRead = (cacheReadTokens || 0) * pricing.cache_read_cost_per_mtok / 1_000_000
  const cacheWrite = (cacheCreationTokens || 0) * pricing.cache_write_cost_per_mtok / 1_000_000

  return input + output + cacheRead + cacheWrite
}

/**
 * Update session aggregates after adding turns (incremental, supports batches)
 * Use this for batched inserts to avoid O(n) table scan
 */
export function incrementSessionAggregates(
  db: BetterSqlite3.Database,
  sessionId: string,
  delta: {
    turnCount: number
    cost: number
    durationMs: number
    inputTokens: number
    outputTokens: number
  }
): void {
  const now = new Date().toISOString()

  db.prepare(`
    UPDATE sessions SET
      turn_count = turn_count + ?,
      total_cost = total_cost + ?,
      total_duration_ms = total_duration_ms + ?,
      total_input_tokens = total_input_tokens + ?,
      total_output_tokens = total_output_tokens + ?,
      last_active_at = ?
    WHERE id = ?
  `).run(
    delta.turnCount,
    delta.cost,
    delta.durationMs,
    delta.inputTokens,
    delta.outputTokens,
    now,
    sessionId
  )
}

/**
 * Decrement session aggregates after removing a turn (incremental)
 */
function decrementSessionAggregates(
  db: BetterSqlite3.Database,
  sessionId: string,
  metrics: { cost: number; durationMs: number; inputTokens: number; outputTokens: number }
): void {
  db.prepare(`
    UPDATE sessions SET
      turn_count = MAX(0, turn_count - 1),
      total_cost = MAX(0, total_cost - ?),
      total_duration_ms = MAX(0, total_duration_ms - ?),
      total_input_tokens = MAX(0, total_input_tokens - ?),
      total_output_tokens = MAX(0, total_output_tokens - ?)
    WHERE id = ?
  `).run(
    metrics.cost,
    metrics.durationMs,
    metrics.inputTokens,
    metrics.outputTokens,
    sessionId
  )
}

/**
 * Recompute session aggregates from all turns (full recalculation)
 * Use this when incremental updates might be out of sync (debounced fallback)
 */
export function recomputeSessionAggregates(db: BetterSqlite3.Database, sessionId: string): void {
  const result = db.prepare(`
    SELECT
      COUNT(*) as turn_count,
      COALESCE(SUM(cost), 0) as total_cost,
      COALESCE(SUM(duration_ms), 0) as total_duration_ms,
      COALESCE(SUM(input_tokens), 0) as total_input_tokens,
      COALESCE(SUM(output_tokens), 0) as total_output_tokens,
      MAX(ts) as last_active_at
    FROM turns
    WHERE session_id = ?
  `).get(sessionId) as {
    turn_count: number
    total_cost: number
    total_duration_ms: number
    total_input_tokens: number
    total_output_tokens: number
    last_active_at: string | null
  }

  db.prepare(`
    UPDATE sessions SET
      turn_count = ?,
      total_cost = ?,
      total_duration_ms = ?,
      total_input_tokens = ?,
      total_output_tokens = ?,
      last_active_at = COALESCE(?, last_active_at)
    WHERE id = ?
  `).run(
    result.turn_count,
    result.total_cost,
    result.total_duration_ms,
    result.total_input_tokens,
    result.total_output_tokens,
    result.last_active_at,
    sessionId
  )

  console.log('[DbTurns] Recomputed aggregates for session:', sessionId, result)
}

// ============================================================================
// Turn CRUD Operations
// ============================================================================

/**
 * Get turns for a session
 * Orders by ts_ms (chronological) with fallback to turn_number for legacy data
 * Nulls are sorted last to keep legacy data at the end rather than the beginning
 */
export function getTurnsForSession(db: BetterSqlite3.Database, sessionId: string): TurnEvent[] {
  const rows = db.prepare(`
    SELECT * FROM turns WHERE session_id = ?
    ORDER BY (ts_ms IS NULL), ts_ms ASC, turn_number ASC, id ASC
  `).all(sessionId) as DbTurn[]

  return rows.map(mapDbTurnToTurnEvent)
}

/**
 * Query turns with optional filters (date range, provider, model, etc.)
 * This is much more efficient than iterating sessions
 */
export function queryTurns(
  db: BetterSqlite3.Database,
  filters?: {
    dateFrom?: string
    dateTo?: string
    provider?: string
    model?: string
    origin?: string // 'rudi' | 'provider-import'
  }
): TurnEvent[] {
  // Filter out system events/commands that don't have a model (warmup, interrupts, etc.)
  // Only include turns with actual AI model interactions
  let sql = 'SELECT t.* FROM turns t LEFT JOIN sessions s ON t.session_id = s.id WHERE t.model IS NOT NULL AND t.model != \'\''
  const params: any[] = []

  if (filters?.dateFrom) {
    sql += ' AND t.ts >= ?'
    params.push(filters.dateFrom)
  }

  if (filters?.dateTo) {
    sql += ' AND t.ts <= ?'
    params.push(filters.dateTo)
  }

  if (filters?.provider) {
    sql += ' AND t.provider = ?'
    params.push(filters.provider)
  }

  if (filters?.model) {
    sql += ' AND t.model = ?'
    params.push(filters.model)
  }

  if (filters?.origin) {
    sql += ' AND s.origin = ?'
    params.push(filters.origin)
  }

  sql += ' ORDER BY t.ts DESC'

  console.log('[DB:turns] queryTurns:', { sql, params })
  const rows = db.prepare(sql).all(...params) as DbTurn[]
  console.log('[DB:turns] queryTurns returned', rows.length, 'rows')
  return rows.map(mapDbTurnToTurnEvent)
}

/**
 * Get a single turn by ID
 */
export function getTurn(db: BetterSqlite3.Database, turnId: string): TurnEvent | null {
  const row = db.prepare('SELECT * FROM turns WHERE id = ?').get(turnId) as DbTurn | undefined
  return row ? mapDbTurnToTurnEvent(row) : null
}

/**
 * Get a turn by session ID and turn number
 */
export function getTurnByNumber(
  db: BetterSqlite3.Database,
  sessionId: string,
  turnNumber: number
): TurnEvent | null {
  const row = db.prepare(
    'SELECT * FROM turns WHERE session_id = ? AND turn_number = ?'
  ).get(sessionId, turnNumber) as DbTurn | undefined
  return row ? mapDbTurnToTurnEvent(row) : null
}

/**
 * Create a new turn
 */
export function createTurn(db: BetterSqlite3.Database, options: TurnCreateOptions): TurnEvent {
  const id = uuidv4()
  const ts = options.ts ?? new Date().toISOString()
  // Compute ts_ms from ISO string for chronological ordering
  const tsMs = new Date(ts).getTime()

  const stmt = db.prepare(`
    INSERT INTO turns (
      id, session_id, provider, provider_session_id, provider_turn_id, turn_number,
      user_message, assistant_response, thinking,
      model, permission_mode, system_prompt,
      cost, duration_ms, duration_api_ms,
      input_tokens, output_tokens, cache_read_tokens, cache_creation_tokens,
      finish_reason, error, tools_used, tool_results, kind, ts, ts_ms
    ) VALUES (
      ?, ?, ?, ?, ?, ?,
      ?, ?, ?,
      ?, ?, ?,
      ?, ?, ?,
      ?, ?, ?, ?,
      ?, ?, ?, ?, ?, ?, ?
    )
  `)

  // Convert error to string if boolean
  const errorValue = typeof options.error === 'boolean'
    ? (options.error ? 'true' : null)
    : (options.error ?? null)

  stmt.run(
    id,
    options.sessionId,
    options.provider,
    options.providerSessionId ?? null,
    options.providerTurnId ?? null,
    options.turnNumber,
    options.userMessage ?? null,
    options.assistantResponse ?? null,
    options.thinking ?? null,
    options.model ?? null,
    options.permissionMode ?? null,
    options.systemPrompt ?? null,
    options.cost ?? null,
    options.durationMs ?? null,
    options.durationApiMs ?? null,
    options.inputTokens ?? null,
    options.outputTokens ?? null,
    options.cacheReadTokens ?? null,
    options.cacheCreationTokens ?? null,
    options.finishReason ?? null,
    errorValue,
    options.toolsUsed ? JSON.stringify(options.toolsUsed) : null,
    options.toolResults ? JSON.stringify(options.toolResults) : null,
    options.kind ?? 'message',
    ts,
    tsMs
  )

  console.log('[DbTurns] Created turn:', id, 'session:', options.sessionId, 'turn#:', options.turnNumber, 'kind:', options.kind ?? 'message', 'providerTurnId:', options.providerTurnId)

  // Update session aggregates incrementally
  incrementSessionAggregates(db, options.sessionId, {
    turnCount: 1,
    cost: options.cost ?? 0,
    durationMs: options.durationMs ?? 0,
    inputTokens: options.inputTokens ?? 0,
    outputTokens: options.outputTokens ?? 0,
  })

  return getTurn(db, id)!
}

/**
 * Upsert a turn (idempotent write using providerTurnId for dedup)
 * If a turn with the same sessionId + providerTurnId exists, update it.
 * Otherwise, create a new turn.
 * Returns { created: boolean, turn: TurnEvent }
 */
export function upsertTurn(
  db: BetterSqlite3.Database,
  options: TurnCreateOptions
): { created: boolean; turn: TurnEvent } {
  // If no providerTurnId, fall back to regular create (no dedup possible)
  if (!options.providerTurnId) {
    const turn = createTurn(db, options)
    return { created: true, turn }
  }

  // Check if turn already exists
  const existing = db.prepare(`
    SELECT id FROM turns
    WHERE session_id = ? AND provider_turn_id = ?
  `).get(options.sessionId, options.providerTurnId) as { id: string } | undefined

  if (existing) {
    // Update existing turn
    const updated = updateTurn(db, existing.id, {
      userMessage: options.userMessage,
      assistantResponse: options.assistantResponse,
      thinking: options.thinking,
      model: options.model,
      cost: options.cost,
      durationMs: options.durationMs,
      durationApiMs: options.durationApiMs,
      inputTokens: options.inputTokens,
      outputTokens: options.outputTokens,
      cacheReadTokens: options.cacheReadTokens,
      cacheCreationTokens: options.cacheCreationTokens,
      finishReason: options.finishReason,
      error: options.error,
      toolsUsed: options.toolsUsed,
      toolResults: options.toolResults,
    })
    console.log('[DbTurns] Upserted (updated) turn:', existing.id, 'providerTurnId:', options.providerTurnId)
    return { created: false, turn: updated! }
  }

  // Create new turn
  const turn = createTurn(db, options)
  console.log('[DbTurns] Upserted (created) turn:', turn.id, 'providerTurnId:', options.providerTurnId)
  return { created: true, turn }
}

/**
 * Find turn by provider turn ID
 */
export function getTurnByProviderTurnId(
  db: BetterSqlite3.Database,
  sessionId: string,
  providerTurnId: string
): TurnEvent | null {
  const row = db.prepare(`
    SELECT * FROM turns
    WHERE session_id = ? AND provider_turn_id = ?
  `).get(sessionId, providerTurnId) as DbTurn | undefined
  return row ? mapDbTurnToTurnEvent(row) : null
}

/**
 * Update an existing turn
 * This adjusts session aggregates based on the delta between old and new values
 */
export function updateTurn(
  db: BetterSqlite3.Database,
  turnId: string,
  data: TurnUpdateOptions
): TurnEvent | null {
  // Get current turn to calculate delta
  const currentTurn = getTurn(db, turnId)
  if (!currentTurn) {
    console.warn('[DbTurns] Cannot update non-existent turn:', turnId)
    return null
  }

  const updates: string[] = []
  const values: (string | number | null)[] = []

  if (data.userMessage !== undefined) {
    updates.push('user_message = ?')
    values.push(data.userMessage)
  }
  if (data.assistantResponse !== undefined) {
    updates.push('assistant_response = ?')
    values.push(data.assistantResponse)
  }
  if (data.thinking !== undefined) {
    updates.push('thinking = ?')
    values.push(data.thinking)
  }
  if (data.model !== undefined) {
    updates.push('model = ?')
    values.push(data.model)
  }
  if (data.cost !== undefined) {
    updates.push('cost = ?')
    values.push(data.cost)
  }
  if (data.durationMs !== undefined) {
    updates.push('duration_ms = ?')
    values.push(data.durationMs)
  }
  if (data.durationApiMs !== undefined) {
    updates.push('duration_api_ms = ?')
    values.push(data.durationApiMs)
  }
  if (data.inputTokens !== undefined) {
    updates.push('input_tokens = ?')
    values.push(data.inputTokens)
  }
  if (data.outputTokens !== undefined) {
    updates.push('output_tokens = ?')
    values.push(data.outputTokens)
  }
  if (data.cacheReadTokens !== undefined) {
    updates.push('cache_read_tokens = ?')
    values.push(data.cacheReadTokens)
  }
  if (data.cacheCreationTokens !== undefined) {
    updates.push('cache_creation_tokens = ?')
    values.push(data.cacheCreationTokens)
  }
  if (data.finishReason !== undefined) {
    updates.push('finish_reason = ?')
    values.push(data.finishReason)
  }
  if (data.error !== undefined) {
    updates.push('error = ?')
    const errorValue = typeof data.error === 'boolean'
      ? (data.error ? 'true' : null)
      : (data.error ?? null)
    values.push(errorValue)
  }
  if (data.toolsUsed !== undefined) {
    updates.push('tools_used = ?')
    values.push(data.toolsUsed ? JSON.stringify(data.toolsUsed) : null)
  }
  if (data.toolResults !== undefined) {
    updates.push('tool_results = ?')
    values.push(data.toolResults ? JSON.stringify(data.toolResults) : null)
  }

  if (updates.length === 0) {
    return currentTurn
  }

  values.push(turnId)
  const sql = `UPDATE turns SET ${updates.join(', ')} WHERE id = ?`
  db.prepare(sql).run(...values)

  console.log('[DbTurns] Updated turn:', turnId)

  // Calculate delta and update session aggregates
  const oldMetrics = {
    cost: currentTurn.cost ?? 0,
    durationMs: currentTurn.durationMs ?? 0,
    inputTokens: currentTurn.inputTokens ?? 0,
    outputTokens: currentTurn.outputTokens ?? 0,
  }
  const newMetrics = {
    cost: data.cost ?? oldMetrics.cost,
    durationMs: data.durationMs ?? oldMetrics.durationMs,
    inputTokens: data.inputTokens ?? oldMetrics.inputTokens,
    outputTokens: data.outputTokens ?? oldMetrics.outputTokens,
  }

  // Only recompute if metrics changed
  if (
    oldMetrics.cost !== newMetrics.cost ||
    oldMetrics.durationMs !== newMetrics.durationMs ||
    oldMetrics.inputTokens !== newMetrics.inputTokens ||
    oldMetrics.outputTokens !== newMetrics.outputTokens
  ) {
    // For simplicity, do a full recompute (more reliable than delta calculation)
    recomputeSessionAggregates(db, currentTurn.sessionId)
  }

  return getTurn(db, turnId)
}

/**
 * Delete a turn and update session aggregates
 */
export function deleteTurn(db: BetterSqlite3.Database, turnId: string): boolean {
  // Get turn before deleting to know session and metrics
  const turn = getTurn(db, turnId)
  if (!turn) {
    console.warn('[DbTurns] Cannot delete non-existent turn:', turnId)
    return false
  }

  // Delete the turn
  db.prepare('DELETE FROM turns WHERE id = ?').run(turnId)

  console.log('[DbTurns] Deleted turn:', turnId, 'from session:', turn.sessionId)

  // Decrement session aggregates
  decrementSessionAggregates(db, turn.sessionId, {
    cost: turn.cost ?? 0,
    durationMs: turn.durationMs ?? 0,
    inputTokens: turn.inputTokens ?? 0,
    outputTokens: turn.outputTokens ?? 0,
  })

  return true
}

/**
 * Delete all turns from a given turn number onwards (for reverting to earlier state)
 * Returns the number of turns deleted
 */
export function deleteTurnsFrom(
  db: BetterSqlite3.Database,
  sessionId: string,
  fromTurnNumber: number
): number {
  // Get count of turns to delete
  const countResult = db.prepare(
    'SELECT COUNT(*) as count FROM turns WHERE session_id = ? AND turn_number >= ?'
  ).get(sessionId, fromTurnNumber) as { count: number }

  if (countResult.count === 0) {
    return 0
  }

  // Delete the turns
  db.prepare(
    'DELETE FROM turns WHERE session_id = ? AND turn_number >= ?'
  ).run(sessionId, fromTurnNumber)

  console.log('[DbTurns] Deleted', countResult.count, 'turns from session:', sessionId, 'starting at turn:', fromTurnNumber)

  // Recompute session aggregates (safer than calculating delta for multiple turns)
  recomputeSessionAggregates(db, sessionId)

  return countResult.count
}

/**
 * Get the highest turn number for a session
 */
export function getMaxTurnNumber(db: BetterSqlite3.Database, sessionId: string): number {
  const result = db.prepare(
    'SELECT MAX(turn_number) as max_turn FROM turns WHERE session_id = ?'
  ).get(sessionId) as { max_turn: number | null }

  return result.max_turn ?? 0
}

/**
 * Paginated turn query for DB-backed /messages endpoint.
 *
 * Returns the most recent `count` turns before `beforeTurnNumber` (exclusive).
 * Results are in ascending turn_number order (oldest → newest within page).
 *
 * @param beforeTurnNumber - If provided, only returns turns with turn_number < this value.
 *                           Omit to get the latest page.
 * @returns turns in ASC order + hasMore flag
 */
export function getTurnsForSessionPaginated(
  db: BetterSqlite3.Database,
  sessionId: string,
  opts: { count: number; beforeTurnNumber?: number }
): { turns: TurnEvent[]; hasMore: boolean } {
  const { count, beforeTurnNumber } = opts
  const limit = count + 1 // fetch one extra to detect hasMore

  let rows: DbTurn[]
  if (beforeTurnNumber !== undefined) {
    rows = db.prepare(`
      SELECT * FROM turns
      WHERE session_id = ? AND turn_number < ?
      ORDER BY turn_number DESC
      LIMIT ?
    `).all(sessionId, beforeTurnNumber, limit) as DbTurn[]
  } else {
    rows = db.prepare(`
      SELECT * FROM turns
      WHERE session_id = ?
      ORDER BY turn_number DESC
      LIMIT ?
    `).all(sessionId, limit) as DbTurn[]
  }

  const hasMore = rows.length > count
  if (hasMore) rows = rows.slice(0, count)

  // Reverse to ASC order (queried DESC for efficient LIMIT)
  rows.reverse()

  return {
    turns: rows.map(mapDbTurnToTurnEvent),
    hasMore,
  }
}

// ============================================================================
// Search
// ============================================================================

/**
 * Prepare query for FTS5
 */
function prepareFtsQuery(query: string): string {
  const cleaned = query
    .replace(/['"]/g, '')
    .replace(/[()]/g, '')
    .replace(/[-]/g, ' ')
    .replace(/[*]/g, '')
    .trim()

  const words = cleaned.split(/\s+/).filter(w => w.length > 0)

  if (words.length === 0) return '""'
  if (words.length === 1) return `"${words[0]}"*`
  return words.map(w => `"${w}"*`).join(' ')
}

/**
 * Full-text search across all turns
 */
export function searchTurns(
  db: BetterSqlite3.Database,
  query: string,
  options: { limit?: number; provider?: ProviderId } = {}
): SearchResult[] {
  const { limit = 20, provider } = options

  // Prepare FTS query
  const ftsQuery = prepareFtsQuery(query)

  let sql = `
    SELECT
      t.id,
      t.session_id as sessionId,
      t.turn_number as turnNumber,
      t.user_message as userMessage,
      t.assistant_response as assistantResponse,
      t.model,
      t.ts,
      s.title as sessionTitle,
      s.provider,
      s.cwd,
      highlight(turns_fts, 0, '<mark>', '</mark>') as userHighlighted,
      highlight(turns_fts, 1, '<mark>', '</mark>') as assistantHighlighted,
      bm25(turns_fts) as rank
    FROM turns_fts
    JOIN turns t ON turns_fts.rowid = t.rowid
    JOIN sessions s ON t.session_id = s.id
    WHERE turns_fts MATCH ?
  `

  const params: (string | number)[] = [ftsQuery]

  if (provider) {
    sql += ' AND s.provider = ?'
    params.push(provider)
  }

  sql += ' ORDER BY rank LIMIT ?'
  params.push(limit)

  try {
    return db.prepare(sql).all(...params) as SearchResult[]
  } catch {
    // Fallback to LIKE search
    return searchTurnsFallback(db, query, options)
  }
}

/**
 * Fallback search using LIKE
 */
function searchTurnsFallback(
  db: BetterSqlite3.Database,
  query: string,
  options: { limit?: number; provider?: ProviderId } = {}
): SearchResult[] {
  const { limit = 20, provider } = options

  let sql = `
    SELECT
      t.id,
      t.session_id as sessionId,
      t.turn_number as turnNumber,
      t.user_message as userMessage,
      t.assistant_response as assistantResponse,
      t.model,
      t.ts,
      s.title as sessionTitle,
      s.provider,
      s.cwd
    FROM turns t
    JOIN sessions s ON t.session_id = s.id
    WHERE (t.user_message LIKE ? OR t.assistant_response LIKE ?)
  `

  const likeQuery = `%${query}%`
  const params: (string | number)[] = [likeQuery, likeQuery]

  if (provider) {
    sql += ' AND s.provider = ?'
    params.push(provider)
  }

  sql += ' ORDER BY t.ts DESC LIMIT ?'
  params.push(limit)

  return db.prepare(sql).all(...params) as SearchResult[]
}

/**
 * Unified session search across session titles/snippets and turn content.
 * Returns session-level grouped results with up to 3 matched turns per session.
 */
export function searchSessions(
  db: BetterSqlite3.Database,
  query: string,
  options: { limit?: number; provider?: ProviderId } = {}
): SessionSearchResult[] {
  const text = query.trim()
  if (!text) return []

  const limit = Math.min(Math.max(options.limit ?? 20, 1), 100)
  const provider = options.provider
  const ftsQuery = prepareFtsQuery(text)

  try {
    return searchSessionsFts(db, ftsQuery, { limit, provider })
  } catch {
    return searchSessionsFallback(db, text, { limit, provider })
  }
}

function searchSessionsFts(
  db: BetterSqlite3.Database,
  ftsQuery: string,
  options: { limit: number; provider?: ProviderId }
): SessionSearchResult[] {
  const { limit, provider } = options
  const paramsTitle: (string | number)[] = [ftsQuery]
  const paramsTurns: (string | number)[] = [ftsQuery]
  let providerClause = ''
  if (provider) {
    providerClause = ' AND s.provider = ?'
    paramsTitle.push(provider)
    paramsTurns.push(provider)
  }

  const titleRows = db.prepare(`
    SELECT
      s.id as sessionId,
      highlight(sessions_fts, 1, '<mark>', '</mark>') as titleMatch,
      highlight(sessions_fts, 2, '<mark>', '</mark>') as snippetMatch,
      bm25(sessions_fts) as rank
    FROM sessions_fts
    JOIN sessions s ON sessions_fts.session_id = s.id
    WHERE sessions_fts MATCH ?
      AND s.status != 'deleted'
      ${providerClause}
    ORDER BY rank
    LIMIT ?
  `).all(...paramsTitle, limit * 4) as Array<{
    sessionId: string
    titleMatch: string | null
    snippetMatch: string | null
    rank: number
  }>

  const turnRows = db.prepare(`
    SELECT
      t.session_id as sessionId,
      t.turn_number as turnNumber,
      highlight(turns_fts, 0, '<mark>', '</mark>') as userHighlighted,
      highlight(turns_fts, 1, '<mark>', '</mark>') as assistantHighlighted,
      bm25(turns_fts) as rank
    FROM turns_fts
    JOIN turns t ON turns_fts.rowid = t.rowid
    JOIN sessions s ON s.id = t.session_id
    WHERE turns_fts MATCH ?
      AND s.status != 'deleted'
      ${providerClause}
    ORDER BY rank
    LIMIT ?
  `).all(...paramsTurns, limit * 20) as Array<{
    sessionId: string
    turnNumber: number
    userHighlighted: string | null
    assistantHighlighted: string | null
    rank: number
  }>

  return mergeSessionSearchRows(db, titleRows, turnRows, limit)
}

function searchSessionsFallback(
  db: BetterSqlite3.Database,
  query: string,
  options: { limit: number; provider?: ProviderId }
): SessionSearchResult[] {
  const { limit, provider } = options
  const likeQuery = `%${query}%`
  const paramsTitle: (string | number)[] = [likeQuery, likeQuery]
  const paramsTurns: (string | number)[] = [likeQuery, likeQuery]
  let providerClause = ''
  if (provider) {
    providerClause = ' AND s.provider = ?'
    paramsTitle.push(provider)
    paramsTurns.push(provider)
  }

  const titleRows = db.prepare(`
    SELECT
      s.id as sessionId,
      s.title as titleMatch,
      s.snippet as snippetMatch,
      0 as rank
    FROM sessions s
    WHERE s.status != 'deleted'
      AND (s.title LIKE ? OR s.snippet LIKE ?)
      ${providerClause}
    ORDER BY s.last_active_at DESC
    LIMIT ?
  `).all(...paramsTitle, limit * 4) as Array<{
    sessionId: string
    titleMatch: string | null
    snippetMatch: string | null
    rank: number
  }>

  const turnRows = db.prepare(`
    SELECT
      t.session_id as sessionId,
      t.turn_number as turnNumber,
      t.user_message as userHighlighted,
      t.assistant_response as assistantHighlighted,
      0 as rank
    FROM turns t
    JOIN sessions s ON s.id = t.session_id
    WHERE s.status != 'deleted'
      AND (t.user_message LIKE ? OR t.assistant_response LIKE ?)
      ${providerClause}
    ORDER BY t.ts DESC
    LIMIT ?
  `).all(...paramsTurns, limit * 20) as Array<{
    sessionId: string
    turnNumber: number
    userHighlighted: string | null
    assistantHighlighted: string | null
    rank: number
  }>

  return mergeSessionSearchRows(db, titleRows, turnRows, limit)
}

function mergeSessionSearchRows(
  db: BetterSqlite3.Database,
  titleRows: Array<{ sessionId: string; titleMatch: string | null; snippetMatch: string | null; rank: number }>,
  turnRows: Array<{ sessionId: string; turnNumber: number; userHighlighted: string | null; assistantHighlighted: string | null; rank: number }>,
  limit: number
): SessionSearchResult[] {
  const scoreBySession = new Map<string, number>()
  const titleBySession = new Map<string, { titleMatch?: string; snippetMatch?: string }>()
  const turnsBySession = new Map<string, Array<{
    turnNumber: number
    userHighlighted?: string
    assistantHighlighted?: string
  }>>()

  titleRows.forEach((row, idx) => {
    const base = scoreBySession.get(row.sessionId) ?? 0
    scoreBySession.set(row.sessionId, base + (10_000 - idx))
    titleBySession.set(row.sessionId, {
      titleMatch: row.titleMatch || undefined,
      snippetMatch: row.snippetMatch || undefined,
    })
  })

  turnRows.forEach((row, idx) => {
    const base = scoreBySession.get(row.sessionId) ?? 0
    scoreBySession.set(row.sessionId, base + (1_000 - idx))
    const existing = turnsBySession.get(row.sessionId) ?? []
    if (existing.length < 3) {
      existing.push({
        turnNumber: row.turnNumber,
        userHighlighted: row.userHighlighted || undefined,
        assistantHighlighted: row.assistantHighlighted || undefined,
      })
      turnsBySession.set(row.sessionId, existing)
    }
  })

  const sessionIds = [...scoreBySession.keys()]
  if (sessionIds.length === 0) return []

  const placeholders = sessionIds.map(() => '?').join(', ')
  const rows = db.prepare(`
    SELECT
      id as sessionId,
      title,
      provider,
      cwd,
      project_path as projectPath,
      last_active_at as lastActiveAt,
      COALESCE(turn_count, 0) as turnCount
    FROM sessions
    WHERE id IN (${placeholders})
      AND status != 'deleted'
  `).all(...sessionIds) as Array<{
    sessionId: string
    title: string | null
    provider: ProviderId
    cwd: string | null
    projectPath: string | null
    lastActiveAt: string
    turnCount: number
  }>

  const rowById = new Map(rows.map(r => [r.sessionId, r]))
  const sortedIds = sessionIds
    .filter(id => rowById.has(id))
    .sort((a, b) => {
      const scoreDiff = (scoreBySession.get(b) ?? 0) - (scoreBySession.get(a) ?? 0)
      if (scoreDiff !== 0) return scoreDiff
      const aTs = new Date(rowById.get(a)!.lastActiveAt).getTime()
      const bTs = new Date(rowById.get(b)!.lastActiveAt).getTime()
      return bTs - aTs
    })
    .slice(0, limit)

  return sortedIds.map((id) => {
    const meta = rowById.get(id)!
    const title = titleBySession.get(id) ?? {}
    return {
      sessionId: id,
      title: meta.title,
      provider: meta.provider,
      cwd: meta.cwd,
      projectPath: meta.projectPath,
      lastActiveAt: meta.lastActiveAt,
      turnCount: meta.turnCount,
      titleMatch: title.titleMatch,
      snippetMatch: title.snippetMatch,
      turnMatches: turnsBySession.get(id) ?? [],
    }
  })
}
