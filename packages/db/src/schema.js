/**
 * Database schema definitions and migrations
 */

import { getDb } from './index.js';

export const SCHEMA_VERSION = 22;

export const SCHEMA_SQL = `
-- Schema version tracking
CREATE TABLE IF NOT EXISTS schema_version (
  version INTEGER PRIMARY KEY,
  applied_at TEXT NOT NULL
);

-- =============================================================================
-- SESSIONS/CONVERSATIONS (existing)
-- =============================================================================

-- Projects (provider-scoped groupings)
CREATE TABLE IF NOT EXISTS projects (
  id TEXT PRIMARY KEY,
  provider TEXT NOT NULL CHECK (provider IN ('claude', 'codex', 'gemini', 'ollama')),
  name TEXT NOT NULL,
  color TEXT DEFAULT '#6366f1',
  cross_project_id TEXT,
  session_count INTEGER DEFAULT 0,
  total_cost REAL DEFAULT 0,
  settings TEXT,
  created_at TEXT NOT NULL,

  UNIQUE(provider, name)
);

CREATE INDEX IF NOT EXISTS idx_projects_provider ON projects(provider);

-- Run groups (parallel session orchestration)
CREATE TABLE IF NOT EXISTS run_groups (
  id TEXT PRIMARY KEY,
  name TEXT,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending','running','completed','partial','failed','stopped')),
  project_path TEXT,
  base_branch TEXT,
  execution_mode TEXT NOT NULL DEFAULT 'worktree'
    CHECK (execution_mode IN ('worktree','shared_cwd','read_only','detached')),
  coordination_mode TEXT NOT NULL DEFAULT 'flat'
    CHECK (coordination_mode IN ('flat','phased','supervisor')),
  requires_git INTEGER NOT NULL DEFAULT 1,
  workspace_root TEXT,
  provider TEXT DEFAULT 'claude',
  model TEXT,
  permission_mode TEXT,
  session_count INTEGER NOT NULL DEFAULT 0,
  completed_count INTEGER NOT NULL DEFAULT 0,
  failed_count INTEGER NOT NULL DEFAULT 0,
  total_cost REAL NOT NULL DEFAULT 0,
  total_tokens INTEGER NOT NULL DEFAULT 0,
  config_json TEXT,
  created_at TEXT NOT NULL,
  started_at TEXT,
  completed_at TEXT,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_run_groups_status ON run_groups(status);
CREATE INDEX IF NOT EXISTS idx_run_groups_created ON run_groups(created_at DESC);

-- Orchestration plans (natural language → run group decomposition)
CREATE TABLE IF NOT EXISTS orchestration_plans (
  id TEXT PRIMARY KEY,
  status TEXT NOT NULL DEFAULT 'planning'
    CHECK (status IN ('planning', 'ready', 'executing', 'completed', 'failed', 'cancelled')),
  prompt TEXT NOT NULL,
  provider TEXT DEFAULT 'claude',
  model TEXT,
  plan_json TEXT,
  planner_session_id TEXT,
  run_group_id TEXT REFERENCES run_groups(id) ON DELETE SET NULL,
  project_path TEXT,
  created_at TEXT NOT NULL,
  completed_at TEXT,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_orchestration_plans_status ON orchestration_plans(status);

-- Sessions (conversation containers)
CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY,
  provider TEXT NOT NULL CHECK (provider IN ('claude', 'codex', 'gemini', 'ollama')),
  provider_session_id TEXT,
  project_id TEXT,
  run_group_id TEXT REFERENCES run_groups(id) ON DELETE SET NULL,

  -- Origin tracking
  origin TEXT NOT NULL CHECK (origin IN ('rudi', 'provider-import', 'mixed')),
  origin_imported_at TEXT,
  origin_native_file TEXT,

  -- Display
  title TEXT,
  title_override TEXT,
  snippet TEXT,

  -- State
  status TEXT DEFAULT 'active' CHECK (status IN ('active', 'archived', 'deleted')),
  model TEXT,
  system_prompt TEXT,

  -- Context
  cwd TEXT,
  project_path TEXT,
  dir_scope TEXT DEFAULT 'project' CHECK (dir_scope IN ('project', 'home')),
  git_branch TEXT,
  native_storage_path TEXT,

  -- Claude-specific metadata
  inherit_project_prompt INTEGER DEFAULT 1,
  is_warmup INTEGER DEFAULT 0,
  parent_session_id TEXT,
  agent_id TEXT,
  is_sidechain INTEGER DEFAULT 0,
  session_type TEXT DEFAULT 'main',
  slug TEXT,
  version TEXT,
  user_type TEXT DEFAULT 'external',

  -- Child session lifecycle
  started_at TEXT,
  ended_at TEXT,
  exit_code INTEGER,
  error_code TEXT,
  error_message TEXT,

  -- Timestamps
  created_at TEXT NOT NULL,
  last_active_at TEXT NOT NULL,
  deleted_at TEXT,

  -- Aggregates (denormalized for performance)
  turn_count INTEGER DEFAULT 0,
  total_cost REAL DEFAULT 0,
  total_input_tokens INTEGER DEFAULT 0,
  total_output_tokens INTEGER DEFAULT 0,
  total_duration_ms INTEGER DEFAULT 0,

  FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_sessions_provider ON sessions(provider);
CREATE INDEX IF NOT EXISTS idx_sessions_project ON sessions(project_id);
CREATE INDEX IF NOT EXISTS idx_sessions_status ON sessions(status);
CREATE INDEX IF NOT EXISTS idx_sessions_last_active ON sessions(last_active_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS idx_sessions_provider_session_unique
  ON sessions(provider, provider_session_id)
  WHERE provider_session_id IS NOT NULL AND status != 'deleted';
CREATE INDEX IF NOT EXISTS idx_sessions_cwd ON sessions(cwd);
CREATE INDEX IF NOT EXISTS idx_sessions_project_path ON sessions(project_path);
CREATE INDEX IF NOT EXISTS idx_sessions_project_active ON sessions(project_path, last_active_at DESC) WHERE status != 'deleted';
CREATE INDEX IF NOT EXISTS idx_sessions_parent ON sessions(parent_session_id);
CREATE INDEX IF NOT EXISTS idx_sessions_agent ON sessions(agent_id);
CREATE INDEX IF NOT EXISTS idx_sessions_type ON sessions(session_type);
CREATE INDEX IF NOT EXISTS idx_sessions_run_group ON sessions(run_group_id);

-- Turns (individual user->assistant exchanges)
CREATE TABLE IF NOT EXISTS turns (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL,
  provider TEXT NOT NULL,
  provider_session_id TEXT,
  provider_turn_id TEXT,

  -- Sequence
  turn_number INTEGER NOT NULL,

  -- Content
  user_message TEXT,
  assistant_response TEXT,
  thinking TEXT,

  -- Config at time of turn
  model TEXT,
  permission_mode TEXT,
  system_prompt TEXT,

  -- Metrics
  cost REAL,
  duration_ms INTEGER,
  duration_api_ms INTEGER,
  input_tokens INTEGER,
  output_tokens INTEGER,
  cache_read_tokens INTEGER,
  cache_creation_tokens INTEGER,
  context_tokens INTEGER,

  -- Completion
  finish_reason TEXT,
  error TEXT,

  -- Rich metadata (JSON)
  tools_used TEXT,
  tool_results TEXT,
  todos TEXT,
  thinking_config TEXT,
  image_ids TEXT,
  compact_metadata TEXT,

  -- Turn linking
  parent_turn_id TEXT,
  uuid TEXT,
  logical_parent_id TEXT,
  leaf_uuid TEXT,

  -- Message metadata
  user_type TEXT,
  is_meta INTEGER DEFAULT 0,
  display_only INTEGER DEFAULT 0,

  -- API metadata
  service_tier TEXT,
  api_request_id TEXT,

  -- Event classification
  kind TEXT DEFAULT 'message' CHECK (kind IN ('message', 'display', 'summary', 'tool', 'error')),

  -- Timestamps
  ts TEXT NOT NULL,
  ts_ms INTEGER,

  FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_turns_session ON turns(session_id);
CREATE INDEX IF NOT EXISTS idx_turns_ts ON turns(ts DESC);
CREATE INDEX IF NOT EXISTS idx_turns_model ON turns(model);
CREATE INDEX IF NOT EXISTS idx_turns_session_number ON turns(session_id, turn_number);
CREATE INDEX IF NOT EXISTS idx_turns_session_ts_ms ON turns(session_id, ts_ms);
CREATE UNIQUE INDEX IF NOT EXISTS idx_turns_provider_dedup
  ON turns(session_id, provider_turn_id) WHERE provider_turn_id IS NOT NULL;

-- Full-text search on turns
CREATE VIRTUAL TABLE IF NOT EXISTS turns_fts USING fts5(
  user_message,
  assistant_response,
  content='turns',
  content_rowid='rowid'
);

-- Triggers to keep FTS in sync
CREATE TRIGGER IF NOT EXISTS turns_ai AFTER INSERT ON turns BEGIN
  INSERT INTO turns_fts(rowid, user_message, assistant_response)
  VALUES (NEW.rowid, NEW.user_message, NEW.assistant_response);
END;

CREATE TRIGGER IF NOT EXISTS turns_ad AFTER DELETE ON turns BEGIN
  INSERT INTO turns_fts(turns_fts, rowid, user_message, assistant_response)
  VALUES ('delete', OLD.rowid, OLD.user_message, OLD.assistant_response);
END;

CREATE TRIGGER IF NOT EXISTS turns_au AFTER UPDATE ON turns BEGIN
  INSERT INTO turns_fts(turns_fts, rowid, user_message, assistant_response)
  VALUES ('delete', OLD.rowid, OLD.user_message, OLD.assistant_response);
  INSERT INTO turns_fts(rowid, user_message, assistant_response)
  VALUES (NEW.rowid, NEW.user_message, NEW.assistant_response);
END;

-- Tool calls (normalized from turns.tool_results JSON)
CREATE TABLE IF NOT EXISTS tool_calls (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL,
  turn_id TEXT NOT NULL,
  provider TEXT NOT NULL,
  tool_name TEXT NOT NULL,
  canonical_name TEXT,
  file_path TEXT,
  success INTEGER NOT NULL,
  error_message TEXT,
  duration_ms INTEGER,
  input_preview TEXT,
  output_preview TEXT,
  ts_ms INTEGER NOT NULL,

  FOREIGN KEY (session_id) REFERENCES sessions(id),
  FOREIGN KEY (turn_id) REFERENCES turns(id)
);

CREATE INDEX IF NOT EXISTS idx_tool_calls_session ON tool_calls(session_id);
CREATE INDEX IF NOT EXISTS idx_tool_calls_turn ON tool_calls(turn_id);
CREATE INDEX IF NOT EXISTS idx_tool_calls_name ON tool_calls(tool_name);
CREATE INDEX IF NOT EXISTS idx_tool_calls_canonical ON tool_calls(canonical_name);
CREATE INDEX IF NOT EXISTS idx_tool_calls_file ON tool_calls(file_path) WHERE file_path IS NOT NULL;

-- Full-text search on sessions
CREATE VIRTUAL TABLE IF NOT EXISTS sessions_fts USING fts5(
  session_id UNINDEXED,
  title,
  snippet
);

-- Tags (many-to-many with sessions)
CREATE TABLE IF NOT EXISTS tags (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE
);

CREATE TABLE IF NOT EXISTS session_tags (
  session_id TEXT NOT NULL,
  tag_id INTEGER NOT NULL,
  PRIMARY KEY (session_id, tag_id),
  FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE,
  FOREIGN KEY (tag_id) REFERENCES tags(id) ON DELETE CASCADE
);

-- Model pricing (for cost calculation)
CREATE TABLE IF NOT EXISTS model_pricing (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  provider TEXT NOT NULL CHECK (provider IN ('claude', 'codex', 'gemini', 'openai', 'ollama')),
  model_pattern TEXT NOT NULL,
  display_name TEXT,
  input_cost_per_mtok REAL NOT NULL,
  output_cost_per_mtok REAL NOT NULL,
  cache_read_cost_per_mtok REAL DEFAULT 0,
  cache_write_cost_per_mtok REAL DEFAULT 0,
  effective_from TEXT NOT NULL,
  effective_until TEXT,
  notes TEXT,

  UNIQUE(provider, model_pattern, effective_from)
);

CREATE INDEX IF NOT EXISTS idx_model_pricing_provider ON model_pricing(provider);
CREATE INDEX IF NOT EXISTS idx_model_pricing_pattern ON model_pricing(model_pattern);

-- =============================================================================
-- FILE POSITIONS (session file tailing)
-- =============================================================================

CREATE TABLE IF NOT EXISTS file_positions (
  file_path TEXT PRIMARY KEY,
  byte_offset INTEGER NOT NULL DEFAULT 0,
  file_size INTEGER NOT NULL DEFAULT 0,
  mtime_ms INTEGER NOT NULL DEFAULT 0,
  inode TEXT,
  provider TEXT NOT NULL CHECK (provider IN ('claude', 'codex', 'gemini', 'ollama')),
  last_synced_at TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_file_positions_provider ON file_positions(provider);

-- =============================================================================
-- FILE HISTORY (tracked files / revisions)
-- =============================================================================

CREATE TABLE IF NOT EXISTS tracked_files (
  id TEXT PRIMARY KEY,
  current_path TEXT NOT NULL,
  risk_level TEXT DEFAULT 'low' CHECK (risk_level IN ('low', 'medium', 'high')),
  created_at TEXT NOT NULL,
  deleted_at TEXT
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_tracked_files_path_active
  ON tracked_files(current_path) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_tracked_files_path ON tracked_files(current_path);
CREATE INDEX IF NOT EXISTS idx_tracked_files_active ON tracked_files(deleted_at) WHERE deleted_at IS NULL;

CREATE TABLE IF NOT EXISTS file_revisions (
  id TEXT PRIMARY KEY,
  file_id TEXT NOT NULL,
  revision_number INTEGER NOT NULL,
  parent_revision_id TEXT,
  content_hash TEXT NOT NULL,
  size_bytes INTEGER NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('edit', 'revert', 'import', 'external', 'delete')),
  author TEXT NOT NULL CHECK (author IN ('agent', 'user', 'external', 'system')),
  summary TEXT,
  is_binary INTEGER DEFAULT 0 CHECK (is_binary IN (0, 1)),
  reverted_to_revision_id TEXT,
  created_at TEXT NOT NULL,
  path_at_revision TEXT NOT NULL,
  FOREIGN KEY (file_id) REFERENCES tracked_files(id) ON DELETE CASCADE,
  FOREIGN KEY (parent_revision_id) REFERENCES file_revisions(id),
  FOREIGN KEY (reverted_to_revision_id) REFERENCES file_revisions(id)
);

CREATE INDEX IF NOT EXISTS idx_file_revisions_file ON file_revisions(file_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_file_revisions_file_rev ON file_revisions(file_id, revision_number DESC);
CREATE INDEX IF NOT EXISTS idx_file_revisions_hash ON file_revisions(content_hash);
CREATE INDEX IF NOT EXISTS idx_file_revisions_path ON file_revisions(path_at_revision);
CREATE UNIQUE INDEX IF NOT EXISTS idx_file_revisions_number ON file_revisions(file_id, revision_number);

-- =============================================================================
-- FILE CHANGES / SYSTEM EVENTS
-- =============================================================================

CREATE TABLE IF NOT EXISTS file_changes (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL,
  turn_id TEXT,
  file_path TEXT NOT NULL,
  operation TEXT NOT NULL,
  content_before_hash TEXT,
  content_after_hash TEXT,
  diff_summary TEXT,
  ts TEXT NOT NULL,
  ts_ms INTEGER,
  FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_file_changes_session ON file_changes(session_id);
CREATE INDEX IF NOT EXISTS idx_file_changes_path ON file_changes(file_path);
CREATE INDEX IF NOT EXISTS idx_file_changes_ts ON file_changes(ts_ms);

CREATE TABLE IF NOT EXISTS system_events (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL,
  event_type TEXT NOT NULL,
  payload TEXT,
  ts TEXT NOT NULL,
  ts_ms INTEGER,
  FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_system_events_session ON system_events(session_id);
CREATE INDEX IF NOT EXISTS idx_system_events_type ON system_events(event_type);

-- =============================================================================
-- SESSION RUNTIME
-- =============================================================================

CREATE TABLE IF NOT EXISTS session_runtime_state (
  session_id TEXT PRIMARY KEY,
  status TEXT NOT NULL CHECK(status IN ('starting','running','retrying','completed','error','stopped','crashed')),
  provider TEXT,
  provider_session_id TEXT,
  resume_session_id TEXT,
  cwd TEXT,
  started_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  completed_at TEXT,
  last_seq INTEGER NOT NULL DEFAULT 0,
  turn_count INTEGER NOT NULL DEFAULT 0,
  cost_total REAL NOT NULL DEFAULT 0,
  tokens_total INTEGER NOT NULL DEFAULT 0,
  compaction_count INTEGER NOT NULL DEFAULT 0,
  tokens_saved_total INTEGER NOT NULL DEFAULT 0,
  last_compaction_at TEXT,
  last_compaction_json TEXT,
  unseen_completion INTEGER NOT NULL DEFAULT 0,
  last_error TEXT,
  worktree_path TEXT,
  worktree_branch TEXT,
  project_root TEXT,
  base_branch TEXT,
  use_worktree INTEGER NOT NULL DEFAULT 1,
  execution_mode TEXT DEFAULT 'shared_cwd'
);

CREATE TABLE IF NOT EXISTS session_runtime_events (
  session_id TEXT NOT NULL,
  seq INTEGER NOT NULL,
  type TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  ts TEXT NOT NULL,
  PRIMARY KEY (session_id, seq)
);

CREATE INDEX IF NOT EXISTS idx_session_runtime_events_session_ts
  ON session_runtime_events(session_id, ts);

-- =============================================================================
-- OBSERVABILITY LOGS
-- =============================================================================

CREATE TABLE IF NOT EXISTS logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  timestamp INTEGER NOT NULL,
  source TEXT NOT NULL,
  level TEXT NOT NULL CHECK (level IN ('debug', 'info', 'warn', 'error')),
  type TEXT NOT NULL,
  provider TEXT,
  cid TEXT,
  session_id TEXT,
  terminal_id INTEGER,
  feature TEXT,
  step TEXT,
  duration_ms INTEGER,
  data_json TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_logs_timestamp ON logs(timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_logs_source ON logs(source);
CREATE INDEX IF NOT EXISTS idx_logs_level ON logs(level);
CREATE INDEX IF NOT EXISTS idx_logs_type ON logs(type);
CREATE INDEX IF NOT EXISTS idx_logs_provider ON logs(provider);
CREATE INDEX IF NOT EXISTS idx_logs_session ON logs(session_id);
CREATE INDEX IF NOT EXISTS idx_logs_duration ON logs(duration_ms) WHERE duration_ms IS NOT NULL;

-- =============================================================================
-- PACKAGES (stacks, prompts, runtimes, binaries, agents)
-- =============================================================================

-- Installed packages
CREATE TABLE IF NOT EXISTS packages (
  id TEXT PRIMARY KEY,              -- e.g., 'stack:pdf-creator', 'binary:ffmpeg', 'agent:claude'
  kind TEXT NOT NULL CHECK (kind IN ('stack', 'prompt', 'runtime', 'binary', 'tool', 'agent')),
  name TEXT NOT NULL,
  version TEXT NOT NULL,
  description TEXT,

  -- Source
  source TEXT NOT NULL CHECK (source IN ('registry', 'local', 'bundled')),
  source_url TEXT,

  -- Installation
  install_path TEXT NOT NULL,
  installed_at TEXT NOT NULL,
  updated_at TEXT,

  -- Metadata (JSON)
  manifest_json TEXT,

  -- State
  status TEXT DEFAULT 'installed' CHECK (status IN ('installed', 'disabled', 'broken'))
);

CREATE INDEX IF NOT EXISTS idx_packages_kind ON packages(kind);
CREATE INDEX IF NOT EXISTS idx_packages_status ON packages(status);

-- Package dependencies
CREATE TABLE IF NOT EXISTS package_deps (
  package_id TEXT NOT NULL,
  depends_on TEXT NOT NULL,         -- e.g., 'runtime:python'
  version_constraint TEXT,          -- e.g., '>=3.10'
  PRIMARY KEY (package_id, depends_on),
  FOREIGN KEY (package_id) REFERENCES packages(id) ON DELETE CASCADE
);

-- Stack runs
CREATE TABLE IF NOT EXISTS runs (
  id TEXT PRIMARY KEY,
  package_id TEXT NOT NULL,
  package_version TEXT NOT NULL,

  -- Inputs/outputs (JSON)
  inputs_json TEXT,
  outputs_json TEXT,

  -- Secrets used (names only, not values)
  secrets_used TEXT,                -- JSON array of secret names

  -- Execution
  status TEXT NOT NULL CHECK (status IN ('pending', 'running', 'success', 'failed', 'cancelled')),
  exit_code INTEGER,
  error TEXT,

  -- Context
  cwd TEXT,

  -- Timestamps
  started_at TEXT NOT NULL,
  ended_at TEXT,
  duration_ms INTEGER,

  FOREIGN KEY (package_id) REFERENCES packages(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_runs_package ON runs(package_id);
CREATE INDEX IF NOT EXISTS idx_runs_status ON runs(status);
CREATE INDEX IF NOT EXISTS idx_runs_started ON runs(started_at DESC);

-- Run artifacts (files produced by runs)
CREATE TABLE IF NOT EXISTS artifacts (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL,

  -- File info
  filename TEXT NOT NULL,
  path TEXT NOT NULL,
  mime_type TEXT,
  size_bytes INTEGER,

  -- Metadata
  created_at TEXT NOT NULL,

  FOREIGN KEY (run_id) REFERENCES runs(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_artifacts_run ON artifacts(run_id);

-- Lockfiles (for reproducibility)
CREATE TABLE IF NOT EXISTS lockfiles (
  package_id TEXT PRIMARY KEY,
  content_json TEXT NOT NULL,       -- Full lockfile content
  created_at TEXT NOT NULL,
  updated_at TEXT,

  FOREIGN KEY (package_id) REFERENCES packages(id) ON DELETE CASCADE
);

-- =============================================================================
-- SECRETS (metadata only - actual values stored elsewhere)
-- =============================================================================

CREATE TABLE IF NOT EXISTS secrets_meta (
  name TEXT PRIMARY KEY,            -- e.g., 'VERCEL_TOKEN'
  description TEXT,
  hint TEXT,                        -- e.g., 'Starts with vcel_'
  link TEXT,                        -- URL for setup help
  added_at TEXT NOT NULL,
  last_used_at TEXT
);
`;

