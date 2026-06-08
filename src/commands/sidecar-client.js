import fs from 'fs';
import path from 'path';
import { PATHS } from '@learnrudi/env';

export const SIDECAR_PORT_FILE = path.join(PATHS.home, '.rudi-lite-port');
export const SIDECAR_TOKEN_FILE = path.join(PATHS.home, '.rudi-lite-token');

export function readSidecarInfo(options = {}) {
  const portFile = options.portFile || SIDECAR_PORT_FILE;
  const tokenFile = options.tokenFile || SIDECAR_TOKEN_FILE;

  if (!fs.existsSync(portFile) || !fs.existsSync(tokenFile)) {
    const error = new Error('RUDI sidecar is not running. Start it with: rudi serve');
    error.code = 'SIDECAR_NOT_RUNNING';
    error.portFile = portFile;
    error.tokenFile = tokenFile;
    throw error;
  }

  const portRaw = fs.readFileSync(portFile, 'utf-8').trim();
  const token = fs.readFileSync(tokenFile, 'utf-8').trim();
  const port = Number.parseInt(portRaw, 10);

  if (!Number.isFinite(port) || port <= 0) {
    const error = new Error('Invalid sidecar port file. Restart sidecar with: rudi serve');
    error.code = 'SIDECAR_INVALID_PORT_FILE';
    error.portFile = portFile;
    throw error;
  }
  if (!token) {
    const error = new Error('Missing sidecar token. Restart sidecar with: rudi serve');
    error.code = 'SIDECAR_MISSING_TOKEN_FILE';
    error.tokenFile = tokenFile;
    throw error;
  }

  return { port, token, portFile, tokenFile };
}

export async function sidecarRequest({
  port,
  token,
  method = 'GET',
  pathname,
  body,
  timeoutMs = 5000,
  fetchImpl = globalThis.fetch,
}) {
  if (typeof fetchImpl !== 'function') {
    throw new Error('fetch is not available in this Node.js runtime');
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  let response;
  try {
    response = await fetchImpl(`http://127.0.0.1:${port}${pathname}`, {
      method,
      headers: {
        'Content-Type': 'application/json',
        'x-rudi-token': token,
      },
      body: body ? JSON.stringify(body) : undefined,
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timeout);
  }

  const text = await response.text();
  let parsed = null;
  try {
    parsed = text ? JSON.parse(text) : null;
  } catch {}

  if (!response.ok) {
    const message = parsed?.message || parsed?.error || text || `HTTP ${response.status}`;
    const error = new Error(message);
    error.statusCode = response.status;
    error.responseBody = parsed;
    error.pathname = pathname;
    throw error;
  }

  return parsed || {};
}

function buildDaemonProbeResult(patch = {}) {
  return {
    running: false,
    reachable: false,
    healthy: false,
    ready: false,
    reason: 'unknown',
    error: null,
    port: null,
    version: null,
    readiness: null,
    status: null,
    toolIndexStatus: null,
    dbStatus: null,
    activeSessionCount: 0,
    activeJobCount: 0,
    ...patch,
  };
}

export async function getSidecarDaemonStatus(options = {}) {
  const readInfo = options.readSidecarInfo || readSidecarInfo;
  const request = options.sidecarRequest || sidecarRequest;
  const timeoutMs = Number.isFinite(options.timeoutMs) && options.timeoutMs > 0
    ? options.timeoutMs
    : 1500;

  let sidecar;
  try {
    sidecar = readInfo(options);
  } catch (error) {
    return buildDaemonProbeResult({
      reason: error.code === 'SIDECAR_NOT_RUNNING' ? 'not_running' : 'invalid_connection_files',
      error: error.message,
    });
  }

  try {
    const [readiness, status] = await Promise.all([
      request({ ...sidecar, pathname: '/ready', timeoutMs }),
      request({ ...sidecar, pathname: '/daemon/status', timeoutMs }),
    ]);
    const ready = readiness?.ready === true;

    return buildDaemonProbeResult({
      running: true,
      reachable: true,
      healthy: ready,
      ready,
      reason: ready ? 'ok' : 'not_ready',
      port: sidecar.port,
      version: status?.version || null,
      readiness,
      status,
      toolIndexStatus: status?.toolIndexStatus || readiness?.checks?.toolIndex || null,
      dbStatus: status?.dbStatus || readiness?.checks?.db || null,
      activeSessionCount: Number.isInteger(status?.activeSessionCount) ? status.activeSessionCount : 0,
      activeJobCount: Number.isInteger(status?.activeJobCount) ? status.activeJobCount : 0,
    });
  } catch (error) {
    return buildDaemonProbeResult({
      running: false,
      reachable: false,
      healthy: false,
      ready: false,
      reason: 'unreachable',
      error: error.name === 'AbortError' ? `Timed out after ${timeoutMs}ms` : error.message,
      port: sidecar.port,
    });
  }
}
