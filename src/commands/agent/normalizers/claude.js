/**
 * Stateless Claude event normalizer.
 * Maps Claude stream-json events (snake_case + message wrapper) into
 * canonical RUDI events (camelCase + top-level content/usage/model).
 */

function toNumber(value, fallback = 0) {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function toString(value, fallback = '') {
  return typeof value === 'string' ? value : fallback;
}

function toUsage(rawUsage) {
  if (!rawUsage || typeof rawUsage !== 'object') return undefined;

  const inputTokens = rawUsage.inputTokens ?? rawUsage.input_tokens;
  const outputTokens = rawUsage.outputTokens ?? rawUsage.output_tokens;
  if (typeof inputTokens !== 'number' || typeof outputTokens !== 'number') return undefined;

  const usage = {
    inputTokens: toNumber(inputTokens),
    outputTokens: toNumber(outputTokens),
  };

  const cacheReadTokens =
    rawUsage.cacheReadTokens ??
    rawUsage.cache_read_input_tokens ??
    rawUsage.cached_input_tokens;
  if (typeof cacheReadTokens === 'number') {
    usage.cacheReadTokens = toNumber(cacheReadTokens);
  }

  const cacheCreationTokens =
    rawUsage.cacheCreationTokens ??
    rawUsage.cache_creation_input_tokens;
  if (typeof cacheCreationTokens === 'number') {
    usage.cacheCreationTokens = toNumber(cacheCreationTokens);
  }

  return usage;
}

function normalizeContentBlock(block) {
  if (!block || typeof block !== 'object') return null;

  if (block.type === 'text') {
    return { type: 'text', text: toString(block.text) };
  }
  if (block.type === 'thinking') {
    return { type: 'thinking', thinking: toString(block.thinking) };
  }
  if (block.type === 'tool_use') {
    return {
      type: 'tool_use',
      id: toString(block.id),
      name: toString(block.name, 'unknown'),
      input: block.input && typeof block.input === 'object' ? block.input : {},
    };
  }
  if (block.type === 'tool_result') {
    const normalized = {
      type: 'tool_result',
      toolUseId: toString(block.toolUseId ?? block.tool_use_id),
      content: block.content ?? '',
    };
    const isError = block.isError ?? block.is_error;
    if (typeof isError === 'boolean') normalized.isError = isError;
    return normalized;
  }

  return null;
}

function normalizeAssistantEvent(event) {
  const message = event.message && typeof event.message === 'object' ? event.message : null;
  const rawContent = Array.isArray(event.content)
    ? event.content
    : Array.isArray(message?.content)
      ? message.content
      : [];

  const content = rawContent
    .map(normalizeContentBlock)
    .filter(Boolean);

  const usage = toUsage(event.usage || message?.usage);
  const model = toString(event.model || message?.model, '');
  const finishReason = toString(event.finishReason || event.stopReason || message?.stop_reason, '');

  const normalized = {
    type: 'assistant',
    content,
  };
  if (usage) normalized.usage = usage;
  if (model) normalized.model = model;
  if (finishReason) normalized.finishReason = finishReason;
  if (event.error) normalized.error = event.error;
  return normalized;
}

function normalizeResultEvent(event) {
  const message = event.message && typeof event.message === 'object' ? event.message : null;
  const usage = toUsage(event.usage || message?.usage);
  const model = toString(event.model || message?.model, '');
  const finishReason = toString(event.finishReason || event.stopReason || message?.stop_reason, '');

  const normalized = {
    type: 'result',
  };

  const providerSessionId = event.providerSessionId ?? event.session_id;
  if (typeof providerSessionId === 'string' && providerSessionId) {
    normalized.providerSessionId = providerSessionId;
  }

  const costUsd = event.costUsd ?? event.total_cost_usd;
  if (typeof costUsd === 'number') normalized.costUsd = costUsd;

  const durationMs = event.durationMs ?? event.duration_ms;
  if (typeof durationMs === 'number') normalized.durationMs = durationMs;

  const numTurns = event.numTurns ?? event.num_turns;
  if (typeof numTurns === 'number') normalized.numTurns = numTurns;

  const result = event.result;
  if (typeof result === 'string') normalized.result = result;

  if (usage) normalized.usage = usage;
  if (model) normalized.model = model;
  if (finishReason) normalized.finishReason = finishReason;
  if (event.is_error === true) normalized.isError = true;

  return normalized;
}

function normalizeSystemEvent(event) {
  const subtype = toString(event.subtype, 'unknown');
  const normalized = {
    type: 'system',
    subtype,
    message: toString(event.message, 'System event'),
  };

  const rawCompaction = event.compaction || event.microcompactMetadata || event.compactMetadata;
  if (rawCompaction && typeof rawCompaction === 'object') {
    const compaction = {
      trigger: toString(rawCompaction.trigger, 'unknown'),
      preTokens: toNumber(rawCompaction.preTokens ?? rawCompaction.pre_tokens),
      tokensSaved: toNumber(rawCompaction.tokensSaved ?? rawCompaction.tokens_saved),
    };
    const compactedToolIds = rawCompaction.compactedToolIds ?? rawCompaction.compacted_tool_ids;
    if (Array.isArray(compactedToolIds)) {
      compaction.compactedToolIds = compactedToolIds.filter((id) => typeof id === 'string');
    }
    normalized.compaction = compaction;
  }

  const isPermissionEvent = subtype === 'permission_request';
  const rawPermission = event.permission && typeof event.permission === 'object' ? event.permission : event;
  const requestId = rawPermission.requestId ?? rawPermission.request_id;
  if (isPermissionEvent && typeof requestId === 'string' && requestId) {
    const permission = { requestId };
    const batchId = rawPermission.batchId ?? rawPermission.batch_id;
    const toolName = rawPermission.toolName ?? rawPermission.tool_name;
    const toolInput = rawPermission.toolInput ?? rawPermission.tool_input;
    if (typeof batchId === 'string') permission.batchId = batchId;
    if (typeof toolName === 'string') permission.toolName = toolName;
    if (toolInput && typeof toolInput === 'object') {
      permission.toolInput = toolInput;
    }
    normalized.permission = permission;
  }

  return normalized;
}

function normalizeErrorEvent(event) {
  const rawError = event.error && typeof event.error === 'object' ? event.error : null;

  const message = toString(
    event.message || rawError?.message,
    'Unknown error',
  );

  const normalized = {
    type: 'error',
    message,
  };

  const code = event.code || rawError?.code;
  if (typeof code === 'string' && code) normalized.code = code;

  const details = event.details ?? rawError?.details ?? rawError;
  if (details !== undefined) normalized.details = details;

  return normalized;
}

/**
 * Normalize a Claude event into canonical RUDI event shape.
 */
export function normalize(event) {
  if (!event || typeof event !== 'object') {
    return { type: 'error', message: 'Invalid event payload' };
  }

  if (event.type === 'assistant') return normalizeAssistantEvent(event);
  if (event.type === 'result') return normalizeResultEvent(event);
  if (event.type === 'system') return normalizeSystemEvent(event);
  if (event.type === 'error') return normalizeErrorEvent(event);

  return {
    type: 'system',
    subtype: 'unknown',
    message: `Unrecognized Claude event: ${toString(event.type, 'unknown')}`,
  };
}
