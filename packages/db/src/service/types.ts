/**
 * Database Types
 *
 * Shared type definitions for database operations.
 */

import type { ProviderId } from './sessions-v2'

// ============================================================================
// Session Types
// ============================================================================

export interface DbSessionFilters {
  provider?: ProviderId
  projectId?: string | null
  status?: 'active' | 'completed' | 'archived' | 'deleted'  // Match SessionStatus
  origin?: 'rudi' | 'provider-import' | 'mixed'  // Filter by session origin
  excludeDeleted?: boolean
  excludeWarmup?: boolean  // Exclude warmup/meta sessions (default: true)
  excludeEmpty?: boolean   // Exclude sessions with 0 turns (default: true)
  search?: string
  limit?: number
  offset?: number  // For pagination - skip this many rows
}

/** Session type classification */
export type SessionType = 'main' | 'agent' | 'branch'

export interface DbSession {
  id: string
  provider: string
  provider_session_id: string | null
  project_id: string | null
  run_group_id: string | null
  origin: string
  origin_imported_at: string | null
  origin_native_file: string | null
  title: string | null
  title_override: string | null  // User's custom title (takes precedence over synced title)
  snippet: string | null
  status: string
  model: string | null
  system_prompt: string | null
  inherit_project_prompt: number | null
  cwd: string | null
  dir_scope: string | null  // 'project' | 'home'
  git_branch: string | null
  native_storage_path: string | null
  created_at: string
  last_active_at: string
  deleted_at: string | null
  turn_count: number
  total_cost: number
  total_input_tokens: number
  total_output_tokens: number
  total_duration_ms: number
  // Sub-agent/branching support (v4)
  parent_session_id: string | null
  agent_id: string | null
  is_sidechain: number | null  // 0 or 1
  session_type: SessionType | null
  slug: string | null
  version: string | null
  user_type: string | null
}

// ============================================================================
// Run Group Types
// ============================================================================

export type RunGroupStatus = 'pending' | 'running' | 'completed' | 'partial' | 'failed' | 'stopped'
export type RunGroupExecutionMode = 'worktree' | 'shared_cwd' | 'read_only' | 'detached'
export type RunGroupCoordinationMode = 'flat' | 'phased' | 'supervisor'

export interface DbRunGroup {
  id: string
  name: string | null
  status: RunGroupStatus
  project_path: string | null
  base_branch: string | null
  execution_mode: RunGroupExecutionMode
  coordination_mode: RunGroupCoordinationMode
  requires_git: number
  workspace_root: string | null
  provider: string | null
  model: string | null
  permission_mode: string | null
  session_count: number
  completed_count: number
  failed_count: number
  total_cost: number
  total_tokens: number
  config_json: string | null
  created_at: string
  started_at: string | null
  completed_at: string | null
  updated_at: string
}

// ============================================================================
// Turn Types
// ============================================================================

/** Event classification for turns */
export type TurnKind = 'message' | 'display' | 'summary' | 'tool' | 'error'

export interface DbTurn {
  id: string
  session_id: string
  provider: string
  provider_session_id: string | null
  provider_turn_id: string | null  // Native provider message/turn ID for dedup
  turn_number: number
  user_message: string | null
  assistant_response: string | null
  thinking: string | null
  model: string | null
  permission_mode: string | null
  system_prompt: string | null
  cost: number | null
  duration_ms: number | null
  duration_api_ms: number | null
  input_tokens: number | null
  output_tokens: number | null
  cache_read_tokens: number | null
  cache_creation_tokens: number | null
  finish_reason: string | null
  error: string | null
  tools_used: string | null
  tool_results: string | null  // JSON: full tool call data with inputs/outputs
  kind: TurnKind | null  // Event classification
  ts: string
  ts_ms: number | null   // Epoch milliseconds for chronological ordering
  // Turn linking (v4)
  parent_turn_id: string | null
  uuid: string | null
}

export interface TurnCreateOptions {
  sessionId: string
  provider: ProviderId
  providerSessionId?: string | null
  providerTurnId?: string | null  // Native provider message ID for dedup (e.g., entry.uuid)
  turnNumber: number
  userMessage?: string
  assistantResponse?: string
  thinking?: string
  model?: string
  permissionMode?: string
  systemPrompt?: string
  cost?: number
  durationMs?: number
  durationApiMs?: number
  inputTokens?: number
  outputTokens?: number
  cacheReadTokens?: number
  cacheCreationTokens?: number
  finishReason?: string
  error?: string | boolean
  toolsUsed?: string[]
  toolResults?: unknown[]  // Full tool call data with inputs/outputs (JSON serializable)
  kind?: TurnKind  // Event classification (default: 'message')
  ts?: string      // Optional timestamp override (ISO string)
}

