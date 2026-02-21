/**
 * Database Service (v3)
 *
 * Thin facade that delegates to modular database operations.
 * Maintains backwards-compatible API.
 *
 * Uses readiness promise pattern to ensure DB is initialized before any operations.
 */

import type BetterSqlite3 from 'better-sqlite3'
import type {
  RudiSession,
  SessionCreateOptions,
  SessionUpdateData,
  ProviderId,
  TurnEvent,
} from './sessions-v2'

// Import modules
import { dbConnection } from './connection'
import { initializeSchema, runSchemaMigrations } from './schema'
import * as sessions from './sessions'
import * as turns from './turns'
import * as projects from './projects'
import * as migrations from './migrations'
import * as filePositions from './file-positions'
import * as integrity from './integrity'
import * as systemEvents from './system-events'
import * as logs from './logs'
import * as runGroups from './run-groups'
import type { DbSessionFilters, UsageStats, TurnCreateOptions, TurnUpdateOptions, SearchResult, SessionSearchResult, Project, ProjectCreateOptions, ProjectUpdateData, FilePosition, DbRunGroup, RunGroupStatus } from './types'

// ============================================================================
// Database State Management
// ============================================================================

type DbState = 'uninitialized' | 'initializing' | 'ready' | 'failed'

/** Error thrown when DB operations are attempted before ready */
export class DatabaseNotReadyError extends Error {
  constructor(message = 'Database not ready') {
    super(message)
    this.name = 'DatabaseNotReadyError'
  }
}

// Re-export types
export type {
  DbSessionFilters,
  DbSession,
  DbTurn,
  TurnCreateOptions,
  TurnUpdateOptions,
  Project,
  ProjectCreateOptions,
  ProjectUpdateData,
  ProjectSettings,
  SearchResult,
  SessionSearchResult,
  UsageStats,
  FilePosition,
  DbFilePosition,
  DbRunGroup,
  RunGroupStatus,
} from './types'
export type { RunGroupCreateOptions, RunGroupListFilters } from './run-groups'
export {
  createRunGroup,
  getRunGroup,
  listRunGroups,
  updateRunGroupStatus,
  refreshRunGroupAggregates,
} from './run-groups'

// ============================================================================
// Database Service Class
// ============================================================================

class DatabaseService {
  private hasMigratedOnStartup = false
  private state: DbState = 'uninitialized'
  private readyPromise: Promise<void> | null = null
  private initError: Error | null = null
  private readyHooks: Array<(db: BetterSqlite3.Database) => void> = []

  /**
   * Get current database state
   */
  getState(): DbState {
    return this.state
  }

  /**
   * Check if database is ready (synchronous check)
   */
  isReady(): boolean {
    return this.state === 'ready'
  }

  /**
   * Wait for database to be ready
   * Call this before any DB operation in IPC handlers
   */
  async ready(): Promise<void> {
    // Already ready
    if (this.state === 'ready') {
      return
    }

    // Failed previously - throw the error
    if (this.state === 'failed') {
      throw this.initError || new DatabaseNotReadyError('Database initialization failed')
    }

    // Not started yet - start initialization
    if (!this.readyPromise) {
      this.readyPromise = this.initializeAsync()
    }

    return this.readyPromise
  }

  /**
   * Register a hook to run when the DB is ready.
   */
  registerOnReady(handler: (db: BetterSqlite3.Database) => void): void {
    this.readyHooks.push(handler)
    if (this.state === 'ready' && dbConnection.isConnected()) {
      handler(dbConnection.getDb())
    }
  }

  /**
   * Get the initialization error (if failed)
   */
  getInitError(): Error | null {
    return this.initError
  }

  /**
   * Retry initialization after failure
   * Resets state and attempts to initialize again
   */
  async retry(): Promise<void> {
    if (this.state !== 'failed') {
      return this.ready()
    }

    // Reset state for retry
    this.state = 'uninitialized'
    this.readyPromise = null
    this.initError = null

    return this.ready()
  }

