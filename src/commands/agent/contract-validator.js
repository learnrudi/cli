import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { execFile } from 'child_process';

const VALIDATION_TIMEOUT_MS = 60_000;
const OUTPUT_TRUNCATE_CHARS = 2000;
const ALLOWED_VALIDATION_PREFIXES = new Set([
  'npm',
  'pnpm',
  'node',
  'npx',
  'git',
  'make',
  'cargo',
  'go',
  'pytest',
  'tsc',
  'eslint',
]);

function truncateText(value, maxChars = OUTPUT_TRUNCATE_CHARS) {
  if (typeof value !== 'string') return '';
  return value.length <= maxChars ? value : value.slice(0, maxChars);
}

function buildValidationEnv(baseEnv = process.env) {
  const env = { ...baseEnv };
  for (const key of ['HTTP_PROXY', 'HTTPS_PROXY', 'ALL_PROXY', 'http_proxy', 'https_proxy', 'all_proxy']) {
    delete env[key];
  }
  env.NO_PROXY = '*';
  env.no_proxy = '*';
  return env;
}

function execFileAsync(file, args, options) {
  return new Promise((resolve, reject) => {
    execFile(file, args, options, (error, stdout, stderr) => {
      if (error) {
        error.stdout = stdout;
        error.stderr = stderr;
        reject(error);
        return;
      }
      resolve({ stdout, stderr });
    });
  });
}

function resolveArtifactPath(rootDir, candidatePath) {
  if (typeof candidatePath !== 'string' || !candidatePath.trim()) {
    throw new Error('artifact path required');
  }

  const absolutePath = path.resolve(rootDir, candidatePath);
  const relativePath = path.relative(rootDir, absolutePath);
  if (relativePath.startsWith('..') || path.isAbsolute(relativePath)) {
    throw new Error(`artifact path escapes task root: ${candidatePath}`);
  }
  return absolutePath;
}

function checkExpectedPathType(expectedType, targetPath) {
  const stat = fs.statSync(targetPath);
  if (expectedType === 'file' && !stat.isFile()) {
    throw new Error(`expected file at ${targetPath}`);
  }
  if (expectedType === 'directory' && !stat.isDirectory()) {
    throw new Error(`expected directory at ${targetPath}`);
  }
}

async function runCommandValidation(command, { cwd, allowValidationCommands, log }) {
  if (!Array.isArray(command) || command.length === 0) {
    return { ok: true, stdout: '', stderr: '' };
  }

  const executable = command[0];
  const normalizedExecutable = path.basename(executable);
  if (!allowValidationCommands && !ALLOWED_VALIDATION_PREFIXES.has(normalizedExecutable)) {
    return {
      ok: false,
      stdout: '',
      stderr: `validation command blocked: ${normalizedExecutable} is not in the allowlist`,
    };
  }

  const startedAt = Date.now();
  try {
    const result = await execFileAsync(executable, command.slice(1), {
      cwd,
      env: buildValidationEnv(process.env),
      timeout: VALIDATION_TIMEOUT_MS,
      maxBuffer: 1024 * 1024,
    });
    log?.('agent', 'info', 'validation command executed', {
      command,
      cwd,
      exitCode: 0,
      durationMs: Date.now() - startedAt,
      stdout: truncateText(result.stdout),
      stderr: truncateText(result.stderr),
    });
    return {
      ok: true,
      stdout: truncateText(result.stdout),
      stderr: truncateText(result.stderr),
    };
  } catch (error) {
    log?.('agent', 'warn', 'validation command failed', {
      command,
      cwd,
      exitCode: typeof error.code === 'number' ? error.code : null,
      durationMs: Date.now() - startedAt,
      stdout: truncateText(error.stdout || ''),
      stderr: truncateText(error.stderr || error.message || ''),
    });
    return {
      ok: false,
      stdout: truncateText(error.stdout || ''),
      stderr: truncateText(error.stderr || error.message || ''),
    };
  }
}

