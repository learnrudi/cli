/**
 * Local LLM daemon operation.
 *
 * RUDI treats local model runtimes as daemon-owned capabilities. Commands,
 * Lite, and other consumers should call this operation or its HTTP route
 * instead of reimplementing runtime metadata, health checks, and env export.
 */

import { getManifest, getPackage } from '@learnrudi/registry-client';

import {
  validateLocalLlmEnvExport,
  validateLocalLlmRuntimeStatus,
} from '../schemas/local-llm.js';

const DEFAULT_RUNTIME = 'ollama';
const DEFAULT_TARGET = 'mac_host';
const DEFAULT_CONSUMER_CONTEXT = 'host_process';
const DEFAULT_TIMEOUT_MS = 5000;

function requireValidResult(name, result, validation) {
  if (!validation.ok) {
    throw new Error(`${name} failed schema validation: ${validation.errors.join('; ')}`);
  }
  return result;
}

export function normalizeRuntimeName(runtime) {
  return String(runtime || DEFAULT_RUNTIME).replace(/^runtime:/, '');
}

function normalizeApiKeyPolicy(policy) {
  if (policy === 'placeholder-accepted') return 'placeholder';
  return policy || 'none';
}

function contentEngineConsumerFromLegacy(spec) {
  const legacyEnv = spec.consumerEnv?.contentEngine || spec.consumerEnv?.['content-engine'];
  if (legacyEnv) {
    return {
      defaultConsumerContext: 'docker_container',
      env: legacyEnv,
    };
  }

  return {
    defaultConsumerContext: 'docker_container',
    env: {
      ENABLE_LLM: 'true',
      ENABLE_LOCAL_LLM: 'true',
      LOCAL_LLM_PROVIDER: 'local',
      LOCAL_LLM_BASE_URL: '{{baseUrl}}',
      LOCAL_LLM_API_KEY: '{{apiKey}}',
      LOCAL_LLM_MODEL: '{{model}}',
    },
  };
}

export function joinEndpoint(baseUrl, endpointPath) {
  const base = String(baseUrl || '').replace(/\/+$/, '');
  const suffix = String(endpointPath || '/models').startsWith('/')
    ? endpointPath
    : `/${endpointPath}`;
  return `${base}${suffix}`;
}

export function extractModelIds(body) {
  const candidates = Array.isArray(body?.data)
    ? body.data
    : Array.isArray(body?.models)
      ? body.models
      : [];

  return candidates
    .map((model) => {
      if (typeof model === 'string') return model;
      return model?.id || model?.name || model?.model || null;
    })
    .filter(Boolean)
    .sort();
}

export function normalizeLocalLlmSpec(spec = {}) {
  const providerFamily = spec.providerFamily
    || (spec.openaiCompatible ? 'openai_compatible' : 'unknown');

  const fallbackTarget = {
    runtimeBaseUrl: spec.defaultBaseUrl,
    consumerUrls: {
      host_process: spec.defaultBaseUrl,
      docker_container: spec.dockerHostBaseUrl || spec.defaultBaseUrl,
    },
    healthCheck: {
      method: 'GET',
      path: spec.modelsEndpoint || '/models',
    },
    apiKeyPolicy: normalizeApiKeyPolicy(spec.apiKeyPolicy),
    placeholderApiKey: spec.placeholderApiKey,
  };

  const targets = Object.keys(spec.targets || {}).length > 0
    ? spec.targets
    : { [DEFAULT_TARGET]: fallbackTarget };

  const normalizedTargets = Object.fromEntries(
    Object.entries(targets).map(([name, target]) => [
      name,
      {
        ...target,
        healthCheck: target.healthCheck || fallbackTarget.healthCheck,
        apiKeyPolicy: normalizeApiKeyPolicy(target.apiKeyPolicy || spec.apiKeyPolicy),
        placeholderApiKey: target.placeholderApiKey || spec.placeholderApiKey,
      },
    ]),
  );

  const consumers = {
    ...(spec.consumers || {}),
  };
  if (!consumers['content-engine']) {
    consumers['content-engine'] = contentEngineConsumerFromLegacy(spec);
  }

  return {
    ...spec,
    providerFamily,
    targets: normalizedTargets,
    consumers,
  };
}

export function resolveLocalLlmConfig({
  runtime = DEFAULT_RUNTIME,
  localLlm,
  target = DEFAULT_TARGET,
  consumer = null,
  consumerContext = null,
  model = null,
  baseUrl = null,
} = {}) {
  const spec = normalizeLocalLlmSpec(localLlm);
  const targetSpec = spec.targets[target];
  if (!targetSpec) {
    throw new Error(`Local LLM target not found: ${target}`);
  }

  const consumerSpec = consumer ? spec.consumers?.[consumer] : null;
  if (consumer && !consumerSpec) {
    throw new Error(`Local LLM consumer mapping not found: ${consumer}`);
  }

  const resolvedConsumerContext = consumerContext
    || consumerSpec?.defaultConsumerContext
    || DEFAULT_CONSUMER_CONTEXT;
  const resolvedBaseUrl = baseUrl
    || targetSpec.consumerUrls?.[resolvedConsumerContext]
    || targetSpec.runtimeBaseUrl
    || targetSpec.baseUrl
    || spec.defaultBaseUrl;

  if (!resolvedBaseUrl) {
    throw new Error(`Local LLM base URL not configured for target ${target}`);
  }

  const healthCheck = targetSpec.healthCheck || { method: 'GET', path: '/models' };
  const apiKeyPolicy = normalizeApiKeyPolicy(targetSpec.apiKeyPolicy || spec.apiKeyPolicy);
  const apiKey = apiKeyPolicy === 'placeholder'
    ? (targetSpec.placeholderApiKey || spec.placeholderApiKey || 'ollama')
    : null;

  return {
    runtime: normalizeRuntimeName(runtime),
    providerFamily: spec.providerFamily,
    target,
    consumer,
    consumerContext: resolvedConsumerContext,
    baseUrl: resolvedBaseUrl,
    healthUrl: joinEndpoint(resolvedBaseUrl, healthCheck.path || '/models'),
    healthCheck: {
      method: healthCheck.method || 'GET',
      path: healthCheck.path || '/models',
    },
    apiKeyPolicy,
    apiKey,
    model: model || null,
    consumerSpec,
    localLlm: spec,
  };
}

