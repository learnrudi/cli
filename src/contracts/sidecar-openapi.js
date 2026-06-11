import { SIDECAR_ERROR_CODES } from '../commands/serve/error-codes.js';
import { SIDECAR_API_VERSION } from '../commands/serve/metadata.js';
import {
  createRunGroupCompletedEvent,
  createRunGroupSessionActivityEvent,
  createRunGroupSessionDoneEvent,
  createRunGroupStartedEvent,
  createRunGroupStoppedEvent,
} from '../commands/agent/run-group-domain.js';
import {
  AgentSessionSchema as DaemonAgentSessionSchema,
  ArtifactSchema as DaemonArtifactSchema,
  DaemonHealthSchema,
  DaemonReadinessSchema,
  DaemonStatusSchema,
  EventEnvelopeSchema as DaemonEventEnvelopeSchema,
  FailureEnvelopeSchema as DaemonFailureEnvelopeSchema,
  JobSchema as DaemonJobSchema,
  LocalLlmEnvExportSchema as DaemonLocalLlmEnvExportSchema,
  LocalLlmRuntimeStatusSchema as DaemonLocalLlmRuntimeStatusSchema,
  PackageDescriptorSchema as DaemonPackageDescriptorSchema,
  PackageStatusSchema as DaemonPackageStatusSchema,
  RequestContextSchema as DaemonRequestContextSchema,
  RunGroupSchema as DaemonRunGroupSchema,
  SecretStatusSchema as DaemonSecretStatusSchema,
  SessionSummarySchema as DaemonSessionSummarySchema,
  SuccessEnvelopeSchema as DaemonSuccessEnvelopeSchema,
  ToolDescriptorSchema as DaemonToolDescriptorSchema,
  ToolIndexCacheSchema as DaemonToolIndexCacheSchema,
  ToolIndexStatusSchema as DaemonToolIndexStatusSchema,
} from '../daemon/schemas/index.js';

const JSON_CONTENT_TYPE = 'application/json';
const REQUEST_ID_HEADER = 'x-rudi-request-id';

function schemaRef(name) {
  return { $ref: `#/components/schemas/${name}` };
}

function responseRef(name) {
  return { $ref: `#/components/responses/${name}` };
}

function jsonResponse(description, schemaName, example) {
  const response = {
    description,
    headers: {
      [REQUEST_ID_HEADER]: {
        $ref: '#/components/headers/RequestIdHeader',
      },
    },
    content: {
      [JSON_CONTENT_TYPE]: {
        schema: schemaRef(schemaName),
      },
    },
  };
  if (example !== undefined) {
    response.content[JSON_CONTENT_TYPE].example = example;
  }
  return response;
}

function errorResponse(errorDefinition, example) {
  return jsonResponse(
    errorDefinition.defaultMessage || errorDefinition.code,
    'SidecarError',
    example || {
      error: errorDefinition.defaultMessage || 'Error',
      code: errorDefinition.code,
      requestId: 'req_example_123',
    },
  );
}

function localLlmQueryParameters(options = {}) {
  const params = [
    {
      name: 'target',
      in: 'query',
      required: false,
      schema: { type: 'string', default: 'mac_host' },
      description: 'Runtime target to resolve, such as mac_host.',
    },
    {
      name: 'context',
      in: 'query',
      required: false,
      schema: { type: 'string' },
      description: 'Consumer network context, such as host_process or docker_container.',
    },
    {
      name: 'model',
      in: 'query',
      required: false,
      schema: { type: 'string' },
      description: 'Preferred model tag to render into consumer env output.',
    },
    {
      name: 'baseUrl',
      in: 'query',
      required: false,
      schema: { type: 'string' },
      description: 'Explicit OpenAI-compatible base URL override.',
    },
    {
      name: 'timeoutMs',
      in: 'query',
      required: false,
      schema: { type: 'integer', minimum: 1, default: 5000 },
      description: 'Health/model list request timeout in milliseconds.',
    },
  ];

  if (options.includeRuntimeQuery) {
    params.unshift({
      name: 'runtime',
      in: 'query',
      required: false,
      schema: { type: 'string', default: 'ollama' },
      description: 'Runtime registry id or name.',
    });
  }

  return params;
}

function buildWebsocketEventsExtension() {
  return {
    transport: {
      protocol: 'ws',
      envelope: {
        type: 'object',
        required: ['type', 'data'],
        properties: {
          type: { type: 'string' },
          data: { type: 'object' },
        },
      },
      authentication: {
        header: 'x-rudi-token',
        websocketProtocolPrefix: 'rudi-token.',
      },
    },
    events: {
      'run-group:started': {
        stability: 'stable',
        description: 'Emitted after a run-group launch pass starts one or more sessions.',
        payloadSchema: schemaRef('RunGroupStartedEvent'),
        example: createRunGroupStartedEvent({
          groupId: 'group_demo',
          sessionIds: ['sess_a', 'sess_b'],
          activeSessionIds: ['sess_a', 'sess_b'],
        }),
      },
      'run-group:session-done': {
        stability: 'stable',
        description: 'Emitted when one run-group session reaches a terminal runtime state.',
        payloadSchema: schemaRef('RunGroupSessionDoneEvent'),
        example: createRunGroupSessionDoneEvent({
          groupId: 'group_demo',
          sessionId: 'sess_a',
          status: 'completed',
        }),
      },
      'run-group:completed': {
        stability: 'stable',
        description: 'Emitted when the aggregate run-group status becomes terminal.',
        payloadSchema: schemaRef('RunGroupCompletedEvent'),
        example: createRunGroupCompletedEvent({
          groupId: 'group_demo',
          status: 'partial',
          completedCount: 1,
          failedCount: 1,
        }),
      },
      'run-group:stopped': {
        stability: 'stable',
        description: 'Emitted after a stop request has committed the stopped aggregate state.',
        payloadSchema: schemaRef('RunGroupStoppedEvent'),
        example: createRunGroupStoppedEvent({ groupId: 'group_demo' }),
      },
      'run-group:session-activity': {
        stability: 'stable',
        description: 'Emitted after a turn result updates live run-group session activity counters.',
        payloadSchema: schemaRef('RunGroupSessionActivityEvent'),
        example: createRunGroupSessionActivityEvent({
          groupId: 'group_demo',
          sessionId: 'sess_a',
          turnCount: 3,
          costTotal: 1.25,
        }),
      },
    },
    unstableEvents: {
      'run-group:phase-started': {
        stability: 'unstable',
        description: 'Internal phased-execution signal. Not part of the public consumer contract.',
      },
    },
  };
}

