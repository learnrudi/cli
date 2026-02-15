import { safeParseJsonObject, stripSystemXml } from '../common.js';

export function extractCodexTextBlocks(contentBlocks) {
  if (!Array.isArray(contentBlocks)) return '';
  const parts = [];
  for (const block of contentBlocks) {
    if (!block || typeof block !== 'object') continue;
    if (
      (block.type === 'output_text'
      || block.type === 'input_text'
      || block.type === 'text'
      || block.type === 'summary_text')
      && typeof block.text === 'string'
    ) {
      const text = block.text.trim();
      if (text) parts.push(text);
    }
  }
  return parts.join('\n').trim();
}

export function extractCodexReasoningText(payload) {
  if (!payload || typeof payload !== 'object') return '';
  if (typeof payload.text === 'string' && payload.text.trim()) {
    return payload.text.trim();
  }
  const summary = extractCodexTextBlocks(payload.summary);
  if (summary) return summary;
  return extractCodexTextBlocks(payload.content);
}

export function parseCodexSessionMessagesFromJsonl(content) {
  if (!content || typeof content !== 'string') return [];

  const lines = content.trim().split('\n').filter(Boolean);
  const messages = [];
  let currentAssistant = null;

  function ensureAssistant(timestamp) {
    if (!currentAssistant) {
      currentAssistant = {
        content: '',
        thinking: '',
        toolCalls: [],
        contentBlocks: [],
        pendingToolIds: new Map(),
        timestamp,
      };
    }
  }

  function appendAssistantText(text) {
    if (!text) return;
    ensureAssistant(null);
    if (currentAssistant.content) currentAssistant.content += '\n';
    currentAssistant.content += text;
    const lastBlock = currentAssistant.contentBlocks[currentAssistant.contentBlocks.length - 1];
    if (lastBlock && lastBlock.type === 'text') {
      lastBlock.text += '\n' + text;
    } else {
      currentAssistant.contentBlocks.push({ type: 'text', text });
    }
  }

  function appendAssistantThinking(text) {
    if (!text) return;
    ensureAssistant(null);
    if (currentAssistant.thinking) currentAssistant.thinking += '\n\n';
    currentAssistant.thinking += text;
  }

  function flushAssistant() {
    if (!currentAssistant) return;
    const msg = {
      role: 'assistant',
      content: currentAssistant.content.trim(),
      timestamp: currentAssistant.timestamp,
    };
    if (currentAssistant.thinking) msg.thinking = currentAssistant.thinking.trim();
    if (currentAssistant.toolCalls.length > 0) msg.toolCalls = currentAssistant.toolCalls;
    if (currentAssistant.contentBlocks.length > 0) msg.contentBlocks = currentAssistant.contentBlocks;
    if (msg.content || msg.thinking || (msg.toolCalls && msg.toolCalls.length > 0)) {
      messages.push(msg);
    }
    currentAssistant = null;
  }

  for (const line of lines) {
    // Skip massive encrypted reasoning lines we don't need to render.
    if (line.length > 200_000 && !line.includes('"function_call"') && !line.includes('"custom_tool_call"') && !line.includes('"agent_message"')) {
      continue;
    }
    let entry;
    try { entry = JSON.parse(line); } catch { continue; }

    if (entry?.type === 'event_msg') {
      const p = entry.payload || {};
      if (p.type === 'user_message') {
        flushAssistant();
        const text = typeof p.message === 'string' ? p.message.trim() : '';
        if (text) {
          messages.push({ role: 'user', content: text, timestamp: entry.timestamp });
        }
        continue;
      }
      if (p.type === 'agent_message') {
        ensureAssistant(entry.timestamp);
        appendAssistantText(typeof p.message === 'string' ? p.message.trim() : '');
        continue;
      }
      if (p.type === 'agent_reasoning') {
        ensureAssistant(entry.timestamp);
        appendAssistantThinking(typeof p.text === 'string' ? p.text.trim() : '');
      }
      continue;
    }

    if (entry?.type !== 'response_item') continue;
    const p = entry.payload || {};

    if (p.type === 'message') {
      const text = extractCodexTextBlocks(p.content);
      if (p.role === 'user') {
        flushAssistant();
        if (text) messages.push({ role: 'user', content: text, timestamp: entry.timestamp });
      } else if (p.role === 'assistant') {
        ensureAssistant(entry.timestamp);
        appendAssistantText(text);
      }
      continue;
    }

    if (p.type === 'reasoning') {
      ensureAssistant(entry.timestamp);
      appendAssistantThinking(extractCodexReasoningText(p));
      continue;
    }

    if (p.type === 'function_call' || p.type === 'custom_tool_call') {
      ensureAssistant(entry.timestamp);
      const callId = p.call_id || p.id || `tool-${currentAssistant.toolCalls.length + 1}`;
      // function_call uses `arguments` (JSON string); custom_tool_call uses `input` (plain string)
      let input = safeParseJsonObject(p.arguments);
      if (p.type === 'custom_tool_call' && Object.keys(input).length === 0 && p.input != null) {
        // custom_tool_call.input is a raw string — key by tool name for display
        const toolName = typeof p.name === 'string' ? p.name : 'content';
        input = typeof p.input === 'string' ? { [toolName]: p.input } : safeParseJsonObject(p.input);
      }
      const toolCall = {
        id: callId,
        name: typeof p.name === 'string' ? p.name : 'tool_call',
        input,
        status: p.status === 'completed' ? 'complete' : 'pending',
      };
      const idx = currentAssistant.toolCalls.length;
      currentAssistant.pendingToolIds.set(callId, idx);
      currentAssistant.toolCalls.push(toolCall);
      currentAssistant.contentBlocks.push({ type: 'tool', toolIndex: idx });
      continue;
    }

    if (p.type === 'function_call_output' || p.type === 'custom_tool_call_output') {
      ensureAssistant(entry.timestamp);
      const callId = p.call_id || p.id;
      if (!callId) continue;
      const idx = currentAssistant.pendingToolIds.get(callId);
      if (idx === undefined) continue;
      let output = typeof p.output === 'string' ? p.output : JSON.stringify(p.output || '');
      let isError = !!p.error;
      // function_call_output: strip Codex exec_command metadata prefix
      // (Chunk ID: ...\nWall time: ...\nProcess exited with code N\nOriginal token count: N\nOutput:\n)
      if (p.type === 'function_call_output' && typeof output === 'string') {
        const outputMarker = output.indexOf('\nOutput:\n');
        if (outputMarker !== -1 && output.startsWith('Chunk ID:')) {
          const exitMatch = output.match(/Process exited with code (\d+)/);
          if (exitMatch && exitMatch[1] !== '0') isError = true;
          output = output.slice(outputMarker + '\nOutput:\n'.length);
        }
      }
      // custom_tool_call_output: JSON string wrapping { output, metadata }
      if (p.type === 'custom_tool_call_output' && typeof p.output === 'string') {
        try {
          const parsed = JSON.parse(p.output);
          if (parsed && typeof parsed.output === 'string') output = parsed.output;
          if (parsed?.metadata?.exit_code && parsed.metadata.exit_code !== 0) isError = true;
        } catch {
          // not JSON-wrapped, use as-is
        }
      }
      currentAssistant.toolCalls[idx].result = stripSystemXml(output);
      currentAssistant.toolCalls[idx].status = isError ? 'error' : 'complete';
      currentAssistant.pendingToolIds.delete(callId);
    }
  }

  flushAssistant();
  return messages;
}
