/**
 * WebSocket runtime for daemon events.
 */

import { URL } from 'url';
import { WebSocketServer } from 'ws';

export const WS_TOKEN_PROTOCOL_PREFIX = 'rudi-token.';

export function readWsTokenFromProtocolHeader(headerValue) {
  if (!headerValue) return null;
  const raw = Array.isArray(headerValue) ? headerValue.join(',') : headerValue;
  const protocols = String(raw).split(',').map((p) => p.trim()).filter(Boolean);
  for (const protocol of protocols) {
    const normalized = protocol.replace(/^"+|"+$/g, '');
    if (normalized.startsWith(WS_TOKEN_PROTOCOL_PREFIX)) {
      return normalized.slice(WS_TOKEN_PROTOCOL_PREFIX.length);
    }
  }
  return null;
}

export function selectWsProtocol(protocols) {
  const offeredProtocols = protocols || [];
  for (const offered of offeredProtocols) {
    const normalized = String(offered).replace(/^"+|"+$/g, '');
    if (normalized.startsWith(WS_TOKEN_PROTOCOL_PREFIX)) {
      return normalized;
    }
  }

  const count = typeof offeredProtocols.size === 'number'
    ? offeredProtocols.size
    : offeredProtocols.length || 0;
  return count === 0 ? undefined : false;
}

export function isSameOriginWebSocketToken(presentedToken, host) {
  // Kept as an exported compatibility helper; Host-based same-origin trust is not authentication.
  return false;
}

export function createWebSocketRuntime({
  getToken,
  handleMessage,
  handleDisconnect,
  log,
  WebSocketServerImpl = WebSocketServer,
} = {}) {
  const wss = new WebSocketServerImpl({
    noServer: true,
    // Avoid extension negotiation edge-cases across runtimes/webviews.
    perMessageDeflate: false,
    handleProtocols: selectWsProtocol,
  });

  function attachToServer(server) {
    server.on('upgrade', (req, socket, head) => {
      const url = new URL(req.url, 'http://localhost');
      const protocolToken = readWsTokenFromProtocolHeader(req.headers['sec-websocket-protocol']);
      const expectedToken = getToken?.();

      if (!expectedToken || protocolToken !== expectedToken) {
        log?.('ws', 'warn', 'upgrade auth failed', {
          path: url.pathname,
          hasProtocolToken: !!protocolToken,
          hasQueryToken: url.searchParams.has('token'),
        });
        socket.destroy();
        return;
      }

      wss.handleUpgrade(req, socket, head, (ws) => {
        wss.emit('connection', ws, req);
      });
    });
  }

  wss.on('connection', (ws) => {
    log?.('ws', 'info', `client connected (total: ${wss.clients.size})`, { protocol: ws.protocol || null });

    ws.on('message', (raw) => {
      try {
        const msg = JSON.parse(typeof raw === 'string' ? raw : raw.toString());
        handleMessage?.(ws, msg);
      } catch {
        // Ignore malformed messages.
      }
    });

    ws.on('close', () => {
      log?.('ws', 'info', `client disconnected (total: ${wss.clients.size})`);
      handleDisconnect?.(ws);
    });
  });

  return {
    attachToServer,
    wss,
  };
}
