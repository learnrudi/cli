import fs from 'node:fs';
import path from 'node:path';

export function resolveArtifactPath(rootDir, candidatePath) {
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

export function checkExpectedPathType(expectedType, targetPath, fsApi = fs) {
  const stat = fsApi.statSync(targetPath);
  if (expectedType === 'file' && !stat.isFile()) {
    throw new Error(`expected file at ${targetPath}`);
  }
  if (expectedType === 'directory' && !stat.isDirectory()) {
    throw new Error(`expected directory at ${targetPath}`);
  }
}

export function collectDeclaredArtifacts(task, cwd, warnings, errors, fsApi = fs) {
  const artifacts = [];
  if (!task?.output?.path || !task.output.type) {
    return artifacts;
  }

  try {
    const artifactPath = resolveArtifactPath(cwd, task.output.path);
    if (!fsApi.existsSync(artifactPath)) {
      errors.push(`declared output missing: ${task.output.path}`);
      return artifacts;
    }
    checkExpectedPathType(task.output.type, artifactPath, fsApi);
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

export function createTaskArtifactAvailabilityMap(rows) {
  const artifactMap = new Map();
  for (const row of Array.isArray(rows) ? rows : []) {
    if (!artifactMap.has(row.task_index)) {
      artifactMap.set(row.task_index, new Set());
    }
    artifactMap.get(row.task_index).add(row.artifact_name);
  }
  return artifactMap;
}

export function projectDependencyArtifactRows(rows) {
  return (Array.isArray(rows) ? rows : []).map((row) => ({
    name: row.artifact_name,
    path: row.artifact_path,
    kind: row.artifact_kind,
  }));
}
