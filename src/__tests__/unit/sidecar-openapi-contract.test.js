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
  assert.notDeepEqual(committedSpec.paths['/ready']?.get?.security, []);
  assert.notDeepEqual(committedSpec.paths['/version']?.get?.security, []);
  assert.notDeepEqual(committedSpec.paths['/daemon/status']?.get?.security, []);
  assert.notDeepEqual(committedSpec.paths['/local-llm/status']?.get?.security, []);
  assert.notDeepEqual(committedSpec.paths['/local-llm/env/{consumer}']?.get?.security, []);
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
  assert.ok(committedSpec.paths['/fs/serve']);
  assert.ok(committedSpec.paths['/fs/watch']);
  assert.ok(committedSpec.paths['/fs/unwatch']);
  assert.equal(
    committedSpec.paths['/fs/read']?.get?.parameters?.[0]?.schema?.$ref,
    '#/components/schemas/AbsolutePath',
  );
  assert.equal(
    committedSpec.components?.schemas?.FsWriteRequest?.properties?.path?.$ref,
    '#/components/schemas/MutableAbsolutePath',
  );
  assert.match(
    committedSpec.components?.schemas?.FsWriteBinaryRequest?.properties?.base64?.pattern,
    /A-Za-z0-9/,
  );
});

test('sidecar OpenAPI spec documents shell and terminal helper routes with explicit caveats', () => {
  assert.ok(committedSpec.paths['/shell/open']?.post?.description.includes('macOS-specific helper'));
  assert.ok(committedSpec.paths['/terminal/open']?.post?.description.includes('@lydell/node-pty'));
  assert.ok(committedSpec.paths['/terminal/close']);
  assert.deepEqual(committedSpec.components?.schemas?.TerminalShellPath?.enum, [
    '/bin/zsh',
    '/bin/bash',
    '/bin/sh',
  ]);
  assert.equal(committedSpec.components?.schemas?.TerminalOpenRequest?.properties?.cols?.maximum, 1000);
  assert.equal(committedSpec.components?.schemas?.TerminalOpenRequest?.properties?.rows?.default, 24);
});

test('sidecar OpenAPI spec publishes additive daemon schema components without changing legacy routes', () => {
  const schemas = committedSpec.components?.schemas || {};
  for (const schemaName of [
    'DaemonSuccessEnvelope',
    'DaemonFailureEnvelope',
    'DaemonRequestContext',
    'DaemonEventEnvelope',
    'DaemonHealth',
    'DaemonReadiness',
    'DaemonStatus',
    'DaemonLocalLlmRuntimeStatus',
    'DaemonLocalLlmEnvExport',
    'LocalLlmModelsResponse',
    'DaemonPackageStatus',
    'DaemonSecretStatus',
    'DaemonToolIndexCache',
    'DaemonRunGroup',
    'DaemonAgentSession',
    'DaemonJob',
    'DaemonArtifact',
  ]) {
    assert.ok(schemas[schemaName], `${schemaName} should be published in OpenAPI components`);
  }

  assert.deepEqual(schemas.DaemonSuccessEnvelope.required, ['ok', 'data']);
  assert.deepEqual(schemas.DaemonFailureEnvelope.required, ['ok', 'error']);
  assert.deepEqual(schemas.DaemonToolIndexCache.required, ['version', 'updatedAt', 'byStack']);
  assert.deepEqual(schemas.HealthResponse.required, ['status', 'version']);
  assert.deepEqual(schemas.VersionResponse.required, ['version']);
});
