/**
 * RUDI Session Types v2
 *
 * Multi-provider session management with provider-scoped projects.
 *
 * Hierarchy:
 *   Provider → Project → Session → Turn
 *
 * Storage:
 *   ~/.rudi/
 *   ├── meta.json              # Storage version, settings
 *   ├── turns.jsonl            # All turns (source of truth)
 *   ├── session-index.json     # Session metadata
 *   └── projects.json          # Project definitions
 *
 * Native session data lives in provider directories:
 *   ~/.claude/projects/{path}/{session-id}.jsonl
 *   ~/.codex/sessions/YYYY/MM/DD/rollout-*.jsonl
 *   ~/.gemini/tmp/{project-hash}/chats/{session-id}.json
 */

// ============================================================================
// Provider Types
// ============================================================================

// Provider ID - known providers plus arbitrary strings for extensibility
export type ProviderId = 'claude' | 'codex' | 'gemini' | 'copilot' | 'ollama' | (string & {})

// ============================================================================
// Turn Types (Source of Truth - stored in turns.jsonl)
// ============================================================================

/**
 * TurnEvent - A single user→assistant interaction
 *
 * This is the atomic unit. All aggregates derive from turns.
 * Stored in ~/.rudi/turns.jsonl
 *
 * NOTE: projectId is NOT stored here. Get it via Turn.sessionId → Session.projectId.
 * This keeps turns append-only (no rewrites when reorganizing projects).
 */
/** Event classification for turns */
export type TurnKind = 'message' | 'display' | 'summary' | 'tool' | 'error'

export interface TurnEvent {
  // Identity
  id: string                          // Unique turn ID (UUID)
  ts: string                          // ISO 8601 timestamp
  tsMs?: number                       // Epoch milliseconds for chronological ordering

  // Provider & Links
  provider: ProviderId
  sessionId: string                   // PS session ID
  providerSessionId: string | null    // Native session ID from provider
  providerTurnId?: string             // Native provider message/turn ID for dedup (e.g., entry.uuid)
  // NOTE: No projectId here - derive from session

  // Classification
  kind?: TurnKind                     // Event type (default: 'message')

  // Configuration at time of turn
  model: string                       // e.g., "claude-opus-4-5", "gpt-5.1-codex"
  permissionMode?: string             // e.g., "agent", "plan", "default", "yolo"
  systemPrompt?: string               // System prompt used for this turn

  // Content
  userMessage: string                 // Full user message text
  assistantResponse?: string          // Full assistant response text
  thinking?: string                   // Extended thinking content (Claude)
  turnNumber: number                  // Sequence in session (1, 2, 3...)

  // Metrics (provider-dependent, all optional)
  cost?: number                       // USD cost (Claude only currently)
  durationMs?: number                 // Processing time (Claude, Gemini)
  durationApiMs?: number              // API-specific duration

  // Token usage
  inputTokens?: number                // Tokens sent
  outputTokens?: number               // Tokens received
  cacheReadTokens?: number            // Cache read tokens (Claude)
  cacheCreationTokens?: number        // Cache creation tokens (Claude)

  // Completion info
  finishReason?: string               // e.g., "stop", "length", "filter", "error"

  // Rich metadata (high-value optional fields)
  toolsUsed?: string[]                // e.g., ['Bash', 'Read', 'Edit']
  toolResults?: unknown[]             // Full tool call data: [{id, name, input, result}]
  error?: boolean | string            // true or error code/message
  parentTurnId?: string               // For branching/forking

  // Provider-specific overflow
  providerMeta?: Record<string, unknown>
}

// ============================================================================
// Session Types (stored in session-index.json)
// ============================================================================

// Align with global.d.ts RudiSessionStatus - includes 'completed' status
export type SessionStatus = 'active' | 'completed' | 'archived' | 'deleted'

/**
 * SessionOrigin - Where did this session come from?
 *
 * - 'rudi': Created through RUDI UI, we orchestrate the CLI
 * - 'provider-import': Discovered from provider's native storage (~/.claude, ~/.gemini, ~/.codex)
 * - 'mixed': Started externally, later continued in RUDI (future)
 */
export type SessionOrigin = 'rudi' | 'provider-import' | 'mixed'

/**
 * SessionOriginDetail - Extended info about session provenance
 *
 * The `type` field provides more granular information about how the session
 * was created/discovered:
 * - 'rudi': Created through normal RUDI UI interaction
 * - 'provider-import': Discovered and imported from provider's storage
 * - 'live-attach': Attached to an existing live CLI session
 */