/**
 * Initialize the database schema
 * Creates all tables if they don't exist, runs migrations if needed
 */
export function initSchemaWithDb(db) {
  // Check current version
  const hasVersionTable = db.prepare(`
    SELECT name FROM sqlite_master WHERE type='table' AND name='schema_version'
  `).get();

  if (!hasVersionTable) {
    // Fresh install - run full schema
    console.log('Initializing database schema...');
    db.exec(SCHEMA_SQL);
    applySchemaUpdates(db);

    db.prepare('INSERT INTO schema_version (version, applied_at) VALUES (?, ?)')
      .run(SCHEMA_VERSION, new Date().toISOString());

    console.log(`Database initialized at schema version ${SCHEMA_VERSION}`);
    return { version: SCHEMA_VERSION, migrated: false };
  }

  // Check for migrations
  const currentVersion = db.prepare('SELECT MAX(version) as v FROM schema_version').get().v || 0;

  if (currentVersion < SCHEMA_VERSION) {
    runMigrations(db, currentVersion, SCHEMA_VERSION);
    return { version: SCHEMA_VERSION, migrated: true, from: currentVersion };
  }

  // Ensure idempotent schema updates even when version is current
  db.exec(SCHEMA_SQL);
  applySchemaUpdates(db);

  return { version: currentVersion, migrated: false };
}