export function renderConsumerEnv(config, model = null) {
  if (!config.consumerSpec?.env) {
    throw new Error(`No env mapping configured for consumer: ${config.consumer || '(none)'}`);
  }

  const resolvedModel = model || config.model || '<model-tag>';
  const replacements = {
    '{{baseUrl}}': config.baseUrl,
    '{{apiKey}}': config.apiKey || '',
    '{{model}}': resolvedModel,
    '<model-tag>': resolvedModel,
  };

  return Object.fromEntries(
    Object.entries(config.consumerSpec.env).map(([key, value]) => {
      let rendered = String(value);
      for (const [token, replacement] of Object.entries(replacements)) {
        rendered = rendered.split(token).join(replacement);
      }
      return [key, rendered];
    }),
  );
}

export async function queryOpenAICompatibleModels(config, options = {}) {
  const fetchImpl = options.fetchImpl || globalThis.fetch;
  const timeoutMs = Number(options.timeoutMs || DEFAULT_TIMEOUT_MS);
  if (typeof fetchImpl !== 'function') {
    throw new Error('fetch is not available in this Node.js runtime');
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetchImpl(config.healthUrl, {
      method: config.healthCheck.method,
      headers: {
        accept: 'application/json',
      },
      signal: controller.signal,
    });

    let body = null;
    try {
      body = await response.json();
    } catch {
      body = null;
    }

    if (!response.ok) {
      return {
        available: false,
        statusCode: response.status,
        models: [],
        error: `HTTP ${response.status}`,
      };
    }

    return {
      available: true,
      statusCode: response.status,
      models: extractModelIds(body),
      error: null,
    };
  } catch (error) {
    const message = error?.name === 'AbortError'
      ? `Timed out after ${timeoutMs}ms`
      : error.message;
    return {
      available: false,
      statusCode: null,
      models: [],
      error: message,
    };
  } finally {
    clearTimeout(timeout);
  }
}

export async function loadLocalLlmRuntime(runtimeName, deps = {}) {
  const runtime = normalizeRuntimeName(runtimeName);
  const getPackageImpl = deps.getPackage || getPackage;
  const getManifestImpl = deps.getManifest || getManifest;
  const pkg = await getPackageImpl(`runtime:${runtime}`);
  if (!pkg) {
    throw new Error(`Runtime not found in registry: runtime:${runtime}`);
  }

  const manifest = await getManifestImpl(pkg);
  const merged = manifest ? { ...pkg, ...manifest, kind: pkg.kind || manifest.kind } : pkg;
  const localLlm = merged.meta?.localLlm;
  if (!localLlm) {
    throw new Error(`Runtime does not declare meta.localLlm: runtime:${runtime}`);
  }

  return {
    runtime,
    package: merged,
    localLlm,
  };
}

export async function resolveLocalLlmRuntimeConfig(options = {}, deps = {}) {
  const runtimeInfo = await loadLocalLlmRuntime(options.runtime, deps);
  return resolveLocalLlmConfig({
    runtime: runtimeInfo.runtime,
    localLlm: runtimeInfo.localLlm,
    target: options.target,
    consumer: options.consumer,
    consumerContext: options.consumerContext,
    model: options.model,
    baseUrl: options.baseUrl,
  });
}

export async function getLocalLlmStatus(options = {}, deps = {}) {
  const config = await resolveLocalLlmRuntimeConfig(options, deps);
  const health = await queryOpenAICompatibleModels(config, {
    timeoutMs: options.timeoutMs,
    fetchImpl: options.fetchImpl || deps.fetchImpl,
  });

  const result = {
    runtime: config.runtime,
    providerFamily: config.providerFamily,
    target: config.target,
    consumer: config.consumer,
    consumerContext: config.consumerContext,
    baseUrl: config.baseUrl,
    healthUrl: config.healthUrl,
    apiKeyPolicy: config.apiKeyPolicy,
    available: health.available,
    statusCode: health.statusCode,
    models: health.models,
    error: health.error,
  };

  return requireValidResult('local LLM runtime status', result, validateLocalLlmRuntimeStatus(result));
}

export async function getLocalLlmEnvExport(options = {}, deps = {}) {
  const config = await resolveLocalLlmRuntimeConfig(options, deps);
  const result = {
    runtime: config.runtime,
    providerFamily: config.providerFamily,
    target: config.target,
    consumer: config.consumer,
    consumerContext: config.consumerContext,
    baseUrl: config.baseUrl,
    env: renderConsumerEnv(config, options.model),
  };

  return requireValidResult('local LLM env export', result, validateLocalLlmEnvExport(result));
}