  /**
   * Internal async initialization
   */
  private async initializeAsync(): Promise<void> {
    if (this.state === 'ready') return
    // Note: no early-exit for 'initializing' - ready() controls single-entry via readyPromise

    this.state = 'initializing'
    console.log('[DatabaseService] Initializing...')

    try {
      // Step 1: Open connection and run schema
      const success = this.ensureDatabase()
      if (!success) {
        throw new DatabaseNotReadyError('Failed to open database connection')
      }
      console.log('[DatabaseService] Connection established')

      // Step 2: Run async migrations
      await this.runMigrations()
      console.log('[DatabaseService] Migrations complete')

      // Step 3: Run ready hooks with DB reference
      if (dbConnection.isConnected()) {
        const db = dbConnection.getDb()
        for (const handler of this.readyHooks) {
          handler(db)
        }

        // Step 4: Defer integrity check to not block UI startup
        // PERF FIX: This was taking 171ms+ and blocking IPC during init
        setImmediate(() => {
          const { issues, durationMs } = integrity.checkSessionAggregates(db)
          if (issues.length > 0) {
            console.warn(`[DatabaseService] Found ${issues.length} aggregate integrity issues, repairing...`)
            const repair = integrity.repairAggregates(db)
            console.log(`[DatabaseService] Repaired ${repair.repairedCount} sessions in ${repair.durationMs}ms`)
          } else {
            console.log(`[DatabaseService] Integrity check passed (${durationMs}ms)`)
          }
        })
      }

      this.state = 'ready'
      console.log('[DatabaseService] Ready')
    } catch (error) {
      this.state = 'failed'
      this.initError = error instanceof Error ? error : new Error(String(error))
      this.readyPromise = null // Clear so retry() works cleanly

      // Close partial handle if opened
      try {
        dbConnection.close()
      } catch {
        // Ignore close errors
      }

      console.error('[DatabaseService] Initialization failed:', this.initError.message)
      throw this.initError
    }
  }

  /**
   * Configure custom database path (for testing)
   * Must be called before ready()
   */
  setDatabasePath(dbPath: string): void {
    dbConnection.setDatabasePath(dbPath)
  }

  /**
   * Get the database path
   */
  getDbPath(): string {
    return dbConnection.getDbPath()
  }

  /**
   * Get the raw database connection for advanced use cases.
   */
  getRawDb(): BetterSqlite3.Database {
    return this.getDb()
  }

  /**
   * Reset to default database path and close connection
   */
  reset(): void {
    dbConnection.reset()
    this.hasMigratedOnStartup = false
    this.state = 'uninitialized'
    this.readyPromise = null
    this.initError = null
  }

  /**
   * Check if the database file exists
   */
  async isDatabaseAvailableAsync(): Promise<boolean> {
    return dbConnection.isDatabaseAvailableAsync()
  }

  /**
   * Ensure the database is ready (create if doesn't exist)
   * Synchronous version - prefer ready() for async initialization
   */
  ensureDatabase(): boolean {
    const result = dbConnection.initialize(
      // onNewDatabase - run schema AND migrations (for columns not in base schema)
      (db) => {
        initializeSchema(db)
        runSchemaMigrations(db)
      },
      // onExistingDatabase
      (db) => runSchemaMigrations(db)
    )

    if (result && this.state !== 'ready') {
      this.state = 'ready'
    }

    return result
  }

  /**
   * Run migrations (async - should be called after ensureDatabase)
   */
  async runMigrations(): Promise<void> {
    if (this.hasMigratedOnStartup) {
      return
    }

    this.hasMigratedOnStartup = true
    const db = this.getDb()
    const dbDir = dbConnection.getDbDir()

    if (await migrations.needsProjectMigration(db, dbDir)) {
      console.log('[DatabaseService] Found projects.json, migrating to database...')
      await migrations.migrateProjectsFromJson(db, dbDir)
    }

    if (await migrations.needsTurnsMigration(dbDir)) {
      console.log('[DatabaseService] Found turns.jsonl, migrating to database...')
      await migrations.migrateTurnsFromJsonl(db, dbDir)
    }

    // Migrate session titles from "Imported Session" to slug-based titles
    // PERF FIX: Defer to not block UI startup (was scanning 546 sessions synchronously)
    migrations.needsSessionTitleMigration(db).then((needs) => {
      if (needs) {
        console.log('[DatabaseService] Found sessions with placeholder titles, migrating in background...')
        // Run after a short delay to let UI settle
        setTimeout(() => {
          migrations.migrateSessionTitles(db).catch((err) => {
            console.error('[DatabaseService] Session title migration failed:', err)
          })
        }, 3000) // 3 second delay
      }
    })
  }

  /**
   * Get the raw database connection
   * @throws DatabaseNotReadyError if not initialized
   */
  private getDb(): BetterSqlite3.Database {
    if (this.state !== 'ready' && this.state !== 'initializing') {
      throw new DatabaseNotReadyError(`Database not ready (state: ${this.state})`)
    }
    return dbConnection.getDb()
  }

