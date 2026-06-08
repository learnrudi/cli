import { test } from 'node:test';
import assert from 'node:assert/strict';

import { SIDECAR_ERROR_CODES } from '../../commands/serve/error-codes.js';
import {
  AGENT_SESSION_STATUSES,
  ARTIFACT_KINDS,
  CURRENT_RUN_GROUP_STATUSES,
  DAEMON_ERROR_CODE_VALUES,
  DAEMON_EVENT_TYPES,
  JOB_STATUSES,
  LOCAL_LLM_PROVIDER_FAMILIES,
  LEGACY_PACKAGE_INSTALL_ACK_STATUSES,
  LocalLlmEnvExportSchema,
  LocalLlmRuntimeStatusSchema,
  PACKAGE_KINDS,
  PACKAGE_ROUTE_KINDS,
  RUN_GROUP_STATUSES,
  RUN_GROUP_TERMINAL_STATUSES,
  SECRET_NAME_PATTERN,
  SESSION_PROVIDERS,
  TARGET_RUN_GROUP_STATUSES,
  TOOL_INDEX_CACHE_VERSION,
  ToolIndexCacheSchema,
  EventEnvelopeSchema,
  FailureEnvelopeSchema,
  RequestContextSchema,
  SuccessEnvelopeSchema,
  createToolIndexCache,
  createDaemonEvent,
  createFailureEnvelope,
  createRequestContext,
  createSuccessEnvelope,
  isJobTerminalStatus,
  isRunGroupTerminalStatus,
  validateAgentSessionStatus,
  validateArtifact,
  validateDaemonEventEnvelope,
  validateFailureEnvelope,
  validateJobStatus,
  validateLocalLlmEnvExport,
  validateLocalLlmRuntimeStatus,
  validatePackageStatus,
  validateRequestContext,
  validateRunGroupStatus,
  validateSecretName,
  validateSuccessEnvelope,
  validateToolIndexCache,
} from '../../daemon/schemas/index.js';

test('success envelope schema and helper preserve the daemon success contract', () => {
  assert.deepEqual(SuccessEnvelopeSchema.required, ['ok', 'data']);
  assert.equal(SuccessEnvelopeSchema.properties.ok.const, true);

  const envelope = createSuccessEnvelope({ status: 'ok' });

  assert.deepEqual(envelope, {
    ok: true,
    data: { status: 'ok' },
  });
  assert.deepEqual(validateSuccessEnvelope(envelope), { ok: true, errors: [] });
  assert.deepEqual(validateSuccessEnvelope({ ok: true }), {
    ok: false,
    errors: ['data is required'],
  });
});

test('failure envelope schema and helper preserve the daemon error contract', () => {
  assert.deepEqual(FailureEnvelopeSchema.required, ['ok', 'error']);
  assert.equal(FailureEnvelopeSchema.properties.ok.const, false);

  const envelope = createFailureEnvelope({
    code: 'MISSING_REQUIRED_FIELD',
    message: 'path required',
    details: { field: 'path', location: 'body' },
    requestId: 'req_test_1',
  });

  assert.deepEqual(envelope, {
    ok: false,
    error: {
      code: 'MISSING_REQUIRED_FIELD',
      message: 'path required',
      details: { field: 'path', location: 'body' },
    },
    requestId: 'req_test_1',
  });
  assert.deepEqual(validateFailureEnvelope(envelope), { ok: true, errors: [] });
  assert.deepEqual(validateFailureEnvelope({ ok: false, error: { code: 'UNKNOWN', message: 'bad' } }), {
    ok: false,
    errors: ['error.code must be a stable daemon error code'],
  });
  assert.deepEqual(createFailureEnvelope({ status: 400 }), {
    ok: false,
    error: {
      code: 'BAD_REQUEST',
      message: 'Bad request',
    },
  });
  assert.deepEqual(createFailureEnvelope({ code: 'UNKNOWN_DAEMON_CODE', status: 409 }), {
    ok: false,
    error: {
      code: 'CONFLICT',
      message: 'Conflict',
    },
  });
});

test('daemon error codes include every current sidecar error code', () => {
  for (const definition of Object.values(SIDECAR_ERROR_CODES)) {
    assert.ok(
      DAEMON_ERROR_CODE_VALUES.includes(definition.code),
      `${definition.code} should be represented in DAEMON_ERROR_CODES`,
    );
  }
});

