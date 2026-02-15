import { parseClaudeSessionMessagesFromJsonl } from './claude/parser.js';
import { parseCodexSessionMessagesFromJsonl } from './codex/parser.js';

export function parseSessionMessagesFromJsonl(content, provider = 'claude') {
  if (provider === 'codex') {
    return parseCodexSessionMessagesFromJsonl(content);
  }
  return parseClaudeSessionMessagesFromJsonl(content);
}
