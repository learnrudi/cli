import fs from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';

import { assertLaunchId, getAgentHostPaths } from './artifacts.js';

export const LAUNCH_STATUSES = Object.freeze([
  'starting',
  'running',
  'completed',
  'failed',
  'stopped',
]);
export const LAUNCH_DISPOSITIONS = Object.freeze(['retained', 'promoted', 'discarded']);
export const LAUNCH_EXECUTION_KINDS = Object.freeze(['foreground', 'detached']);
const GROUP_ID_PATTERN = /^group_[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/;

const TERMINAL_STATUSES = new Set(['completed', 'failed', 'stopped']);
const TRANSITIONS = Object.freeze({
  starting: new Set(['running', 'failed', 'stopped']),
  running: new Set(['completed', 'failed', 'stopped']),
  completed: new Set(),
  failed: new Set(),
  stopped: new Set(),
});

function requiredString(value, field, maxLength = 4096) {
  if (typeof value !== 'string' || value.trim() === '' || value.includes('\0')) {
    throw new Error(`${field} must be a non-empty string without NUL bytes`);
  }
  if (value.length > maxLength) {
    throw new Error(`${field} exceeds ${maxLength} characters`);
  }
  return value;
}

function optionalString(value, field, maxLength = 4096) {
  if (value == null) return null;
  return requiredString(value, field, maxLength);
}

function mapLaunch(row) {
  if (!row) return null;
  return {
    baseRef: row.base_ref,
    disposition: row.disposition,
    executionKind: row.execution_kind,
    executionWorkspace: row.execution_workspace,
    exitCode: row.exit_code,
    finishedAt: row.finished_at,
    lastError: row.last_error,
    launchId: row.launch_id,
    model: row.model,
    nativeSessionId: row.native_session_id,
    originDirectory: row.origin_directory,
    ownerPid: row.owner_pid,
    outputDestination: row.output_destination,
    parentLaunchId: row.parent_launch_id,
    pid: row.pid,
    projectRoot: row.project_root,
    provider: row.provider,
    startedAt: row.started_at,
    status: row.status,
    updatedAt: row.updated_at,
    workspaceMode: row.workspace_mode,
    worktreeBranch: row.worktree_branch,
  };
}

function validateStatus(status) {
  if (!LAUNCH_STATUSES.includes(status)) {
    throw new Error(`Unknown launch status: ${status}`);
  }
  return status;
}

function validateEnum(value, field, allowed) {
  if (!allowed.includes(value)) {
    throw new Error(`Unknown ${field}: ${value}`);
  }
  return value;
}

function optionalPid(value, field) {
  if (value == null) return null;
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 1) {
    throw new Error(`${field} must be a positive integer`);
  }
  return parsed;
}

export function assertAgentGroupId(groupId) {
  if (typeof groupId !== 'string' || !GROUP_ID_PATTERN.test(groupId)) {
    throw new Error('Invalid Agent Host group ID');
  }
  return groupId;
}

function deriveGroupStatus(launches) {
  const statuses = launches.map(launch => launch.status);
  if (statuses.includes('running')) return 'running';
  if (statuses.includes('starting')) return 'starting';
  if (statuses.every(status => status === 'completed')) return 'completed';
  if (statuses.some(status => status === 'completed')) return 'partial';
  if (statuses.every(status => status === 'stopped')) return 'stopped';
  return 'failed';
}

function ensureColumn(database, name, definition) {
  const columns = new Set(database.prepare('PRAGMA table_info(agent_launches)').all().map(row => row.name));
  if (!columns.has(name)) database.exec(`ALTER TABLE agent_launches ADD COLUMN ${name} ${definition}`);
}

function migrateSharedWorkspace(database) {
  const sql = database.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='agent_launches'").get().sql;
  if (sql.includes("'registered-shared'")) return;
  const indexes = database.prepare("SELECT sql FROM sqlite_master WHERE type='index' AND tbl_name='agent_launches' AND sql IS NOT NULL").all();
  const replacement = sql.replace('CREATE TABLE agent_launches', 'CREATE TABLE agent_launches_next')
    .replace("'isolated-copy'", "'isolated-copy', 'registered-shared'");
  if (replacement === sql || !replacement.includes('CREATE TABLE agent_launches_next')) throw new Error('unrecognized Agent Host launch schema');
  database.pragma('foreign_keys = OFF');
  try {
    database.transaction(() => {
      database.exec(replacement);
      database.exec('INSERT INTO agent_launches_next SELECT * FROM agent_launches');
      database.exec('DROP TABLE agent_launches');
      database.exec('ALTER TABLE agent_launches_next RENAME TO agent_launches');
      for (const index of indexes) database.exec(index.sql);
      if (database.pragma('foreign_key_check').length) throw new Error('Agent Host migration foreign-key failure');
    })();
  } finally { database.pragma('foreign_keys = ON'); }
}

