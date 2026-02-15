/**
 * Shared provider parsing helpers used by session JSONL parsers.
 */

export function stripSystemXml(text) {
  if (!text || typeof text !== 'string') return text;
  return text
    .replace(/<system-reminder>[\s\S]*?<\/system-reminder>/g, '')
    .replace(/<task-notification>[\s\S]*?<\/task-notification>/g, '')
    .replace(/<bash-notification>[\s\S]*?<\/bash-notification>/g, '')
    .trim();
}

export function extractContent(entry) {
  if (typeof entry.message === 'string') return stripSystemXml(entry.message);

  const content = entry?.message?.content;
  if (typeof content === 'string') return stripSystemXml(content);

  if (Array.isArray(content)) {
    const parts = [];
    for (const block of content) {
      if (!block || typeof block !== 'object') continue;

      if ((block.type === 'text' || block.type === 'input_text') && typeof block.text === 'string') {
        const text = block.text.trim();
        if (text) parts.push(text);
        continue;
      }

      if (block.type === 'document') {
        const label = typeof block.title === 'string'
          ? block.title
          : (typeof block.filename === 'string' ? block.filename : '');
        parts.push(label ? `[Document: ${label}]` : '[Document attached]');
        continue;
      }

      if (block.type === 'image') {
        parts.push('[Image attached]');
      }
    }
    return parts.join('\n').trim();
  }

  return '';
}

export function safeParseJsonObject(value) {
  if (!value) return {};
  if (typeof value === 'object' && !Array.isArray(value)) return value;
  if (typeof value !== 'string') return {};
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

export function getSessionEntryRole(entry, provider = 'claude') {
  if (provider === 'codex') {
    if (entry?.type === 'event_msg') {
      const payloadType = entry?.payload?.type;
      if (payloadType === 'user_message') return 'user';
      if (payloadType === 'agent_message' || payloadType === 'agent_reasoning') return 'assistant';
    }
    if (entry?.type === 'response_item') {
      const payloadType = entry?.payload?.type;
      if (payloadType === 'message') {
        const role = entry?.payload?.role;
        if (role === 'user' || role === 'assistant') return role;
      }
      if (
        payloadType === 'reasoning'
        || payloadType === 'function_call'
        || payloadType === 'custom_tool_call'
        || payloadType === 'function_call_output'
      ) {
        return 'assistant';
      }
    }
  }

  const messageRole = entry?.message?.role;
  if (messageRole === 'user' || messageRole === 'assistant') {
    return messageRole;
  }

  const type = String(entry?.type || '').toLowerCase();
  if (type === 'user' || type === 'user_turn' || type === 'human' || type === 'human_turn') {
    return 'user';
  }
  if (type === 'assistant' || type === 'assistant_turn') {
    return 'assistant';
  }
  return null;
}

export function isToolResultOnly(content) {
  if (!Array.isArray(content)) return false;
  if (content.length === 0) return false;
  return content.every(
    (block) => block && typeof block === 'object' && block.type === 'tool_result'
  );
}

export function extractToolResultText(resultContent) {
  let text;
  if (typeof resultContent === 'string') {
    text = resultContent;
  } else if (Array.isArray(resultContent)) {
    text = resultContent
      .filter((b) => b && b.type === 'text' && typeof b.text === 'string')
      .map((b) => b.text)
      .join('\n');
  } else {
    return '';
  }
  return stripSystemXml(text);
}