export interface SessionOriginDetail {
  type: SessionOrigin | 'live-attach'  // Align with SessionOrigin, plus live-attach
  importedAt?: string              // ISO - when we discovered/imported it
  nativeFile?: string              // Absolute path to provider's session file
  notes?: string                   // Human-readable context
}

/**
 * SessionCost - Structured cost tracking
 */
export interface SessionCost {
  totalUsd: number
  inputTokens: number
  outputTokens: number
}

/**
 * Normalize cost to a number (handles both legacy number and SessionCost object)
 */
export function normalizeCost(cost: number | SessionCost | undefined): number {
  if (cost === undefined) return 0
  return typeof cost === 'number' ? cost : cost.totalUsd
}

/**
 * RudiSession - Session metadata record
 *
 * Links to native provider storage for actual messages.
 * Aggregates are eventually consistent (derived from turns).
 */
export interface RudiSession {
  // Identity
  id: string                          // PS session ID (UUID)
  provider: ProviderId
  providerSessionId: string | null    // Native session ID
  projectId: string | null            // null = Inbox
  runGroupId?: string | null          // Parallel run-group ownership

  // Origin - where did this session come from?
  origin: SessionOrigin               // 'rudi' | 'provider-import' | 'mixed'
  originDetail?: SessionOriginDetail  // Extended provenance info

  // Display
  title: string                       // User-editable or auto-generated
  snippet: string                     // Preview of last message

  // State
  status: SessionStatus
  model: string                       // Last used model
  systemPrompt?: string               // Session-level system prompt (custom instructions)
  inheritProjectPrompt?: boolean      // Whether to include project prompt (default: true)

  // Timestamps
  createdAt: string                   // ISO 8601
  lastActiveAt: string                // ISO 8601
  deletedAt?: string                  // ISO 8601 (soft delete)

  // Aggregated from turns (eventually consistent, not source of truth)
  turns: number
  totalCost: number | SessionCost     // Can be number (legacy) or structured
  totalDurationMs: number

  // Optional breakdowns
  costByModel?: Record<string, number>
  turnsByModel?: Record<string, number>

  // Context
  cwd?: string                        // Working directory at creation (optional for imported sessions)
  dirScope?: 'project' | 'home'       // Directory scope for agent access (default: 'project')
  gitBranch?: string                  // Git branch at creation (handy context)
  tags: string[]                      // User-defined tags

  // Native storage reference (for loading messages)
  nativeStoragePath?: string          // Path to provider's session file (relative or absolute)

  // Resolved path (computed at query time, not stored)
  // This is the actual absolute path to the native session file
  resolvedNativeFilePath?: string     // Computed by getNativeFilePath() when listing
}

// ============================================================================
// Project Types (stored in projects.json)
// ============================================================================

/**
 * Project - Groups sessions within a provider
 *
 * Projects are provider-scoped. Use crossProjectId to link
 * related projects across providers.
 */
export interface Project {
  id: string                          // PS project ID
  provider: ProviderId
  name: string
  color: string                       // Hex color for UI
  createdAt: string                   // ISO 8601

  // Cross-provider linking (optional, for future)
  crossProjectId?: string             // Same ID across providers = global project

  // Aggregated (eventually consistent)
  sessionCount?: number
  totalCost?: number
}

// ============================================================================
// Storage Types
// ============================================================================

/**
 * StorageMeta - Version and settings for storage format
 *
 * Stored in ~/.rudi/meta.json
 */
export interface StorageMeta {
  version: number                     // Schema version
  turnStorage: 'single-file' | 'per-session' | 'per-day'
  createdAt: string
  lastMigration?: string
  lastReconciledAt?: string           // When aggregates were last recomputed
}

/**
 * SessionsFile - Container for all sessions
 *
 * Stored in ~/.rudi/sessions.json
 */
export interface SessionsFile {
  version: number
  sessions: Record<string, RudiSession>
}

/**
 * ProjectsFile - Container for all projects
 */
export interface ProjectsFile {
  version: number
  projects: Project[]
}

// ============================================================================
// Query & Filter Types
// ============================================================================