export function buildSidecarOpenApiSpec({ cliVersion = null } = {}) {
  const spec = {
    openapi: '3.1.0',
    info: {
      title: 'RUDI Sidecar API',
      version: SIDECAR_API_VERSION,
      description: 'Machine-readable contract for the hardened RUDI sidecar surfaces: health, projects, notes, stable session endpoints, shell, terminal, filesystem, run-groups, and the public run-group WebSocket events.',
    },
    servers: [
      {
        url: 'http://127.0.0.1:{port}',
        description: 'Local sidecar server',
        variables: {
          port: {
            default: '8100',
            description: 'Dynamic sidecar port written to ~/.rudi/.rudi-lite-port',
          },
        },
      },
    ],
    security: [
      { RudiTokenAuth: [] },
    ],
    tags: [
      { name: 'Health' },
      { name: 'Daemon' },
      { name: 'Local LLM' },
      { name: 'Projects' },
      { name: 'Notes' },
      { name: 'Sessions' },
      { name: 'Shell' },
      { name: 'Terminal' },
      { name: 'Filesystem' },
      { name: 'Run Groups' },
    ],
    paths: {
      '/health': {
        get: {
          tags: ['Health'],
          summary: 'Health check',
          description: 'Unauthenticated sidecar health check.',
          security: [],
          operationId: 'getHealth',
          responses: {
            '200': jsonResponse('Sidecar health status', 'HealthResponse', {
              status: 'ok',
              version: SIDECAR_API_VERSION,
            }),
          },
        },
      },
      '/ready': {
        get: {
          tags: ['Daemon'],
          summary: 'Daemon readiness',
          description: 'Authenticated readiness check for dependencies needed by the local daemon.',
          operationId: 'getDaemonReadiness',
          responses: {
            '200': jsonResponse('Daemon readiness status', 'DaemonReadiness', {
              status: 'ready',
              ready: true,
              checks: {
                routes: true,
                db: { status: 'ready', ready: true },
                toolIndex: { status: 'ready', ready: true, toolCount: 4 },
              },
            }),
            '401': responseRef('UnauthorizedError'),
          },
        },
      },
      '/version': {
        get: {
          tags: ['Daemon'],
          summary: 'Daemon API version',
          description: 'Authenticated sidecar API version endpoint.',
          operationId: 'getDaemonVersion',
          responses: {
            '200': jsonResponse('Daemon API version', 'VersionResponse', {
              version: SIDECAR_API_VERSION,
            }),
            '401': responseRef('UnauthorizedError'),
          },
        },
      },
      '/daemon/status': {
        get: {
          tags: ['Daemon'],
          summary: 'Daemon status',
          description: 'Authenticated runtime status for the local daemon process and key subsystems.',
          operationId: 'getDaemonStatus',
          responses: {
            '200': jsonResponse('Daemon runtime status', 'DaemonStatus', {
              version: SIDECAR_API_VERSION,
              pid: 12345,
              port: 8100,
              uptimeMs: 1500,
              rudiHome: '/Users/hoff/.rudi',
              platform: 'darwin',
              runtime: { name: 'node', version: 'v20.0.0' },
              startedAt: '2026-05-17T12:00:00.000Z',
              toolIndexStatus: { status: 'ready', ready: true, toolCount: 4 },
              dbStatus: { status: 'ready', ready: true },
              packageCounts: { stack: 2 },
              activeSessionCount: 1,
              activeJobCount: 0,
            }),
            '401': responseRef('UnauthorizedError'),
          },
        },
      },
      '/local-llm/status': {
        get: {
          tags: ['Local LLM'],
          summary: 'Local LLM runtime status',
          description: 'Resolves a registry-backed local LLM runtime target and checks its OpenAI-compatible models endpoint.',
          operationId: 'getLocalLlmStatus',
          parameters: localLlmQueryParameters({ includeRuntimeQuery: true }),
          responses: {
            '200': jsonResponse('Local LLM runtime status', 'DaemonLocalLlmRuntimeStatus', {
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
              models: ['llama3.2:3b'],
              error: null,
            }),
            '400': responseRef('BadRequestError'),
            '401': responseRef('UnauthorizedError'),
          },
        },
      },
      '/local-llm/models': {
        get: {
          tags: ['Local LLM'],
          summary: 'Local LLM models',
          description: 'Lists models reported by the resolved OpenAI-compatible local LLM runtime.',
          operationId: 'listLocalLlmModels',
          parameters: localLlmQueryParameters({ includeRuntimeQuery: true }),
          responses: {
            '200': jsonResponse('Local LLM model list', 'LocalLlmModelsResponse', {
              runtime: 'ollama',
              target: 'mac_host',
              consumerContext: 'host_process',
              available: true,
              models: ['llama3.2:3b'],
              error: null,
            }),
            '400': responseRef('BadRequestError'),
            '401': responseRef('UnauthorizedError'),
          },
        },
      },
      '/local-llm/env/{consumer}': {
        parameters: [
          { $ref: '#/components/parameters/LocalLlmConsumer' },
        ],
        get: {
          tags: ['Local LLM'],
          summary: 'Local LLM consumer env export',
          description: 'Renders consumer-specific environment values from daemon-owned runtime metadata.',
          operationId: 'getLocalLlmConsumerEnv',
          parameters: localLlmQueryParameters({ includeRuntimeQuery: true }),
          responses: {
            '200': jsonResponse('Local LLM consumer env export', 'DaemonLocalLlmEnvExport', {
              runtime: 'ollama',
              providerFamily: 'openai_compatible',
              target: 'mac_host',
              consumer: 'content-engine',
              consumerContext: 'docker_container',
              baseUrl: 'http://host.docker.internal:11434/v1',
              env: {
                LOCAL_LLM_BASE_URL: 'http://host.docker.internal:11434/v1',
                LOCAL_LLM_API_KEY: 'ollama',
                LOCAL_LLM_MODEL: 'llama3.2:3b',
              },
            }),
            '400': responseRef('BadRequestError'),
            '401': responseRef('UnauthorizedError'),
          },
        },
      },
      '/runtimes/{runtime}/status': {
        parameters: [
          { $ref: '#/components/parameters/LocalLlmRuntime' },
        ],
        get: {
          tags: ['Local LLM'],
          summary: 'Runtime status',
          description: 'Runtime status adapter for local LLM runtimes backed by the daemon runtime broker.',
          operationId: 'getRuntimeStatus',
          parameters: localLlmQueryParameters(),
          responses: {
            '200': jsonResponse('Runtime status', 'DaemonLocalLlmRuntimeStatus', {
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
              models: ['llama3.2:3b'],
              error: null,
            }),
            '400': responseRef('BadRequestError'),
            '401': responseRef('UnauthorizedError'),
          },
        },
      },
      '/projects': {
        get: {
          tags: ['Projects'],
          summary: 'List projects',
          operationId: 'listProjects',
          responses: {
            '200': jsonResponse('Projects list', 'ProjectListResponse', {
              projects: [{
                id: 'proj-alpha-project',
                name: 'Alpha Project',
                provider: 'claude',
                color: '#7c3aed',
                path: '',
                sessionCount: 1,
                createdAt: '2026-03-22T12:00:00.000Z',
              }],
            }),
            '503': responseRef('DatabaseNotInitialized'),
            '401': responseRef('UnauthorizedError'),
          },
        },
        post: {
          tags: ['Projects'],
          summary: 'Create project',
          operationId: 'createProject',
          requestBody: {
            required: true,
            content: {
              [JSON_CONTENT_TYPE]: {
                schema: schemaRef('CreateProjectRequest'),
                example: {
                  name: 'Alpha Project',
                  path: '/Users/hoff/dev/RUDI',
                },
              },
            },
          },
          responses: {
            '201': jsonResponse('Created project', 'CreatedProjectResponse', {
              id: 'proj-alpha-project',
              name: 'Alpha Project',
              path: '/Users/hoff/dev/RUDI',
              createdAt: '2026-03-22T12:00:00.000Z',
            }),
            '400': responseRef('MissingRequiredFieldError'),
            '409': responseRef('ProjectAlreadyExistsError'),
            '503': responseRef('DatabaseNotInitialized'),
            '401': responseRef('UnauthorizedError'),
          },
        },
      },
      '/projects/{projectId}': {
        parameters: [
          { $ref: '#/components/parameters/ProjectId' },
        ],
        post: {
          tags: ['Projects'],
          summary: 'Update project',
          description: 'Updates project fields. Uses POST rather than PATCH in the current sidecar contract.',
          operationId: 'updateProject',
          requestBody: {
            required: true,
            content: {
              [JSON_CONTENT_TYPE]: {
                schema: schemaRef('UpdateProjectRequest'),
                example: {
                  name: 'Renamed Project',
                  color: '#123456',
                },
              },
            },
          },
          responses: {
            '200': jsonResponse('Updated project', 'UpdatedProjectResponse', {
              id: 'proj-alpha-project',
              name: 'Renamed Project',
              color: '#123456',
            }),
            '400': responseRef('InvalidFieldError'),
            '404': responseRef('ProjectNotFoundError'),
            '503': responseRef('DatabaseNotInitialized'),
            '401': responseRef('UnauthorizedError'),
          },
        },
        delete: {
          tags: ['Projects'],
          summary: 'Delete project',
          operationId: 'deleteProject',
          responses: {
            '200': jsonResponse('Deleted project', 'OkResponse', { ok: true }),
            '404': responseRef('ProjectNotFoundError'),
            '503': responseRef('DatabaseNotInitialized'),
            '401': responseRef('UnauthorizedError'),
          },
        },
      },
      '/notes': {
        get: {
          tags: ['Notes'],
          summary: 'List notes',
          operationId: 'listNotes',
          responses: {
            '200': jsonResponse('Notes list', 'NotesListResponse', {
              notes: [{
                id: 'note_123',
                title: 'Draft Plan',
                content: 'First version',
                createdAt: '2026-03-22T12:00:00.000Z',
                updatedAt: '2026-03-22T12:00:00.000Z',
              }],
            }),
            '401': responseRef('UnauthorizedError'),
          },
        },
        post: {
          tags: ['Notes'],
          summary: 'Create note',
          operationId: 'createNote',
          requestBody: {
            required: true,
            content: {
              [JSON_CONTENT_TYPE]: {
                schema: schemaRef('CreateNoteRequest'),
                example: {
                  title: 'Draft Plan',
                  content: 'First version',
                },
              },
            },
          },
          responses: {
            '201': jsonResponse('Created note', 'Note', {
              id: 'note_123',
              title: 'Draft Plan',
              content: 'First version',
              createdAt: '2026-03-22T12:00:00.000Z',
              updatedAt: '2026-03-22T12:00:00.000Z',
            }),
            '400': responseRef('MissingRequiredFieldError'),
            '401': responseRef('UnauthorizedError'),
          },
        },
      },
      '/notes/{noteId}': {
        parameters: [
          { $ref: '#/components/parameters/NoteId' },
        ],
        get: {
          tags: ['Notes'],
          summary: 'Get note',
          operationId: 'getNote',
          responses: {
            '200': jsonResponse('Note', 'Note', {
              id: 'note_123',
              title: 'Draft Plan',
              content: 'First version',
              createdAt: '2026-03-22T12:00:00.000Z',
              updatedAt: '2026-03-22T12:00:00.000Z',
            }),
            '404': responseRef('NoteNotFoundError'),
            '401': responseRef('UnauthorizedError'),
          },
        },
        post: {
          tags: ['Notes'],
          summary: 'Update note',
          description: 'Updates note fields. Uses POST rather than PATCH in the current sidecar contract.',
          operationId: 'updateNote',
          requestBody: {
            required: true,
            content: {
              [JSON_CONTENT_TYPE]: {
                schema: schemaRef('UpdateNoteRequest'),
                example: {
                  title: 'Revised Plan',
                  content: 'Updated version',
                },
              },
            },
          },
          responses: {
            '200': jsonResponse('Updated note', 'Note', {
              id: 'note_123',
              title: 'Revised Plan',
              content: 'Updated version',
              createdAt: '2026-03-22T12:00:00.000Z',
              updatedAt: '2026-03-22T12:30:00.000Z',
            }),
            '400': responseRef('InvalidFieldError'),
            '404': responseRef('NoteNotFoundError'),
            '401': responseRef('UnauthorizedError'),
          },
        },
        delete: {
          tags: ['Notes'],
          summary: 'Delete note',
          operationId: 'deleteNote',
          responses: {
            '200': jsonResponse('Deleted note', 'OkResponse', { ok: true }),
            '404': responseRef('NoteNotFoundError'),
            '401': responseRef('UnauthorizedError'),
          },
        },
      },
      '/sessions/projects': {
        get: {
          tags: ['Sessions'],
          summary: 'List session projects for the sidebar',
          description: 'Primary sidebar session grouping surface. Returns cached project/session summaries and supports ETag-based 304 responses. `source=db` uses the DB spine only when it is enabled; otherwise the server falls back to filesystem-backed enumeration.',
          operationId: 'listSessionProjects',
          parameters: [
            {
              name: 'source',
              in: 'query',
              schema: {
                type: 'string',
                enum: ['db'],
              },
              description: 'Optional source override. `db` is advisory and only applies when the DB spine is enabled.',
            },
            {
              name: 'If-None-Match',
              in: 'header',
              schema: { type: 'string' },
              description: 'ETag from a previous `/sessions/projects` response.',
            },
          ],
          responses: {
            '200': jsonResponse('Session projects', 'SessionProjectsResponse', {
              projects: [{
                path: 'Users-hoff-dev-RUDI',
                name: 'RUDI',
                originalPath: '/Users/hoff/dev/RUDI',
                gitStatus: null,
                sessions: [{
                  sessionId: 'sess_123',
                  provider: 'claude',
                  summary: 'Review the sidecar API',
                  firstPrompt: 'Review the sidecar API',
                  messageCount: 0,
                  modified: '2026-03-22T12:00:00.000Z',
                  created: '2026-03-22T11:45:00.000Z',
                  gitBranch: 'main',
                  originNativeFile: '/Users/hoff/.claude/projects/users-hoff-dev-RUDI/sess_123.jsonl',
                  diffStats: null,
                }],
              }],
            }),
            '304': {
              description: 'Not modified. Returned when the caller sends a matching `If-None-Match` header.',
            },
            '401': responseRef('UnauthorizedError'),
          },
        },
      },
      '/sessions/{sessionId}/messages': {
        parameters: [
          { $ref: '#/components/parameters/SessionId' },
        ],
        get: {
          tags: ['Sessions'],
          summary: 'Get paginated session messages',
          description: 'Returns chat-style messages plus usage and cursor pagination metadata. In DB mode, `count` is measured in turns rather than chat messages.',
          operationId: 'getSessionMessages',
          parameters: [
            {
              name: 'count',
              in: 'query',
              schema: { type: 'integer', minimum: 1 },
              description: 'Requested page size. In DB mode this is the number of turns; in JSONL fallback it is the number of chat messages.',
            },
            {
              name: 'cursor',
              in: 'query',
              schema: { type: 'string' },
              description: 'Opaque pagination cursor from a previous response.',
            },
          ],
          responses: {
            '200': jsonResponse('Session messages', 'SessionMessagesResponse', {
              messages: [
                {
                  role: 'user',
                  content: 'Review the API boundary',
                  timestamp: '2026-03-22T12:00:00.000Z',
                  turnNumber: 1,
                  uuid: 'turn-uuid-1',
                },
                {
                  role: 'assistant',
                  content: 'I reviewed the boundary and found two issues.',
                  timestamp: '2026-03-22T12:00:05.000Z',
                  turnNumber: 1,
                  uuid: 'turn-uuid-1',
                  model: 'claude-sonnet-4-5-20250929',
                  inputTokens: 650,
                  outputTokens: 200,
                  contextTokens: 650,
                  costUsd: 0.0042,
                },
              ],
              byteOffset: 4096,
              usage: {
                totalInputTokens: 650,
                totalOutputTokens: 200,
                totalCacheReadTokens: 0,
                turnCount: 1,
                totalCostUsd: 0.0042,
              },
              hasMore: false,
              nextCursor: null,
              totalTurns: 1,
            }),
            '400': responseRef('BadRequestError'),
            '404': responseRef('NotFoundError'),
            '503': responseRef('ServiceUnavailableError'),
            '401': responseRef('UnauthorizedError'),
          },
        },
      },
      '/sessions/{sessionId}/subagents': {
        parameters: [
          { $ref: '#/components/parameters/SessionId' },
        ],
        get: {
          tags: ['Sessions'],
          summary: 'List subagent sessions',
          description: 'Returns child sessions spawned from a parent session plus aggregate token and cost totals.',
          operationId: 'getSessionSubagents',
          responses: {
            '200': jsonResponse('Session subagents', 'SessionSubagentsResponse', {
              subagents: [{
                sessionId: 'child_123',
                agentId: 'agent_a',
                sessionType: 'task',
                model: 'claude-sonnet-4-5-20250929',
                status: 'completed',
                totalCost: 1.25,
                totalInputTokens: 1200,
                totalOutputTokens: 400,
                turnCount: 3,
                snippet: 'Implemented the error registry',
                createdAt: '2026-03-22T12:00:00.000Z',
                lastActiveAt: '2026-03-22T12:10:00.000Z',
              }],
              aggregated: {
                totalCost: 1.25,
                totalInputTokens: 1200,
                totalOutputTokens: 400,
                count: 1,
              },
            }),
            '500': responseRef('InternalError'),
            '503': responseRef('ServiceUnavailableError'),
            '401': responseRef('UnauthorizedError'),
          },
        },
      },
      '/sessions/{sessionId}/title': {
        parameters: [
          { $ref: '#/components/parameters/SessionId' },
        ],
        post: {
          tags: ['Sessions'],
          summary: 'Set a session title override',
          description: 'Stores a user-chosen session title. If the DB is unavailable, the sidecar still returns `{ ok: true, title }` so the local consumer is not blocked.',
          operationId: 'updateSessionTitle',
          requestBody: {
            required: true,
            content: {
              [JSON_CONTENT_TYPE]: {
                schema: schemaRef('SessionTitleUpdateRequest'),
                example: {
                  title: 'Sidecar hardening pass',
                },
              },
            },
          },
          responses: {
            '200': jsonResponse('Updated session title', 'SessionTitleUpdateResponse', {
              ok: true,
              title: 'Sidecar hardening pass',
            }),
            '400': responseRef('BadRequestError'),
            '401': responseRef('UnauthorizedError'),
          },
        },
      },
      '/fs/read': {
        get: {
          tags: ['Filesystem'],
          summary: 'Read a UTF-8 text file',
          operationId: 'readFileText',
          parameters: [
            {
              name: 'path',
              in: 'query',
              required: true,
              schema: schemaRef('AbsolutePath'),
            },
          ],
          responses: {
            '200': jsonResponse('File contents', 'FsReadResponse', {
              content: 'hello world',
            }),
            '400': responseRef('ValidationError'),
            '404': responseRef('NotFoundError'),
            '401': responseRef('UnauthorizedError'),
          },
        },
      },
      '/fs/write': {
        post: {
          tags: ['Filesystem'],
          summary: 'Write a UTF-8 text file',
          description: 'Creates parent directories automatically. The request body is capped at 50 MB.',
          operationId: 'writeFileText',
          requestBody: {
            required: true,
            content: {
              [JSON_CONTENT_TYPE]: {
                schema: schemaRef('FsWriteRequest'),
                example: {
                  path: '/Users/hoff/dev/RUDI/tmp/example.txt',
                  content: 'hello world',
                },
              },
            },
          },
          responses: {
            '200': jsonResponse('Write complete', 'OkResponse', { ok: true }),
            '400': responseRef('ValidationError'),
            '413': responseRef('RequestTooLargeError'),
            '500': responseRef('InternalError'),
            '401': responseRef('UnauthorizedError'),
          },
        },
      },
      '/fs/write-binary': {
        post: {
          tags: ['Filesystem'],
          summary: 'Write a binary file from base64 data',
          description: 'Creates parent directories automatically. The request body is capped at 50 MB.',
          operationId: 'writeFileBinary',
          requestBody: {
            required: true,
            content: {
              [JSON_CONTENT_TYPE]: {
                schema: schemaRef('FsWriteBinaryRequest'),
                example: {
                  path: '/Users/hoff/dev/RUDI/tmp/image.bin',
                  base64: 'AAEC/w==',
                },
              },
            },
          },
          responses: {
            '200': jsonResponse('Binary write complete', 'OkResponse', { ok: true }),
            '400': responseRef('ValidationError'),
            '413': responseRef('RequestTooLargeError'),
            '500': responseRef('InternalError'),
            '401': responseRef('UnauthorizedError'),
          },
        },
      },
      '/fs/readdir': {
        get: {
          tags: ['Filesystem'],
          summary: 'List directory entries',
          description: 'Dotfiles are hidden by default. Results are cached briefly inside the sidecar.',
          operationId: 'readDirectory',
          parameters: [
            {
              name: 'path',
              in: 'query',
              required: true,
              schema: schemaRef('AbsolutePath'),
            },
            {
              name: 'showHidden',
              in: 'query',
              schema: { type: 'string', enum: ['1'] },
              description: 'Set to `1` to include dotfiles.',
            },
          ],
          responses: {
            '200': jsonResponse('Directory entries', 'FsReaddirResponse', {
              entries: [{
                name: 'example.txt',
                path: '/Users/hoff/dev/RUDI/tmp/example.txt',
                isDirectory: false,
                isFile: true,
                size: 11,
                mtime: '2026-03-22T12:00:00.000Z',
              }],
            }),
            '400': responseRef('ValidationError'),
            '404': responseRef('NotFoundError'),
            '401': responseRef('UnauthorizedError'),
          },
        },
      },
      '/fs/stat': {
        get: {
          tags: ['Filesystem'],
          summary: 'Read file or directory metadata',
          operationId: 'statFile',
          parameters: [
            {
              name: 'path',
              in: 'query',
              required: true,
              schema: schemaRef('AbsolutePath'),
            },
          ],
          responses: {
            '200': jsonResponse('Filesystem stat', 'FsEntry', {
              name: 'example.txt',
              path: '/Users/hoff/dev/RUDI/tmp/example.txt',
              isDirectory: false,
              isFile: true,
              size: 11,
              mtime: '2026-03-22T12:00:00.000Z',
            }),
            '400': responseRef('ValidationError'),
            '404': responseRef('NotFoundError'),
            '401': responseRef('UnauthorizedError'),
          },
        },
      },
      '/fs/serve': {
        get: {
          tags: ['Filesystem'],
          summary: 'Serve a binary file',
          description: 'Streams a local file with a content type inferred from extension. The path must be an absolute local filesystem path.',
          operationId: 'serveFile',
          parameters: [
            {
              name: 'path',
              in: 'query',
              required: true,
              schema: schemaRef('AbsolutePath'),
            },
          ],
          responses: {
            '200': {
              description: 'File stream',
              headers: {
                [REQUEST_ID_HEADER]: {
                  $ref: '#/components/headers/RequestIdHeader',
                },
              },
              content: {
                'application/octet-stream': {
                  schema: { type: 'string', format: 'binary' },
                },
              },
            },
            '304': {
              description: 'Cached copy is current',
              headers: {
                [REQUEST_ID_HEADER]: {
                  $ref: '#/components/headers/RequestIdHeader',
                },
              },
            },
            '400': responseRef('ValidationError'),
            '404': responseRef('NotFoundError'),
            '401': responseRef('UnauthorizedError'),
          },
        },
      },
      '/fs/mkdir': {
        post: {
          tags: ['Filesystem'],
          summary: 'Create a directory recursively',
          operationId: 'makeDirectory',
          requestBody: {
            required: true,
            content: {
              [JSON_CONTENT_TYPE]: {
                schema: schemaRef('FsPathRequest'),
                example: {
                  path: '/Users/hoff/dev/RUDI/tmp/nested',
                },
              },
            },
          },
          responses: {
            '200': jsonResponse('Directory created', 'OkResponse', { ok: true }),
            '400': responseRef('ValidationError'),
            '500': responseRef('InternalError'),
            '401': responseRef('UnauthorizedError'),
          },
        },
      },
      '/fs/remove': {
        post: {
          tags: ['Filesystem'],
          summary: 'Remove a file or directory',
          operationId: 'removePath',
          requestBody: {
            required: true,
            content: {
              [JSON_CONTENT_TYPE]: {
                schema: schemaRef('FsDestructivePathRequest'),
                example: {
                  path: '/Users/hoff/dev/RUDI/tmp/example.txt',
                  confirmDestructive: true,
                },
              },
            },
          },
          responses: {
            '200': jsonResponse('Path removed', 'OkResponse', { ok: true }),
            '400': responseRef('ValidationError'),
            '500': responseRef('InternalError'),
            '401': responseRef('UnauthorizedError'),
          },
        },
      },
      '/fs/rename': {
        post: {
          tags: ['Filesystem'],
          summary: 'Rename or move a file or directory',
          operationId: 'renamePath',
          requestBody: {
            required: true,
            content: {
              [JSON_CONTENT_TYPE]: {
                schema: schemaRef('FsRenameRequest'),
                example: {
                  oldPath: '/Users/hoff/dev/RUDI/tmp/example.txt',
                  newPath: '/Users/hoff/dev/RUDI/tmp/example-renamed.txt',
                },
              },
            },
          },
          responses: {
            '200': jsonResponse('Path renamed', 'OkResponse', { ok: true }),
            '400': responseRef('ValidationError'),
            '500': responseRef('InternalError'),
            '401': responseRef('UnauthorizedError'),
          },
        },
      },
      '/fs/watch': {
        post: {
          tags: ['Filesystem'],
          summary: 'Watch a filesystem path for sidecar change events',
          description: 'Registers an in-process filesystem watcher. The path must be absolute and cannot be the filesystem root.',
          operationId: 'watchPath',
          requestBody: {
            required: true,
            content: {
              [JSON_CONTENT_TYPE]: {
                schema: schemaRef('FsPathRequest'),
                example: {
                  path: '/Users/hoff/dev/RUDI/tmp',
                },
              },
            },
          },
          responses: {
            '200': jsonResponse('Watch registered', 'OkResponse', { ok: true }),
            '400': responseRef('ValidationError'),
            '500': responseRef('InternalError'),
            '401': responseRef('UnauthorizedError'),
          },
        },
      },
      '/fs/unwatch': {
        post: {
          tags: ['Filesystem'],
          summary: 'Stop watching a filesystem path',
          description: 'Unregisters an in-process filesystem watcher. The path must be absolute and cannot be the filesystem root.',
          operationId: 'unwatchPath',
          requestBody: {
            required: true,
            content: {
              [JSON_CONTENT_TYPE]: {
                schema: schemaRef('FsPathRequest'),
                example: {
                  path: '/Users/hoff/dev/RUDI/tmp',
                },
              },
            },
          },
          responses: {
            '200': jsonResponse('Watch removed', 'OkResponse', { ok: true }),
            '400': responseRef('ValidationError'),
            '401': responseRef('UnauthorizedError'),
          },
        },
      },
      '/shell/reveal': {
        post: {
          tags: ['Shell'],
          summary: 'Reveal a path in the host shell UI',
          description: 'macOS-specific helper that spawns a detached `open -R` process. A `200` response means the spawn attempt was made, not that the target UI definitely opened.',
          operationId: 'shellReveal',
          requestBody: {
            required: true,
            content: {
              [JSON_CONTENT_TYPE]: {
                schema: schemaRef('ShellRevealRequest'),
                example: {
                  path: '/Users/hoff/dev/RUDI',
                },
              },
            },
          },
          responses: {
            '200': jsonResponse('Reveal requested', 'OkResponse', { ok: true }),
            '400': responseRef('ValidationError'),
            '401': responseRef('UnauthorizedError'),
          },
        },
      },
      '/shell/open': {
        post: {
          tags: ['Shell'],
          summary: 'Open a path in a host application',
          description: 'macOS-specific helper that spawns a detached application launch process. A `200` response confirms dispatch, not downstream app success.',
          operationId: 'shellOpen',
          requestBody: {
            required: true,
            content: {
              [JSON_CONTENT_TYPE]: {
                schema: schemaRef('ShellOpenRequest'),
                example: {
                  path: '/Users/hoff/dev/RUDI',
                  app: 'vscode',
                },
              },
            },
          },
          responses: {
            '200': jsonResponse('Open requested', 'OkResponse', { ok: true }),
            '400': responseRef('ValidationError'),
            '401': responseRef('UnauthorizedError'),
          },
        },
      },
      '/terminal/open': {
        post: {
          tags: ['Terminal'],
          summary: 'Open or reuse an embedded terminal session',
          description: 'Opens a PTY-backed terminal. Requires the optional `@lydell/node-pty` dependency; otherwise the sidecar returns `503`.',
          operationId: 'openTerminal',
          requestBody: {
            required: true,
            content: {
              [JSON_CONTENT_TYPE]: {
                schema: schemaRef('TerminalOpenRequest'),
                example: {
                  sessionKey: 'global',
                  cwd: '/Users/hoff/dev/RUDI',
                  shell: '/bin/zsh',
                  cols: 80,
                  rows: 24,
                },
              },
            },
          },
          responses: {
            '200': jsonResponse('Terminal opened or reused', 'TerminalOpenResponse', {
              ok: true,
              sessionKey: 'global',
              reused: false,
            }),
            '400': responseRef('ValidationError'),
            '409': responseRef('ConflictError'),
            '503': responseRef('ServiceUnavailableError'),
            '401': responseRef('UnauthorizedError'),
          },
        },
      },
      '/terminal/write': {
        post: {
          tags: ['Terminal'],
          summary: 'Write input to an embedded terminal session',
          operationId: 'writeTerminal',
          requestBody: {
            required: true,
            content: {
              [JSON_CONTENT_TYPE]: {
                schema: schemaRef('TerminalWriteRequest'),
                example: {
                  sessionKey: 'global',
                  data: 'ls\\n',
                },
              },
            },
          },
          responses: {
            '200': jsonResponse('Terminal write complete', 'OkResponse', { ok: true }),
            '400': responseRef('ValidationError'),
            '404': responseRef('NotFoundError'),
            '401': responseRef('UnauthorizedError'),
          },
        },
      },
      '/terminal/resize': {
        post: {
          tags: ['Terminal'],
          summary: 'Resize an embedded terminal session',
          operationId: 'resizeTerminal',
          requestBody: {
            required: true,
            content: {
              [JSON_CONTENT_TYPE]: {
                schema: schemaRef('TerminalResizeRequest'),
                example: {
                  sessionKey: 'global',
                  cols: 120,
                  rows: 30,
                },
              },
            },
          },
          responses: {
            '200': jsonResponse('Terminal resized', 'OkResponse', { ok: true }),
            '400': responseRef('MissingRequiredFieldError'),
            '404': responseRef('NotFoundError'),
            '401': responseRef('UnauthorizedError'),
          },
        },
      },
      '/terminal/close': {
        post: {
          tags: ['Terminal'],
          summary: 'Close an embedded terminal session',
          description: 'Idempotent. Closing a nonexistent session still returns `{ ok: true }`.',
          operationId: 'closeTerminal',
          requestBody: {
            required: true,
            content: {
              [JSON_CONTENT_TYPE]: {
                schema: schemaRef('TerminalSessionKeyRequest'),
                example: {
                  sessionKey: 'global',
                },
              },
            },
          },
          responses: {
            '200': jsonResponse('Terminal closed', 'OkResponse', { ok: true }),
            '401': responseRef('UnauthorizedError'),
          },
        },
      },
      '/agent/run-group': {
        post: {
          tags: ['Run Groups'],
          summary: 'Create and launch run group',
          operationId: 'createRunGroup',
          requestBody: {
            required: true,
            content: {
              [JSON_CONTENT_TYPE]: {
                schema: schemaRef('RunGroupCreateRequest'),
                example: {
                  name: 'Batch Review',
                  cwd: '/Users/hoff/dev/RUDI',
                  coordinationMode: 'flat',
                  executionMode: 'worktree',
                  tasks: [
                    { prompt: 'Review the API boundary', role: 'reviewer', filesTouched: ['src/commands/serve.js'] },
                    { prompt: 'Implement the error registry', role: 'implementer', requiresWrite: true },
                  ],
                },
              },
            },
          },
          responses: {
            '200': jsonResponse('Run-group created', 'RunGroupCreateResponse', {
              groupId: 'group_demo',
              status: 'running',
              sessionIds: ['sess_a', 'sess_b'],
              startedSessionIds: ['sess_a', 'sess_b'],
              errors: [],
            }),
            '400': responseRef('BadRequestError'),
            '429': responseRef('RateLimitedError'),
            '500': responseRef('InternalError'),
            '401': responseRef('UnauthorizedError'),
          },
        },
      },
      '/agent/run-groups': {
        get: {
          tags: ['Run Groups'],
          summary: 'List run groups',
          operationId: 'listRunGroups',
          parameters: [
            {
              name: 'projectPath',
              in: 'query',
              schema: { type: 'string' },
            },
            {
              name: 'status',
              in: 'query',
              schema: schemaRef('RunGroupStatus'),
            },
            {
              name: 'limit',
              in: 'query',
              schema: { type: 'integer', minimum: 1 },
            },
            {
              name: 'offset',
              in: 'query',
              schema: { type: 'integer', minimum: 0 },
            },
          ],
          responses: {
            '200': jsonResponse('Run-group list', 'RunGroupListResponse', {
              groups: [{
                id: 'group_demo',
                name: 'Batch Review',
                status: 'running',
                project_path: '/Users/hoff/dev/RUDI',
                base_branch: 'main',
                execution_mode: 'worktree',
                coordination_mode: 'flat',
                requires_git: 1,
                workspace_root: '/Users/hoff/dev/RUDI',
                provider: 'claude',
                model: null,
                permission_mode: null,
                session_count: 2,
                completed_count: 0,
                failed_count: 0,
                total_cost: 0,
                total_tokens: 0,
                config_json: '{"tasks":[]}',
                created_at: '2026-03-22T12:00:00.000Z',
                started_at: '2026-03-22T12:00:00.000Z',
                completed_at: null,
                updated_at: '2026-03-22T12:00:00.000Z',
              }],
            }),
            '401': responseRef('UnauthorizedError'),
          },
        },
      },
      '/agent/run-group/{groupId}': {
        parameters: [
          { $ref: '#/components/parameters/RunGroupId' },
        ],
        get: {
          tags: ['Run Groups'],
          summary: 'Get run-group detail',
          operationId: 'getRunGroup',
          responses: {
            '200': jsonResponse('Run-group detail', 'RunGroupDetailResponse'),
            '404': responseRef('RunGroupNotFoundError'),
            '401': responseRef('UnauthorizedError'),
          },
        },
      },
      '/agent/run-group/{groupId}/live': {
        parameters: [
          { $ref: '#/components/parameters/RunGroupId' },
        ],
        get: {
          tags: ['Run Groups'],
          summary: 'Get live run-group activity',
          operationId: 'getRunGroupLive',
          responses: {
            '200': jsonResponse('Run-group live activity', 'RunGroupLiveResponse'),
            '404': responseRef('RunGroupNotFoundError'),
            '401': responseRef('UnauthorizedError'),
          },
        },
      },
      '/agent/run-group/{groupId}/stop': {
        parameters: [
          { $ref: '#/components/parameters/RunGroupId' },
        ],
        post: {
          tags: ['Run Groups'],
          summary: 'Stop run group',
          description: 'Stops active sessions in a run group. After this call returns, a subsequent detail read sees the stopped aggregate state.',
          operationId: 'stopRunGroup',
          responses: {
            '200': jsonResponse('Stopped run group', 'RunGroupStopResponse', {
              ok: true,
              groupId: 'group_demo',
              stopped: 2,
              status: 'stopped',
            }),
            '404': responseRef('RunGroupNotFoundError'),
            '401': responseRef('UnauthorizedError'),
          },
        },
      },
    },
    components: {
      securitySchemes: {
        RudiTokenAuth: {
          type: 'apiKey',
          in: 'header',
          name: 'x-rudi-token',
          description: 'Sidecar auth token read from ~/.rudi/.rudi-lite-token.',
        },
      },
      headers: {
        RequestIdHeader: {
          description: 'Per-request correlation ID returned on sidecar responses.',
          schema: {
            type: 'string',
          },
        },
      },
      parameters: {
        ProjectId: {
          name: 'projectId',
          in: 'path',
          required: true,
          schema: { type: 'string' },
        },
        NoteId: {
          name: 'noteId',
          in: 'path',
          required: true,
          schema: { type: 'string' },
        },
        SessionId: {
          name: 'sessionId',
          in: 'path',
          required: true,
          schema: { type: 'string' },
        },
        RunGroupId: {
          name: 'groupId',
          in: 'path',
          required: true,
          schema: { type: 'string' },
        },
        LocalLlmConsumer: {
          name: 'consumer',
          in: 'path',
          required: true,
          schema: { type: 'string' },
          example: 'content-engine',
        },
        LocalLlmRuntime: {
          name: 'runtime',
          in: 'path',
          required: true,
          schema: { type: 'string' },
          example: 'ollama',
        },
      },
      responses: {
        UnauthorizedError: errorResponse(SIDECAR_ERROR_CODES.UNAUTHORIZED, {
          error: 'Unauthorized',
          code: SIDECAR_ERROR_CODES.UNAUTHORIZED.code,
          requestId: 'req_example_123',
        }),
        BadRequestError: errorResponse(SIDECAR_ERROR_CODES.BAD_REQUEST, {
          error: 'Bad request',
          code: SIDECAR_ERROR_CODES.BAD_REQUEST.code,
          requestId: 'req_example_123',
        }),
        ConflictError: errorResponse(SIDECAR_ERROR_CODES.CONFLICT, {
          error: 'Conflict',
          code: SIDECAR_ERROR_CODES.CONFLICT.code,
          requestId: 'req_example_123',
        }),
        NotFoundError: errorResponse(SIDECAR_ERROR_CODES.NOT_FOUND, {
          error: 'Not found',
          code: SIDECAR_ERROR_CODES.NOT_FOUND.code,
          requestId: 'req_example_123',
        }),
        RequestTooLargeError: errorResponse(SIDECAR_ERROR_CODES.REQUEST_TOO_LARGE, {
          error: 'Request body too large',
          code: SIDECAR_ERROR_CODES.REQUEST_TOO_LARGE.code,
          requestId: 'req_example_123',
        }),
        ServiceUnavailableError: errorResponse(SIDECAR_ERROR_CODES.SERVICE_UNAVAILABLE, {
          error: 'Service unavailable',
          code: SIDECAR_ERROR_CODES.SERVICE_UNAVAILABLE.code,
          requestId: 'req_example_123',
        }),
        MissingRequiredFieldError: errorResponse(SIDECAR_ERROR_CODES.MISSING_REQUIRED_FIELD, {
          error: 'name required',
          code: SIDECAR_ERROR_CODES.MISSING_REQUIRED_FIELD.code,
          details: {
            field: 'name',
            location: 'body',
          },
          requestId: 'req_example_123',
        }),
        InvalidFieldError: errorResponse(SIDECAR_ERROR_CODES.INVALID_FIELD, {
          error: 'title must be a string',
          code: SIDECAR_ERROR_CODES.INVALID_FIELD.code,
          details: {
            field: 'title',
            location: 'body',
            reason: 'invalid_type',
            expectedType: 'string',
          },
          requestId: 'req_example_123',
        }),
        ValidationError: {
          description: 'Missing required field or invalid field value.',
          headers: {
            [REQUEST_ID_HEADER]: {
              $ref: '#/components/headers/RequestIdHeader',
            },
          },
          content: {
            [JSON_CONTENT_TYPE]: {
              schema: schemaRef('SidecarError'),
              examples: {
                missingRequiredField: {
                  value: {
                    error: 'path required',
                    code: SIDECAR_ERROR_CODES.MISSING_REQUIRED_FIELD.code,
                    details: {
                      field: 'path',
                      location: 'body',
                    },
                    requestId: 'req_example_123',
                  },
                },
                invalidPath: {
                  value: {
                    error: 'path must be an absolute filesystem path',
                    code: SIDECAR_ERROR_CODES.INVALID_FIELD.code,
                    details: {
                      field: 'path',
                      location: 'body',
                      reason: 'absolute_path_required',
                    },
                    requestId: 'req_example_123',
                  },
                },
              },
            },
          },
        },
        ProjectAlreadyExistsError: errorResponse(SIDECAR_ERROR_CODES.PROJECT_ALREADY_EXISTS, {
          error: 'Project already exists',
          code: SIDECAR_ERROR_CODES.PROJECT_ALREADY_EXISTS.code,
          requestId: 'req_example_123',
        }),
        ProjectNotFoundError: errorResponse(SIDECAR_ERROR_CODES.PROJECT_NOT_FOUND, {
          error: 'Project not found',
          code: SIDECAR_ERROR_CODES.PROJECT_NOT_FOUND.code,
          requestId: 'req_example_123',
        }),
        NoteNotFoundError: errorResponse(SIDECAR_ERROR_CODES.NOTE_NOT_FOUND, {
          error: 'Note not found',
          code: SIDECAR_ERROR_CODES.NOTE_NOT_FOUND.code,
          requestId: 'req_example_123',
        }),
        RunGroupNotFoundError: errorResponse(SIDECAR_ERROR_CODES.RUN_GROUP_NOT_FOUND, {
          error: 'Run group not found',
          code: SIDECAR_ERROR_CODES.RUN_GROUP_NOT_FOUND.code,
          requestId: 'req_example_123',
        }),
        DatabaseNotInitialized: errorResponse(SIDECAR_ERROR_CODES.DATABASE_NOT_INITIALIZED, {
          error: 'Database not initialized',
          code: SIDECAR_ERROR_CODES.DATABASE_NOT_INITIALIZED.code,
          requestId: 'req_example_123',
        }),
        RateLimitedError: errorResponse(SIDECAR_ERROR_CODES.RATE_LIMITED, {
          error: 'MAX_CONCURRENT_REACHED',
          code: SIDECAR_ERROR_CODES.RATE_LIMITED.code,
          message: 'Too many active agent processes for requested group (9 + 2 > 10)',
          requestId: 'req_example_123',
        }),
        InternalError: errorResponse(SIDECAR_ERROR_CODES.INTERNAL_ERROR, {
          error: 'Internal server error',
          code: SIDECAR_ERROR_CODES.INTERNAL_ERROR.code,
          requestId: 'req_example_123',
        }),
      },
      schemas: {
        DaemonSuccessEnvelope: DaemonSuccessEnvelopeSchema,
        DaemonFailureEnvelope: DaemonFailureEnvelopeSchema,
        DaemonRequestContext: DaemonRequestContextSchema,
        DaemonEventEnvelope: DaemonEventEnvelopeSchema,
        DaemonHealth: DaemonHealthSchema,
        DaemonReadiness: DaemonReadinessSchema,
        DaemonStatus: DaemonStatusSchema,
        DaemonLocalLlmRuntimeStatus: DaemonLocalLlmRuntimeStatusSchema,
        DaemonLocalLlmEnvExport: DaemonLocalLlmEnvExportSchema,
        DaemonPackageDescriptor: DaemonPackageDescriptorSchema,
        DaemonPackageStatus: DaemonPackageStatusSchema,
        DaemonSecretStatus: DaemonSecretStatusSchema,
        DaemonToolIndexCache: DaemonToolIndexCacheSchema,
        DaemonToolDescriptor: DaemonToolDescriptorSchema,
        DaemonToolIndexStatus: DaemonToolIndexStatusSchema,
        DaemonRunGroup: DaemonRunGroupSchema,
        DaemonAgentSession: DaemonAgentSessionSchema,
        DaemonSessionSummary: DaemonSessionSummarySchema,
        DaemonJob: DaemonJobSchema,
        DaemonArtifact: DaemonArtifactSchema,
        LocalLlmModelsResponse: {
          type: 'object',
          additionalProperties: false,
          required: ['runtime', 'target', 'consumerContext', 'available', 'models', 'error'],
          properties: {
            runtime: { type: 'string' },
            target: { type: 'string' },
            consumerContext: { type: 'string' },
            available: { type: 'boolean' },
            models: {
              type: 'array',
              items: { type: 'string' },
            },
            error: { type: ['string', 'null'] },
          },
        },
        HealthResponse: {
          type: 'object',
          required: ['status', 'version'],
          properties: {
            status: { type: 'string', const: 'ok' },
            version: { type: 'string' },
          },
        },
        VersionResponse: {
          type: 'object',
          additionalProperties: false,
          required: ['version'],
          properties: {
            version: { type: 'string' },
          },
        },
        SidecarError: {
          type: 'object',
          required: ['error', 'code'],
          properties: {
            error: { type: 'string' },
            code: { type: 'string' },
            message: { type: ['string', 'null'] },
            details: {
              type: ['object', 'null'],
              additionalProperties: true,
            },
            requestId: { type: 'string' },
          },
          additionalProperties: false,
        },
        OkResponse: {
          type: 'object',
          required: ['ok'],
          properties: {
            ok: { type: 'boolean', const: true },
          },
        },
        ProjectListItem: {
          type: 'object',
          required: ['id', 'name', 'provider', 'color', 'path', 'sessionCount', 'createdAt'],
          properties: {
            id: { type: 'string' },
            name: { type: 'string' },
            provider: { type: 'string' },
            color: { type: ['string', 'null'] },
            path: { type: 'string' },
            sessionCount: { type: 'integer' },
            createdAt: { type: 'string', format: 'date-time' },
          },
        },
        ProjectListResponse: {
          type: 'object',
          required: ['projects'],
          properties: {
            projects: {
              type: 'array',
              items: schemaRef('ProjectListItem'),
            },
          },
        },
        CreateProjectRequest: {
          type: 'object',
          required: ['name'],
          properties: {
            name: { type: 'string' },
            path: { type: 'string' },
          },
          additionalProperties: false,
        },
        UpdateProjectRequest: {
          type: 'object',
          properties: {
            name: { type: 'string' },
            color: { type: ['string', 'null'] },
          },
          additionalProperties: false,
        },
        CreatedProjectResponse: {
          type: 'object',
          required: ['id', 'name', 'path', 'createdAt'],
          properties: {
            id: { type: 'string' },
            name: { type: 'string' },
            path: { type: 'string' },
            createdAt: { type: 'string', format: 'date-time' },
          },
        },
        UpdatedProjectResponse: {
          type: 'object',
          required: ['id'],
          properties: {
            id: { type: 'string' },
            name: { type: 'string' },
            color: { type: ['string', 'null'] },
          },
        },
        Note: {
          type: 'object',
          required: ['id', 'title', 'content', 'createdAt', 'updatedAt'],
          properties: {
            id: { type: 'string' },
            title: { type: 'string' },
            content: { type: 'string' },
            createdAt: { type: 'string', format: 'date-time' },
            updatedAt: { type: 'string', format: 'date-time' },
          },
        },
        NotesListResponse: {
          type: 'object',
          required: ['notes'],
          properties: {
            notes: {
              type: 'array',
              items: schemaRef('Note'),
            },
          },
        },
        CreateNoteRequest: {
          type: 'object',
          required: ['title'],
          properties: {
            title: { type: 'string' },
            content: { type: 'string' },
          },
          additionalProperties: false,
        },
        UpdateNoteRequest: {
          type: 'object',
          properties: {
            title: { type: 'string' },
            content: { type: 'string' },
          },
          additionalProperties: false,
        },
        SessionProjectSession: {
          type: 'object',
          required: ['sessionId', 'provider', 'summary', 'firstPrompt', 'messageCount', 'modified', 'created', 'gitBranch'],
          properties: {
            sessionId: { type: 'string' },
            provider: { type: 'string' },
            summary: { type: 'string' },
            firstPrompt: { type: 'string' },
            messageCount: { type: 'integer' },
            modified: { type: 'string' },
            created: { type: 'string' },
            gitBranch: { type: 'string' },
            originNativeFile: { type: ['string', 'null'] },
            diffStats: {
              type: ['object', 'null'],
              additionalProperties: true,
            },
            dbTitle: { type: ['string', 'null'] },
            totalCost: { type: 'number' },
            totalInputTokens: { type: 'integer' },
            totalOutputTokens: { type: 'integer' },
            turnCount: { type: 'integer' },
            parentSessionId: { type: ['string', 'null'] },
            isSidechain: { type: 'boolean' },
            sessionType: { type: ['string', 'null'] },
            tags: {
              type: 'array',
              items: { type: 'string' },
            },
            model: { type: ['string', 'null'] },
          },
          additionalProperties: false,
        },
        SessionProject: {
          type: 'object',
          required: ['path', 'name', 'originalPath', 'sessions', 'gitStatus'],
          properties: {
            path: { type: 'string' },
            name: { type: 'string' },
            originalPath: { type: 'string' },
            sessions: {
              type: 'array',
              items: schemaRef('SessionProjectSession'),
            },
            gitStatus: {
              type: ['object', 'null'],
              additionalProperties: true,
            },
          },
          additionalProperties: false,
        },
        SessionProjectsResponse: {
          type: 'object',
          required: ['projects'],
          properties: {
            projects: {
              type: 'array',
              items: schemaRef('SessionProject'),
            },
            error: { type: ['string', 'null'] },
          },
          additionalProperties: false,
        },
        SessionMessage: {
          type: 'object',
          required: ['role', 'content'],
          properties: {
            role: {
              type: 'string',
              enum: ['user', 'assistant'],
            },
            content: { type: 'string' },
            timestamp: { type: ['string', 'null'], format: 'date-time' },
            turnNumber: { type: 'integer' },
            providerTurnId: { type: ['string', 'null'] },
            uuid: { type: ['string', 'null'] },
            permissionMode: { type: ['string', 'null'] },
            model: { type: ['string', 'null'] },
            inputTokens: { type: 'integer' },
            outputTokens: { type: 'integer' },
            cacheReadTokens: { type: 'integer' },
            cacheCreationTokens: { type: 'integer' },
            contextTokens: { type: 'integer' },
            costUsd: { type: 'number' },
            durationMs: { type: 'integer' },
            finishReason: { type: ['string', 'null'] },
            compactMetadata: {
              type: ['object', 'null'],
              additionalProperties: true,
            },
            thinking: { type: ['string', 'null'] },
            toolCalls: {
              type: 'array',
              items: {
                type: 'object',
                additionalProperties: true,
              },
            },
            contentBlocks: {
              type: 'array',
              items: {
                type: 'object',
                additionalProperties: true,
              },
            },
          },
          additionalProperties: false,
        },
        SessionUsageSummary: {
          type: 'object',
          required: ['totalInputTokens', 'totalOutputTokens', 'totalCacheReadTokens', 'turnCount'],
          properties: {
            totalInputTokens: { type: 'integer' },
            totalOutputTokens: { type: 'integer' },
            totalCacheReadTokens: { type: 'integer' },
            turnCount: { type: 'integer' },
            totalCostUsd: { type: ['number', 'null'] },
          },
          additionalProperties: false,
        },
        SessionMessagesResponse: {
          type: 'object',
          required: ['messages', 'byteOffset', 'hasMore'],
          properties: {
            messages: {
              type: 'array',
              items: schemaRef('SessionMessage'),
            },
            byteOffset: { type: 'integer' },
            usage: {
              anyOf: [
                schemaRef('SessionUsageSummary'),
                { type: 'null' },
              ],
            },
            hasMore: { type: 'boolean' },
            nextCursor: { type: ['string', 'null'] },
            totalTurns: { type: 'integer' },
          },
          additionalProperties: false,
        },
        SessionSubagent: {
          type: 'object',
          required: [
            'sessionId',
            'agentId',
            'sessionType',
            'model',
            'status',
            'totalCost',
            'totalInputTokens',
            'totalOutputTokens',
            'turnCount',
            'snippet',
            'createdAt',
            'lastActiveAt',
          ],
          properties: {
            sessionId: { type: 'string' },
            agentId: { type: 'string' },
            sessionType: { type: 'string' },
            model: { type: 'string' },
            status: { type: 'string' },
            totalCost: { type: 'number' },
            totalInputTokens: { type: 'integer' },
            totalOutputTokens: { type: 'integer' },
            turnCount: { type: 'integer' },
            snippet: { type: 'string' },
            createdAt: { type: 'string' },
            lastActiveAt: { type: 'string' },
          },
          additionalProperties: false,
        },
        SessionSubagentsAggregated: {
          type: 'object',
          required: ['totalCost', 'totalInputTokens', 'totalOutputTokens', 'count'],
          properties: {
            totalCost: { type: 'number' },
            totalInputTokens: { type: 'integer' },
            totalOutputTokens: { type: 'integer' },
            count: { type: 'integer' },
          },
          additionalProperties: false,
        },
        SessionSubagentsResponse: {
          type: 'object',
          required: ['subagents', 'aggregated'],
          properties: {
            subagents: {
              type: 'array',
              items: schemaRef('SessionSubagent'),
            },
            aggregated: schemaRef('SessionSubagentsAggregated'),
          },
          additionalProperties: false,
        },
        SessionTitleUpdateRequest: {
          type: 'object',
          required: ['title'],
          properties: {
            title: { type: 'string' },
          },
          additionalProperties: false,
        },
        SessionTitleUpdateResponse: {
          type: 'object',
          required: ['ok', 'title'],
          properties: {
            ok: { type: 'boolean', const: true },
            title: { type: 'string' },
          },
          additionalProperties: false,
        },
        AbsolutePath: {
          type: 'string',
          description: 'Absolute local filesystem path. Empty, relative, and NUL-containing values are rejected.',
          examples: ['/Users/hoff/dev/RUDI/tmp/example.txt'],
        },
        MutableAbsolutePath: {
          type: 'string',
          description: 'Absolute local filesystem path for a mutating sidecar operation. The filesystem root is rejected.',
          examples: ['/Users/hoff/dev/RUDI/tmp/example.txt'],
        },
        FsEntry: {
          type: 'object',
          required: ['name', 'path', 'isDirectory', 'isFile', 'size', 'mtime'],
          properties: {
            name: { type: 'string' },
            path: { type: 'string' },
            isDirectory: { type: 'boolean' },
            isFile: { type: 'boolean' },
            size: { type: 'integer' },
            mtime: { type: 'string', format: 'date-time' },
          },
          additionalProperties: false,
        },
        FsReadResponse: {
          type: 'object',
          required: ['content'],
          properties: {
            content: { type: 'string' },
          },
          additionalProperties: false,
        },
        FsReaddirResponse: {
          type: 'object',
          required: ['entries'],
          properties: {
            entries: {
              type: 'array',
              items: schemaRef('FsEntry'),
            },
          },
          additionalProperties: false,
        },
        FsPathRequest: {
          type: 'object',
          required: ['path'],
          properties: {
            path: schemaRef('MutableAbsolutePath'),
          },
          additionalProperties: false,
        },
        FsDestructivePathRequest: {
          type: 'object',
          required: ['path', 'confirmDestructive'],
          properties: {
            path: schemaRef('MutableAbsolutePath'),
            confirmDestructive: {
              type: 'boolean',
              const: true,
              description: 'Must be true for destructive filesystem operations.',
            },
          },
          additionalProperties: false,
        },
        FsWriteRequest: {
          type: 'object',
          required: ['path', 'content'],
          properties: {
            path: schemaRef('MutableAbsolutePath'),
            content: { type: 'string' },
          },
          additionalProperties: false,
        },
        FsWriteBinaryRequest: {
          type: 'object',
          required: ['path', 'base64'],
          properties: {
            path: schemaRef('MutableAbsolutePath'),
            base64: {
              type: 'string',
              pattern: '^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$',
              description: 'Strict standard base64 content without whitespace or data URI prefixes.',
            },
          },
          additionalProperties: false,
        },
        FsRenameRequest: {
          type: 'object',
          required: ['oldPath', 'newPath'],
          properties: {
            oldPath: schemaRef('MutableAbsolutePath'),
            newPath: schemaRef('MutableAbsolutePath'),
          },
          additionalProperties: false,
        },
        ShellApp: {
          type: 'string',
          enum: ['vscode', 'cursor', 'finder', 'xcode', 'antigravity', 'warp', 'terminal'],
        },
        ShellRevealRequest: {
          type: 'object',
          required: ['path'],
          properties: {
            path: schemaRef('AbsolutePath'),
          },
          additionalProperties: false,
        },
        ShellOpenRequest: {
          type: 'object',
          required: ['path', 'app'],
          properties: {
            path: schemaRef('AbsolutePath'),
            app: schemaRef('ShellApp'),
          },
          additionalProperties: false,
        },
        TerminalShellPath: {
          type: 'string',
          enum: ['/bin/zsh', '/bin/bash', '/bin/sh'],
          description: 'Allowed interactive shell executable for embedded terminal sessions.',
        },
        TerminalSessionKeyRequest: {
          type: 'object',
          properties: {
            sessionKey: { type: 'string' },
          },
          additionalProperties: false,
        },
        TerminalOpenRequest: {
          type: 'object',
          required: ['cwd'],
          properties: {
            sessionKey: { type: 'string' },
            cwd: schemaRef('AbsolutePath'),
            shell: schemaRef('TerminalShellPath'),
            cols: { type: 'integer', minimum: 1, maximum: 1000, default: 80 },
            rows: { type: 'integer', minimum: 1, maximum: 1000, default: 24 },
          },
          additionalProperties: false,
        },
        TerminalOpenResponse: {
          type: 'object',
          required: ['ok', 'sessionKey', 'reused'],
          properties: {
            ok: { type: 'boolean', const: true },
            sessionKey: { type: 'string' },
            reused: { type: 'boolean' },
            buffer: { type: ['string', 'null'] },
          },
          additionalProperties: false,
        },
        TerminalWriteRequest: {
          type: 'object',
          required: ['data'],
          properties: {
            sessionKey: { type: 'string' },
            data: { type: 'string' },
          },
          additionalProperties: false,
        },
        TerminalResizeRequest: {
          type: 'object',
          required: ['cols', 'rows'],
          properties: {
            sessionKey: { type: 'string' },
            cols: { type: 'integer', minimum: 1, maximum: 1000 },
            rows: { type: 'integer', minimum: 1, maximum: 1000 },
          },
          additionalProperties: false,
        },
        RunGroupStatus: {
          type: 'string',
          enum: ['pending', 'running', 'completed', 'partial', 'failed', 'stopped'],
        },
        RunGroupExecutionMode: {
          type: 'string',
          enum: ['worktree', 'shared_cwd', 'read_only', 'detached'],
        },
        RunGroupCoordinationMode: {
          type: 'string',
          enum: ['flat', 'phased', 'dependency', 'supervisor'],
        },
        RunGroupFailurePolicy: {
          type: 'string',
          enum: ['stop-all', 'stop-downstream', 'continue', 'escalate'],
        },
        RunGroupMergePolicy: {
          type: 'string',
          enum: ['git', 'manual', 'synthesize', 'concatenate'],
        },
        RunGroupIoSpec: {
          type: 'object',
          required: ['type', 'path'],
          properties: {
            type: {
              type: 'string',
              enum: ['file', 'directory'],
            },
            path: { type: 'string' },
            optional: { type: 'boolean' },
          },
          additionalProperties: false,
        },
        RunGroupOutputSpec: {
          type: 'object',
          required: ['type', 'path'],
          properties: {
            type: {
              type: 'string',
              enum: ['file', 'directory'],
            },
            path: { type: 'string' },
          },
          additionalProperties: false,
        },
        RunGroupEvidenceSpec: {
          type: 'object',
          required: ['type'],
          properties: {
            type: {
              type: 'string',
              enum: ['artifact_exists', 'json_file', 'command'],
            },
            path: { type: 'string' },
            command: {
              type: 'array',
              items: { type: 'string' },
            },
          },
          additionalProperties: false,
        },
        RunGroupDependencySpec: {
          type: 'object',
          required: ['taskIndex'],
          properties: {
            taskIndex: { type: 'integer', minimum: 0 },
            artifact: { type: ['string', 'null'] },
          },
          additionalProperties: false,
        },
        RunGroupValidationSpec: {
          type: 'object',
          required: ['command'],
          properties: {
            command: {
              type: 'array',
              items: { type: 'string' },
              minItems: 1,
            },
          },
          additionalProperties: false,
        },
        RunGroupTaskRequest: {
          type: 'object',
          required: ['prompt'],
          properties: {
            prompt: { type: 'string' },
            name: { type: 'string' },
            scope: { type: 'string' },
            provider: { type: 'string' },
            model: { type: 'string' },
            role: { type: 'string' },
            goal: { type: 'string' },
            deliverable: { type: 'string' },
            rationale: { type: 'string' },
            inputs: {
              type: 'array',
              items: schemaRef('RunGroupIoSpec'),
            },
            tools: {
              type: 'array',
              items: { type: 'string' },
            },
            evidence: schemaRef('RunGroupEvidenceSpec'),
            output: schemaRef('RunGroupOutputSpec'),
            dependencies: {
              type: 'array',
              items: schemaRef('RunGroupDependencySpec'),
            },
            failurePolicy: {
              allOf: [schemaRef('RunGroupFailurePolicy')],
              'x-rudi-aliases': ['failure_policy'],
            },
            mergePolicy: {
              allOf: [schemaRef('RunGroupMergePolicy')],
              'x-rudi-aliases': ['merge_policy'],
            },
            validation: schemaRef('RunGroupValidationSpec'),
            validationCommand: {
              type: 'array',
              items: { type: 'string' },
              'x-rudi-aliases': ['validation_command'],
            },
            filesTouched: {
              type: 'array',
              items: { type: 'string' },
              'x-rudi-aliases': ['files_touched'],
            },
            dependsOn: {
              type: 'array',
              items: { type: 'integer', minimum: 0 },
              'x-rudi-aliases': ['depends_on'],
            },
            requiresWrite: {
              type: 'boolean',
              'x-rudi-aliases': ['requires_write'],
            },
            contextPaths: {
              type: 'array',
              items: { type: 'string' },
              'x-rudi-aliases': ['context_paths'],
            },
            artifactsIn: {
              type: 'array',
              items: { type: 'string' },
              'x-rudi-aliases': ['artifacts_in'],
            },
            artifactsOut: {
              type: 'array',
              items: { type: 'string' },
              'x-rudi-aliases': ['artifacts_out'],
            },
          },
          additionalProperties: true,
        },
        RunGroupCreateRequest: {
          type: 'object',
          required: ['tasks'],
          properties: {
            name: { type: 'string' },
            provider: { type: 'string' },
            model: { type: 'string' },
            cwd: { type: 'string' },
            coordinationMode: {
              allOf: [schemaRef('RunGroupCoordinationMode')],
              'x-rudi-aliases': ['coordination_mode'],
            },
            executionMode: {
              allOf: [schemaRef('RunGroupExecutionMode')],
              'x-rudi-aliases': ['execution_mode'],
            },
            useWorktree: { type: 'boolean' },
            baseBranch: { type: 'string' },
            permissionMode: { type: 'string' },
            systemPrompt: { type: 'string' },
            allowValidationCommands: { type: 'boolean' },
            sequentialPhases: {
              type: 'array',
              items: {
                type: 'array',
                items: { type: 'integer', minimum: 0 },
              },
              'x-rudi-aliases': ['sequential_phases'],
            },
            tasks: {
              type: 'array',
              minItems: 2,
              maxItems: 10,
              items: {
                oneOf: [
                  { type: 'string' },
                  schemaRef('RunGroupTaskRequest'),
                ],
              },
            },
          },
          additionalProperties: false,
        },
        RunGroupLaunchError: {
          type: 'object',
          required: ['sessionId', 'message'],
          properties: {
            sessionId: { type: 'string' },
            message: { type: 'string' },
          },
          additionalProperties: false,
        },
        RunGroupCreateResponse: {
          type: 'object',
          required: ['groupId', 'status', 'sessionIds', 'startedSessionIds', 'errors'],
          properties: {
            groupId: { type: 'string' },
            status: schemaRef('RunGroupStatus'),
            sessionIds: {
              type: 'array',
              items: { type: 'string' },
            },
            startedSessionIds: {
              type: 'array',
              items: { type: 'string' },
            },
            errors: {
              type: 'array',
              items: schemaRef('RunGroupLaunchError'),
            },
          },
        },
        RunGroupSummary: {
          type: 'object',
          required: [
            'id', 'name', 'status', 'project_path', 'base_branch', 'execution_mode',
            'coordination_mode', 'requires_git', 'workspace_root', 'provider', 'model',
            'permission_mode', 'session_count', 'completed_count', 'failed_count',
            'total_cost', 'total_tokens', 'config_json', 'created_at', 'started_at',
            'completed_at', 'updated_at',
          ],
          properties: {
            id: { type: 'string' },
            name: { type: ['string', 'null'] },
            status: schemaRef('RunGroupStatus'),
            project_path: { type: ['string', 'null'] },
            base_branch: { type: ['string', 'null'] },
            execution_mode: schemaRef('RunGroupExecutionMode'),
            coordination_mode: schemaRef('RunGroupCoordinationMode'),
            requires_git: { type: 'integer' },
            workspace_root: { type: ['string', 'null'] },
            provider: { type: ['string', 'null'] },
            model: { type: ['string', 'null'] },
            permission_mode: { type: ['string', 'null'] },
            session_count: { type: 'integer' },
            completed_count: { type: 'integer' },
            failed_count: { type: 'integer' },
            total_cost: { type: 'number' },
            total_tokens: { type: 'integer' },
            config_json: { type: ['string', 'null'] },
            created_at: { type: 'string', format: 'date-time' },
            started_at: { type: ['string', 'null'], format: 'date-time' },
            completed_at: { type: ['string', 'null'], format: 'date-time' },
            updated_at: { type: 'string', format: 'date-time' },
          },
        },
        RunGroupDetail: {
          allOf: [
            schemaRef('RunGroupSummary'),
            {
              type: 'object',
              required: ['validation_failed_count'],
              properties: {
                validation_failed_count: { type: 'integer' },
              },
            },
          ],
        },
        RunGroupListResponse: {
          type: 'object',
          required: ['groups'],
          properties: {
            groups: {
              type: 'array',
              items: schemaRef('RunGroupSummary'),
            },
          },
        },
        RunGroupSessionDetail: {
          type: 'object',
          required: [
            'id', 'provider', 'provider_session_id', 'title', 'title_override', 'model', 'cwd',
            'session_status', 'started_at', 'ended_at', 'exit_code', 'error_code', 'error_message',
            'created_at', 'last_active_at', 'turn_count', 'total_cost', 'runtime_status',
            'runtime_turn_count', 'runtime_cost_total', 'runtime_tokens_total', 'runtime_last_error',
            'worktree_path', 'worktree_branch', 'base_branch', 'completed_at', 'validation_passed',
            'validation_errors_json', 'validation_warnings_json', 'validated_at', 'status', 'alive',
            'turn_active', 'pid', 'last_progress_snippet', 'last_progress_type', 'last_progress_at',
            'last_progress_source', 'validation_errors', 'validation_warnings',
          ],
          properties: {
            id: { type: 'string' },
            provider: { type: 'string' },
            provider_session_id: { type: ['string', 'null'] },
            title: { type: ['string', 'null'] },
            title_override: { type: ['string', 'null'] },
            model: { type: ['string', 'null'] },
            cwd: { type: ['string', 'null'] },
            session_status: { type: ['string', 'null'] },
            started_at: { type: ['string', 'null'], format: 'date-time' },
            ended_at: { type: ['string', 'null'], format: 'date-time' },
            exit_code: { type: ['integer', 'null'] },
            error_code: { type: ['string', 'null'] },
            error_message: { type: ['string', 'null'] },
            created_at: { type: 'string', format: 'date-time' },
            last_active_at: { type: 'string', format: 'date-time' },
            turn_count: { type: 'integer' },
            total_cost: { type: 'number' },
            runtime_status: { type: ['string', 'null'] },
            runtime_turn_count: { type: 'integer' },
            runtime_cost_total: { type: 'number' },
            runtime_tokens_total: { type: 'integer' },
            runtime_last_error: { type: ['string', 'null'] },
            worktree_path: { type: ['string', 'null'] },
            worktree_branch: { type: ['string', 'null'] },
            base_branch: { type: ['string', 'null'] },
            completed_at: { type: ['string', 'null'], format: 'date-time' },
            validation_passed: { type: ['boolean', 'null'] },
            validation_errors_json: { type: ['string', 'null'] },
            validation_warnings_json: { type: ['string', 'null'] },
            validated_at: { type: ['string', 'null'], format: 'date-time' },
            status: { type: 'string' },
            alive: { type: 'boolean' },
            turn_active: { type: 'boolean' },
            pid: { type: ['integer', 'null'] },
            last_progress_snippet: { type: ['string', 'null'] },
            last_progress_type: { type: ['string', 'null'] },
            last_progress_at: { type: ['string', 'null'], format: 'date-time' },
            last_progress_source: { type: ['string', 'null'] },
            validation_errors: {
              type: 'array',
              items: {
                type: 'object',
                additionalProperties: true,
              },
            },
            validation_warnings: {
              type: 'array',
              items: {
                type: 'object',
                additionalProperties: true,
              },
            },
          },
        },
        RunGroupDetailResponse: {
          type: 'object',
          required: ['group', 'sessions'],
          properties: {
            group: schemaRef('RunGroupDetail'),
            sessions: {
              type: 'array',
              items: schemaRef('RunGroupSessionDetail'),
            },
          },
        },
        RunGroupLiveSession: {
          type: 'object',
          required: [
            'sessionId', 'name', 'status', 'alive', 'turnActive', 'turnCount', 'costTotal',
            'tokensTotal', 'lastError', 'lastSnippet', 'lastProgressType', 'lastProgressAt',
            'lastProgressSource', 'worktreeBranch', 'validationPassed',
          ],
          properties: {
            sessionId: { type: 'string' },
            name: { type: 'string' },
            status: { type: 'string' },
            alive: { type: 'boolean' },
            turnActive: { type: 'boolean' },
            turnCount: { type: 'integer' },
            costTotal: { type: 'number' },
            tokensTotal: { type: 'integer' },
            lastError: { type: ['string', 'null'] },
            lastSnippet: { type: ['string', 'null'] },
            lastProgressType: { type: ['string', 'null'] },
            lastProgressAt: { type: ['string', 'null'], format: 'date-time' },
            lastProgressSource: { type: ['string', 'null'] },
            worktreeBranch: { type: ['string', 'null'] },
            validationPassed: { type: ['boolean', 'null'] },
          },
        },
        RunGroupLiveResponse: {
          type: 'object',
          required: ['groupId', 'status', 'sessions'],
          properties: {
            groupId: { type: 'string' },
            status: schemaRef('RunGroupStatus'),
            sessions: {
              type: 'array',
              items: schemaRef('RunGroupLiveSession'),
            },
          },
        },
        RunGroupStopResponse: {
          type: 'object',
          required: ['ok', 'groupId', 'stopped', 'status'],
          properties: {
            ok: { type: 'boolean', const: true },
            groupId: { type: 'string' },
            stopped: { type: 'integer' },
            status: schemaRef('RunGroupStatus'),
          },
        },
        RunGroupStartedEvent: {
          type: 'object',
          required: ['groupId', 'sessionIds', 'activeSessionIds'],
          properties: {
            groupId: { type: 'string' },
            sessionIds: {
              type: 'array',
              items: { type: 'string' },
            },
            activeSessionIds: {
              type: 'array',
              items: { type: 'string' },
            },
          },
        },
        RunGroupSessionDoneEvent: {
          type: 'object',
          required: ['groupId', 'sessionId', 'status', 'contractValidation'],
          properties: {
            groupId: { type: 'string' },
            sessionId: { type: 'string' },
            status: { type: 'string' },
            contractValidation: {
              type: ['object', 'null'],
              additionalProperties: true,
            },
          },
        },
        RunGroupCompletedEvent: {
          type: 'object',
          required: ['groupId', 'status', 'completedCount', 'failedCount'],
          properties: {
            groupId: { type: 'string' },
            status: schemaRef('RunGroupStatus'),
            completedCount: { type: 'integer' },
            failedCount: { type: 'integer' },
          },
        },
        RunGroupStoppedEvent: {
          type: 'object',
          required: ['groupId'],
          properties: {
            groupId: { type: 'string' },
          },
        },
        RunGroupSessionActivityEvent: {
          type: 'object',
          required: ['groupId', 'sessionId', 'turnCount', 'costTotal', 'lastSnippet'],
          properties: {
            groupId: { type: 'string' },
            sessionId: { type: 'string' },
            turnCount: { type: 'integer' },
            costTotal: { type: ['number', 'null'] },
            lastSnippet: { type: ['string', 'null'] },
          },
        },
      },
    },
    'x-rudi-websocket-events': buildWebsocketEventsExtension(),
  };

  if (cliVersion) {
    spec.info['x-rudi-cli-version'] = cliVersion;
  }

  return spec;
}