  /**
   * Close the database connection
   */
  close(): void {
    dbConnection.close()
    this.state = 'uninitialized'
    this.readyPromise = null
    turns.clearStatementCache()
  }

  /**
   * Run a function inside a SQLite transaction.
   * All writes are batched into a single commit (reduces fsync overhead).
   * @param fn Function that performs DB operations - receives the db connection
   * @returns The return value of fn
   */
  runTransaction<T>(fn: (db: BetterSqlite3.Database) => T): T {
    const db = this.getDb()
    const tx = db.transaction((work: () => T) => work())
    return tx(() => fn(db))
  }

  // ==========================================================================
  // Session Operations
  // ==========================================================================

  listSessions(filters?: DbSessionFilters): RudiSession[] {
    return sessions.listSessions(this.getDb(), filters)
  }

  countSessions(filters?: DbSessionFilters): number {
    return sessions.countSessions(this.getDb(), filters)
  }

  getSession(id: string): RudiSession | null {
    return sessions.getSession(this.getDb(), id)
  }

  getSessionByProviderSessionId(providerSessionId: string, provider: ProviderId): RudiSession | null {
    return sessions.getSessionByProviderSessionId(this.getDb(), providerSessionId, provider)
  }

  /**
   * Find an unclaimed session (rudi origin, null providerSessionId, matching cwd, recent)
   * Used by AgentService to claim sessions before SessionWatcher creates duplicates
   * @deprecated Use linkProviderSession() instead for race-safe linking
   */
  findUnclaimedSession(provider: ProviderId, cwd: string): RudiSession | null {
    return sessions.findUnclaimedSession(this.getDb(), provider, cwd)
  }

  /**
   * Atomically link a provider session ID to a RUDI session
   *
   * This is the SINGLE entry point for correlating provider sessions.
   * Handles race conditions between AgentService and SessionWatcher using atomic SQL.
   *
   * @returns { sessionId, action: 'found' | 'claimed' | 'created' }
   */
  linkProviderSession(options: {
    provider: ProviderId
    providerSessionId: string
    cwd: string
    origin?: 'rudi' | 'provider-import' | 'mixed'
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
  }): sessions.LinkProviderSessionResult {
    return sessions.linkProviderSession(this.getDb(), options)
  }

  createSession(options: SessionCreateOptions): RudiSession {
    return sessions.createSession(this.getDb(), options)
  }

  updateSession(sessionId: string, data: SessionUpdateData): void {
    sessions.updateSession(this.getDb(), sessionId, data)
  }

  deleteSession(sessionId: string): void {
    sessions.deleteSession(this.getDb(), sessionId)
  }

  hardDeleteSession(sessionId: string): void {
    sessions.hardDeleteSession(this.getDb(), sessionId)
  }

  listSessionsByProject(projectId: string | null, provider?: ProviderId): RudiSession[] {
    return sessions.listSessionsByProject(this.getDb(), projectId, provider)
  }

  getInboxSessions(provider?: ProviderId): RudiSession[] {
    return sessions.getInboxSessions(this.getDb(), provider)
  }

  moveSessionToProject(sessionId: string, projectId: string | null): void {
    sessions.moveSessionToProject(this.getDb(), sessionId, projectId)
  }

  getStats(): UsageStats {
    return sessions.getStats(this.getDb())
  }

  // ==========================================================================
  // Run Group Operations
  // ==========================================================================

  createRunGroup(options: runGroups.RunGroupCreateOptions = {}): DbRunGroup {
    return runGroups.createRunGroup(this.getDb(), options)
  }

  getRunGroup(runGroupId: string): DbRunGroup | null {
    return runGroups.getRunGroup(this.getDb(), runGroupId)
  }

  listRunGroups(filters: runGroups.RunGroupListFilters = {}): DbRunGroup[] {
    return runGroups.listRunGroups(this.getDb(), filters)
  }

  updateRunGroupStatus(
    runGroupId: string,
    status: RunGroupStatus,
    extras: { startedAt?: string | null; completedAt?: string | null } = {}
  ): DbRunGroup | null {
    return runGroups.updateRunGroupStatus(this.getDb(), runGroupId, status, extras)
  }

  refreshRunGroupAggregates(runGroupId: string): DbRunGroup | null {
    return runGroups.refreshRunGroupAggregates(this.getDb(), runGroupId)
  }

  // ==========================================================================
  // Turn Operations
  // ==========================================================================

