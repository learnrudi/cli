import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import {
  collectDeclaredArtifacts,
  createTaskArtifactAvailabilityMap,
  projectDependencyArtifactRows,
  resolveArtifactPath,
} from '../../daemon/operations/artifacts.js';

test('resolveArtifactPath keeps artifact paths inside the task root', () => {
  const root = '/tmp/rudi-task';

  assert.equal(resolveArtifactPath(root, 'reports/output.md'), '/tmp/rudi-task/reports/output.md');
  assert.throws(
    () => resolveArtifactPath(root, '../outside.md'),
    /artifact path escapes task root/,
  );
  assert.throws(
    () => resolveArtifactPath(root, ''),
    /artifact path required/,
  );
});

test('collectDeclaredArtifacts records declared output without changing validation errors shape', () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rudi-artifacts-'));
  try {
    const outputPath = path.join(tempDir, 'artifact.txt');
    fs.writeFileSync(outputPath, 'artifact content');
    const warnings = [];
    const errors = [];

    const artifacts = collectDeclaredArtifacts({
      output: {
        path: 'artifact.txt',
        type: 'file',
      },
    }, tempDir, warnings, errors);

    assert.deepEqual(artifacts, [{
      name: 'artifact.txt',
      path: outputPath,
      kind: 'file',
    }]);
    assert.deepEqual(warnings, []);
    assert.deepEqual(errors, []);
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test('collectDeclaredArtifacts reports missing and wrong-type outputs as errors', () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rudi-artifacts-'));
  try {
    const errors = [];
    const missing = collectDeclaredArtifacts({
      output: {
        path: 'missing.txt',
        type: 'file',
      },
    }, tempDir, [], errors);
    assert.deepEqual(missing, []);
    assert.deepEqual(errors, ['declared output missing: missing.txt']);

    const dirPath = path.join(tempDir, 'directory-output');
    fs.mkdirSync(dirPath);
    const typeErrors = [];
    const wrongType = collectDeclaredArtifacts({
      output: {
        path: 'directory-output',
        type: 'file',
      },
    }, tempDir, [], typeErrors);
    assert.deepEqual(wrongType, []);
    assert.match(typeErrors[0], /expected file at/);
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test('createTaskArtifactAvailabilityMap groups artifact names by task index', () => {
  const map = createTaskArtifactAvailabilityMap([
    { task_index: 0, artifact_name: 'summary.md' },
    { task_index: 0, artifact_name: 'data.json' },
    { task_index: 1, artifact_name: 'result.txt' },
  ]);

  assert.deepEqual([...map.entries()].map(([taskIndex, names]) => [
    taskIndex,
    [...names].sort(),
  ]), [
    [0, ['data.json', 'summary.md']],
    [1, ['result.txt']],
  ]);
});

test('projectDependencyArtifactRows preserves dependency artifact response shape', () => {
  assert.deepEqual(projectDependencyArtifactRows([{
    artifact_name: 'config.json',
    artifact_path: '/tmp/config.json',
    artifact_kind: 'file',
  }]), [{
    name: 'config.json',
    path: '/tmp/config.json',
    kind: 'file',
  }]);
});