function insertArtifacts(db, { sessionId, runGroupId, taskIndex, artifacts }) {
  db.prepare('DELETE FROM task_artifacts WHERE session_id = ?').run(sessionId);
  if (!Array.isArray(artifacts) || artifacts.length === 0) return [];

  const insert = db.prepare(`
    INSERT OR REPLACE INTO task_artifacts
      (id, session_id, run_group_id, task_index, artifact_name, artifact_path, artifact_kind, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const now = new Date().toISOString();
  const ids = [];

  for (const artifact of artifacts) {
    const artifactId = crypto.randomUUID();
    insert.run(
      artifactId,
      sessionId,
      runGroupId,
      taskIndex,
      artifact.name,
      artifact.path,
      artifact.kind,
      now,
    );
    ids.push(artifactId);
  }
  return ids;
}

function writeValidationResult(db, { sessionId, runGroupId, taskIndex, passed, errors, warnings, artifactIds }) {
  db.prepare(`
    INSERT OR REPLACE INTO task_validation_results
      (session_id, run_group_id, task_index, passed, errors_json, warnings_json, artifacts_json, validated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    sessionId,
    runGroupId,
    taskIndex,
    passed ? 1 : 0,
    JSON.stringify(errors || []),
    JSON.stringify(warnings || []),
    JSON.stringify(artifactIds || []),
    new Date().toISOString(),
  );
}

function collectDeclaredArtifacts(task, cwd, warnings, errors) {
  const artifacts = [];
  if (!task?.output?.path || !task.output.type) {
    return artifacts;
  }

  try {
    const artifactPath = resolveArtifactPath(cwd, task.output.path);
    if (!fs.existsSync(artifactPath)) {
      errors.push(`declared output missing: ${task.output.path}`);
      return artifacts;
    }
    checkExpectedPathType(task.output.type, artifactPath);
    artifacts.push({
      name: path.basename(task.output.path),
      path: artifactPath,
      kind: task.output.type,
    });
  } catch (error) {
    errors.push(error.message);
  }

  return artifacts;
}

export async function validateTaskContract({
  db,
  sessionId,
  runGroupId,
  task,
  cwd,
  log,
  allowValidationCommands = false,
}) {
  const taskIndex = Number(task?.taskIndex ?? -1);

  try {
    const errors = [];
    const warnings = [];

    const artifacts = collectDeclaredArtifacts(task, cwd, warnings, errors);

    if (task?.evidence?.type === 'artifact_exists' || task?.evidence?.type === 'json_file') {
      try {
        const evidencePath = resolveArtifactPath(cwd, task.evidence.path);
        if (!fs.existsSync(evidencePath)) {
          errors.push(`evidence missing: ${task.evidence.path}`);
        } else if (task.evidence.type === 'json_file') {
          const raw = fs.readFileSync(evidencePath, 'utf-8');
          JSON.parse(raw);
        }
      } catch (error) {
        errors.push(error.message);
      }
    }

    if (task?.evidence?.type === 'command' && Array.isArray(task.evidence.command) && task.evidence.command.length > 0) {
      const commandResult = await runCommandValidation(task.evidence.command, {
        cwd,
        allowValidationCommands,
        log,
      });
      if (!commandResult.ok) {
        errors.push(commandResult.stderr || 'evidence command failed');
      }
    }

    if (Array.isArray(task?.validation?.command) && task.validation.command.length > 0) {
      const commandResult = await runCommandValidation(task.validation.command, {
        cwd,
        allowValidationCommands,
        log,
      });
      if (!commandResult.ok) {
        errors.push(commandResult.stderr || 'validation command failed');
      }
    }

    const artifactIds = insertArtifacts(db, {
      sessionId,
      runGroupId,
      taskIndex,
      artifacts,
    });
    const passed = errors.length === 0;

    writeValidationResult(db, {
      sessionId,
      runGroupId,
      taskIndex,
      passed,
      errors,
      warnings,
      artifactIds,
    });

    return {
      passed,
      errors,
      warnings,
      artifactIds,
    };
  } catch (error) {
    const result = {
      passed: false,
      errors: [error.message],
      warnings: [],
      artifactIds: [],
    };
    writeValidationResult(db, {
      sessionId,
      runGroupId,
      taskIndex,
      passed: false,
      errors: result.errors,
      warnings: result.warnings,
      artifactIds: result.artifactIds,
    });
    return result;
  }
}

export function getTaskValidationResultMap(db, runGroupId) {
  const rows = db.prepare(`
    SELECT session_id, passed, errors_json, warnings_json, artifacts_json, validated_at
    FROM task_validation_results
    WHERE run_group_id = ?
  `).all(runGroupId);

  return new Map(rows.map((row) => [
    row.session_id,
    {
      passed: Number(row.passed || 0) === 1,
      errors: JSON.parse(row.errors_json || '[]'),
      warnings: JSON.parse(row.warnings_json || '[]'),
      artifacts: JSON.parse(row.artifacts_json || '[]'),
      validatedAt: row.validated_at,
    },
  ]));
}

export function getTaskArtifactAvailabilityMap(db, runGroupId) {
  const rows = db.prepare(`
    SELECT task_index, artifact_name
    FROM task_artifacts
    WHERE run_group_id = ?
  `).all(runGroupId);

  const artifactMap = new Map();
  for (const row of rows) {
    if (!artifactMap.has(row.task_index)) {
      artifactMap.set(row.task_index, new Set());
    }
    artifactMap.get(row.task_index).add(row.artifact_name);
  }
  return artifactMap;
}

export function getDependencyArtifacts(db, runGroupId, dependency) {
  const rows = db.prepare(`
    SELECT artifact_name, artifact_path, artifact_kind
    FROM task_artifacts
    WHERE run_group_id = ?
      AND task_index = ?
      AND (? IS NULL OR artifact_name = ?)
    ORDER BY created_at ASC
  `).all(
    runGroupId,
    dependency.taskIndex,
    dependency.artifact || null,
    dependency.artifact || null,
  );

  return rows.map((row) => ({
    name: row.artifact_name,
    path: row.artifact_path,
    kind: row.artifact_kind,
  }));
}
