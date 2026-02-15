/**
 * Stateful Codex event normalizer.
 * Buffers item lifecycles (started → updated* → completed) and emits
 * canonical RUDI events.
 *
 * normalize() returns Array<{ normalized, raw }> — 0, 1, or many events.
 * Buffered updates return [].
 */

export class CodexNormalizer {
  constructor() {
    /** @type {Map<string, { type: string, name: string, contentBuffer: string, startEvent: object }>} */
    this.pendingItems = new Map();
    this.sessionId = null;
  }

  /**
   * Normalize a raw Codex event into 0+ RudiEvent objects.
   * @param {object} rawEvent
   * @returns {Array<{ normalized: object, raw: object }>}
   */
  normalize(rawEvent) {
    if (!rawEvent || typeof rawEvent !== 'object') return [];

    const type = rawEvent.type;

    if (type === 'thread.started') {
      this.sessionId = rawEvent.thread_id || null;
      return [this._wrap({
        type: 'system',
        subtype: 'thread_started',
        message: 'Thread started',
      }, rawEvent)];
    }

    if (type === 'turn.started') {
      return [this._wrap({
        type: 'system',
        subtype: 'turn_started',
        message: `Turn ${rawEvent.turn_number || 1} started`,
      }, rawEvent)];
    }

    if (type === 'item.started') return this._handleItemStarted(rawEvent);
    if (type === 'item.updated') return this._handleItemUpdated(rawEvent);
    if (type === 'item.completed') return this._handleItemCompleted(rawEvent);
    if (type === 'turn.completed') return this._handleTurnCompleted(rawEvent);

    if (type === 'turn.failed') {
      const normalized = {
        type: 'result',
        result: rawEvent.error?.message || 'Turn failed',
        usage: this._normalizeUsage({}),
      };
      const sid = this._sid(rawEvent);
      if (sid) normalized.providerSessionId = sid;
      if (typeof rawEvent.model === 'string' && rawEvent.model) normalized.model = rawEvent.model;
      return [this._wrap(normalized, rawEvent)];
    }

    if (type === 'error') {
      const normalized = {
        type: 'error',
        message: rawEvent.error?.message || rawEvent.message || 'Unknown error',
      };
      const code = rawEvent.error?.code || rawEvent.code;
      if (typeof code === 'string' && code) normalized.code = code;
      const details = rawEvent.error || rawEvent.details;
      if (details !== undefined) normalized.details = details;
      return [this._wrap(normalized, rawEvent)];
    }

    return [this._wrap({
      type: 'system',
      subtype: 'unknown',
      message: `Unrecognized Codex event: ${type}`,
    }, rawEvent)];
  }

  /**
   * Flush any remaining buffered items.
   * @returns {Array<{ normalized: object, raw: object }>}
   */
  flush() {
    const results = [];
    for (const [itemId, pending] of this.pendingItems) {
      const flushed = this._flushItem(itemId, pending, pending.startEvent);
      if (flushed) results.push(flushed);
    }
    this.pendingItems.clear();
    return results;
  }

  /**
   * Reset state between turns.
   */
  reset() {
    this.pendingItems.clear();
  }

  // ---- Private helpers ----

  _wrap(normalized, raw) {
    return { normalized, raw };
  }

  _sid(event) {
    return this.sessionId || event.thread_id || null;
  }

  _toString(value, fallback = '') {
    return typeof value === 'string' ? value : fallback;
  }

  _toText(value) {
    if (typeof value === 'string') return value;
    if (value == null) return '';
    try {
      return JSON.stringify(value);
    } catch {
      return String(value);
    }
  }

  _normalizeUsage(rawUsage = {}) {
    const usage = {
      inputTokens: typeof rawUsage.input_tokens === 'number' ? rawUsage.input_tokens : 0,
      outputTokens: typeof rawUsage.output_tokens === 'number' ? rawUsage.output_tokens : 0,
    };
    const cacheRead =
      rawUsage.cache_read_input_tokens ?? rawUsage.cached_input_tokens;
    if (typeof cacheRead === 'number') usage.cacheReadTokens = cacheRead;
    if (typeof rawUsage.cache_creation_input_tokens === 'number') {
      usage.cacheCreationTokens = rawUsage.cache_creation_input_tokens;
    }
    return usage;
  }

  _ensureRecord(value) {
    if (value && typeof value === 'object' && !Array.isArray(value)) return value;
    return {};
  }

  _itemId(item, rawEvent) {
    return this._toString(item?.id || rawEvent.item_id);
  }

  _toolName(item) {
    return this._toString(item.tool || item.command || item.name, 'unknown');
  }

  _extractDeltaText(rawEvent, item) {
    if (typeof rawEvent.delta === 'string') return rawEvent.delta;
    if (rawEvent.delta && typeof rawEvent.delta === 'object') {
      if (typeof rawEvent.delta.text === 'string') return rawEvent.delta.text;
      if (Array.isArray(rawEvent.delta.content)) {
        return rawEvent.delta.content
          .map((block) => (block && typeof block.text === 'string' ? block.text : ''))
          .join('');
      }
    }
    if (typeof item?.text === 'string') return item.text;
    if (Array.isArray(item?.content)) {
      return item.content
        .map((block) => (block && typeof block.text === 'string' ? block.text : ''))
        .join('');
    }
    return '';
  }

  _assistantWithContent(rawEvent, content) {
    const normalized = {
      type: 'assistant',
      content,
    };
    const model = rawEvent.item?.model || rawEvent.model;
    if (typeof model === 'string' && model) normalized.model = model;
    return this._wrap(normalized, rawEvent);
  }