export function initSchema() {
  return initSchemaWithDb(getDb());
}

export function applySchemaUpdates(db) {
  // Projects
  if (tableExists(db, 'projects')) {
    ensureColumn(db, 'projects', 'settings', 'ALTER TABLE projects ADD COLUMN settings TEXT');
  }

  // Run groups
  ensureTable(db, 'run_groups', `
    CREATE TABLE IF NOT EXISTS run_groups (
      id TEXT PRIMARY KEY,
      name TEXT,
      status TEXT NOT NULL DEFAULT 'pending'
        CHECK (status IN ('pending','running','completed','partial','failed','stopped')),
      project_path TEXT,
      base_branch TEXT,
      execution_mode TEXT NOT NULL DEFAULT 'worktree'
        CHECK (execution_mode IN ('worktree','shared_cwd','read_only','detached')),
      coordination_mode TEXT NOT NULL DEFAULT 'flat'
        CHECK (coordination_mode IN ('flat','phased','supervisor')),
      requires_git INTEGER NOT NULL DEFAULT 1,
      workspace_root TEXT,
      provider TEXT DEFAULT 'claude',
      model TEXT,
      permission_mode TEXT,
      session_count INTEGER NOT NULL DEFAULT 0,
      completed_count INTEGER NOT NULL DEFAULT 0,
      failed_count INTEGER NOT NULL DEFAULT 0,
      total_cost REAL NOT NULL DEFAULT 0,
      total_tokens INTEGER NOT NULL DEFAULT 0,
      config_json TEXT,
      created_at TEXT NOT NULL,
      started_at TEXT,
      completed_at TEXT,
      updated_at TEXT NOT NULL
    );
  `);
  ensureColumn(
    db,
    'run_groups',
    'execution_mode',
    "ALTER TABLE run_groups ADD COLUMN execution_mode TEXT NOT NULL DEFAULT 'worktree'"
  );
  ensureColumn(
    db,
    'run_groups',
    'coordination_mode',
    "ALTER TABLE run_groups ADD COLUMN coordination_mode TEXT NOT NULL DEFAULT 'flat'"
  );
  ensureColumn(
    db,
    'run_groups',
    'requires_git',
    'ALTER TABLE run_groups ADD COLUMN requires_git INTEGER NOT NULL DEFAULT 1'
  );
  ensureColumn(
    db,
    'run_groups',
    'workspace_root',
    'ALTER TABLE run_groups ADD COLUMN workspace_root TEXT'
  );
  ensureIndex(
    db,
    'idx_run_groups_status',
    "CREATE INDEX IF NOT EXISTS idx_run_groups_status ON run_groups(status)"
  );
  ensureIndex(
    db,
    'idx_run_groups_created',
    "CREATE INDEX IF NOT EXISTS idx_run_groups_created ON run_groups(created_at DESC)"
  );

  // Orchestration plans
  ensureTable(db, 'orchestration_plans', `
    CREATE TABLE IF NOT EXISTS orchestration_plans (
      id TEXT PRIMARY KEY,
      status TEXT NOT NULL DEFAULT 'planning'
        CHECK (status IN ('planning', 'ready', 'executing', 'completed', 'failed', 'cancelled')),
      prompt TEXT NOT NULL,
      provider TEXT DEFAULT 'claude',
      model TEXT,
      plan_json TEXT,
      planner_session_id TEXT,
      run_group_id TEXT REFERENCES run_groups(id) ON DELETE SET NULL,
      project_path TEXT,
      created_at TEXT NOT NULL,
      completed_at TEXT,
      updated_at TEXT NOT NULL
    );
  `);
  ensureIndex(
    db,
    'idx_orchestration_plans_status',
    "CREATE INDEX IF NOT EXISTS idx_orchestration_plans_status ON orchestration_plans(status)"
  );

  // Sessions
  if (tableExists(db, 'sessions')) {
    ensureColumn(db, 'sessions', 'title_override', 'ALTER TABLE sessions ADD COLUMN title_override TEXT');
    ensureColumn(db, 'sessions', 'system_prompt', 'ALTER TABLE sessions ADD COLUMN system_prompt TEXT');
    ensureColumn(
      db,
      'sessions',
      'dir_scope',
      "ALTER TABLE sessions ADD COLUMN dir_scope TEXT DEFAULT 'project' CHECK (dir_scope IN ('project', 'home'))"
    );
    ensureColumn(
      db,
      'sessions',
      'inherit_project_prompt',
      'ALTER TABLE sessions ADD COLUMN inherit_project_prompt INTEGER DEFAULT 1'
    );
    ensureColumn(db, 'sessions', 'is_warmup', 'ALTER TABLE sessions ADD COLUMN is_warmup INTEGER DEFAULT 0');
    ensureColumn(db, 'sessions', 'parent_session_id', 'ALTER TABLE sessions ADD COLUMN parent_session_id TEXT');
    ensureColumn(db, 'sessions', 'agent_id', 'ALTER TABLE sessions ADD COLUMN agent_id TEXT');
    ensureColumn(db, 'sessions', 'is_sidechain', 'ALTER TABLE sessions ADD COLUMN is_sidechain INTEGER DEFAULT 0');
    ensureColumn(
      db,
      'sessions',
      'session_type',
      "ALTER TABLE sessions ADD COLUMN session_type TEXT DEFAULT 'main'"
    );
    ensureColumn(db, 'sessions', 'slug', 'ALTER TABLE sessions ADD COLUMN slug TEXT');
    ensureColumn(db, 'sessions', 'version', 'ALTER TABLE sessions ADD COLUMN version TEXT');
    ensureColumn(
      db,
      'sessions',
      'user_type',
      "ALTER TABLE sessions ADD COLUMN user_type TEXT DEFAULT 'external'"
    );
    // Child session lifecycle columns (v9)
    ensureColumn(db, 'sessions', 'started_at', 'ALTER TABLE sessions ADD COLUMN started_at TEXT');
    ensureColumn(db, 'sessions', 'ended_at', 'ALTER TABLE sessions ADD COLUMN ended_at TEXT');
    ensureColumn(db, 'sessions', 'exit_code', 'ALTER TABLE sessions ADD COLUMN exit_code INTEGER');
    ensureColumn(db, 'sessions', 'error_code', 'ALTER TABLE sessions ADD COLUMN error_code TEXT');
    ensureColumn(db, 'sessions', 'error_message', 'ALTER TABLE sessions ADD COLUMN error_message TEXT');
    // v10: project_path for DB-as-spine sidebar queries
    ensureColumn(db, 'sessions', 'project_path', 'ALTER TABLE sessions ADD COLUMN project_path TEXT');
    // v15: run group linkage for parallel orchestration
    ensureColumn(
      db,
      'sessions',
      'run_group_id',
      'ALTER TABLE sessions ADD COLUMN run_group_id TEXT REFERENCES run_groups(id) ON DELETE SET NULL'
    );
    // v11: title provenance tracking
    ensureColumn(db, 'sessions', 'title_source', 'ALTER TABLE sessions ADD COLUMN title_source TEXT');
    ensureColumn(db, 'sessions', 'title_generated_at', 'ALTER TABLE sessions ADD COLUMN title_generated_at TEXT');
    ensureSessionsFtsHealthy(db);

    if (columnExists(db, 'sessions', 'session_type')) {
      db.exec("UPDATE sessions SET session_type = 'main' WHERE session_type = 'task'");
    }

    ensureIndex(db, 'idx_sessions_parent', 'CREATE INDEX IF NOT EXISTS idx_sessions_parent ON sessions(parent_session_id)');
    ensureIndex(db, 'idx_sessions_agent', 'CREATE INDEX IF NOT EXISTS idx_sessions_agent ON sessions(agent_id)');
    ensureIndex(db, 'idx_sessions_type', 'CREATE INDEX IF NOT EXISTS idx_sessions_type ON sessions(session_type)');
    ensureIndex(db, 'idx_sessions_project_path', 'CREATE INDEX IF NOT EXISTS idx_sessions_project_path ON sessions(project_path)');
    ensureIndex(db, 'idx_sessions_project_active', "CREATE INDEX IF NOT EXISTS idx_sessions_project_active ON sessions(project_path, last_active_at DESC) WHERE status != 'deleted'");
    ensureIndex(db, 'idx_sessions_run_group', 'CREATE INDEX IF NOT EXISTS idx_sessions_run_group ON sessions(run_group_id)');

    if (!indexExists(db, 'idx_sessions_provider_session_unique')) {
      dedupeProviderSessions(db);
      db.exec('DROP INDEX IF EXISTS idx_sessions_provider_session');
      db.exec(`
        CREATE UNIQUE INDEX IF NOT EXISTS idx_sessions_provider_session_unique
          ON sessions(provider, provider_session_id)
          WHERE provider_session_id IS NOT NULL AND status != 'deleted'
      `);
    }

  }

  // Turns
  if (tableExists(db, 'turns')) {
    ensureColumn(db, 'turns', 'provider_turn_id', 'ALTER TABLE turns ADD COLUMN provider_turn_id TEXT');
    ensureColumn(db, 'turns', 'system_prompt', 'ALTER TABLE turns ADD COLUMN system_prompt TEXT');
    ensureColumn(db, 'turns', 'parent_turn_id', 'ALTER TABLE turns ADD COLUMN parent_turn_id TEXT');
    ensureColumn(db, 'turns', 'uuid', 'ALTER TABLE turns ADD COLUMN uuid TEXT');
    ensureColumn(db, 'turns', 'service_tier', 'ALTER TABLE turns ADD COLUMN service_tier TEXT');
    ensureColumn(db, 'turns', 'api_request_id', 'ALTER TABLE turns ADD COLUMN api_request_id TEXT');
    ensureColumn(db, 'turns', 'tool_results', 'ALTER TABLE turns ADD COLUMN tool_results TEXT');
    ensureColumn(db, 'turns', 'user_type', 'ALTER TABLE turns ADD COLUMN user_type TEXT');
    ensureColumn(db, 'turns', 'is_meta', 'ALTER TABLE turns ADD COLUMN is_meta INTEGER DEFAULT 0');
    ensureColumn(db, 'turns', 'display_only', 'ALTER TABLE turns ADD COLUMN display_only INTEGER DEFAULT 0');
    ensureColumn(db, 'turns', 'todos', 'ALTER TABLE turns ADD COLUMN todos TEXT');
    ensureColumn(db, 'turns', 'thinking_config', 'ALTER TABLE turns ADD COLUMN thinking_config TEXT');
    ensureColumn(db, 'turns', 'image_ids', 'ALTER TABLE turns ADD COLUMN image_ids TEXT');
    ensureColumn(db, 'turns', 'compact_metadata', 'ALTER TABLE turns ADD COLUMN compact_metadata TEXT');
    ensureColumn(db, 'turns', 'context_tokens', 'ALTER TABLE turns ADD COLUMN context_tokens INTEGER');
    ensureColumn(db, 'turns', 'logical_parent_id', 'ALTER TABLE turns ADD COLUMN logical_parent_id TEXT');
    ensureColumn(db, 'turns', 'leaf_uuid', 'ALTER TABLE turns ADD COLUMN leaf_uuid TEXT');

    if (!columnExists(db, 'turns', 'ts_ms')) {
      db.exec('ALTER TABLE turns ADD COLUMN ts_ms INTEGER');
      db.exec(`
        UPDATE turns
        SET ts_ms = CASE
          WHEN ts GLOB '[0-9]*' AND LENGTH(ts) >= 13 THEN CAST(ts AS INTEGER)
          WHEN ts LIKE '____-__-__T__:__:__*' THEN
            CAST((julianday(SUBSTR(ts, 1, 19)) - julianday('1970-01-01')) * 86400000 AS INTEGER)
          ELSE CAST((julianday(ts) - julianday('1970-01-01')) * 86400000 AS INTEGER)
        END
        WHERE ts_ms IS NULL AND ts IS NOT NULL
      `);
    }

    if (columnExists(db, 'turns', 'ts_ms')) {
      ensureIndex(
        db,
        'idx_turns_session_ts_ms',
        'CREATE INDEX IF NOT EXISTS idx_turns_session_ts_ms ON turns(session_id, ts_ms)'
      );
    }

    if (!columnExists(db, 'turns', 'kind')) {
      db.exec("ALTER TABLE turns ADD COLUMN kind TEXT DEFAULT 'message' CHECK (kind IN ('message', 'display', 'summary', 'tool', 'error'))");
      db.exec(`
        UPDATE turns SET kind = 'display'
        WHERE user_message LIKE '[display: %]' AND assistant_response IS NULL
      `);
    }

    if (columnExists(db, 'turns', 'provider_turn_id')) {
      ensureIndex(
        db,
        'idx_turns_provider_dedup',
        'CREATE UNIQUE INDEX IF NOT EXISTS idx_turns_provider_dedup ON turns(session_id, provider_turn_id) WHERE provider_turn_id IS NOT NULL'
      );
    }
  }

  // File positions
  ensureTable(db, 'file_positions', `
    CREATE TABLE IF NOT EXISTS file_positions (
      file_path TEXT PRIMARY KEY,
      byte_offset INTEGER NOT NULL DEFAULT 0,
      file_size INTEGER NOT NULL DEFAULT 0,
      mtime_ms INTEGER NOT NULL DEFAULT 0,
      inode TEXT,
      provider TEXT NOT NULL CHECK (provider IN ('claude', 'codex', 'gemini', 'ollama')),
      last_synced_at TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
  `);
  ensureIndex(
    db,
    'idx_file_positions_provider',
    'CREATE INDEX IF NOT EXISTS idx_file_positions_provider ON file_positions(provider)'
  );

  // File history
  ensureTable(db, 'tracked_files', `
    CREATE TABLE IF NOT EXISTS tracked_files (
      id TEXT PRIMARY KEY,
      current_path TEXT NOT NULL,
      risk_level TEXT DEFAULT 'low' CHECK (risk_level IN ('low', 'medium', 'high')),
      created_at TEXT NOT NULL,
      deleted_at TEXT
    );
  `);
  ensureIndex(
    db,
    'idx_tracked_files_path_active',
    'CREATE UNIQUE INDEX IF NOT EXISTS idx_tracked_files_path_active ON tracked_files(current_path) WHERE deleted_at IS NULL'
  );
  ensureIndex(
    db,
    'idx_tracked_files_path',
    'CREATE INDEX IF NOT EXISTS idx_tracked_files_path ON tracked_files(current_path)'
  );
  ensureIndex(
    db,
    'idx_tracked_files_active',
    'CREATE INDEX IF NOT EXISTS idx_tracked_files_active ON tracked_files(deleted_at) WHERE deleted_at IS NULL'
  );

  ensureTable(db, 'file_revisions', `
    CREATE TABLE IF NOT EXISTS file_revisions (
      id TEXT PRIMARY KEY,
      file_id TEXT NOT NULL,
      revision_number INTEGER NOT NULL,
      parent_revision_id TEXT,
      content_hash TEXT NOT NULL,
      size_bytes INTEGER NOT NULL,
      kind TEXT NOT NULL CHECK (kind IN ('edit', 'revert', 'import', 'external', 'delete')),
      author TEXT NOT NULL CHECK (author IN ('agent', 'user', 'external', 'system')),
      summary TEXT,
      is_binary INTEGER DEFAULT 0 CHECK (is_binary IN (0, 1)),
      reverted_to_revision_id TEXT,
      created_at TEXT NOT NULL,
      path_at_revision TEXT NOT NULL,
      FOREIGN KEY (file_id) REFERENCES tracked_files(id) ON DELETE CASCADE,
      FOREIGN KEY (parent_revision_id) REFERENCES file_revisions(id),
      FOREIGN KEY (reverted_to_revision_id) REFERENCES file_revisions(id)
    );
  `);
  ensureIndex(
    db,
    'idx_file_revisions_file',
    'CREATE INDEX IF NOT EXISTS idx_file_revisions_file ON file_revisions(file_id, created_at DESC)'
  );
  ensureIndex(
    db,
    'idx_file_revisions_file_rev',
    'CREATE INDEX IF NOT EXISTS idx_file_revisions_file_rev ON file_revisions(file_id, revision_number DESC)'
  );
  ensureIndex(
    db,
    'idx_file_revisions_hash',
    'CREATE INDEX IF NOT EXISTS idx_file_revisions_hash ON file_revisions(content_hash)'
  );
  ensureIndex(
    db,
    'idx_file_revisions_path',
    'CREATE INDEX IF NOT EXISTS idx_file_revisions_path ON file_revisions(path_at_revision)'
  );
  ensureIndex(
    db,
    'idx_file_revisions_number',
    'CREATE UNIQUE INDEX IF NOT EXISTS idx_file_revisions_number ON file_revisions(file_id, revision_number)'
  );

  if (tableExists(db, 'file_revisions')) {
    ensureColumn(
      db,
      'file_revisions',
      'is_binary',
      'ALTER TABLE file_revisions ADD COLUMN is_binary INTEGER DEFAULT 0 CHECK (is_binary IN (0, 1))'
    );
  }

  // File changes + system events
  ensureTable(db, 'file_changes', `
    CREATE TABLE IF NOT EXISTS file_changes (
      id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL,
      turn_id TEXT,
      file_path TEXT NOT NULL,
      operation TEXT NOT NULL,
      content_before_hash TEXT,
      content_after_hash TEXT,
      diff_summary TEXT,
      ts TEXT NOT NULL,
      ts_ms INTEGER,
      FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE
    );
  `);
  ensureIndex(
    db,
    'idx_file_changes_session',
    'CREATE INDEX IF NOT EXISTS idx_file_changes_session ON file_changes(session_id)'
  );
  ensureIndex(
    db,
    'idx_file_changes_path',
    'CREATE INDEX IF NOT EXISTS idx_file_changes_path ON file_changes(file_path)'
  );
  ensureIndex(
    db,
    'idx_file_changes_ts',
    'CREATE INDEX IF NOT EXISTS idx_file_changes_ts ON file_changes(ts_ms)'
  );

  ensureTable(db, 'system_events', `
    CREATE TABLE IF NOT EXISTS system_events (
      id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL,
      event_type TEXT NOT NULL,
      payload TEXT,
      ts TEXT NOT NULL,
      ts_ms INTEGER,
      FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE
    );
  `);
  ensureIndex(
    db,
    'idx_system_events_session',
    'CREATE INDEX IF NOT EXISTS idx_system_events_session ON system_events(session_id)'
  );
  ensureIndex(
    db,
    'idx_system_events_type',
    'CREATE INDEX IF NOT EXISTS idx_system_events_type ON system_events(event_type)'
  );

  // Session runtime
  ensureTable(db, 'session_runtime_state', `
    CREATE TABLE IF NOT EXISTS session_runtime_state (
      session_id TEXT PRIMARY KEY,
      status TEXT NOT NULL CHECK(status IN ('starting','running','retrying','completed','error','stopped','crashed')),
      provider TEXT,
      provider_session_id TEXT,
      resume_session_id TEXT,
      cwd TEXT,
      started_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      completed_at TEXT,
      last_seq INTEGER NOT NULL DEFAULT 0,
      turn_count INTEGER NOT NULL DEFAULT 0,
      cost_total REAL NOT NULL DEFAULT 0,
      tokens_total INTEGER NOT NULL DEFAULT 0,
      compaction_count INTEGER NOT NULL DEFAULT 0,
      tokens_saved_total INTEGER NOT NULL DEFAULT 0,
      last_compaction_at TEXT,
      last_compaction_json TEXT,
      unseen_completion INTEGER NOT NULL DEFAULT 0,
      last_error TEXT
    )
  `);

  // Defensive ensureColumn for tables that exist but weren't migrated
  if (tableExists(db, 'session_runtime_state')) {
    ensureColumn(db, 'session_runtime_state', 'turn_count', 'ALTER TABLE session_runtime_state ADD COLUMN turn_count INTEGER NOT NULL DEFAULT 0');
    ensureColumn(db, 'session_runtime_state', 'cwd', 'ALTER TABLE session_runtime_state ADD COLUMN cwd TEXT');
    ensureColumn(db, 'session_runtime_state', 'resume_session_id', 'ALTER TABLE session_runtime_state ADD COLUMN resume_session_id TEXT');
    ensureColumn(db, 'session_runtime_state', 'compaction_count', 'ALTER TABLE session_runtime_state ADD COLUMN compaction_count INTEGER NOT NULL DEFAULT 0');
    ensureColumn(db, 'session_runtime_state', 'tokens_saved_total', 'ALTER TABLE session_runtime_state ADD COLUMN tokens_saved_total INTEGER NOT NULL DEFAULT 0');
    ensureColumn(db, 'session_runtime_state', 'last_compaction_at', 'ALTER TABLE session_runtime_state ADD COLUMN last_compaction_at TEXT');
    ensureColumn(db, 'session_runtime_state', 'last_compaction_json', 'ALTER TABLE session_runtime_state ADD COLUMN last_compaction_json TEXT');
    // Worktree isolation columns (v8)
    ensureColumn(db, 'session_runtime_state', 'worktree_path', 'ALTER TABLE session_runtime_state ADD COLUMN worktree_path TEXT');
    ensureColumn(db, 'session_runtime_state', 'worktree_branch', 'ALTER TABLE session_runtime_state ADD COLUMN worktree_branch TEXT');
    ensureColumn(db, 'session_runtime_state', 'project_root', 'ALTER TABLE session_runtime_state ADD COLUMN project_root TEXT');
    ensureColumn(db, 'session_runtime_state', 'base_branch', 'ALTER TABLE session_runtime_state ADD COLUMN base_branch TEXT');
    ensureColumn(db, 'session_runtime_state', 'use_worktree', 'ALTER TABLE session_runtime_state ADD COLUMN use_worktree INTEGER NOT NULL DEFAULT 1');
    ensureColumn(db, 'session_runtime_state', 'execution_mode', "ALTER TABLE session_runtime_state ADD COLUMN execution_mode TEXT DEFAULT 'shared_cwd'");
  }

  ensureTable(db, 'session_runtime_events', `
    CREATE TABLE IF NOT EXISTS session_runtime_events (
      session_id TEXT NOT NULL,
      seq INTEGER NOT NULL,
      type TEXT NOT NULL,
      payload_json TEXT NOT NULL,
      ts TEXT NOT NULL,
      PRIMARY KEY (session_id, seq)
    );
  `);
  ensureIndex(
    db,
    'idx_session_runtime_events_session_ts',
    'CREATE INDEX IF NOT EXISTS idx_session_runtime_events_session_ts ON session_runtime_events(session_id, ts)'
  );

  // Logs
  ensureTable(db, 'logs', `
    CREATE TABLE IF NOT EXISTS logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      timestamp INTEGER NOT NULL,
      source TEXT NOT NULL,
      level TEXT NOT NULL CHECK (level IN ('debug', 'info', 'warn', 'error')),
      type TEXT NOT NULL,
      provider TEXT,
      cid TEXT,
      session_id TEXT,
      terminal_id INTEGER,
      feature TEXT,
      step TEXT,
      duration_ms INTEGER,
      data_json TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);
  ensureIndex(
    db,
    'idx_logs_timestamp',
    'CREATE INDEX IF NOT EXISTS idx_logs_timestamp ON logs(timestamp DESC)'
  );
  ensureIndex(
    db,
    'idx_logs_source',
    'CREATE INDEX IF NOT EXISTS idx_logs_source ON logs(source)'
  );
  ensureIndex(
    db,
    'idx_logs_level',
    'CREATE INDEX IF NOT EXISTS idx_logs_level ON logs(level)'
  );
  ensureIndex(
    db,
    'idx_logs_type',
    'CREATE INDEX IF NOT EXISTS idx_logs_type ON logs(type)'
  );
  ensureIndex(
    db,
    'idx_logs_provider',
    'CREATE INDEX IF NOT EXISTS idx_logs_provider ON logs(provider)'
  );
  ensureIndex(
    db,
    'idx_logs_session',
    'CREATE INDEX IF NOT EXISTS idx_logs_session ON logs(session_id)'
  );
  ensureIndex(
    db,
    'idx_logs_duration',
    'CREATE INDEX IF NOT EXISTS idx_logs_duration ON logs(duration_ms) WHERE duration_ms IS NOT NULL'
  );

  // Pricing table may exist but be empty
  ensureTable(db, 'model_pricing', `
    CREATE TABLE IF NOT EXISTS model_pricing (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      provider TEXT NOT NULL CHECK (provider IN ('claude', 'codex', 'gemini', 'openai', 'ollama')),
      model_pattern TEXT NOT NULL,
      display_name TEXT,
      input_cost_per_mtok REAL NOT NULL,
      output_cost_per_mtok REAL NOT NULL,
      cache_read_cost_per_mtok REAL DEFAULT 0,
      cache_write_cost_per_mtok REAL DEFAULT 0,
      effective_from TEXT NOT NULL,
      effective_until TEXT,
      notes TEXT,
      UNIQUE(provider, model_pattern, effective_from)
    );
  `);
  ensureIndex(
    db,
    'idx_model_pricing_provider',
    'CREATE INDEX IF NOT EXISTS idx_model_pricing_provider ON model_pricing(provider)'
  );
  ensureIndex(
    db,
    'idx_model_pricing_pattern',
    'CREATE INDEX IF NOT EXISTS idx_model_pricing_pattern ON model_pricing(model_pattern)'
  );

  if (tableExists(db, 'model_pricing')) {
    const count = db.prepare('SELECT COUNT(*) as count FROM model_pricing').get();
    if (count && count.count === 0) {
      seedModelPricing(db);
    } else {
      // Ensure new models get added to existing DBs
      db.prepare(`
        INSERT OR IGNORE INTO model_pricing
        (provider, model_pattern, display_name, input_cost_per_mtok, output_cost_per_mtok, cache_read_cost_per_mtok, cache_write_cost_per_mtok, effective_from, notes)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run('claude', 'claude-opus-4-6%', 'Claude Opus 4.6', 5.0, 25.0, 0.50, 6.25, '2025-01-01', 'Most capable');
    }
  }
}

