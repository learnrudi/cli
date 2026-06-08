import {
  getLocalLlmEnvExport,
  getLocalLlmStatus,
  normalizeRuntimeName,
} from '../operations/local-llm.js';

function optionalSearchParam(url, name) {
  const value = url.searchParams.get(name);
  return value && value.length > 0 ? value : null;
}

function parseTimeoutMs(url) {
  const value = optionalSearchParam(url, 'timeoutMs') || optionalSearchParam(url, 'timeout');
  if (!value) return undefined;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    const error = new Error(`Invalid timeout: ${value}`);
    error.statusCode = 400;
    throw error;
  }
  return parsed;
}

function optionsFromUrl(url, overrides = {}) {
  return {
    runtime: normalizeRuntimeName(overrides.runtime || optionalSearchParam(url, 'runtime') || 'ollama'),
    target: optionalSearchParam(url, 'target') || 'mac_host',
    consumer: overrides.consumer || optionalSearchParam(url, 'consumer') || null,
    consumerContext: optionalSearchParam(url, 'context') || optionalSearchParam(url, 'consumerContext') || null,
    model: optionalSearchParam(url, 'model') || null,
    baseUrl: optionalSearchParam(url, 'baseUrl') || null,
    timeoutMs: parseTimeoutMs(url),
  };
}

function pathSegment(value) {
  return decodeURIComponent(value || '').trim();
}

function writeRouteError(ctx, res, error) {
  const status = Number.isInteger(error.statusCode) ? error.statusCode : 400;
  ctx.error(res, error.message, status);
  return true;
}

export function buildLocalLlmRoutes(ctx, deps = {}) {
  const { json } = ctx;

  return {
    async handle(req, res, url) {
      if (req.method !== 'GET') return false;

      try {
        if (url.pathname === '/local-llm/status') {
          json(res, await getLocalLlmStatus(optionsFromUrl(url), deps));
          return true;
        }

        if (url.pathname === '/local-llm/models') {
          const status = await getLocalLlmStatus(optionsFromUrl(url), deps);
          json(res, {
            runtime: status.runtime,
            target: status.target,
            consumerContext: status.consumerContext,
            available: status.available,
            models: status.models,
            error: status.error,
          });
          return true;
        }

        if (url.pathname.startsWith('/local-llm/env/')) {
          const consumer = pathSegment(url.pathname.slice('/local-llm/env/'.length));
          if (!consumer) {
            const error = new Error('consumer is required');
            error.statusCode = 400;
            throw error;
          }
          json(res, await getLocalLlmEnvExport(optionsFromUrl(url, { consumer }), deps));
          return true;
        }

        const runtimeStatusMatch = url.pathname.match(/^\/runtimes\/([^/]+)\/status$/);
        if (runtimeStatusMatch) {
          const runtime = pathSegment(runtimeStatusMatch[1]);
          json(res, await getLocalLlmStatus(optionsFromUrl(url, { runtime }), deps));
          return true;
        }
      } catch (error) {
        return writeRouteError(ctx, res, error);
      }

      return false;
    },
  };
}
