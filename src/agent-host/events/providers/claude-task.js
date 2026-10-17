// A task result must close the same fresh session. Assistant text and
// Codex-shaped terminal events cannot substitute for a Claude result.
export function consumeClaudeTaskEvent(state, event) {
  if (state.terminal) throw new Error('Claude output after terminal result');
  if (event.session_id !== undefined) {
    if (typeof event.session_id !== 'string' || !/^[A-Za-z0-9_-]{1,256}$/u.test(event.session_id)
        || (state.observedSessionId && event.session_id !== state.observedSessionId)) throw new Error('Claude session mismatch');
    state.observedSessionId = event.session_id;
  }
  if (event.type === 'system' && event.subtype === 'init') {
    if (state.sessionId || typeof event.session_id !== 'string'
        || !/^[A-Za-z0-9_-]{1,256}$/u.test(event.session_id)) throw new Error('invalid Claude session initialization');
    state.sessionId = event.session_id;
  }
  if (!state.sessionId && event.type !== 'system') throw new Error('Claude event before initialization');
  if (event.type === 'error' || event.error) throw new Error('Claude native failure');
  if (event.type !== 'result') return;
  if (!state.sessionId || event.session_id !== state.sessionId || event.subtype !== 'success'
      || event.is_error !== false || !Array.isArray(event.permission_denials)
      || event.permission_denials.length !== 0 || typeof event.result !== 'string'
      || Buffer.byteLength(event.result) > 65536) throw new Error('invalid Claude terminal result');
  state.terminal = true;
  state.finalOutput = event.result;
}