  getTurnsForSession(sessionId: string): TurnEvent[] {
    return turns.getTurnsForSession(this.getDb(), sessionId)
  }

  queryTurns(filters?: {
    dateFrom?: string
    dateTo?: string
    provider?: string
    model?: string
    origin?: string
  }): TurnEvent[] {
    return turns.queryTurns(this.getDb(), filters)
  }

  getTurn(turnId: string): TurnEvent | null {
    return turns.getTurn(this.getDb(), turnId)
  }

  getTurnByNumber(sessionId: string, turnNumber: number): TurnEvent | null {
    return turns.getTurnByNumber(this.getDb(), sessionId, turnNumber)
  }

  createTurn(options: TurnCreateOptions): TurnEvent {
    return turns.createTurn(this.getDb(), options)
  }

  updateTurn(turnId: string, data: TurnUpdateOptions): TurnEvent | null {
    return turns.updateTurn(this.getDb(), turnId, data)
  }

  deleteTurn(turnId: string): boolean {
    return turns.deleteTurn(this.getDb(), turnId)
  }

  deleteTurnsFrom(sessionId: string, fromTurnNumber: number): number {
    return turns.deleteTurnsFrom(this.getDb(), sessionId, fromTurnNumber)
  }

  getMaxTurnNumber(sessionId: string): number {
    return turns.getMaxTurnNumber(this.getDb(), sessionId)
  }

  recomputeSessionAggregates(sessionId: string): void {
    turns.recomputeSessionAggregates(this.getDb(), sessionId)
  }

  /**
   * Incrementally update session aggregates (for batched turn inserts)
   * Use this instead of recomputeSessionAggregates when you know the delta
   */
  incrementSessionAggregates(
    sessionId: string,
    delta: {
      turnCount: number
      cost: number
      durationMs: number
      inputTokens: number
      outputTokens: number
    }
  ): void {
    turns.incrementSessionAggregates(this.getDb(), sessionId, delta)
  }

  /**
   * Get pricing map for in-memory cost calculation (avoids per-turn DB queries)
   */
  getPricingMap(): turns.PricingMap {
    return turns.getPricingMap(this.getDb())
  }

  searchTurns(query: string, options?: { limit?: number; provider?: ProviderId }): SearchResult[] {
    return turns.searchTurns(this.getDb(), query, options)
  }

  searchSessions(query: string, options?: { limit?: number; provider?: ProviderId }): SessionSearchResult[] {
    return turns.searchSessions(this.getDb(), query, options)
  }

  /**
   * Upsert a turn (idempotent write using providerTurnId for dedup)
   */
  upsertTurn(options: TurnCreateOptions): { created: boolean; turn: TurnEvent } {
    return turns.upsertTurn(this.getDb(), options)
  }

  /**
   * Find turn by provider turn ID
   */
  getTurnByProviderTurnId(sessionId: string, providerTurnId: string): TurnEvent | null {
    return turns.getTurnByProviderTurnId(this.getDb(), sessionId, providerTurnId)
  }

  /**
   * Calculate cost for a turn based on model pricing
   */
  calculateTurnCost(
    provider: string | undefined,
    model: string | undefined,
    inputTokens: number | undefined,
    outputTokens: number | undefined,
    cacheReadTokens?: number,
    cacheCreationTokens?: number
  ): number {
    return turns.calculateTurnCost(this.getDb(), provider, model, inputTokens, outputTokens, cacheReadTokens, cacheCreationTokens)
  }

  // ==========================================================================
  // File Position Operations (for session file tailing)
  // ==========================================================================

  getFilePosition(filePath: string): FilePosition | null {
    return filePositions.getFilePosition(this.getDb(), filePath)
  }

  getFilePositionsByProvider(provider: ProviderId): FilePosition[] {
    return filePositions.getFilePositionsByProvider(this.getDb(), provider)
  }

  getAllFilePositions(): FilePosition[] {
    return filePositions.getAllFilePositions(this.getDb())
  }

  upsertFilePosition(position: {
    filePath: string
    byteOffset: number
    fileSize: number
    mtimeMs: number
    inode?: string | null
    provider: ProviderId
  }): FilePosition {
    return filePositions.upsertFilePosition(this.getDb(), position)
  }

  updateFilePosition(filePath: string, updates: {
    byteOffset?: number
    fileSize?: number
    mtimeMs?: number
    inode?: string | null
  }): FilePosition | null {
    return filePositions.updateFilePosition(this.getDb(), filePath, updates)
  }

