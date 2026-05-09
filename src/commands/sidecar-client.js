import fs from 'fs';
import path from 'path';
import { PATHS } from '@learnrudi/env';

const PORT_FILE = path.join(PATHS.home, '.rudi-lite-port');
const TOKEN_FILE = path.join(PATHS.home, '.rudi-lite-token');

export function readSidecarInfo() {
  if (!fs.existsSync(PORT_FILE) || !fs.existsSync(TOKEN_FILE)) {
    throw new Error('RUDI sidecar is not running. Start it with: rudi serve');
  }

  const portRaw = fs.readFileSync(PORT_FILE, 'utf-8').trim();
  const token = fs.readFileSync(TOKEN_FILE, 'utf-8').trim();
  const port = Number.parseInt(portRaw, 10);

  if (!Number.isFinite(port) || port <= 0) {
    throw new Error('Invalid sidecar port file. Restart sidecar with: rudi serve');
  }
  if (!token) {
    throw new Error('Missing sidecar token. Restart sidecar with: rudi serve');
  }

  return { port, token };
}

export async function sidecarRequest({ port, token, method, pathname, body }) {
  const response = await fetch(`http://127.0.0.1:${port}${pathname}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      'X-Rudi-Token': token,
    },
    body: body ? JSON.stringify(body) : undefined,
  });

  const text = await response.text();
  let parsed = null;
  try {
    parsed = text ? JSON.parse(text) : null;
  } catch {}

  if (!response.ok) {
    const message = parsed?.message || parsed?.error || text || `HTTP ${response.status}`;
    throw new Error(message);
  }

  return parsed || {};
}
