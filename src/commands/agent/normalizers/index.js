/**
 * Event normalizer dispatcher.
 * Routes provider events to their specific normalizer modules.
 *
 * Supports both stateless (Claude) and stateful (Codex) normalizers.
 * Stateful normalizers buffer multi-event item lifecycles and return arrays.
 */

import * as claudeNormalizer from './claude.js';
import { CodexNormalizer } from './codex.js';

const NORMALIZERS = {
  claude: claudeNormalizer,
};

/**
 * Canonical RudiEvent schema (provider-agnostic wire format for Lite UI):
 *
 * RudiEvent =
 *   | { type: 'assistant', content: RudiContentBlock[], usage?: RudiUsage, model?: string, finishReason?: string }
 *   | { type: 'result', providerSessionId?: string, costUsd?: number, durationMs?: number,
 *       numTurns?: number, result?: string, usage?: RudiUsage, model?: string, finishReason?: string }
 *   | { type: 'system', subtype: string, message: string,
 *       providerEventType?: string, providerItemType?: string, unknownReason?: string,
 *       rawPayload?: string, rawPayloadTruncated?: boolean, rawPayloadUnavailable?: boolean,
 *       compaction?: { trigger: string, preTokens: number, tokensSaved: number, compactedToolIds?: string[] },
 *       permission?: { requestId: string, batchId?: string, toolName?: string, toolInput?: Record<string, unknown> } }
 *   | { type: 'error', message: string, code?: string, details?: unknown };
 *
 * RudiUsage = {
 *   inputTokens: number,
 *   outputTokens: number,
 *   cacheReadTokens?: number,
 *   cacheCreationTokens?: number,
 * };
 *
 * RudiContentBlock =
 *   | { type: 'text', text: string }
 *   | { type: 'thinking', thinking: string }
 *   | { type: 'tool_use', id: string, name: string, input: Record<string, unknown> }
 *   | { type: 'tool_result', toolUseId: string, content: string | Array<{ type: string, text: string }>, isError?: boolean };
 */

/**
 * Create a stateful normalizer instance for providers that need one.
 * Returns null for providers that use stateless normalization (Claude).
 */
export function createNormalizer(provider) {
  if (provider === 'codex') return new CodexNormalizer();
  return null;
}

/**
 * Get the stateless normalizer function for a provider.
 * Returns a function that takes a raw event and returns a normalized event.
 */
export function getNormalizer(provider) {
  const normalizer = NORMALIZERS[provider];
  if (normalizer && typeof normalizer.normalize === 'function') {
    return normalizer.normalize;
  }
  // Fallback: pass-through normalizer
  return (event) => event;
}

/**
 * Normalize an event using the provider's normalizer.
 *
 * If a stateful normalizer instance is provided, uses it (returns array).
 * Otherwise falls back to stateless normalization (returns array with single item).
 *
 * @param {string} provider - Provider ID
 * @param {object} rawEvent - Raw event from stdout
 * @param {object|null} [normalizer] - Stateful normalizer instance (from createNormalizer)
 * @returns {Array<{ normalized: object, raw: object }>}
 */
export function normalizeEvent(provider, rawEvent, normalizer) {
  if (normalizer) {
    return normalizer.normalize(rawEvent);
  }

  // Stateless path (Claude)
  const normalize = getNormalizer(provider);
  const normalized = normalize(rawEvent);
  return [{ normalized, raw: rawEvent }];
}
