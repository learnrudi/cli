/**
 * Live tail — follow/unfollow/parse/broadcast for session JSONL files.
 * Factory: createSessionsTailModule({ log, broadcast, findSessionFile })
 */

import fs from 'fs';
import fsp from 'fs/promises';
import {
  extractContent,
  extractToolResultText,
  getSessionEntryRole,
  isToolResultOnly,
  safeParseJsonObject,
  stripSystemXml,
} from './providers/common.js';
import { extractCodexReasoningText, extractCodexTextBlocks } from './providers/codex/parser.js';

const MAX_FOLLOWED_SESSIONS = 10;
const TAIL_FALLBACK_INTERVAL_MS = 5000;
const TAIL_IDLE_TIMEOUT_MS = 5 * 60 * 1000;

/**
 * @param {{ log, broadcast, findSessionFile: (sessionId: string) => Promise<{provider, filePath}|null> }} deps
 */
export function createSessionsTailModule({ log, broadcast, findSessionFile }) {
  // sessionId → { filePath, byteOffset, partialLine, parserState, subscriberCount, watcher, lastGrowth, tailQueued }
  const followedSessions = new Map();
  // ws → Set<sessionId>
  const clientFollows = new WeakMap();
  let tailFallbackTimer = null;

  function createParserState() {
    return {
      lastAssistantMsg: null,
      pendingToolUses: new Map(),
      flushedToolCalls: null,
    };
  }

  /**
   * Parse JSONL lines using per-session stateful parser.
   */
  function parseJsonlLinesStateful(lines, state, provider = 'claude') {
    const messages = [];
    const toolUpdates = [];

    function flushAssistant() {
      if (!state.lastAssistantMsg) return;
      const msg = {
        role: 'assistant',
        content: state.lastAssistantMsg.content.trim(),
        timestamp: state.lastAssistantMsg.timestamp,
      };
      if (state.lastAssistantMsg.thinking) {
        msg.thinking = state.lastAssistantMsg.thinking.trim();
      }
      if (state.lastAssistantMsg.toolCalls.length > 0) {
        msg.toolCalls = state.lastAssistantMsg.toolCalls;
        state.flushedToolCalls = state.lastAssistantMsg.toolCalls;
      } else {
        state.flushedToolCalls = null;
      }
      if (state.lastAssistantMsg.contentBlocks && state.lastAssistantMsg.contentBlocks.length > 0) {
        msg.contentBlocks = state.lastAssistantMsg.contentBlocks;
      }
      if (msg.content || msg.thinking || (msg.toolCalls && msg.toolCalls.length > 0)) {
        messages.push(msg);
      }
      state.lastAssistantMsg = null;
    }

    function ensureAssistant(entryTimestamp) {
      if (!state.lastAssistantMsg) {
        state.lastAssistantMsg = {
          content: '',
          thinking: '',
          toolCalls: [],
          contentBlocks: [],
          timestamp: entryTimestamp,
        };
      } else if (!state.lastAssistantMsg.timestamp && entryTimestamp) {
        state.lastAssistantMsg.timestamp = entryTimestamp;
      }
    }

    for (const line of lines) {
      if (
        provider === 'codex'
        && line.length > 200_000
        && !line.includes('"function_call"')
        && !line.includes('"custom_tool_call"')
        && !line.includes('"agent_message"')
      ) {
        continue;
      }
      let entry;
      try {
        entry = JSON.parse(line);
      } catch {
        continue;
      }

      if (provider === 'codex') {
        if (entry?.type === 'event_msg') {
          const p = entry.payload || {};
          if (p.type === 'user_message') {
            flushAssistant();
            state.flushedToolCalls = null;
            state.pendingToolUses.clear();
            const text = typeof p.message === 'string' ? p.message.trim() : '';
            if (text) {
              messages.push({
                role: 'user',
                content: text,
                timestamp: entry.timestamp,
              });
            }
            continue;
          }
          if (p.type === 'agent_message') {
            ensureAssistant(entry.timestamp);
            const text = typeof p.message === 'string' ? p.message.trim() : '';
            if (text) {
              if (state.lastAssistantMsg.content) state.lastAssistantMsg.content += '\n';
              state.lastAssistantMsg.content += text;
              const lastCB = state.lastAssistantMsg.contentBlocks[state.lastAssistantMsg.contentBlocks.length - 1];
              if (lastCB && lastCB.type === 'text') {
                lastCB.text += '\n' + text;
              } else {
                state.lastAssistantMsg.contentBlocks.push({ type: 'text', text });
              }
            }
            continue;
          }
          if (p.type === 'agent_reasoning') {
            ensureAssistant(entry.timestamp);
            const thinking = typeof p.text === 'string' ? p.text.trim() : '';
            if (thinking) {
              if (state.lastAssistantMsg.thinking) state.lastAssistantMsg.thinking += '\n\n';
              state.lastAssistantMsg.thinking += thinking;
            }
          }
          continue;
        }

        if (entry?.type === 'response_item') {
          const p = entry.payload || {};
          if (p.type === 'message') {
            const text = extractCodexTextBlocks(p.content);
            if (p.role === 'user') {
              flushAssistant();
              state.flushedToolCalls = null;
              state.pendingToolUses.clear();
              if (text) {
                messages.push({
                  role: 'user',
                  content: text,
                  timestamp: entry.timestamp,
                });
              }
            } else if (p.role === 'assistant') {
              ensureAssistant(entry.timestamp);
              if (text) {
                if (state.lastAssistantMsg.content) state.lastAssistantMsg.content += '\n';
                state.lastAssistantMsg.content += text;
                const lastCB = state.lastAssistantMsg.contentBlocks[state.lastAssistantMsg.contentBlocks.length - 1];
                if (lastCB && lastCB.type === 'text') {
                  lastCB.text += '\n' + text;
                } else {
                  state.lastAssistantMsg.contentBlocks.push({ type: 'text', text });
                }
              }
            }
            continue;
          }

          if (p.type === 'reasoning') {
            ensureAssistant(entry.timestamp);
            const thinking = extractCodexReasoningText(p);
            if (thinking) {
              if (state.lastAssistantMsg.thinking) state.lastAssistantMsg.thinking += '\n\n';
              state.lastAssistantMsg.thinking += thinking;
            }
            continue;
          }

          if (p.type === 'function_call' || p.type === 'custom_tool_call') {
            ensureAssistant(entry.timestamp);
            const callId = p.call_id || p.id || `tool-${state.lastAssistantMsg.toolCalls.length + 1}`;
            // function_call uses `arguments` (JSON string); custom_tool_call uses `input` (plain string)
            let input = safeParseJsonObject(p.arguments);
            if (p.type === 'custom_tool_call' && Object.keys(input).length === 0 && p.input != null) {
              const toolName = typeof p.name === 'string' ? p.name : 'content';
              input = typeof p.input === 'string' ? { [toolName]: p.input } : safeParseJsonObject(p.input);
            }
            const toolCall = {
              id: callId,
              name: typeof p.name === 'string' ? p.name : 'tool_call',
              input,
              status: p.status === 'completed' ? 'complete' : 'pending',
            };
            const idx = state.lastAssistantMsg.toolCalls.length;
            state.pendingToolUses.set(callId, idx);
            state.lastAssistantMsg.toolCalls.push(toolCall);
            state.lastAssistantMsg.contentBlocks.push({ type: 'tool', toolIndex: idx });
            continue;
          }

          if (p.type === 'function_call_output' || p.type === 'custom_tool_call_output') {
            const callId = p.call_id || p.id;
            if (!callId) continue;
            const isFlushed = !state.lastAssistantMsg && !!state.flushedToolCalls;
            const toolCalls = state.lastAssistantMsg?.toolCalls || state.flushedToolCalls;
            const idx = state.pendingToolUses.get(callId);
            if (toolCalls && idx !== undefined) {
              let result = typeof p.output === 'string' ? p.output : JSON.stringify(p.output || '');
              let isError = !!p.error;
              // function_call_output: strip exec_command metadata wrapper
              if (p.type === 'function_call_output' && typeof result === 'string') {
                const outputMarker = result.indexOf('\nOutput:\n');
                if (outputMarker !== -1 && result.startsWith('Chunk ID:')) {
                  const exitMatch = result.match(/Process exited with code (\d+)/);
                  if (exitMatch && exitMatch[1] !== '0') isError = true;
                  result = result.slice(outputMarker + '\nOutput:\n'.length);
                }
              }
              // custom_tool_call_output: JSON payload wrapper
              if (p.type === 'custom_tool_call_output' && typeof p.output === 'string') {
                try {
                  const parsed = JSON.parse(p.output);
                  if (parsed && typeof parsed.output === 'string') result = parsed.output;
                  if (parsed?.metadata?.exit_code && parsed.metadata.exit_code !== 0) isError = true;
                } catch {
                  // use raw string output
                }
              }
              const cleanResult = stripSystemXml(result);
              const status = isError ? 'error' : 'complete';
              toolCalls[idx].result = cleanResult;
              toolCalls[idx].status = status;
              state.pendingToolUses.delete(callId);
              if (isFlushed) {
                toolUpdates.push({
                  toolUseId: callId,
                  status,
                  result: cleanResult,
                });
              }
            }
            continue;
          }
        }
        continue;
      }

      const role = getSessionEntryRole(entry, provider);
      if (!role) continue;

      const contentBlocks = entry?.message?.content;

      if (role === 'assistant') {
        ensureAssistant(entry.timestamp);

        if (Array.isArray(contentBlocks)) {
          for (const block of contentBlocks) {
            if (!block || typeof block !== 'object') continue;

            if (block.type === 'text' && typeof block.text === 'string') {
              const text = stripSystemXml(block.text);
              if (text) {
                if (state.lastAssistantMsg.content) state.lastAssistantMsg.content += '\n';
                state.lastAssistantMsg.content += text;
                const lastCB = state.lastAssistantMsg.contentBlocks[state.lastAssistantMsg.contentBlocks.length - 1];
                if (lastCB && lastCB.type === 'text') {
                  lastCB.text += '\n' + text;
                } else {
                  state.lastAssistantMsg.contentBlocks.push({ type: 'text', text });
                }
              }
            } else if (block.type === 'thinking' && typeof block.thinking === 'string') {
              const thinking = block.thinking.trim();
              if (thinking) {
                if (state.lastAssistantMsg.thinking) state.lastAssistantMsg.thinking += '\n\n';
                state.lastAssistantMsg.thinking += thinking;
              }
            } else if (block.type === 'tool_use' && block.id && block.name) {
              const toolCall = {
                id: block.id,
                name: block.name,
                input: block.input || {},
                status: 'pending',
              };
              const idx = state.lastAssistantMsg.toolCalls.length;
              state.pendingToolUses.set(block.id, idx);
              state.lastAssistantMsg.toolCalls.push(toolCall);
              state.lastAssistantMsg.contentBlocks.push({ type: 'tool', toolIndex: idx });
            }
          }
        } else {
          const text = extractContent(entry);
          if (text) {
            if (state.lastAssistantMsg.content) state.lastAssistantMsg.content += '\n';
            state.lastAssistantMsg.content += text;
            const lastCB = state.lastAssistantMsg.contentBlocks[state.lastAssistantMsg.contentBlocks.length - 1];
            if (lastCB && lastCB.type === 'text') {
              lastCB.text += '\n' + text;
            } else {
              state.lastAssistantMsg.contentBlocks.push({ type: 'text', text });
            }
          }
        }
      } else if (role === 'user') {
        if (Array.isArray(contentBlocks) && isToolResultOnly(contentBlocks)) {
          const isFlushed = !state.lastAssistantMsg && !!state.flushedToolCalls;
          const toolCalls = state.lastAssistantMsg?.toolCalls || state.flushedToolCalls;
          if (toolCalls) {
            for (const block of contentBlocks) {
              const idx = state.pendingToolUses.get(block.tool_use_id);
              if (idx !== undefined) {
                const result = extractToolResultText(block.content);
                const status = block.is_error ? 'error' : 'complete';
                toolCalls[idx].result = result;
                toolCalls[idx].status = status;
                state.pendingToolUses.delete(block.tool_use_id);
                if (isFlushed) {
                  toolUpdates.push({
                    toolUseId: block.tool_use_id,
                    status,
                    result,
                  });
                }
              }
            }
          }
          continue;
        }

        flushAssistant();
        state.flushedToolCalls = null;
        state.pendingToolUses.clear();

        const extracted = extractContent(entry);
        if (extracted) {
          messages.push({
            role: 'user',
            content: extracted,
            timestamp: entry.timestamp,
          });
        }
      }
    }

    flushAssistant();

    return { messages, toolUpdates };
  }

  async function tailSession(entry) {
    if (entry.tailQueued) return;
    entry.tailQueued = true;

    try {
      let stat;
      try {
        stat = await fsp.stat(entry.filePath);
      } catch {
        return;
      }
      if (stat.size <= entry.byteOffset) return;

      const fd = await fsp.open(entry.filePath, 'r');
      try {
        const readLen = stat.size - entry.byteOffset;
        const buf = Buffer.alloc(readLen);
        await fd.read(buf, 0, buf.length, entry.byteOffset);

        const text = entry.partialLine + buf.toString('utf-8');
        const lines = text.split('\n');
        entry.partialLine = lines.pop() || '';
        entry.byteOffset = stat.size - Buffer.byteLength(entry.partialLine, 'utf-8');
        entry.lastGrowth = Date.now();

        const validLines = lines.filter(l => l.trim());
        if (validLines.length > 0) {
          const { messages: newMessages, toolUpdates } = parseJsonlLinesStateful(
            validLines,
            entry.parserState,
            entry.provider || 'claude',
          );
          if (newMessages.length > 0) {
            broadcast('session:lines-added', {
              sessionId: entry.sessionId,
              messages: newMessages,
            });
          }
          if (toolUpdates.length > 0) {
            broadcast('session:tool-updated', {
              sessionId: entry.sessionId,
              updates: toolUpdates,
            });
          }
        }
      } finally {
        await fd.close();
      }
    } catch (err) {
      log('sessions', 'warn', `tail error for ${entry.sessionId}: ${err.message}`);
    } finally {
      entry.tailQueued = false;
    }
  }

  function startFileWatcher(entry) {
    try {
      entry.watcher = fs.watch(entry.filePath, () => {
        setImmediate(() => tailSession(entry));
      });
      entry.watcher.on('error', () => {
        if (entry.watcher) {
          try { entry.watcher.close(); } catch {}
          entry.watcher = null;
        }
      });
    } catch (err) {
      log('sessions', 'warn', `failed to watch ${entry.filePath}: ${err.message}`);
    }
  }

  function stopFollowEntry(sessionId) {
    const entry = followedSessions.get(sessionId);
    if (!entry) return;
    if (entry.watcher) {
      try { entry.watcher.close(); } catch {}
    }
    followedSessions.delete(sessionId);
  }

  async function handleSessionFollow(ws, data) {
    const { sessionId, fromOffset } = data || {};
    if (!sessionId || typeof sessionId !== 'string') return;

    if (!followedSessions.has(sessionId) && followedSessions.size >= MAX_FOLLOWED_SESSIONS) {
      log('sessions', 'warn', `follow limit reached (${MAX_FOLLOWED_SESSIONS}), rejecting ${sessionId}`);
      try {
        ws.send(JSON.stringify({
          type: 'session:follow-error',
          data: { sessionId, error: 'max_followed_sessions' },
        }));
      } catch {}
      return;
    }

    if (!clientFollows.has(ws)) {
      clientFollows.set(ws, new Set());
    }
    const clientSet = clientFollows.get(ws);

    if (followedSessions.has(sessionId)) {
      const entry = followedSessions.get(sessionId);
      if (!clientSet.has(sessionId)) {
        entry.subscriberCount++;
        clientSet.add(sessionId);
      }
      log('sessions', 'debug', `follow: existing ${sessionId} (subscribers: ${entry.subscriberCount})`);
      return;
    }

    const found = await findSessionFile(sessionId);
    if (!found?.filePath) {
      log('sessions', 'warn', `follow: session file not found for ${sessionId}`);
      try {
        ws.send(JSON.stringify({
          type: 'session:follow-error',
          data: { sessionId, error: 'not_found' },
        }));
      } catch {}
      return;
    }

    const entry = {
      sessionId,
      provider: found.provider || 'claude',
      filePath: found.filePath,
      byteOffset: typeof fromOffset === 'number' && fromOffset > 0 ? fromOffset : 0,
      partialLine: '',
      parserState: createParserState(),
      subscriberCount: 1,
      watcher: null,
      lastGrowth: Date.now(),
      tailQueued: false,
    };

    followedSessions.set(sessionId, entry);
    clientSet.add(sessionId);

    startFileWatcher(entry);

    if (!tailFallbackTimer) {
      tailFallbackTimer = setInterval(tailFallbackTick, TAIL_FALLBACK_INTERVAL_MS);
    }

    setImmediate(() => tailSession(entry));

    log('sessions', 'info', `follow: started ${sessionId} from offset ${entry.byteOffset}`);
  }

  function handleSessionUnfollow(ws, data) {
    const { sessionId } = data || {};
    if (!sessionId || typeof sessionId !== 'string') return;

    const clientSet = clientFollows.get(ws);
    if (!clientSet || !clientSet.has(sessionId)) return;
    clientSet.delete(sessionId);

    const entry = followedSessions.get(sessionId);
    if (!entry) return;

    entry.subscriberCount--;
    if (entry.subscriberCount <= 0) {
      stopFollowEntry(sessionId);
      log('sessions', 'info', `unfollow: stopped ${sessionId} (no subscribers)`);
    } else {
      log('sessions', 'debug', `unfollow: ${sessionId} (subscribers: ${entry.subscriberCount})`);
    }

    if (followedSessions.size === 0 && tailFallbackTimer) {
      clearInterval(tailFallbackTimer);
      tailFallbackTimer = null;
    }
  }

  function handleWsDisconnect(ws) {
    const clientSet = clientFollows.get(ws);
    if (!clientSet) return;

    for (const sessionId of clientSet) {
      const entry = followedSessions.get(sessionId);
      if (!entry) continue;
      entry.subscriberCount--;
      if (entry.subscriberCount <= 0) {
        stopFollowEntry(sessionId);
        log('sessions', 'debug', `ws disconnect: stopped following ${sessionId}`);
      }
    }

    if (followedSessions.size === 0 && tailFallbackTimer) {
      clearInterval(tailFallbackTimer);
      tailFallbackTimer = null;
    }
  }

  function tailFallbackTick() {
    const now = Date.now();
    for (const [sessionId, entry] of followedSessions) {
      if (now - entry.lastGrowth > TAIL_IDLE_TIMEOUT_MS) {
        log('sessions', 'info', `idle cleanup: ${sessionId} (no growth for ${TAIL_IDLE_TIMEOUT_MS / 1000}s)`);
        broadcast('session:follow-ended', { sessionId, reason: 'idle' });
        stopFollowEntry(sessionId);
        continue;
      }
      setImmediate(() => tailSession(entry));
    }

    if (followedSessions.size === 0 && tailFallbackTimer) {
      clearInterval(tailFallbackTimer);
      tailFallbackTimer = null;
    }
  }

  function handleWsMessage(ws, msg) {
    if (!msg || typeof msg !== 'object') return false;
    if (msg.type === 'session:follow') {
      handleSessionFollow(ws, msg);
      return true;
    }
    if (msg.type === 'session:unfollow') {
      handleSessionUnfollow(ws, msg);
      return true;
    }
    return false;
  }

  function cleanup() {
    for (const [, entry] of followedSessions) {
      if (entry.watcher) {
        try { entry.watcher.close(); } catch {}
      }
    }
    followedSessions.clear();
    if (tailFallbackTimer) {
      clearInterval(tailFallbackTimer);
      tailFallbackTimer = null;
    }
  }

  return {
    handleWsMessage,
    handleWsDisconnect,
    cleanup,
  };
}