function initialize(database) {
  database.pragma('journal_mode = WAL');
  database.pragma('foreign_keys = ON');
  database.exec(`
    CREATE TABLE IF NOT EXISTS agent_launches (
      launch_id TEXT PRIMARY KEY,
      parent_launch_id TEXT REFERENCES agent_launches(launch_id),
      provider TEXT NOT NULL,
      native_session_id TEXT,
      origin_directory TEXT NOT NULL,
      project_root TEXT NOT NULL,
      execution_workspace TEXT NOT NULL,
      output_destination TEXT NOT NULL,
      workspace_mode TEXT NOT NULL CHECK (workspace_mode IN ('read-only', 'worktree', 'isolated-copy', 'registered-shared')),
      worktree_branch TEXT,
      base_ref TEXT,
      model TEXT NOT NULL,
      execution_kind TEXT NOT NULL DEFAULT 'foreground' CHECK (execution_kind IN ('foreground', 'detached')),
      owner_pid INTEGER,
      disposition TEXT NOT NULL DEFAULT 'retained' CHECK (disposition IN ('retained', 'promoted', 'discarded')),
      status TEXT NOT NULL CHECK (status IN ('starting', 'running', 'completed', 'failed', 'stopped')),
      pid INTEGER,
      exit_code INTEGER,
      started_at TEXT NOT NULL,
      finished_at TEXT,
      updated_at TEXT NOT NULL,
      last_error TEXT
    );

    CREATE INDEX IF NOT EXISTS idx_agent_launches_status_started
      ON agent_launches(status, started_at DESC);
    CREATE INDEX IF NOT EXISTS idx_agent_launches_native_session
      ON agent_launches(provider, native_session_id);

    CREATE TABLE IF NOT EXISTS agent_groups (
      group_id TEXT PRIMARY KEY,
      origin_directory TEXT NOT NULL,
      workspace TEXT NOT NULL,
      workspace_mode TEXT NOT NULL CHECK (workspace_mode IN ('auto', 'read-only', 'worktree', 'isolated-copy')),
      started_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS agent_group_launches (
      group_id TEXT NOT NULL REFERENCES agent_groups(group_id) ON DELETE CASCADE,
      ordinal INTEGER NOT NULL,
      launch_id TEXT NOT NULL UNIQUE,
      provider TEXT NOT NULL,
      last_error TEXT,
      PRIMARY KEY (group_id, ordinal)
    );

    CREATE INDEX IF NOT EXISTS idx_agent_group_launches_group
      ON agent_group_launches(group_id, ordinal);
  `);
  migrateSharedWorkspace(database);
  ensureColumn(database, 'execution_kind', "TEXT NOT NULL DEFAULT 'foreground' CHECK (execution_kind IN ('foreground', 'detached'))");
  ensureColumn(database, 'owner_pid', 'INTEGER');
  ensureColumn(database, 'disposition', "TEXT NOT NULL DEFAULT 'retained' CHECK (disposition IN ('retained', 'promoted', 'discarded'))");
}

