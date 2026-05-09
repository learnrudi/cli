import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

import { buildSidecarOpenApiSpec } from '../../contracts/sidecar-openapi.js';

const projectRoot = path.resolve(process.cwd());
const packageJson = JSON.parse(
  fs.readFileSync(path.join(projectRoot, 'package.json'), 'utf-8'),
);
const committedSpec = JSON.parse(
  fs.readFileSync(path.join(projectRoot, 'docs', 'sidecar', 'openapi.json'), 'utf-8'),
);

test('generated sidecar OpenAPI spec matches the committed artifact', () => {
  const generated = buildSidecarOpenApiSpec({ cliVersion: packageJson.version });
  assert.deepEqual(committedSpec, generated);
});

test('sidecar OpenAPI spec documents only the public run-group websocket contract', () => {
  const events = committedSpec['x-rudi-websocket-events']?.events || {};
  assert.deepEqual(Object.keys(events), [
    'run-group:started',
    'run-group:session-done',
    'run-group:completed',
    'run-group:stopped',
    'run-group:session-activity',
  ]);
  assert.ok(!events['run-group:phase-started']);
});

test('sidecar OpenAPI spec keeps /health unauthenticated and documents the stable project CRUD paths', () => {
  assert.deepEqual(committedSpec.paths['/health']?.get?.security, []);
  assert.ok(committedSpec.paths['/projects']);
  assert.ok(committedSpec.paths['/projects/{projectId}']);
});

test('sidecar OpenAPI spec documents the stabilized sessions and filesystem surfaces', () => {
  assert.ok(committedSpec.paths['/sessions/projects']);
  assert.ok(committedSpec.paths['/sessions/{sessionId}/messages']);
  assert.ok(committedSpec.paths['/sessions/{sessionId}/subagents']);
  assert.ok(committedSpec.paths['/sessions/{sessionId}/title']);
  assert.ok(committedSpec.paths['/fs/read']);
  assert.ok(committedSpec.paths['/fs/write']);
  assert.ok(committedSpec.paths['/fs/readdir']);
  assert.ok(committedSpec.paths['/fs/stat']);
});

test('sidecar OpenAPI spec documents shell and terminal helper routes with explicit caveats', () => {
  assert.ok(committedSpec.paths['/shell/open']?.post?.description.includes('macOS-specific helper'));
  assert.ok(committedSpec.paths['/terminal/open']?.post?.description.includes('@lydell/node-pty'));
  assert.ok(committedSpec.paths['/terminal/close']);
});
