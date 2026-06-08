/**
 * Local LLM command.
 *
 * The runtime broker behavior lives in the daemon operation layer. This command
 * is a thin terminal adapter over that contract.
 */

import {
  extractModelIds,
  getLocalLlmEnvExport,
  getLocalLlmStatus,
  joinEndpoint,
  normalizeLocalLlmSpec,
  normalizeRuntimeName,
  queryOpenAICompatibleModels,
  renderConsumerEnv,
  resolveLocalLlmConfig,
} from '../daemon/operations/local-llm.js';
import {
  readSidecarInfo,
  sidecarRequest,
} from './sidecar-client.js';

export {
  extractModelIds,
  joinEndpoint,
  normalizeLocalLlmSpec,
  queryOpenAICompatibleModels,
  renderConsumerEnv,
  resolveLocalLlmConfig,
};

const DEFAULT_RUNTIME = 'ollama';
const DEFAULT_TARGET = 'mac_host';
const DEFAULT_TIMEOUT_MS = 5000;
const SIDECAR_TIMEOUT_BUFFER_MS = 1000;

function parseTimeout(flags) {
  const value = flags.timeout || flags['timeout-ms'];
  if (!value) return DEFAULT_TIMEOUT_MS;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error(`Invalid timeout: ${value}`);
  }
  return parsed;
}

function printStatus(status) {
  console.log(`Local LLM runtime: ${status.runtime}`);
  console.log(`Provider family: ${status.providerFamily}`);
  console.log(`Target: ${status.target}`);
  console.log(`Consumer context: ${status.consumerContext}`);
  console.log(`Endpoint: ${status.baseUrl}`);
  console.log(`Status: ${status.available ? 'available' : 'unavailable'}`);
  if (status.error) {
    console.log(`Error: ${status.error}`);
  }
  if (status.models.length > 0) {
    console.log(`Models: ${status.models.join(', ')}`);
  }
}

function printModels(status) {
  if (!status.available) {
    console.error(`Local LLM unavailable: ${status.error}`);
    process.exit(1);
  }

  if (status.models.length === 0) {
    console.log('No models reported by runtime.');
    return;
  }

  for (const model of status.models) {
    console.log(model);
  }
}

function printEnv(env) {
  for (const [key, value] of Object.entries(env)) {
    console.log(`${key}=${value}`);
  }
}

function appendQuery(pathname, entries) {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(entries)) {
    if (value !== null && value !== undefined && value !== '') {
      query.set(key, String(value));
    }
  }
  const suffix = query.toString();
  return suffix ? `${pathname}?${suffix}` : pathname;
}

export function buildLocalLlmSidecarPath(subcommand, options = {}) {
  const query = {
    runtime: options.runtime || DEFAULT_RUNTIME,
    target: options.target || DEFAULT_TARGET,
    context: options.consumerContext || null,
    model: options.model || null,
    baseUrl: options.baseUrl || null,
    timeoutMs: options.timeoutMs || null,
  };

  if (subcommand === 'env') {
    const consumer = encodeURIComponent(options.consumer || 'content-engine');
    return appendQuery(`/local-llm/env/${consumer}`, query);
  }
  if (subcommand === 'models') {
    return appendQuery('/local-llm/models', query);
  }
  return appendQuery('/local-llm/status', {
    ...query,
    consumer: options.consumer || null,
  });
}

function canFallbackFromSidecarError(error) {
  if (error?.code?.startsWith?.('SIDECAR_')) return true;
  if (error?.name === 'AbortError') return true;
  if (error?.statusCode === 404) return true;
  const message = String(error?.message || '');
  if (
    message.includes('Runtime does not declare meta.localLlm')
    || message.includes('Runtime not found in registry')
  ) {
    return true;
  }
  return message.includes('fetch failed')
    || message.includes('ECONNREFUSED')
    || message.includes('ECONNRESET')
    || message.includes('socket hang up');
}

async function getDirectLocalLlmModels(options, deps) {
  const status = await getLocalLlmStatus(options, deps);
  return {
    runtime: status.runtime,
    target: status.target,
    consumerContext: status.consumerContext,
    available: status.available,
    models: status.models,
    error: status.error,
  };
}

async function getDirectLocalLlmResult(subcommand, options, deps) {
  if (subcommand === 'env') {
    return getLocalLlmEnvExport(options, deps);
  }
  if (subcommand === 'models') {
    return getDirectLocalLlmModels(options, deps);
  }
  return getLocalLlmStatus(options, deps);
}

async function getSidecarLocalLlmResult(subcommand, options, deps) {
  const readInfo = deps.readSidecarInfo || readSidecarInfo;
  const request = deps.sidecarRequest || sidecarRequest;
  const sidecar = readInfo(deps);
  const pathname = buildLocalLlmSidecarPath(subcommand, options);
  const requestTimeoutMs = Math.max(
    Number(options.timeoutMs || DEFAULT_TIMEOUT_MS) + SIDECAR_TIMEOUT_BUFFER_MS,
    1500,
  );

  return request({
    ...sidecar,
    pathname,
    timeoutMs: requestTimeoutMs,
  });
}

export async function resolveLocalLlmCommandResult(subcommand, options, deps = {}) {
  if (deps.useSidecar !== false) {
    try {
      return {
        source: 'sidecar',
        result: await getSidecarLocalLlmResult(subcommand, options, deps),
      };
    } catch (error) {
      if (!canFallbackFromSidecarError(error)) {
        throw error;
      }
    }
  }

  return {
    source: 'direct',
    result: await getDirectLocalLlmResult(subcommand, options, deps),
  };
}

export async function cmdLocalLlm(args, flags, deps = {}) {
  const subcommand = args[0] || 'status';
  const runtime = normalizeRuntimeName(flags.runtime || (subcommand === 'env' ? DEFAULT_RUNTIME : args[1]));
  const target = flags.target || DEFAULT_TARGET;
  const consumerContext = flags.context || flags['consumer-context'] || null;
  const model = flags.model || null;
  const baseUrl = flags['base-url'] || null;
  const timeoutMs = parseTimeout(flags);

  if (!['status', 'models', 'env'].includes(subcommand)) {
    console.error('Usage: rudi local-llm <status|models|env> [consumer] [options]');
    process.exit(1);
  }

  if (subcommand === 'env') {
    const consumer = args[1] || flags.consumer || 'content-engine';
    const { result } = await resolveLocalLlmCommandResult(subcommand, {
      runtime,
      target,
      consumer,
      consumerContext,
      model,
      baseUrl,
    }, deps);

    if (flags.json) {
      console.log(JSON.stringify(result, null, 2));
      return;
    }
    printEnv(result.env);
    return;
  }

  const { result: status } = await resolveLocalLlmCommandResult(subcommand, {
    runtime,
    target,
    consumer: flags.consumer || null,
    consumerContext,
    model,
    baseUrl,
    timeoutMs,
  }, deps);

  if (flags.json) {
    console.log(JSON.stringify(status, null, 2));
    return;
  }

  if (subcommand === 'models') {
    printModels(status);
    return;
  }

  printStatus(status);
}