  deleteFilePosition(filePath: string): boolean {
    return filePositions.deleteFilePosition(this.getDb(), filePath)
  }

  resetFilePosition(filePath: string): FilePosition | null {
    return filePositions.resetFilePosition(this.getDb(), filePath)
  }

  hasFileChanged(filePath: string, currentStats: { size: number; mtimeMs: number; inode?: string }): {
    changed: boolean
    position: FilePosition | null
    reason?: string
  } {
    return filePositions.hasFileChanged(this.getDb(), filePath, currentStats)
  }

  // ==========================================================================
  // Project Operations
  // ==========================================================================

  createProject(options: ProjectCreateOptions): Project {
    return projects.createProject(this.getDb(), options)
  }

  getProject(id: string): Project | null {
    return projects.getProject(this.getDb(), id)
  }

  listProjects(provider?: ProviderId): Project[] {
    return projects.listProjects(this.getDb(), provider)
  }

  updateProject(projectId: string, data: ProjectUpdateData): void {
    projects.updateProject(this.getDb(), projectId, data)
  }

  deleteProject(projectId: string): void {
    projects.deleteProject(this.getDb(), projectId)
  }

  getProjectSessionCount(projectId: string): number {
    return projects.getProjectSessionCount(this.getDb(), projectId)
  }

  // ==========================================================================
  // Integrity Operations
  // ==========================================================================

  /**
   * Run integrity check on all session aggregates
   * Returns issues found (empty = all good)
   */
  checkIntegrity(): integrity.IntegrityCheckResult {
    return integrity.checkSessionAggregates(this.getDb())
  }

  /**
   * Repair all aggregate mismatches by recomputing from turns
   */
  repairIntegrity(): integrity.RepairResult {
    return integrity.repairAggregates(this.getDb())
  }

  /**
   * Quick health check - returns true if no issues found
   */
  isIntegrityHealthy(): boolean {
    return integrity.isHealthy(this.getDb())
  }

  /**
   * Get integrity summary stats for monitoring
   */
  getIntegritySummary(): {
    totalSessions: number
    totalTurns: number
    issueCount: number
    healthy: boolean
  } {
    return integrity.getIntegritySummary(this.getDb())
  }

  // ==========================================================================
  // System Events Operations
  // ==========================================================================

  getSystemEventsForSession(sessionId: string) {
    return systemEvents.getSystemEventsForSession(this.getDb(), sessionId)
  }

  getCompactionEventsForSession(sessionId: string) {
    return systemEvents.getCompactionEventsForSession(this.getDb(), sessionId)
  }

  getLatestCompactionEvent(sessionId: string) {
    return systemEvents.getLatestCompactionEvent(this.getDb(), sessionId)
  }

  getSummaryEventsForSession(sessionId: string) {
    return systemEvents.getSummaryEventsForSession(this.getDb(), sessionId)
  }

  // ==========================================================================
  // Migration Operations (legacy API compatibility)
  // ==========================================================================

  async needsProjectMigration(): Promise<boolean> {
    return migrations.needsProjectMigration(this.getDb(), dbConnection.getDbDir())
  }

  async migrateProjectsFromJson(): Promise<number> {
    return migrations.migrateProjectsFromJson(this.getDb(), dbConnection.getDbDir())
  }

  async needsTurnsMigration(): Promise<boolean> {
    return migrations.needsTurnsMigration(dbConnection.getDbDir())
  }

  async migrateTurnsFromJsonl(): Promise<number> {
    return migrations.migrateTurnsFromJsonl(this.getDb(), dbConnection.getDbDir())
  }

  // ==========================================================================
  // Logs Operations (Agent Visibility observability)
  // ==========================================================================

  storeLogEvent(event: any): void {
    logs.storeLogEvent(this.getDb(), event)
  }

  queryLogs(options?: Parameters<typeof logs.queryLogs>[1]): ReturnType<typeof logs.queryLogs> {
    return logs.queryLogs(this.getDb(), options)
  }

  getLogCount(): number {
    return logs.getLogCount(this.getDb())
  }

  getRecentLogs(ms = 60000): ReturnType<typeof logs.getRecentLogs> {
    return logs.getRecentLogs(this.getDb(), ms)
  }

  cleanupOldLogs(retentionDays = 7): number {
    return logs.cleanupOldLogs(this.getDb(), retentionDays)
  }
}

// ============================================================================
// Singleton Export
// ============================================================================

export const databaseService = new DatabaseService()
export default databaseService