function extractToolPreview(input, keys) {
  if (!input || typeof input !== 'object' || !keys) return null;
  const candidates = Array.isArray(keys) ? keys : [keys];
  for (const key of candidates) {
    if (typeof input[key] === 'string') {
      return input[key].slice(0, 300);
    }
  }
  return null;
}

function extractPatchFilePath(patchText) {
  if (typeof patchText !== 'string' || patchText.length === 0) return null;
  const moved = patchText.match(/^\*\*\* Move to: (.+)$/m);
  if (moved?.[1]) return moved[1].trim();
  const fileMatch = patchText.match(/^\*\*\* (?:Update|Add|Delete) File: (.+)$/m);
  return fileMatch?.[1]?.trim() || null;
}

function extractToolBackfillData(provider, toolName, input, filePathKeys, inputPreviewKeys) {
  if (!input || typeof input !== 'object') {
    return { filePath: null, inputPreview: null };
  }

  const filePathKey = filePathKeys[provider]?.[toolName];
  let filePath = filePathKey && typeof input[filePathKey] === 'string'
    ? input[filePathKey]
    : null;

  if (!filePath && provider === 'codex' && toolName === 'apply_patch') {
    filePath = extractPatchFilePath(input.apply_patch);
  }

  const inputPreview = extractToolPreview(input, inputPreviewKeys[provider]?.[toolName]);
  return { filePath, inputPreview };
}

