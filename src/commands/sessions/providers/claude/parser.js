import {
  extractContent,
  extractToolResultText,
  getSessionEntryRole,
  isToolResultOnly,
  stripSystemXml,
} from '../common.js';

/**
 * Parse Claude JSONL session content into chat messages with full fidelity.
 * Merges consecutive assistant entries into a single turn, attaches tool
 * results from intervening user tool_result entries, and preserves thinking.
 */
export function parseClaudeSessionMessagesFromJsonl(content) {
  if (!content || typeof content !== 'string') return [];

  const lines = content.trim().split('\n').filter(Boolean);
  const messages = [];

  let currentAssistant = null;

  function flushAssistant() {
    if (!currentAssistant) return;
    const msg = {
      role: 'assistant',
      content: currentAssistant.content.trim(),
      timestamp: currentAssistant.timestamp,
    };
    if (currentAssistant.thinking) {
      msg.thinking = currentAssistant.thinking.trim();
    }
    if (currentAssistant.toolCalls.length > 0) {
      msg.toolCalls = currentAssistant.toolCalls;
    }
    if (currentAssistant.contentBlocks.length > 0) {
      msg.contentBlocks = currentAssistant.contentBlocks;
    }
    if (msg.content || msg.thinking || (msg.toolCalls && msg.toolCalls.length > 0)) {
      messages.push(msg);
    }
    currentAssistant = null;
  }

  for (const line of lines) {
    let entry;
    try {
      entry = JSON.parse(line);
    } catch {
      continue;
    }

    const role = getSessionEntryRole(entry, 'claude');
    if (!role) continue;

    const contentBlocks = entry?.message?.content;

    if (role === 'assistant') {
      if (!currentAssistant) {
        currentAssistant = {
          content: '',
          thinking: '',
          toolCalls: [],
          contentBlocks: [],
          pendingToolIds: new Map(),
          timestamp: entry.timestamp,
        };
      }

      if (Array.isArray(contentBlocks)) {
        for (const block of contentBlocks) {
          if (!block || typeof block !== 'object') continue;

          if (block.type === 'text' && typeof block.text === 'string') {
            const text = stripSystemXml(block.text);
            if (text) {
              if (currentAssistant.content) currentAssistant.content += '\n';
              currentAssistant.content += text;
              const lastBlock = currentAssistant.contentBlocks[currentAssistant.contentBlocks.length - 1];
              if (lastBlock && lastBlock.type === 'text') {
                lastBlock.text += '\n' + text;
              } else {
                currentAssistant.contentBlocks.push({ type: 'text', text });
              }
            }
          } else if (block.type === 'thinking' && typeof block.thinking === 'string') {
            const thinking = block.thinking.trim();
            if (thinking) {
              if (currentAssistant.thinking) currentAssistant.thinking += '\n\n';
              currentAssistant.thinking += thinking;
            }
          } else if (block.type === 'tool_use' && block.id && block.name) {
            const toolCall = {
              id: block.id,
              name: block.name,
              input: block.input || {},
              status: 'pending',
            };
            const idx = currentAssistant.toolCalls.length;
            currentAssistant.pendingToolIds.set(block.id, idx);
            currentAssistant.toolCalls.push(toolCall);
            currentAssistant.contentBlocks.push({ type: 'tool', toolIndex: idx });
          }
        }
      } else {
        const text = extractContent(entry);
        if (text) {
          if (currentAssistant.content) currentAssistant.content += '\n';
          currentAssistant.content += text;
          const lastBlock = currentAssistant.contentBlocks[currentAssistant.contentBlocks.length - 1];
          if (lastBlock && lastBlock.type === 'text') {
            lastBlock.text += '\n' + text;
          } else {
            currentAssistant.contentBlocks.push({ type: 'text', text });
          }
        }
      }
    } else if (role === 'user') {
      if (Array.isArray(contentBlocks) && isToolResultOnly(contentBlocks)) {
        if (currentAssistant) {
          for (const block of contentBlocks) {
            const idx = currentAssistant.pendingToolIds.get(block.tool_use_id);
            if (idx !== undefined) {
              currentAssistant.toolCalls[idx].result = extractToolResultText(block.content);
              currentAssistant.toolCalls[idx].status = block.is_error ? 'error' : 'complete';
              currentAssistant.pendingToolIds.delete(block.tool_use_id);
            }
          }
        }
        continue;
      }

      flushAssistant();

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

  return messages;
}