test('request context schema captures the ingress metadata contract', () => {
  assert.deepEqual(RequestContextSchema.required, [
    'requestId',
    'method',
    'path',
    'startedAt',
    'caller',
    'auth',
    'client',
  ]);

  const context = createRequestContext({
    requestId: 'req_test_2',
    method: 'POST',
    path: '/agent/run-group',
    startedAt: 123,
    caller: { kind: 'lite' },
    auth: { required: true, result: 'accepted', mechanism: 'x-rudi-token' },
    client: { host: '127.0.0.1' },
  });

  assert.deepEqual(context, {
    requestId: 'req_test_2',
    method: 'POST',
    path: '/agent/run-group',
    startedAt: 123,
    caller: { kind: 'lite' },
    auth: { required: true, result: 'accepted', mechanism: 'x-rudi-token' },
    client: { host: '127.0.0.1' },
  });
  assert.deepEqual(validateRequestContext(context), { ok: true, errors: [] });
  assert.deepEqual(validateRequestContext({ ...context, path: 'relative' }), {
    ok: false,
    errors: ['path must be an absolute HTTP path'],
  });
});

test('event envelope schema and helper preserve the versioned daemon event contract', () => {
  assert.deepEqual(EventEnvelopeSchema.required, [
    'type',
    'id',
    'ts',
    'version',
    'resource',
    'data',
  ]);

  const event = createDaemonEvent({
    type: DAEMON_EVENT_TYPES.RUN_GROUP_UPDATED,
    id: 'evt_test_1',
    ts: '2026-05-17T12:00:00.000Z',
    resource: { kind: 'run_group', id: 'group_1' },
    data: { status: 'running' },
  });

  assert.deepEqual(event, {
    type: 'run_group.updated',
    id: 'evt_test_1',
    ts: '2026-05-17T12:00:00.000Z',
    version: 1,
    resource: { kind: 'run_group', id: 'group_1' },
    data: { status: 'running' },
  });
  assert.deepEqual(validateDaemonEventEnvelope(event), { ok: true, errors: [] });
  assert.throws(
    () => createDaemonEvent({ type: 'legacy:event', resource: { kind: 'x', id: 'y' } }),
    /daemon event type must be a known DAEMON_EVENT_TYPES value/,
  );
});

test('package schemas preserve current route and DB package vocabulary', () => {
  assert.deepEqual(PACKAGE_ROUTE_KINDS, ['agent', 'binary', 'prompt', 'runtime', 'stack']);
  assert.ok(PACKAGE_KINDS.includes('skill'));
  assert.ok(PACKAGE_KINDS.includes('tool'));
  assert.ok(PACKAGE_KINDS.includes('workflow'));

  assert.deepEqual(validatePackageStatus({
    id: 'stack:image-generator',
    kind: 'stack',
    name: 'image-generator',
    installed: true,
    secrets: [],
    problems: [],
  }), { ok: true, errors: [] });

  assert.deepEqual(validatePackageStatus({
    id: 'stack:image-generator',
    kind: 'unknown',
    name: 'image-generator',
    installed: 'yes',
    secrets: [],
    problems: {},
  }), {
    ok: false,
    errors: [
      'kind must be a known package kind',
      'installed must be boolean',
      'problems must be an array',
    ],
  });
});

test('local LLM schemas preserve the daemon runtime broker contract', () => {
  assert.deepEqual(LOCAL_LLM_PROVIDER_FAMILIES, ['openai_compatible', 'unknown']);
  assert.deepEqual(LocalLlmRuntimeStatusSchema.required, [
    'runtime',
    'providerFamily',
    'target',
    'consumer',
    'consumerContext',
    'baseUrl',
    'healthUrl',
    'apiKeyPolicy',
    'available',
    'statusCode',
    'models',
    'error',
  ]);
  assert.deepEqual(LocalLlmEnvExportSchema.required, [
    'runtime',
    'providerFamily',
    'target',
    'consumer',
    'consumerContext',
    'baseUrl',
    'env',
  ]);

  assert.deepEqual(validateLocalLlmRuntimeStatus({
    runtime: 'ollama',
    providerFamily: 'openai_compatible',
    target: 'mac_host',
    consumer: null,
    consumerContext: 'host_process',
    baseUrl: 'http://localhost:11434/v1',
    healthUrl: 'http://localhost:11434/v1/models',
    apiKeyPolicy: 'placeholder',
    available: true,
    statusCode: 200,
    models: ['qwen2.5:3b'],
    error: null,
  }), { ok: true, errors: [] });

  assert.deepEqual(validateLocalLlmEnvExport({
    runtime: 'ollama',
    providerFamily: 'openai_compatible',
    target: 'mac_host',
    consumer: 'content-engine',
    consumerContext: 'docker_container',
    baseUrl: 'http://host.docker.internal:11434/v1',
    env: {
      LOCAL_LLM_BASE_URL: 'http://host.docker.internal:11434/v1',
      LOCAL_LLM_API_KEY: 'ollama',
    },
  }), { ok: true, errors: [] });
});