export function createLaunchStore({
  databasePath = getAgentHostPaths().stateDatabase,
  now = () => new Date().toISOString(),
} = {}) {
  const resolvedPath = path.resolve(databasePath);
  fs.mkdirSync(path.dirname(resolvedPath), { recursive: true, mode: 0o700 });
  const database = new Database(resolvedPath);
  fs.chmodSync(resolvedPath, 0o600);
  initialize(database);

  const getStatement = database.prepare('SELECT * FROM agent_launches WHERE launch_id = ?');

  function get(launchId) {
    assertLaunchId(launchId);
    return mapLaunch(getStatement.get(launchId));
  }

  function create(projection) {
    const launchId = assertLaunchId(projection?.launchId);
    const status = validateStatus(projection?.status || 'starting');
    if (status !== 'starting') {
      throw new Error('New launches must start in the starting state');
    }
    const timestamp = now();
    const record = {
      baseRef: optionalString(projection.baseRef, 'baseRef', 512),
      disposition: validateEnum(projection.disposition || 'retained', 'launch disposition', LAUNCH_DISPOSITIONS),
      executionKind: validateEnum(projection.executionKind || 'foreground', 'execution kind', LAUNCH_EXECUTION_KINDS),
      executionWorkspace: requiredString(projection.executionWorkspace, 'executionWorkspace'),
      launchId,
      model: requiredString(projection.model, 'model', 512),
      nativeSessionId: optionalString(projection.nativeSessionId, 'nativeSessionId', 1024),
      originDirectory: requiredString(projection.originDirectory, 'originDirectory'),
      ownerPid: optionalPid(projection.ownerPid, 'ownerPid'),
      outputDestination: requiredString(projection.outputDestination, 'outputDestination'),
      parentLaunchId: projection.parentLaunchId == null ? null : assertLaunchId(projection.parentLaunchId),
      projectRoot: requiredString(projection.projectRoot, 'projectRoot'),
      provider: requiredString(projection.provider, 'provider', 64),
      status,
      workspaceMode: requiredString(projection.workspaceMode, 'workspaceMode', 32),
      worktreeBranch: optionalString(projection.worktreeBranch, 'worktreeBranch', 512),
    };

    database.prepare(`
      INSERT INTO agent_launches (
        launch_id, parent_launch_id, provider, native_session_id,
        origin_directory, project_root, execution_workspace, output_destination,
        workspace_mode, worktree_branch, base_ref, model, status,
        execution_kind, owner_pid, disposition, started_at, updated_at
      ) VALUES (
        @launchId, @parentLaunchId, @provider, @nativeSessionId,
        @originDirectory, @projectRoot, @executionWorkspace, @outputDestination,
        @workspaceMode, @worktreeBranch, @baseRef, @model, @status,
        @executionKind, @ownerPid, @disposition, @startedAt, @updatedAt
      )
    `).run({ ...record, startedAt: timestamp, updatedAt: timestamp });

    return get(launchId);
  }

  function transition(launchId, nextStatus, patch = {}) {
    assertLaunchId(launchId);
    validateStatus(nextStatus);
    const current = get(launchId);
    if (!current) throw new Error(`Launch not found: ${launchId}`);
    if (!TRANSITIONS[current.status].has(nextStatus)) {
      throw new Error(`Invalid launch transition: ${current.status} -> ${nextStatus}`);
    }

    const timestamp = now();
    const pid = patch.pid == null ? current.pid : Number(patch.pid);
    const exitCode = patch.exitCode == null ? current.exitCode : Number(patch.exitCode);
    if (pid != null && (!Number.isSafeInteger(pid) || pid < 0)) {
      throw new Error('pid must be a non-negative integer');
    }
    if (exitCode != null && !Number.isSafeInteger(exitCode)) {
      throw new Error('exitCode must be an integer');
    }

    database.prepare(`
      UPDATE agent_launches
      SET status = @status,
          pid = @pid,
          owner_pid = @ownerPid,
          exit_code = @exitCode,
          native_session_id = COALESCE(@nativeSessionId, native_session_id),
          last_error = @lastError,
          finished_at = @finishedAt,
          updated_at = @updatedAt
      WHERE launch_id = @launchId
    `).run({
      exitCode,
      finishedAt: TERMINAL_STATUSES.has(nextStatus) ? timestamp : null,
      lastError: optionalString(patch.lastError, 'lastError', 4096),
      launchId,
      nativeSessionId: optionalString(patch.nativeSessionId, 'nativeSessionId', 1024),
      ownerPid: TERMINAL_STATUSES.has(nextStatus)
        ? null
        : optionalPid(patch.ownerPid == null ? current.ownerPid : patch.ownerPid, 'ownerPid'),
      pid,
      status: nextStatus,
      updatedAt: timestamp,
    });

    return get(launchId);
  }

  function setDisposition(launchId, disposition) {
    assertLaunchId(launchId);
    const next = validateEnum(disposition, 'launch disposition', LAUNCH_DISPOSITIONS);
    const current = get(launchId);
    if (!current) throw new Error(`Launch not found: ${launchId}`);
    if (current.disposition === next) return current;
    if (current.disposition !== 'retained') {
      throw new Error(`Launch is already ${current.disposition}: ${launchId}`);
    }
    if (next === 'retained') return current;
    database.prepare(`
      UPDATE agent_launches
      SET disposition = ?, updated_at = ?
      WHERE launch_id = ?
    `).run(next, now(), launchId);
    return get(launchId);
  }

  function setNativeSessionId(launchId, nativeSessionId) {
    assertLaunchId(launchId);
    const validNativeId = requiredString(nativeSessionId, 'nativeSessionId', 1024);
    const result = database.prepare(`
      UPDATE agent_launches
      SET native_session_id = ?, updated_at = ?
      WHERE launch_id = ?
    `).run(validNativeId, now(), launchId);
    if (result.changes === 0) throw new Error(`Launch not found: ${launchId}`);
    return get(launchId);
  }

  function list({ limit = 50, status = null } = {}) {
    const numericLimit = Number(limit);
    if (!Number.isSafeInteger(numericLimit) || numericLimit < 1 || numericLimit > 1000) {
      throw new Error('limit must be an integer between 1 and 1000');
    }
    if (status != null) validateStatus(status);

    const rows = status == null
      ? database.prepare(`
          SELECT * FROM agent_launches
          ORDER BY started_at DESC, rowid DESC
          LIMIT ?
        `).all(numericLimit)
      : database.prepare(`
          SELECT * FROM agent_launches
          WHERE status = ?
          ORDER BY started_at DESC, rowid DESC
          LIMIT ?
        `).all(status, numericLimit);
    return rows.map(mapLaunch);
  }

  function getGroup(groupId) {
    assertAgentGroupId(groupId);
    const row = database.prepare('SELECT * FROM agent_groups WHERE group_id = ?').get(groupId);
    if (!row) return null;
    const taskRows = database.prepare(`
      SELECT launch_id, provider, last_error
      FROM agent_group_launches
      WHERE group_id = ?
      ORDER BY ordinal ASC
    `).all(groupId);
    const launches = taskRows.map((task) => {
      const launch = get(task.launch_id);
      if (launch) return launch;
      return {
        lastError: task.last_error,
        launchId: task.launch_id,
        provider: task.provider,
        status: task.last_error ? 'failed' : 'starting',
      };
    });
    const status = deriveGroupStatus(launches);
    const finishedAt = ['completed', 'partial', 'failed', 'stopped'].includes(status)
      ? launches.map(launch => launch.finishedAt).filter(Boolean).sort().at(-1) || row.updated_at
      : null;
    return {
      finishedAt,
      groupId: row.group_id,
      launches,
      originDirectory: row.origin_directory,
      startedAt: row.started_at,
      status,
      updatedAt: row.updated_at,
      workspace: row.workspace,
      workspaceMode: row.workspace_mode,
    };
  }

  function createGroup(projection) {
    const groupId = assertAgentGroupId(projection?.groupId);
    const tasks = projection?.tasks;
    if (!Array.isArray(tasks) || tasks.length < 2 || tasks.length > 10) {
      throw new Error('Agent Host group requires between 2 and 10 tasks');
    }
    const validatedTasks = tasks.map((task, ordinal) => ({
      launchId: assertLaunchId(task?.launchId),
      ordinal,
      provider: requiredString(task?.provider, `tasks[${ordinal}].provider`, 64),
    }));
    if (new Set(validatedTasks.map(task => task.launchId)).size !== validatedTasks.length) {
      throw new Error('Agent Host group launch IDs must be unique');
    }
    const timestamp = now();
    const record = {
      groupId,
      originDirectory: requiredString(projection.originDirectory, 'originDirectory'),
      startedAt: timestamp,
      updatedAt: timestamp,
      workspace: requiredString(projection.workspace, 'workspace'),
      workspaceMode: validateEnum(
        projection.workspaceMode || 'auto',
        'group workspace mode',
        ['auto', 'read-only', 'worktree', 'isolated-copy'],
      ),
    };
    database.transaction(() => {
      database.prepare(`
        INSERT INTO agent_groups (
          group_id, origin_directory, workspace, workspace_mode, started_at, updated_at
        ) VALUES (
          @groupId, @originDirectory, @workspace, @workspaceMode, @startedAt, @updatedAt
        )
      `).run(record);
      const insertTask = database.prepare(`
        INSERT INTO agent_group_launches (group_id, ordinal, launch_id, provider)
        VALUES (?, ?, ?, ?)
      `);
      for (const task of validatedTasks) {
        insertTask.run(groupId, task.ordinal, task.launchId, task.provider);
      }
    })();
    return getGroup(groupId);
  }

  function setGroupLaunchError(groupId, launchId, lastError) {
    assertAgentGroupId(groupId);
    assertLaunchId(launchId);
    const result = database.prepare(`
      UPDATE agent_group_launches
      SET last_error = ?
      WHERE group_id = ? AND launch_id = ?
    `).run(requiredString(lastError, 'lastError', 4096), groupId, launchId);
    if (result.changes === 0) throw new Error(`Group launch not found: ${groupId}/${launchId}`);
    database.prepare('UPDATE agent_groups SET updated_at = ? WHERE group_id = ?').run(now(), groupId);
    return getGroup(groupId);
  }

  function listGroups({ limit = 50 } = {}) {
    const numericLimit = Number(limit);
    if (!Number.isSafeInteger(numericLimit) || numericLimit < 1 || numericLimit > 1000) {
      throw new Error('limit must be an integer between 1 and 1000');
    }
    return database.prepare(`
      SELECT group_id FROM agent_groups
      ORDER BY started_at DESC, rowid DESC
      LIMIT ?
    `).all(numericLimit).map(row => getGroup(row.group_id));
  }

  return {
    close() {
      if (database.open) database.close();
    },
    create,
    createGroup,
    database,
    get,
    getGroup,
    list,
    listGroups,
    setDisposition,
    setGroupLaunchError,
    setNativeSessionId,
    transition,
  };
}