export interface TurnUpdateOptions {
  userMessage?: string
  assistantResponse?: string
  thinking?: string
  model?: string
  cost?: number
  durationMs?: number
  durationApiMs?: number
  inputTokens?: number
  outputTokens?: number
  cacheReadTokens?: number
  cacheCreationTokens?: number
  finishReason?: string
  error?: string | boolean
  toolsUsed?: string[]
  toolResults?: unknown[]  // Full tool call data with inputs/outputs (JSON serializable)
}

// ============================================================================
// Project Types
// ============================================================================

export interface ProjectSettings {
  systemPrompt?: string
  model?: string
  permissionMode?: 'plan' | 'agent'
  disallowedTools?: string[]
}

export interface Project {
  id: string
  provider: ProviderId
  name: string
  createdAt: string
  color?: string
  settings?: ProjectSettings
  sessionCount?: number
  totalCost?: number
}

export interface ProjectCreateOptions {
  id?: string
  provider: ProviderId
  name: string
  color?: string
  settings?: ProjectSettings
}

export interface ProjectUpdateData {
  name?: string
  color?: string
  settings?: ProjectSettings
}

export interface DbProject {
  id: string
  provider: string
  name: string
  color: string | null
  settings: string | null
  created_at: string
}

// ============================================================================
// File Position Types (for incremental session file tailing)
// ============================================================================

export interface FilePosition {
  filePath: string
  byteOffset: number
  fileSize: number
  mtimeMs: number
  inode: string | null
  provider: ProviderId
  lastSyncedAt: string
  createdAt: string
}

export interface DbFilePosition {
  file_path: string
  byte_offset: number
  file_size: number
  mtime_ms: number
  inode: string | null
  provider: string
  last_synced_at: string
  created_at: string
}

// ============================================================================
// Search & Stats Types
// ============================================================================

export interface SearchResult {
  id: string
  sessionId: string
  turnNumber: number
  userMessage: string | null
  assistantResponse: string | null
  model: string | null
  ts: string
  sessionTitle: string | null
  provider: ProviderId
  cwd: string | null
  userHighlighted?: string
  assistantHighlighted?: string
  rank?: number
}

export interface SessionSearchResult {
  sessionId: string
  title: string | null
  provider: ProviderId
  cwd: string | null
  projectPath: string | null
  lastActiveAt: string
  turnCount: number
  titleMatch?: string
  snippetMatch?: string
  turnMatches: Array<{
    turnNumber: number
    userHighlighted?: string
    assistantHighlighted?: string
  }>
}

export interface UsageStats {
  totalSessions: number
  totalTurns: number
  totalCost: number
  totalInputTokens: number
  totalOutputTokens: number
  byProvider: Record<string, {
    sessions: number
    turns: number
    cost: number
    inputTokens: number
    outputTokens: number
  }>
  byModel: Array<{
    model: string
    turns: number
    cost: number
    inputTokens: number
    outputTokens: number
  }>
  recentActivity: Array<{
    date: string
    sessions: number
    cost: number
    turns: number
  }>
}

// ============================================================================
// File Changes Types (v4 - file-history-snapshot tracking)
// ============================================================================

/** File operation type */
export type FileOperation = 'create' | 'modify' | 'delete' | 'rename'

export interface DbFileChange {
  id: string
  session_id: string
  turn_id: string | null
  file_path: string
  operation: FileOperation
  content_before_hash: string | null
  content_after_hash: string | null
  diff_summary: string | null
  ts: string
  ts_ms: number | null
}

export interface FileChange {
  id: string
  sessionId: string
  turnId: string | null
  filePath: string
  operation: FileOperation
  contentBeforeHash: string | null
  contentAfterHash: string | null
  diffSummary: string | null
  ts: string
  tsMs: number | null
}

export interface FileChangeCreateOptions {
  sessionId: string
  turnId?: string
  filePath: string
  operation: FileOperation
  contentBeforeHash?: string
  contentAfterHash?: string
  diffSummary?: string
  ts?: string
}

// ============================================================================
// System Events Types (v4 - system/queue-operation/summary tracking)
// ============================================================================

/** System event type */
export type SystemEventType = 'system' | 'queue-operation' | 'summary' | 'config'

export interface DbSystemEvent {
  id: string
  session_id: string
  event_type: SystemEventType
  payload: string | null  // JSON blob
  ts: string
  ts_ms: number | null
}

export interface SystemEvent {
  id: string
  sessionId: string
  eventType: SystemEventType
  payload: Record<string, unknown> | null
  ts: string
  tsMs: number | null
}

export interface SystemEventCreateOptions {
  sessionId: string
  eventType: SystemEventType
  payload?: Record<string, unknown>
  ts?: string
}