test('secret schema keeps the current UPPER_SNAKE_CASE boundary', () => {
  assert.equal(SECRET_NAME_PATTERN, '^[A-Z][A-Z0-9_]*$');
  assert.deepEqual(validateSecretName('OPENAI_API_KEY'), { ok: true, errors: [] });
  assert.deepEqual(validateSecretName('openai_api_key'), {
    ok: false,
    errors: ['secret name must be UPPER_SNAKE_CASE'],
  });
});

test('tool index cache schema preserves the router cache format', () => {
  assert.equal(TOOL_INDEX_CACHE_VERSION, 1);
  assert.deepEqual(ToolIndexCacheSchema.required, ['version', 'updatedAt', 'byStack']);

  const cache = createToolIndexCache({
    updatedAt: '2026-05-17T12:00:00.000Z',
    byStack: {
      'image-generator': {
        indexedAt: '2026-05-17T12:00:00.000Z',
        tools: [{
          name: 'generate_image',
          description: 'Generate an image',
          inputSchema: { type: 'object', properties: {} },
        }],
        error: null,
      },
    },
  });

  assert.deepEqual(cache, {
    version: 1,
    updatedAt: '2026-05-17T12:00:00.000Z',
    byStack: {
      'image-generator': {
        indexedAt: '2026-05-17T12:00:00.000Z',
        tools: [{
          name: 'generate_image',
          description: 'Generate an image',
          inputSchema: { type: 'object', properties: {} },
        }],
        error: null,
      },
    },
  });
  assert.deepEqual(validateToolIndexCache(cache), { ok: true, errors: [] });
  assert.deepEqual(validateToolIndexCache({ ...cache, version: 2 }), {
    ok: false,
    errors: ['version must be 1'],
  });
});

test('run-group schema accepts current persisted statuses and target daemon statuses', () => {
  assert.deepEqual(CURRENT_RUN_GROUP_STATUSES, [
    'completed',
    'failed',
    'partial',
    'pending',
    'running',
    'stopped',
  ]);
  assert.ok(TARGET_RUN_GROUP_STATUSES.includes('queued'));
  assert.ok(TARGET_RUN_GROUP_STATUSES.includes('stopping'));
  assert.ok(RUN_GROUP_STATUSES.includes('pending'));
  assert.ok(RUN_GROUP_STATUSES.includes('queued'));

  assert.deepEqual(validateRunGroupStatus('pending'), { ok: true, errors: [] });
  assert.deepEqual(validateRunGroupStatus('queued'), { ok: true, errors: [] });
  assert.equal(isRunGroupTerminalStatus('partial'), true);
  assert.deepEqual(RUN_GROUP_TERMINAL_STATUSES, ['completed', 'failed', 'partial', 'stopped']);
});

test('session, job, and artifact schemas preserve current runtime vocabularies', () => {
  assert.deepEqual(SESSION_PROVIDERS, ['claude', 'codex', 'gemini', 'ollama']);
  assert.deepEqual(AGENT_SESSION_STATUSES, [
    'completed',
    'crashed',
    'error',
    'retrying',
    'running',
    'starting',
    'stopped',
  ]);
  assert.deepEqual(validateAgentSessionStatus('crashed'), { ok: true, errors: [] });

  assert.deepEqual(JOB_STATUSES, ['cancelled', 'completed', 'failed', 'queued', 'running']);
  assert.deepEqual(LEGACY_PACKAGE_INSTALL_ACK_STATUSES, ['started']);
  assert.deepEqual(validateJobStatus('running'), { ok: true, errors: [] });
  assert.equal(isJobTerminalStatus('failed'), true);

  assert.ok(ARTIFACT_KINDS.includes('file'));
  assert.ok(ARTIFACT_KINDS.includes('directory'));
  assert.deepEqual(validateArtifact({
    id: 'artifact_1',
    kind: 'file',
    path: '/tmp/out.png',
    bytes: 100,
  }), { ok: true, errors: [] });
  assert.deepEqual(validateArtifact({
    id: 'artifact_1',
    kind: 'unknown',
    path: '',
    bytes: -1,
  }), {
    ok: false,
    errors: [
      'kind must be a known artifact kind',
      'path is required',
      'bytes must be a non-negative integer or null',
    ],
  });
});