function escapeRegex(text) {
  return String(text).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function decodeJsonStringFragment(fragment) {
  if (typeof fragment !== 'string') return null;
  return fragment
    .replace(/\\u([0-9a-fA-F]{4})/g, (_, hex) => String.fromCharCode(Number.parseInt(hex, 16)))
    .replace(/\\n/g, '\n')
    .replace(/\\r/g, '\r')
    .replace(/\\t/g, '\t')
    .replace(/\\"/g, '"')
    .replace(/\\\\/g, '\\');
}

function extractToolPreviewFromBlob(blob, keys) {
  if (typeof blob !== 'string' || !keys) return null;
  const candidates = Array.isArray(keys) ? keys : [keys];
  for (const key of candidates) {
    const pattern = new RegExp(`"${escapeRegex(key)}"\\s*:\\s*"((?:\\\\.|[^"])*)`);
    const match = blob.match(pattern);
    if (!match?.[1]) continue;
    const decoded = decodeJsonStringFragment(match[1]);
    if (decoded) return decoded.slice(0, 300);
  }
  return null;
}

function extractToolBackfillDataFromBlob(provider, toolName, blob, filePathKeys, inputPreviewKeys) {
  const filePathKey = filePathKeys[provider]?.[toolName];
  let filePath = extractToolPreviewFromBlob(blob, filePathKey);

  if (!filePath && provider === 'codex' && toolName === 'apply_patch') {
    const patchText = extractToolPreviewFromBlob(blob, 'apply_patch');
    filePath = extractPatchFilePath(patchText);
  }

  const inputPreview = extractToolPreviewFromBlob(blob, inputPreviewKeys[provider]?.[toolName]);
  return { filePath, inputPreview };
}

/**
 * Run schema migrations from one version to another
 * @param {Database.Database} db
 * @param {number} from - Current version
 * @param {number} to - Target version
 */
function runMigrations(db, from, to) {
  console.log(`Migrating database from v${from} to v${to}...`);

  // Migration functions keyed by target version
  const migrations = {
    // Version 2: Add model_pricing table
    2: (db) => {
      db.exec(`
        CREATE TABLE IF NOT EXISTS model_pricing (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          provider TEXT NOT NULL CHECK (provider IN ('claude', 'codex', 'gemini', 'openai', 'ollama')),
          model_pattern TEXT NOT NULL,
          display_name TEXT,
          input_cost_per_mtok REAL NOT NULL,
          output_cost_per_mtok REAL NOT NULL,
          cache_read_cost_per_mtok REAL DEFAULT 0,
          cache_write_cost_per_mtok REAL DEFAULT 0,
          effective_from TEXT NOT NULL,
          effective_until TEXT,
          notes TEXT,
          UNIQUE(provider, model_pattern, effective_from)
        );
        CREATE INDEX IF NOT EXISTS idx_model_pricing_provider ON model_pricing(provider);
        CREATE INDEX IF NOT EXISTS idx_model_pricing_pattern ON model_pricing(model_pattern);
      `);
      seedModelPricing(db);
    },

    // Version 3: Add packages, runs, artifacts, lockfiles, secrets_meta tables
    3: (db) => {
      db.exec(`
        CREATE TABLE IF NOT EXISTS packages (
          id TEXT PRIMARY KEY,
          kind TEXT NOT NULL CHECK (kind IN ('stack', 'prompt', 'runtime', 'binary', 'tool', 'agent')),
          name TEXT NOT NULL,
          version TEXT NOT NULL,
          description TEXT,
          source TEXT NOT NULL CHECK (source IN ('registry', 'local', 'bundled')),
          source_url TEXT,
          install_path TEXT NOT NULL,
          installed_at TEXT NOT NULL,
          updated_at TEXT,
          manifest_json TEXT,
          status TEXT DEFAULT 'installed' CHECK (status IN ('installed', 'disabled', 'broken'))
        );
        CREATE INDEX IF NOT EXISTS idx_packages_kind ON packages(kind);
        CREATE INDEX IF NOT EXISTS idx_packages_status ON packages(status);

        CREATE TABLE IF NOT EXISTS package_deps (
          package_id TEXT NOT NULL,
          depends_on TEXT NOT NULL,
          version_constraint TEXT,
          PRIMARY KEY (package_id, depends_on),
          FOREIGN KEY (package_id) REFERENCES packages(id) ON DELETE CASCADE
        );

        CREATE TABLE IF NOT EXISTS runs (
          id TEXT PRIMARY KEY,
          package_id TEXT NOT NULL,
          package_version TEXT NOT NULL,
          inputs_json TEXT,
          outputs_json TEXT,
          secrets_used TEXT,
          status TEXT NOT NULL CHECK (status IN ('pending', 'running', 'success', 'failed', 'cancelled')),
          exit_code INTEGER,
          error TEXT,
          cwd TEXT,
          started_at TEXT NOT NULL,
          ended_at TEXT,
          duration_ms INTEGER,
          FOREIGN KEY (package_id) REFERENCES packages(id) ON DELETE SET NULL
        );
        CREATE INDEX IF NOT EXISTS idx_runs_package ON runs(package_id);
        CREATE INDEX IF NOT EXISTS idx_runs_status ON runs(status);
        CREATE INDEX IF NOT EXISTS idx_runs_started ON runs(started_at DESC);

        CREATE TABLE IF NOT EXISTS artifacts (
          id TEXT PRIMARY KEY,
          run_id TEXT NOT NULL,
          filename TEXT NOT NULL,
          path TEXT NOT NULL,
          mime_type TEXT,
          size_bytes INTEGER,
          created_at TEXT NOT NULL,
          FOREIGN KEY (run_id) REFERENCES runs(id) ON DELETE CASCADE
        );
        CREATE INDEX IF NOT EXISTS idx_artifacts_run ON artifacts(run_id);

        CREATE TABLE IF NOT EXISTS lockfiles (
          package_id TEXT PRIMARY KEY,
          content_json TEXT NOT NULL,
          created_at TEXT NOT NULL,
          updated_at TEXT,
          FOREIGN KEY (package_id) REFERENCES packages(id) ON DELETE CASCADE
        );

        CREATE TABLE IF NOT EXISTS secrets_meta (
          name TEXT PRIMARY KEY,
          description TEXT,
          hint TEXT,
          link TEXT,
          added_at TEXT NOT NULL,
          last_used_at TEXT
        );
      `);
    },

    // Version 4: Allow binary kind in packages (rename tool -> binary)
    4: (db) => {
      db.exec(`
        PRAGMA foreign_keys=OFF;

        CREATE TABLE IF NOT EXISTS packages_new (
          id TEXT PRIMARY KEY,
          kind TEXT NOT NULL CHECK (kind IN ('stack', 'prompt', 'runtime', 'binary', 'tool', 'agent')),
          name TEXT NOT NULL,
          version TEXT NOT NULL,
          description TEXT,
          source TEXT NOT NULL CHECK (source IN ('registry', 'local', 'bundled')),
          source_url TEXT,
          install_path TEXT NOT NULL,
          installed_at TEXT NOT NULL,
          updated_at TEXT,
          manifest_json TEXT,
          status TEXT DEFAULT 'installed' CHECK (status IN ('installed', 'disabled', 'broken'))
        );

        INSERT INTO packages_new (
          id,
          kind,
          name,
          version,
          description,
          source,
          source_url,
          install_path,
          installed_at,
          updated_at,
          manifest_json,
          status
        )
        SELECT
          id,
          CASE WHEN kind = 'tool' THEN 'binary' ELSE kind END,
          name,
          version,
          description,
          source,
          source_url,
          install_path,
          installed_at,
          updated_at,
          manifest_json,
          status
        FROM packages;

        DROP TABLE packages;
        ALTER TABLE packages_new RENAME TO packages;

        CREATE INDEX IF NOT EXISTS idx_packages_kind ON packages(kind);
        CREATE INDEX IF NOT EXISTS idx_packages_status ON packages(status);

        PRAGMA foreign_keys=ON;
      `);
    },

    // Version 5: Add session metadata columns for Claude import
    5: (db) => {
      ensureColumn(
        db,
        'sessions',
        'dir_scope',
        "ALTER TABLE sessions ADD COLUMN dir_scope TEXT DEFAULT 'project' CHECK (dir_scope IN ('project', 'home'))"
      );
      ensureColumn(
        db,
        'sessions',
        'inherit_project_prompt',
        'ALTER TABLE sessions ADD COLUMN inherit_project_prompt INTEGER DEFAULT 1'
      );
      ensureColumn(
        db,
        'sessions',
        'is_warmup',
        'ALTER TABLE sessions ADD COLUMN is_warmup INTEGER DEFAULT 0'
      );
      ensureColumn(
        db,
        'sessions',
        'parent_session_id',
        'ALTER TABLE sessions ADD COLUMN parent_session_id TEXT'
      );
      ensureColumn(
        db,
        'sessions',
        'agent_id',
        'ALTER TABLE sessions ADD COLUMN agent_id TEXT'
      );
      ensureColumn(
        db,
        'sessions',
        'is_sidechain',
        'ALTER TABLE sessions ADD COLUMN is_sidechain INTEGER DEFAULT 0'
      );
      ensureColumn(
        db,
        'sessions',
        'session_type',
        "ALTER TABLE sessions ADD COLUMN session_type TEXT DEFAULT 'main'"
      );
      ensureColumn(
        db,
        'sessions',
        'version',
        'ALTER TABLE sessions ADD COLUMN version TEXT'
      );
      ensureColumn(
        db,
        'sessions',
        'user_type',
        "ALTER TABLE sessions ADD COLUMN user_type TEXT DEFAULT 'external'"
      );
    },

    // Version 6: Bring schema to Studio parity
    6: (db) => {
      applySchemaUpdates(db);
    },

    // Version 7: Expand session_runtime_state CHECK + add columns for lifecycle tracking
    7: (db) => {
      if (tableExists(db, 'session_runtime_state')) {
        db.exec(`
          ALTER TABLE session_runtime_state RENAME TO _srs_old;
          CREATE TABLE session_runtime_state (
            session_id TEXT PRIMARY KEY,
            status TEXT NOT NULL CHECK(status IN ('starting','running','retrying','completed','error','stopped','crashed')),
            provider TEXT,
            provider_session_id TEXT,
            resume_session_id TEXT,
            cwd TEXT,
            started_at TEXT NOT NULL,
            updated_at TEXT NOT NULL,
            completed_at TEXT,
            last_seq INTEGER NOT NULL DEFAULT 0,
            turn_count INTEGER NOT NULL DEFAULT 0,
            cost_total REAL NOT NULL DEFAULT 0,
            tokens_total INTEGER NOT NULL DEFAULT 0,
            compaction_count INTEGER NOT NULL DEFAULT 0,
            tokens_saved_total INTEGER NOT NULL DEFAULT 0,
            last_compaction_at TEXT,
            last_compaction_json TEXT,
            unseen_completion INTEGER NOT NULL DEFAULT 0,
            last_error TEXT
          );
          INSERT INTO session_runtime_state
            (session_id, status, provider, provider_session_id,
             resume_session_id, cwd, started_at, updated_at, completed_at,
             last_seq, turn_count, cost_total, tokens_total, unseen_completion, last_error)
          SELECT
            session_id, status, provider, provider_session_id,
            NULL, NULL, started_at, updated_at, completed_at,
            last_seq, 0, cost_total, tokens_total, unseen_completion, last_error
          FROM _srs_old;
          DROP TABLE _srs_old;
        `);
      }
      applySchemaUpdates(db);
    },

    // Version 8: Add worktree isolation columns to session_runtime_state
    8: (db) => {
      applySchemaUpdates(db);
    },

    // Version 9: Add child session lifecycle columns to sessions
    9: (db) => {
      applySchemaUpdates(db);
    },

    // Version 10: Add project_path column for DB-as-spine sidebar queries
    10: (db) => {
      applySchemaUpdates(db);
      // Backfill project_path from cwd for existing rows
      db.exec(`UPDATE sessions SET project_path = cwd WHERE project_path IS NULL AND cwd IS NOT NULL`);
    },

    // Version 11: Add context_tokens to turns and backfill approximate values
    11: (db) => {
      applySchemaUpdates(db);
      db.exec(`
        UPDATE turns
        SET context_tokens = input_tokens
        WHERE context_tokens IS NULL
          AND input_tokens IS NOT NULL
          AND input_tokens > 0
      `);
    },

    // Version 12: Fix model pricing (correct cache rates) and recompute all costs
    12: (db) => {
      // Update pricing to correct Anthropic rates
      // https://platform.claude.com/docs/en/about-claude/pricing
      // Cache read = 0.1x input, Cache write (5min) = 1.25x input
      const updates = [
        ['claude-opus-4-6%', 5.0, 25.0, 0.50, 6.25],
        ['claude-opus-4-5-%', 5.0, 25.0, 0.50, 6.25],
        ['claude-sonnet-4-5-%', 3.0, 15.0, 0.30, 3.75],
        ['claude-haiku-4-5-%', 1.0, 5.0, 0.10, 1.25],
        // 3.5 models — correct cache rates
        ['claude-3-5-haiku-%', 0.8, 4.0, 0.08, 1.0],
        ['claude-3-5-sonnet-%', 3.0, 15.0, 0.30, 3.75],
      ];
      const updateStmt = db.prepare(`
        UPDATE model_pricing
        SET input_cost_per_mtok = ?, output_cost_per_mtok = ?,
            cache_read_cost_per_mtok = ?, cache_write_cost_per_mtok = ?
        WHERE model_pattern = ?
      `);
      for (const [pattern, inp, out, cr, cw] of updates) {
        updateStmt.run(inp, out, cr, cw, pattern);
      }

      // Recompute all turn costs using corrected formula:
      // base_input = input_tokens - cache_read_tokens - cache_creation_tokens
      // cost = base_input * input_rate + output * output_rate + cache_read * cache_read_rate + cache_creation * cache_write_rate
      //
      // Use a join-based UPDATE to avoid correlated subquery issues with SQLite
      const pricingRows = db.prepare('SELECT model_pattern, provider, input_cost_per_mtok, output_cost_per_mtok, cache_read_cost_per_mtok, cache_write_cost_per_mtok FROM model_pricing').all();
      const updateCost = db.prepare('UPDATE turns SET cost = ? WHERE id = ?');
      const allTurns = db.prepare('SELECT id, provider, model, input_tokens, output_tokens, cache_read_tokens, cache_creation_tokens FROM turns WHERE (input_tokens > 0 OR output_tokens > 0) AND model IS NOT NULL').all();
      for (const turn of allTurns) {
        const entry = pricingRows.find(p => {
          if (p.provider !== turn.provider) return false;
          const re = new RegExp('^' + p.model_pattern.replace(/%/g, '.*').replace(/_/g, '.') + '$');
          return re.test(turn.model);
        });
        if (!entry) continue;
        const baseInput = Math.max((turn.input_tokens || 0) - (turn.cache_read_tokens || 0) - (turn.cache_creation_tokens || 0), 0);
        const cost =
          baseInput * entry.input_cost_per_mtok / 1_000_000 +
          (turn.output_tokens || 0) * entry.output_cost_per_mtok / 1_000_000 +
          (turn.cache_read_tokens || 0) * entry.cache_read_cost_per_mtok / 1_000_000 +
          (turn.cache_creation_tokens || 0) * entry.cache_write_cost_per_mtok / 1_000_000;
        updateCost.run(cost, turn.id);
      }

      // Recompute session aggregates
      db.exec(`
        UPDATE sessions SET
          total_cost = COALESCE((SELECT SUM(cost) FROM turns WHERE turns.session_id = sessions.id), 0),
          total_input_tokens = COALESCE((SELECT SUM(input_tokens) FROM turns WHERE turns.session_id = sessions.id), 0),
          total_output_tokens = COALESCE((SELECT SUM(output_tokens) FROM turns WHERE turns.session_id = sessions.id), 0)
      `);
    },

    // Version 13: Fix opus-4-6 pricing pattern (was claude-opus-4-6-%, now claude-opus-4-6%)
    // The old pattern required a trailing dash, so "claude-opus-4-6" fell through to
    // "claude-opus-4-%" at $15/mtok instead of the correct $5/mtok
    13: (db) => {
      // Rename the pattern
      db.prepare(`
        UPDATE model_pricing SET model_pattern = 'claude-opus-4-6%'
        WHERE model_pattern = 'claude-opus-4-6-%'
      `).run();

      // Recompute all turn costs with correct specificity-sorted pricing
      const pricingRows = db.prepare(
        'SELECT model_pattern, provider, input_cost_per_mtok, output_cost_per_mtok, cache_read_cost_per_mtok, cache_write_cost_per_mtok FROM model_pricing ORDER BY LENGTH(model_pattern) DESC'
      ).all();
      const updateCost = db.prepare('UPDATE turns SET cost = ? WHERE id = ?');
      const allTurns = db.prepare(
        'SELECT id, provider, model, input_tokens, output_tokens, cache_read_tokens, cache_creation_tokens FROM turns WHERE (input_tokens > 0 OR output_tokens > 0) AND model IS NOT NULL'
      ).all();
      for (const turn of allTurns) {
        const entry = pricingRows.find(p => {
          if (p.provider !== null && p.provider !== turn.provider) return false;
          const re = new RegExp('^' + p.model_pattern.replace(/%/g, '.*').replace(/_/g, '.') + '$');
          return re.test(turn.model);
        });
        if (!entry) continue;
        const baseInput = Math.max((turn.input_tokens || 0) - (turn.cache_read_tokens || 0) - (turn.cache_creation_tokens || 0), 0);
        const cost =
          baseInput * entry.input_cost_per_mtok / 1_000_000 +
          (turn.output_tokens || 0) * entry.output_cost_per_mtok / 1_000_000 +
          (turn.cache_read_tokens || 0) * entry.cache_read_cost_per_mtok / 1_000_000 +
          (turn.cache_creation_tokens || 0) * entry.cache_write_cost_per_mtok / 1_000_000;
        updateCost.run(cost, turn.id);
      }

      // Recompute session aggregates
      db.exec(`
        UPDATE sessions SET
          total_cost = COALESCE((SELECT SUM(cost) FROM turns WHERE turns.session_id = sessions.id), 0),
          total_input_tokens = COALESCE((SELECT SUM(input_tokens) FROM turns WHERE turns.session_id = sessions.id), 0),
          total_output_tokens = COALESCE((SELECT SUM(output_tokens) FROM turns WHERE turns.session_id = sessions.id), 0)
      `);
    },

    // Version 14: Add tool_calls table, backfill from turns.tool_results JSON
    14: (db) => {
      db.exec(`
        CREATE TABLE IF NOT EXISTS tool_calls (
          id TEXT PRIMARY KEY,
          session_id TEXT NOT NULL,
          turn_id TEXT NOT NULL,
          provider TEXT NOT NULL,
          tool_name TEXT NOT NULL,
          canonical_name TEXT,
          file_path TEXT,
          success INTEGER NOT NULL,
          error_message TEXT,
          duration_ms INTEGER,
          input_preview TEXT,
          output_preview TEXT,
          ts_ms INTEGER NOT NULL,

          FOREIGN KEY (session_id) REFERENCES sessions(id),
          FOREIGN KEY (turn_id) REFERENCES turns(id)
        );
        CREATE INDEX IF NOT EXISTS idx_tool_calls_session ON tool_calls(session_id);
        CREATE INDEX IF NOT EXISTS idx_tool_calls_turn ON tool_calls(turn_id);
        CREATE INDEX IF NOT EXISTS idx_tool_calls_name ON tool_calls(tool_name);
        CREATE INDEX IF NOT EXISTS idx_tool_calls_canonical ON tool_calls(canonical_name);
        CREATE INDEX IF NOT EXISTS idx_tool_calls_file ON tool_calls(file_path) WHERE file_path IS NOT NULL;
      `);

      // Backfill from existing turns.tool_results JSON
      const CLAUDE_CANONICAL = {
        Read: 'file_read', Edit: 'file_edit', Write: 'file_write', NotebookEdit: 'notebook_edit',
        Grep: 'search_content', Glob: 'search_files',
        Bash: 'shell',
        WebFetch: 'web_fetch', WebSearch: 'web_search',
        LSP: 'lsp',
        Task: 'agent_spawn', AskUserQuestion: 'ask_user',
      };

      const rows = db.prepare(
        'SELECT id, session_id, provider, tool_results, ts_ms FROM turns WHERE tool_results IS NOT NULL'
      ).all();

      const insert = db.prepare(`
        INSERT OR IGNORE INTO tool_calls (id, session_id, turn_id, provider, tool_name, canonical_name, file_path, success, error_message, input_preview, output_preview, ts_ms)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);

      let backfilled = 0;
      for (const row of rows) {
        let calls;
        try { calls = JSON.parse(row.tool_results); } catch { continue; }
        if (!Array.isArray(calls)) continue;
        for (const tc of calls) {
          if (!tc.id || !tc.name) continue;
          const success = tc.status === 'error' ? 0 : 1;
          const canonical = row.provider === 'claude' ? (CLAUDE_CANONICAL[tc.name] || 'mcp') : null;
          const resultStr = typeof tc.result === 'string' ? tc.result : null;
          const errorMsg = !success && resultStr ? resultStr.slice(0, 500) : null;
          const outputPreview = success && resultStr ? resultStr.slice(0, 300) : null;
          insert.run(
            tc.id, row.session_id, row.id, row.provider,
            tc.name, canonical, null, success, errorMsg,
            null, outputPreview,
            row.ts_ms || 0,
          );
          backfilled++;
        }
      }
      console.log(`    Backfilled ${backfilled} tool_calls from existing turns`);
    },

    // Version 15: Add run_groups + sessions.run_group_id for parallel orchestration
    15: (db) => {
      applySchemaUpdates(db);
    },

    // Version 16: Add orchestration_plans table for natural language decomposition
    16: (db) => {
      applySchemaUpdates(db);
    },

    // Version 17: Backfill tool_calls file_path and input_preview from turns.tool_results JSON
    17: (db) => {
      const FILE_PATH_KEYS = {
        claude: {
          Read: 'file_path', Edit: 'file_path', Write: 'file_path',
          NotebookEdit: 'notebook_path', Grep: 'path', LSP: 'filePath',
          Glob: 'path',
        },
        codex: {
          file_read: 'path', file_edit: 'path', file_write: 'path',
        },
        gemini: {
          read_file: 'target_file', edit_file: 'target_file', create_file: 'target_file',
        },
      };
      const INPUT_PREVIEW_KEYS = {
        claude: {
          Read: 'file_path',
          Edit: 'file_path',
          Write: 'file_path',
          NotebookEdit: 'notebook_path',
          Bash: 'command',
          Grep: 'pattern',
          Glob: 'pattern',
          WebFetch: 'url',
          WebSearch: 'query',
          Task: 'description',
        },
        codex: {
          file_read: 'path',
          file_edit: 'path',
          file_write: 'path',
          apply_patch: 'apply_patch',
          shell: 'command',
          shell_command: 'command',
          exec_command: 'cmd',
          write_stdin: 'chars',
          grep: 'pattern',
          glob: 'pattern',
        },
        gemini: {
          read_file: 'target_file',
          edit_file: 'target_file',
          create_file: 'target_file',
          run_terminal_command: 'command',
          search_files: 'pattern',
        },
      };

      const rows = db.prepare(`
        SELECT id, provider, tool_results FROM turns WHERE tool_results IS NOT NULL
      `).all();

      const update = db.prepare(`
        UPDATE tool_calls
        SET file_path = COALESCE(file_path, ?), input_preview = COALESCE(input_preview, ?)
        WHERE id = ?
          AND (file_path IS NULL OR input_preview IS NULL)
      `);

      let updated = 0;
      let total = 0;
      const txn = db.transaction(() => {
        for (const row of rows) {
          let calls;
          try { calls = JSON.parse(row.tool_results); } catch { continue; }
          if (!Array.isArray(calls)) continue;

          for (const tc of calls) {
            if (!tc.id || !tc.name) continue;
            total++;

            const { filePath, inputPreview } = extractToolBackfillData(
              row.provider,
              tc.name,
              tc.input,
              FILE_PATH_KEYS,
              INPUT_PREVIEW_KEYS,
            );

            if (filePath || inputPreview) {
              const result = update.run(filePath, inputPreview, tc.id);
              if (result.changes > 0) updated++;
            }
          }

          if (total > 0 && total % 10000 === 0) {
            console.log(`    Backfill progress: ${total} tool_calls processed, ${updated} updated`);
          }
        }
      });

      txn();
      console.log(`    Backfilled ${updated}/${total} tool_calls with file_path/input_preview`);
    },

    // Version 18: Normalize JSON blob input_preview values into extracted command/pattern strings
    18: (db) => {
      const INPUT_PREVIEW_KEYS = {
        claude: {
          Read: 'file_path',
          Edit: 'file_path',
          Write: 'file_path',
          NotebookEdit: 'notebook_path',
          Bash: 'command',
          Grep: 'pattern',
          Glob: 'pattern',
          WebFetch: 'url',
          WebSearch: 'query',
          Task: 'description',
        },
        codex: {
          file_read: 'path',
          file_edit: 'path',
          file_write: 'path',
          apply_patch: 'apply_patch',
          shell: ['command', 'cmd'],
          shell_command: ['command', 'cmd'],
          exec_command: ['cmd', 'command'],
          write_stdin: 'chars',
          grep: 'pattern',
          glob: 'pattern',
        },
        gemini: {
          read_file: 'target_file',
          edit_file: 'target_file',
          create_file: 'target_file',
          run_terminal_command: 'command',
          search_files: 'pattern',
        },
      };

      const rows = db.prepare(`
        SELECT provider, tool_results
        FROM turns
        WHERE tool_results IS NOT NULL
      `).all();

      const update = db.prepare(`
        UPDATE tool_calls
        SET input_preview = ?
        WHERE id = ?
          AND (? IS NOT NULL)
          AND (input_preview IS NULL OR input_preview LIKE '{%')
      `);

      let normalized = 0;
      let total = 0;

      const txn = db.transaction(() => {
        for (const row of rows) {
          let calls;
          try { calls = JSON.parse(row.tool_results); } catch { continue; }
          if (!Array.isArray(calls)) continue;

          for (const tc of calls) {
            if (!tc?.id || !tc?.name) continue;
            total++;
            const preview = extractToolPreview(tc.input, INPUT_PREVIEW_KEYS[row.provider]?.[tc.name]);
            if (!preview) continue;
            const result = update.run(preview, tc.id, preview);
            if (result.changes > 0) normalized++;
          }
        }
      });

      txn();
      console.log(`    Normalized ${normalized}/${total} tool_call input_preview values`);
    },

    // Version 19: Parse existing JSON blob input_preview values into normalized previews/file paths
    19: (db) => {
      const FILE_PATH_KEYS = {
        claude: {
          Read: 'file_path', Edit: 'file_path', Write: 'file_path',
          NotebookEdit: 'notebook_path', Grep: 'path', LSP: 'filePath',
          Glob: 'path',
        },
        codex: {
          file_read: 'path', file_edit: 'path', file_write: 'path',
        },
        gemini: {
          read_file: 'target_file', edit_file: 'target_file', create_file: 'target_file',
        },
      };
      const INPUT_PREVIEW_KEYS = {
        claude: {
          Read: 'file_path',
          Edit: 'file_path',
          Write: 'file_path',
          NotebookEdit: 'notebook_path',
          Bash: 'command',
          Grep: 'pattern',
          Glob: 'pattern',
          WebFetch: 'url',
          WebSearch: 'query',
          Task: 'description',
        },
        codex: {
          file_read: 'path',
          file_edit: 'path',
          file_write: 'path',
          apply_patch: 'apply_patch',
          shell: ['command', 'cmd'],
          shell_command: ['command', 'cmd'],
          exec_command: ['cmd', 'command'],
          write_stdin: 'chars',
          grep: 'pattern',
          glob: 'pattern',
        },
        gemini: {
          read_file: 'target_file',
          edit_file: 'target_file',
          create_file: 'target_file',
          run_terminal_command: 'command',
          search_files: 'pattern',
        },
      };

      const rows = db.prepare(`
        SELECT id, provider, tool_name, file_path, input_preview
        FROM tool_calls
        WHERE input_preview LIKE '{%' OR input_preview LIKE '[%'
      `).all();

      const update = db.prepare(`
        UPDATE tool_calls
        SET
          file_path = COALESCE(file_path, ?),
          input_preview = CASE
            WHEN (input_preview LIKE '{%' OR input_preview LIKE '[%') AND ? IS NOT NULL THEN ?
            ELSE input_preview
          END
        WHERE id = ?
          AND (
            (file_path IS NULL AND ? IS NOT NULL)
            OR ((input_preview LIKE '{%' OR input_preview LIKE '[%') AND ? IS NOT NULL AND input_preview != ?)
          )
      `);

      let normalized = 0;
      let total = 0;

      const txn = db.transaction(() => {
        for (const row of rows) {
          total++;

          let parsed;
          try {
            parsed = JSON.parse(row.input_preview);
          } catch {
            continue;
          }

          if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) continue;

          const { filePath, inputPreview } = extractToolBackfillData(
            row.provider,
            row.tool_name,
            parsed,
            FILE_PATH_KEYS,
            INPUT_PREVIEW_KEYS,
          );

          if (!filePath && !inputPreview) continue;

          const result = update.run(
            filePath,
            inputPreview,
            inputPreview,
            row.id,
            filePath,
            inputPreview,
            inputPreview,
          );
          if (result.changes > 0) normalized++;
        }
      });

      txn();
      console.log(`    Normalized ${normalized}/${total} raw JSON tool_call previews`);
    },

    // Version 20: Recover normalized previews/file paths from truncated JSON preview blobs
    20: (db) => {
      const FILE_PATH_KEYS = {
        claude: {
          Read: 'file_path', Edit: 'file_path', Write: 'file_path',
          NotebookEdit: 'notebook_path', Grep: 'path', LSP: 'filePath',
          Glob: 'path',
        },
        codex: {
          file_read: 'path', file_edit: 'path', file_write: 'path',
        },
        gemini: {
          read_file: 'target_file', edit_file: 'target_file', create_file: 'target_file',
        },
      };
      const INPUT_PREVIEW_KEYS = {
        claude: {
          Read: 'file_path',
          Edit: 'file_path',
          Write: 'file_path',
          NotebookEdit: 'notebook_path',
          Bash: 'command',
          Grep: 'pattern',
          Glob: 'pattern',
          WebFetch: 'url',
          WebSearch: 'query',
          Task: 'description',
        },
        codex: {
          file_read: 'path',
          file_edit: 'path',
          file_write: 'path',
          apply_patch: 'apply_patch',
          shell: ['command', 'cmd'],
          shell_command: ['command', 'cmd'],
          exec_command: ['cmd', 'command'],
          write_stdin: 'chars',
          grep: 'pattern',
          glob: 'pattern',
        },
        gemini: {
          read_file: 'target_file',
          edit_file: 'target_file',
          create_file: 'target_file',
          run_terminal_command: 'command',
          search_files: 'pattern',
        },
      };

      const rows = db.prepare(`
        SELECT id, provider, tool_name, input_preview
        FROM tool_calls
        WHERE input_preview LIKE '{%' OR input_preview LIKE '[%'
      `).all();

      const update = db.prepare(`
        UPDATE tool_calls
        SET
          file_path = COALESCE(file_path, ?),
          input_preview = CASE
            WHEN (input_preview LIKE '{%' OR input_preview LIKE '[%') AND ? IS NOT NULL THEN ?
            ELSE input_preview
          END
        WHERE id = ?
          AND (
            (file_path IS NULL AND ? IS NOT NULL)
            OR ((input_preview LIKE '{%' OR input_preview LIKE '[%') AND ? IS NOT NULL AND input_preview != ?)
          )
      `);

      let normalized = 0;
      let total = 0;

      const txn = db.transaction(() => {
        for (const row of rows) {
          total++;
          const { filePath, inputPreview } = extractToolBackfillDataFromBlob(
            row.provider,
            row.tool_name,
            row.input_preview,
            FILE_PATH_KEYS,
            INPUT_PREVIEW_KEYS,
          );

          if (!filePath && !inputPreview) continue;

          const result = update.run(
            filePath,
            inputPreview,
            inputPreview,
            row.id,
            filePath,
            inputPreview,
            inputPreview,
          );
          if (result.changes > 0) normalized++;
        }
      });

      txn();
      console.log(`    Recovered ${normalized}/${total} truncated raw JSON tool_call previews`);
    },

    21: (db) => {
      if (tableExists(db, 'sessions')) {
        ensureColumn(db, 'sessions', 'description', 'ALTER TABLE sessions ADD COLUMN description TEXT');
        ensureColumn(db, 'sessions', 'enriched_at', 'ALTER TABLE sessions ADD COLUMN enriched_at TEXT');
      }
    },

    22: (db) => {
      applySchemaUpdates(db);
    },
  };

  for (let v = from + 1; v <= to; v++) {
    if (migrations[v]) {
      console.log(`  Applying migration v${v}...`);
      const applyMigration = () => {
        migrations[v](db);
        db.prepare('INSERT INTO schema_version (version, applied_at) VALUES (?, ?)')
          .run(v, new Date().toISOString());
      };

      if (v === 4 || v === 7) {
        applyMigration();
      } else {
        db.transaction(applyMigration)();
      }
    }
  }

  console.log('Migrations complete.');
}

function tableExists(db, table) {
  const result = db.prepare(`
    SELECT name FROM sqlite_master WHERE type='table' AND name=?
  `).get(table);
  return !!result;
}

function _createSessionsFtsTable(db) {
  db.exec(`
    CREATE VIRTUAL TABLE IF NOT EXISTS sessions_fts USING fts5(
      session_id UNINDEXED,
      title,
      description,
      snippet
    );
  `);
}

function _refreshSessionsFts(db) {
  db.exec('DELETE FROM sessions_fts');
  db.exec(`
    INSERT INTO sessions_fts(session_id, title, description, snippet)
    SELECT
      id,
      COALESCE(title, ''),
      COALESCE(description, ''),
      COALESCE(snippet, '')
    FROM sessions
    WHERE status != 'deleted'
  `);
}

function ensureSessionsFtsHealthy(db) {
  try { db.exec('DROP TRIGGER IF EXISTS sessions_fts_ai'); } catch {}
  try { db.exec('DROP TRIGGER IF EXISTS sessions_fts_ad'); } catch {}
  try { db.exec('DROP TRIGGER IF EXISTS sessions_fts_au'); } catch {}

  try {
    let recreate = !tableExists(db, 'sessions_fts');
    if (!recreate) {
      const cols = db.pragma('table_info(sessions_fts)');
      const hasSessionId = cols.some((col) => col.name === 'session_id');
      const hasDescription = cols.some((col) => col.name === 'description');
      if (!hasSessionId || !hasDescription) recreate = true;
    }
    if (recreate) {
      try { db.exec('DROP TABLE IF EXISTS sessions_fts'); } catch {}
    }

    _createSessionsFtsTable(db);
    _refreshSessionsFts(db);
  } catch (err) {
    console.warn(`[schema] sessions_fts setup failed: ${String(err?.message || err || '')}`);
  }
}

function columnExists(db, table, column) {
  try {
    const columns = db.pragma(`table_info(${table})`);
    return columns.some((col) => col.name === column);
  } catch {
    return false;
  }
}

function indexExists(db, indexName) {
  const result = db.prepare(`
    SELECT name FROM sqlite_master WHERE type='index' AND name=?
  `).get(indexName);
  return !!result;
}

function ensureColumn(db, table, column, statement) {
  if (!columnExists(db, table, column)) {
    db.exec(statement);
  }
}

function ensureIndex(db, indexName, statement) {
  if (!indexExists(db, indexName)) {
    db.exec(statement);
  }
}

function ensureTable(db, table, statement) {
  if (!tableExists(db, table)) {
    db.exec(statement);
  }
}

function dedupeProviderSessions(db) {
  const duplicates = db.prepare(`
    SELECT provider, provider_session_id, COUNT(*) as cnt
    FROM sessions
    WHERE provider_session_id IS NOT NULL
    GROUP BY provider, provider_session_id
    HAVING COUNT(*) > 1
  `).all();

  if (!duplicates.length) {
    return;
  }

  for (const dup of duplicates) {
    const sessions = db.prepare(`
      SELECT id, turn_count, created_at
      FROM sessions
      WHERE provider = ? AND provider_session_id = ?
      ORDER BY turn_count DESC, created_at ASC
    `).all(dup.provider, dup.provider_session_id);

    const keepId = sessions[0].id;
    const deleteIds = sessions.slice(1).map(s => s.id);

    for (const id of deleteIds) {
      db.prepare(`
        UPDATE sessions
        SET status = 'deleted',
            deleted_at = datetime('now'),
            provider_session_id = provider_session_id || '-dup-' || id
        WHERE id = ?
      `).run(id);
    }
  }
}

/**
 * Get current schema version
 * @returns {number}
 */
export function getSchemaVersion() {
  const db = getDb();
  try {
    const result = db.prepare('SELECT MAX(version) as v FROM schema_version').get();
    return result?.v || 0;
  } catch {
    return 0;
  }
}

/**
 * Get all table names in the database
 * @returns {string[]}
 */
export function getTableNames() {
  const db = getDb();
  const tables = db.prepare(`
    SELECT name FROM sqlite_master
    WHERE type='table' AND name NOT LIKE 'sqlite_%'
    ORDER BY name
  `).all();
  return tables.map(t => t.name);
}

/**
 * Get row count for a table
 * @param {string} tableName
 * @returns {number}
 */
export function getTableCount(tableName) {
  const db = getDb();
  const result = db.prepare(`SELECT COUNT(*) as count FROM ${tableName}`).get();
  return result?.count || 0;
}

/**
 * Seed model pricing data
 * Prices in USD per million tokens (MTok)
 * @param {Database.Database} db
 */
export function seedModelPricing(db) {
  const insert = db.prepare(`
    INSERT OR REPLACE INTO model_pricing
    (provider, model_pattern, display_name, input_cost_per_mtok, output_cost_per_mtok, cache_read_cost_per_mtok, cache_write_cost_per_mtok, effective_from, notes)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const pricingData = [
    // Claude models (Anthropic)
    // Pricing from https://platform.claude.com/docs/en/about-claude/pricing
    // Cache read = 0.1x input, Cache write (5min) = 1.25x input
    ['claude', 'claude-opus-4-6%', 'Claude Opus 4.6', 5.0, 25.0, 0.50, 6.25, '2025-01-01', 'Most capable'],
    ['claude', 'claude-opus-4-5-%', 'Claude Opus 4.5', 5.0, 25.0, 0.50, 6.25, '2025-01-01', 'Most capable'],
    ['claude', 'claude-sonnet-4-5-%', 'Claude Sonnet 4.5', 3.0, 15.0, 0.30, 3.75, '2025-01-01', 'Best balance'],
    ['claude', 'claude-haiku-4-5-%', 'Claude Haiku 4.5', 1.0, 5.0, 0.10, 1.25, '2025-01-01', 'Fastest'],
    ['claude', 'claude-opus-4-1-%', 'Claude Opus 4.1', 15.0, 75.0, 1.50, 18.75, '2025-01-01', 'Previous gen'],
    ['claude', 'claude-3-5-haiku-%', 'Claude 3.5 Haiku', 0.8, 4.0, 0.08, 1.0, '2024-10-01', 'Legacy'],
    ['claude', 'claude-3-5-sonnet-%', 'Claude 3.5 Sonnet', 3.0, 15.0, 0.3, 3.75, '2024-06-01', 'Legacy'],

    // Codex/OpenAI models
    ['codex', 'gpt-5.1-codex-max', 'Codex Max', 10.0, 30.0, 0, 0, '2025-01-01', 'Most capable'],
    ['codex', 'gpt-5.1-codex-mini', 'Codex Mini', 1.5, 6.0, 0, 0, '2025-01-01', 'Fastest'],
    ['codex', 'gpt-5.1-codex', 'Codex Standard', 5.0, 15.0, 0, 0, '2025-01-01', 'Default'],
    ['codex', 'gpt-5-codex', 'Codex 5', 5.0, 15.0, 0, 0, '2025-01-01', 'Previous gen'],
    ['codex', 'gpt-4o', 'GPT-4o', 5.0, 15.0, 0, 0, '2024-05-01', 'Multimodal'],
    ['codex', 'gpt-4o-mini', 'GPT-4o Mini', 0.15, 0.6, 0, 0, '2024-07-01', 'Fast/cheap'],
    ['codex', 'o1', 'o1', 15.0, 60.0, 0, 0, '2024-12-01', 'Reasoning'],
    ['codex', 'o1-mini', 'o1 Mini', 3.0, 12.0, 0, 0, '2024-09-01', 'Reasoning light'],
    ['codex', 'o3-mini', 'o3 Mini', 1.1, 4.4, 0, 0, '2025-01-01', 'Latest reasoning'],

    // Gemini models
    ['gemini', 'gemini-2.5-pro%', 'Gemini 2.5 Pro', 1.25, 5.0, 0, 0, '2025-01-01', 'Most capable'],
    ['gemini', 'gemini-2.5-flash%', 'Gemini 2.5 Flash', 0.075, 0.3, 0, 0, '2025-01-01', 'Fast/cheap'],
    ['gemini', 'gemini-2.0-flash%', 'Gemini 2.0 Flash', 0.1, 0.4, 0, 0, '2024-12-01', 'Previous flash'],
    ['gemini', 'gemini-1.5-pro%', 'Gemini 1.5 Pro', 1.25, 5.0, 0, 0, '2024-05-01', 'Legacy pro'],
    ['gemini', 'gemini-1.5-flash%', 'Gemini 1.5 Flash', 0.075, 0.3, 0, 0, '2024-05-01', 'Legacy flash'],
    ['gemini', 'gemini%', 'Gemini (default)', 0.1, 0.4, 0, 0, '2024-01-01', 'Fallback'],

    // Ollama (local - free)
    ['ollama', '%', 'Local Model', 0, 0, 0, 0, '2024-01-01', 'Free local inference'],
  ];

  for (const row of pricingData) {
    insert.run(...row);
  }

  console.log(`  Seeded ${pricingData.length} model pricing entries`);
}

/**
 * Get pricing for a model
 * @param {string} provider
 * @param {string} model
 * @returns {Object|null}
 */
export function getModelPricing(provider, model) {
  const db = getDb();

  const pricing = db.prepare(`
    SELECT input_cost_per_mtok, output_cost_per_mtok, cache_read_cost_per_mtok, cache_write_cost_per_mtok
    FROM model_pricing
    WHERE provider = ?
      AND (model_pattern = ? OR ? LIKE model_pattern)
      AND (effective_until IS NULL OR effective_until > datetime('now'))
    ORDER BY
      CASE WHEN model_pattern = ? THEN 0 ELSE 1 END,
      effective_from DESC
    LIMIT 1
  `).get(provider, model, model, model);

  return pricing || null;
}

/**
 * Calculate cost from tokens using pricing table
 * @param {string} provider
 * @param {string} model
 * @param {Object} usage
 * @returns {number} Cost in USD
 */
export function calculateCostFromPricing(provider, model, usage) {
  if (!usage) return 0;

  const pricing = getModelPricing(provider, model);
  if (!pricing) {
    // Fallback to default pricing
    const inputCost = (usage.input_tokens || 0) * 3 / 1_000_000;
    const outputCost = (usage.output_tokens || 0) * 15 / 1_000_000;
    const cacheReadCost = (usage.cache_read_tokens || 0) * 0.3 / 1_000_000;
    return inputCost + outputCost + cacheReadCost;
  }

  const inputCost = (usage.input_tokens || 0) * pricing.input_cost_per_mtok / 1_000_000;
  const outputCost = (usage.output_tokens || 0) * pricing.output_cost_per_mtok / 1_000_000;
  const cacheReadCost = (usage.cache_read_tokens || 0) * (pricing.cache_read_cost_per_mtok || 0) / 1_000_000;

  return inputCost + outputCost + cacheReadCost;
}