  _handleItemStarted(rawEvent) {
    const item = rawEvent.item || {};
    const itemId = this._itemId(item, rawEvent);
    const itemType = item.type;
    if (!itemId) return [];

    if (itemType === 'agent_message' || itemType === 'reasoning') {
      this.pendingItems.set(itemId, {
        type: itemType,
        name: itemType,
        contentBuffer: this._extractDeltaText(rawEvent, item),
        startEvent: rawEvent,
      });
      return [];
    }

    if (itemType === 'command_execution' || itemType === 'mcp_tool_call') {
      this.pendingItems.set(itemId, {
        type: itemType,
        name: this._toolName(item),
        contentBuffer: '',
        startEvent: rawEvent,
      });
      return [this._assistantWithContent(rawEvent, [{
        type: 'tool_use',
        id: itemId,
        name: this._toolName(item),
        input: this._ensureRecord(item.arguments || item.input || item.args),
      }])];
    }

    this.pendingItems.set(itemId, {
      type: itemType || 'unknown',
      name: itemType || 'unknown',
      contentBuffer: this._extractDeltaText(rawEvent, item),
      startEvent: rawEvent,
    });
    return [];
  }

  _handleItemUpdated(rawEvent) {
    const item = rawEvent.item || {};
    const itemId = this._itemId(item, rawEvent);
    if (!itemId) return [];

    const pending = this.pendingItems.get(itemId);
    if (!pending) return [];

    const delta = this._extractDeltaText(rawEvent, item);
    if (delta) pending.contentBuffer += delta;
    return [];
  }

  _handleItemCompleted(rawEvent) {
    const item = rawEvent.item || {};
    const itemId = this._itemId(item, rawEvent);
    const itemType = item.type;
    if (!itemId) return [];

    const pending = this.pendingItems.get(itemId);

    if (itemType === 'agent_message' || itemType === 'reasoning') {
      const text = this._extractDeltaText(rawEvent, item) || pending?.contentBuffer || '';
      this.pendingItems.delete(itemId);

      const blockType = itemType === 'reasoning' ? 'thinking' : 'text';
      const content = [{
        type: blockType,
        [blockType === 'thinking' ? 'thinking' : 'text']: text,
      }];
      return [this._assistantWithContent(rawEvent, content)];
    }

    if (itemType === 'command_execution' || itemType === 'mcp_tool_call') {
      this.pendingItems.delete(itemId);
      const output =
        item.output ??
        item.result?.content?.[0]?.text ??
        item.result ??
        pending?.contentBuffer ??
        '';

      return [this._assistantWithContent(rawEvent, [{
        type: 'tool_result',
        toolUseId: itemId,
        content: this._toText(output),
        isError: !!(item.error || (item.exit_code != null && item.exit_code !== 0)),
      }])];
    }

    if (itemType === 'file_change') {
      this.pendingItems.delete(itemId);
      const changes = Array.isArray(item.changes) ? item.changes : [];
      const summary = changes
        .map((c) => `${c.kind || 'change'}: ${c.path || 'unknown'}`)
        .join('\n');

      return [this._assistantWithContent(rawEvent, [{
        type: 'text',
        text: summary || this._toText(item),
      }])];
    }

    this.pendingItems.delete(itemId);
    const text = this._extractDeltaText(rawEvent, item) || pending?.contentBuffer || this._toText(item);
    return [this._assistantWithContent(rawEvent, [{
      type: 'text',
      text,
    }])];
  }

  _handleTurnCompleted(rawEvent) {
    const flushed = this.flush();

    const normalized = {
      type: 'result',
      numTurns: typeof rawEvent.turn_number === 'number' ? rawEvent.turn_number : 1,
      usage: this._normalizeUsage(rawEvent.usage || {}),
    };

    const sid = this._sid(rawEvent);
    if (sid) normalized.providerSessionId = sid;
    if (typeof rawEvent.cost_usd === 'number') normalized.costUsd = rawEvent.cost_usd;
    if (typeof rawEvent.duration_ms === 'number') normalized.durationMs = rawEvent.duration_ms;
    if (typeof rawEvent.model === 'string' && rawEvent.model) normalized.model = rawEvent.model;
    if (typeof rawEvent.result === 'string') normalized.result = rawEvent.result;

    flushed.push(this._wrap(normalized, rawEvent));
    return flushed;
  }

  /**
   * Flush one buffered item into an assistant event.
   * Used when a turn completes before item.completed arrives.
   */
  _flushItem(itemId, pending, rawEvent) {
    const isTool = pending.type === 'command_execution' || pending.type === 'mcp_tool_call';
    if (!pending.contentBuffer && !isTool) return null;

    if (pending.type === 'agent_message' || pending.type === 'reasoning') {
      const blockType = pending.type === 'reasoning' ? 'thinking' : 'text';
      return this._assistantWithContent(rawEvent, [{
        type: blockType,
        [blockType === 'thinking' ? 'thinking' : 'text']: pending.contentBuffer,
      }]);
    }

    if (isTool) {
      return this._assistantWithContent(rawEvent, [{
        type: 'tool_result',
        toolUseId: itemId,
        content: pending.contentBuffer || '(no output)',
        isError: false,
      }]);
    }

    return this._assistantWithContent(rawEvent, [{
      type: 'text',
      text: pending.contentBuffer,
    }]);
  }
}

/**
 * Legacy stateless normalize function for compatibility.
 */
export function normalize(event) {
  const normalizer = new CodexNormalizer();
  const results = normalizer.normalize(event);
  if (results.length === 0) return event;
  return results[0].normalized;
}