export interface SessionFilters {
  provider?: ProviderId
  projectId?: string | null           // null = Inbox
  status?: SessionStatus
  model?: string
  dateRange?: { from: string; to: string }
  excludeDeleted?: boolean            // Default true
  search?: string                     // Full-text search
  orderBy?: string                    // Sort field
  orderDir?: 'asc' | 'desc'           // Sort direction
  offset?: number                     // Pagination offset
  limit?: number                      // Pagination limit
}

export interface TurnFilters {
  provider?: ProviderId
  sessionId?: string
  // NOTE: To filter by project, first get sessionIds for the project,
  // then filter turns by sessionId. This avoids denormalization.
  sessionIds?: string[]               // For project-based queries
  model?: string
  origin?: SessionOrigin
  hasError?: boolean
  toolUsed?: string
  dateRange?: { from: string; to: string }
}

// ============================================================================
// Service Types
// ============================================================================

export interface SessionCreateOptions {
  provider?: ProviderId  // Optional - defaults to 'claude' if not specified
  projectId?: string | null
  model?: string
  systemPrompt?: string
  inheritProjectPrompt?: boolean
  title?: string
  cwd?: string
  dirScope?: 'project' | 'home'  // Directory scope (default: 'project')
  gitBranch?: string
  // Origin info - defaults to 'rudi' if not specified
  origin?: SessionOrigin
  originDetail?: SessionOriginDetail
  // For imports: native session info
  providerSessionId?: string
  nativeStoragePath?: string
  runGroupId?: string | null
  // v4: Sub-agent/branching support
  parentSessionId?: string
  agentId?: string
  isSidechain?: boolean
  sessionType?: 'main' | 'agent' | 'task'
  slug?: string
  version?: string
  userType?: string
  // Meta session flags
  isWarmup?: boolean
}

export interface SessionUpdateData {
  title?: string
  title_override?: string  // User's custom title (takes precedence over synced title)
  summary?: string
  systemPrompt?: string
  inheritProjectPrompt?: boolean
  snippet?: string
  status?: SessionStatus
  projectId?: string | null
  model?: string
  dirScope?: 'project' | 'home'  // Directory scope
  cwd?: string  // Working directory
  gitBranch?: string  // Git branch
  tags?: string[]
  providerSessionId?: string
  nativeStoragePath?: string
  // Origin (typically set once at creation or import)
  origin?: SessionOrigin
  originDetail?: SessionOriginDetail
  // Aggregates (set by system, not user)
  turns?: number
  totalCost?: number | SessionCost
  totalDurationMs?: number
  lastActiveAt?: string
  deletedAt?: string
}

export interface ProjectCreateOptions {
  provider: ProviderId
  name: string
  color?: string
  crossProjectId?: string
}

// ============================================================================
// Provider-Specific Session Paths
// ============================================================================

/**
 * Native storage paths per provider
 */
export const NATIVE_SESSION_PATHS = {
  claude: {
    base: '~/.claude/projects',
    pattern: '{projectPath}/{sessionId}.jsonl',
  },
  codex: {
    base: '~/.codex/sessions',
    pattern: '{year}/{month}/{day}/rollout-{timestamp}-{sessionId}.jsonl',
  },
  gemini: {
    base: '~/.gemini/tmp',
    pattern: '{projectHash}/chats/{sessionId}.json',
  },
} as const

// ============================================================================
// Default Values
// ============================================================================

export const DEFAULT_STORAGE_META: StorageMeta = {
  version: 2,
  turnStorage: 'single-file',
  createdAt: new Date().toISOString(),
}

export const DEFAULT_SESSIONS_FILE: SessionsFile = {
  version: 2,
  sessions: {},
}

export const DEFAULT_PROJECTS_FILE: ProjectsFile = {
  version: 2,
  projects: [],
}

// ============================================================================
// Session Change Events (for real-time UI updates)
// ============================================================================

/**
 * Individual session change event metadata
 * Used for smart UI debouncing based on change type and volume
 */
export interface SessionChangeEventData {
  sessionId: string
  changeType: 'turn_added' | 'session_created' | 'session_updated' | 'bulk_sync'
  turnCount: number
  provider: ProviderId
}

/**
 * Payload sent via IPC 'sessions:changed' event
 * Includes aggregated metadata for smart debouncing decisions
 */
export interface SessionChangedPayload {
  events: SessionChangeEventData[]
  isBulk: boolean      // True if this is a bulk operation (many sessions or turns)
  totalTurns: number   // Total turn count across all events
  sessionCount: number // Number of sessions affected
}
