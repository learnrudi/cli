/**
 * Startup helpers for the local daemon process.
 */

import fs from 'fs';
import path from 'path';
import { PATHS } from '@learnrudi/env';

export const PORT_FILE = path.join(PATHS.home, '.rudi-lite-port');
export const TOKEN_FILE = path.join(PATHS.home, '.rudi-lite-token');

export function parseRequestedPort(flags = {}) {
  return Number.parseInt(flags.port, 10) || 0;
}

export function resolveWebRoot(flags = {}) {
  const webRoot = flags['web-root'] ? path.resolve(flags['web-root']) : null;
  if (!webRoot) return null;

  if (!fs.existsSync(path.join(webRoot, 'index.html'))) {
    const err = new Error(`No index.html found in ${webRoot}`);
    err.code = 'RUDI_WEB_ROOT_INDEX_MISSING';
    err.webRoot = webRoot;
    throw err;
  }

  return webRoot;
}

export function writeConnectionFiles({ port, token, portFile = PORT_FILE, tokenFile = TOKEN_FILE }) {
  fs.mkdirSync(PATHS.home, { recursive: true });
  fs.writeFileSync(portFile, String(port), { mode: 0o600 });
  fs.writeFileSync(tokenFile, token, { mode: 0o600 });
}

export function removeConnectionFiles({ portFile = PORT_FILE, tokenFile = TOKEN_FILE } = {}) {
  try { fs.unlinkSync(portFile); } catch {}
  try { fs.unlinkSync(tokenFile); } catch {}
}

export function startDaemonHttpServer(server, {
  port,
  host = '127.0.0.1',
  onListening,
} = {}) {
  server.listen(port || 0, host, () => {
    const address = server.address();
    const actualPort = typeof address === 'object' && address ? address.port : port;
    onListening?.(actualPort);
  });
}

export function printStartupBanner({
  port,
  token,
  webRoot = null,
  pid = process.pid,
  portFile = PORT_FILE,
  tokenFile = TOKEN_FILE,
  writeLine = console.log,
}) {
  writeLine('');
  writeLine('═'.repeat(50));
  writeLine(webRoot ? '  RUDI Dashboard' : '  RUDI Lite Server');
  writeLine('═'.repeat(50));
  if (webRoot) {
    writeLine(`  Open:  http://localhost:${port}`);
  }
  writeLine(`  Port:  ${port}`);
  writeLine(`  Token: ${token.slice(0, 8)}...`);
  writeLine(`  PID:   ${pid}`);
  if (webRoot) {
    writeLine(`  Web:   ${webRoot}`);
  }
  writeLine('');
  writeLine(`  Port file:  ${portFile}`);
  writeLine(`  Token file: ${tokenFile}`);
  writeLine('═'.repeat(50));
  writeLine('');
}
