const RUDI_SCHEMA_VERSION = '1.0.0';
const RUDI_SCHEMA_NAMESPACE = 'io.rudi.session.v1';
const RUDI_SCHEMA_MAJOR = 1;

function toNumberOrNull(value) {
  return Number.isFinite(value) ? Number(value) : null;
}

function toIntegerOrNull(value) {
  return Number.isInteger(value) ? value : null;
}

function toStringOrNull(value) {
  return typeof value === 'string' && value.length > 0 ? value : null;
}

function parseJsonObject(value) {
  if (!value || typeof value !== 'string') return null;
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? parsed
      : null;
  } catch {
    return null;
  }
}

function parseJsonArray(value) {
  if (!value || typeof value !== 'string') return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function pushError(errors, condition, message) {
  if (!condition) errors.push(message);
}

function parseSemver(value) {
  if (typeof value !== 'string') return null;
  const match = /^(\d+)\.(\d+)\.(\d+)$/.exec(value.trim());
  if (!match) return null;
  return {
    major: Number(match[1]),
    minor: Number(match[2]),
    patch: Number(match[3]),
  };
}

function isCompatibleSchemaVersion(value) {
  const parsed = parseSemver(value);
  return !!parsed && parsed.major === RUDI_SCHEMA_MAJOR;
}

export function isSchemaEnvelopeCompatible(doc, expectedKind) {
  if (!doc || typeof doc !== 'object') return false;
  if (doc.schemaNamespace !== RUDI_SCHEMA_NAMESPACE) return false;
  if (!isCompatibleSchemaVersion(doc.schemaVersion)) return false;
  if (expectedKind && doc.kind !== expectedKind) return false;
  return true;
}

/**
 * Convert a DB `sessions` row to a provider-agnostic RUDI session document.
 */
export function toSessionDocument(row) {
  return {
    schemaNamespace: RUDI_SCHEMA_NAMESPACE,
    schemaVersion: RUDI_SCHEMA_VERSION,
    kind: 'session',
    id: row.id,
    provider: row.provider,
    providerSessionId: toStringOrNull(row.provider_session_id),
    status: row.status || 'unknown',
    startedAt: toStringOrNull(row.started_at),
    lastActiveAt: toStringOrNull(row.last_active_at),
    completedAt: toStringOrNull(row.completed_at),
    context: {
      cwd: toStringOrNull(row.cwd),
      projectPath: toStringOrNull(row.project_path),
      projectId: toStringOrNull(row.project_id),
      gitBranch: toStringOrNull(row.git_branch),
      originNativeFile: toStringOrNull(row.origin_native_file),
    },
    linkage: {
      parentSessionId: toStringOrNull(row.parent_session_id),
      sessionType: toStringOrNull(row.session_type),
    },
    metrics: {
      turnCount: toIntegerOrNull(row.turn_count) || 0,
      totalCostUsd: toNumberOrNull(row.total_cost) || 0,
      totalInputTokens: toIntegerOrNull(row.total_input_tokens) || 0,
      totalOutputTokens: toIntegerOrNull(row.total_output_tokens) || 0,
      totalDurationMs: toIntegerOrNull(row.total_duration_ms) || 0,
    },
    metadata: {
      title: toStringOrNull(row.title),
      snippet: toStringOrNull(row.snippet),
      model: toStringOrNull(row.model),
      agentId: toStringOrNull(row.agent_id),
      permissionMode: toStringOrNull(row.permission_mode),
      compactMetadata: parseJsonObject(row.compact_metadata),
    },
  };
}

/**
 * Convert a DB `turns` row to a provider-agnostic RUDI turn document.
 */
export function toTurnDocument(row) {
  return {
    schemaNamespace: RUDI_SCHEMA_NAMESPACE,
    schemaVersion: RUDI_SCHEMA_VERSION,
    kind: 'turn',
    id: row.id,
    sessionId: row.session_id,
    provider: row.provider,
    providerSessionId: toStringOrNull(row.provider_session_id),
    providerTurnId: toStringOrNull(row.provider_turn_id),
    turnNumber: toIntegerOrNull(row.turn_number) || 0,
    ts: row.ts,
    tsMs: toIntegerOrNull(row.ts_ms),
    content: {
      userMessage: toStringOrNull(row.user_message),
      assistantResponse: toStringOrNull(row.assistant_response),
      thinking: toStringOrNull(row.thinking),
    },
    usage: {
      inputTokens: toIntegerOrNull(row.input_tokens) || 0,
      outputTokens: toIntegerOrNull(row.output_tokens) || 0,
      cacheReadTokens: toIntegerOrNull(row.cache_read_tokens) || 0,
      cacheCreationTokens: toIntegerOrNull(row.cache_creation_tokens) || 0,
      contextTokens: toIntegerOrNull(row.context_tokens) || 0,
      costUsd: toNumberOrNull(row.cost),
      durationMs: toIntegerOrNull(row.duration_ms),
      durationApiMs: toIntegerOrNull(row.duration_api_ms),
    },
    execution: {
      model: toStringOrNull(row.model),
      permissionMode: toStringOrNull(row.permission_mode),
      finishReason: toStringOrNull(row.finish_reason),
      error: toStringOrNull(row.error),
      kind: toStringOrNull(row.kind) || 'message',
      serviceTier: toStringOrNull(row.service_tier),
      apiRequestId: toStringOrNull(row.api_request_id),
    },
    tooling: {
      toolsUsed: parseJsonArray(row.tools_used),
      toolResults: parseJsonArray(row.tool_results),
      todos: parseJsonArray(row.todos),
      imageIds: parseJsonArray(row.image_ids),
      thinkingConfig: parseJsonObject(row.thinking_config),
      compaction: parseJsonObject(row.compact_metadata),
    },
    linkage: {
      parentTurnId: toStringOrNull(row.parent_turn_id),
      uuid: toStringOrNull(row.uuid),
      logicalParentId: toStringOrNull(row.logical_parent_id),
      leafUuid: toStringOrNull(row.leaf_uuid),
      userType: toStringOrNull(row.user_type),
      isMeta: row.is_meta === 1,
      displayOnly: row.display_only === 1,
    },
  };
}

export function validateSessionDocument(doc) {
  const errors = [];
  pushError(errors, !!doc && typeof doc === 'object', 'document must be an object');
  if (!doc || typeof doc !== 'object') return { ok: false, errors };

  pushError(errors, doc.schemaNamespace === RUDI_SCHEMA_NAMESPACE, 'schemaNamespace must match v1 namespace');
  pushError(errors, parseSemver(doc.schemaVersion) !== null, 'schemaVersion must be semver (x.y.z)');
  pushError(errors, isCompatibleSchemaVersion(doc.schemaVersion), 'schemaVersion major must be 1 for v1 namespace');
  pushError(errors, doc.kind === 'session', 'kind must be session');
  pushError(errors, typeof doc.id === 'string' && doc.id.length > 0, 'id is required');
  pushError(errors, typeof doc.provider === 'string' && doc.provider.length > 0, 'provider is required');
  pushError(errors, typeof doc.status === 'string' && doc.status.length > 0, 'status is required');
  pushError(errors, typeof doc.metrics === 'object' && doc.metrics !== null, 'metrics object is required');
  if (doc.metrics && typeof doc.metrics === 'object') {
    pushError(errors, Number.isInteger(doc.metrics.turnCount), 'metrics.turnCount must be integer');
    pushError(errors, Number.isFinite(doc.metrics.totalCostUsd), 'metrics.totalCostUsd must be number');
    pushError(errors, Number.isInteger(doc.metrics.totalInputTokens), 'metrics.totalInputTokens must be integer');
    pushError(errors, Number.isInteger(doc.metrics.totalOutputTokens), 'metrics.totalOutputTokens must be integer');
  }

  return { ok: errors.length === 0, errors };
}

export function validateTurnDocument(doc) {
  const errors = [];
  pushError(errors, !!doc && typeof doc === 'object', 'document must be an object');
  if (!doc || typeof doc !== 'object') return { ok: false, errors };

  pushError(errors, doc.schemaNamespace === RUDI_SCHEMA_NAMESPACE, 'schemaNamespace must match v1 namespace');
  pushError(errors, parseSemver(doc.schemaVersion) !== null, 'schemaVersion must be semver (x.y.z)');
  pushError(errors, isCompatibleSchemaVersion(doc.schemaVersion), 'schemaVersion major must be 1 for v1 namespace');
  pushError(errors, doc.kind === 'turn', 'kind must be turn');
  pushError(errors, typeof doc.id === 'string' && doc.id.length > 0, 'id is required');
  pushError(errors, typeof doc.sessionId === 'string' && doc.sessionId.length > 0, 'sessionId is required');
  pushError(errors, typeof doc.provider === 'string' && doc.provider.length > 0, 'provider is required');
  pushError(errors, Number.isInteger(doc.turnNumber) && doc.turnNumber >= 0, 'turnNumber must be an integer >= 0');
  pushError(errors, typeof doc.ts === 'string' && doc.ts.length > 0, 'ts is required');
  pushError(errors, typeof doc.content === 'object' && doc.content !== null, 'content object is required');
  pushError(errors, typeof doc.usage === 'object' && doc.usage !== null, 'usage object is required');
  if (doc.usage && typeof doc.usage === 'object') {
    pushError(errors, Number.isInteger(doc.usage.inputTokens), 'usage.inputTokens must be integer');
    pushError(errors, Number.isInteger(doc.usage.outputTokens), 'usage.outputTokens must be integer');
    pushError(errors, Number.isInteger(doc.usage.contextTokens), 'usage.contextTokens must be integer');
    pushError(errors, doc.usage.costUsd === null || Number.isFinite(doc.usage.costUsd), 'usage.costUsd must be number or null');
  }
  pushError(errors, typeof doc.tooling === 'object' && doc.tooling !== null, 'tooling object is required');
  if (doc.tooling && typeof doc.tooling === 'object') {
    pushError(errors, Array.isArray(doc.tooling.toolsUsed), 'tooling.toolsUsed must be array');
    pushError(errors, Array.isArray(doc.tooling.toolResults), 'tooling.toolResults must be array');
  }

  return { ok: errors.length === 0, errors };
}

export { RUDI_SCHEMA_NAMESPACE, RUDI_SCHEMA_VERSION, RUDI_SCHEMA_MAJOR };
