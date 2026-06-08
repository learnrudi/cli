import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  buildLocalLlmSidecarPath,
  resolveLocalLlmCommandResult,
} from '../../commands/local-llm.js';
import {
  extractModelIds,
  getLocalLlmEnvExport,
  getLocalLlmStatus,
  joinEndpoint,
  normalizeLocalLlmSpec,
  queryOpenAICompatibleModels,
  renderConsumerEnv,
  resolveLocalLlmConfig,
} from '../../daemon/operations/local-llm.js';

const flatLocalLlm = {
  openaiCompatible: true,
  defaultBaseUrl: 'http://localhost:11434/v1',
  dockerHostBaseUrl: 'http://host.docker.internal:11434/v1',
  apiKeyPolicy: 'placeholder-accepted',
  placeholderApiKey: 'ollama',
  modelsEndpoint: '/models',
  consumerEnv: {
    contentEngine: {
      ENABLE_LLM: 'true',
      ENABLE_LOCAL_LLM: 'true',
      LOCAL_LLM_PROVIDER: 'local',
      LOCAL_LLM_BASE_URL: 'http://host.docker.internal:11434/v1',
      LOCAL_LLM_API_KEY: 'ollama',
      LOCAL_LLM_MODEL: '<model-tag>',
    },
  },
};

const targetLocalLlm = {
  providerFamily: 'openai_compatible',
  targets: {
    mac_host: {
      runtimeBaseUrl: 'http://localhost:11434/v1',
      consumerUrls: {
        host_process: 'http://localhost:11434/v1',
        docker_container: 'http://host.docker.internal:11434/v1',
      },
      healthCheck: {
        method: 'GET',
        path: '/models',
      },
      apiKeyPolicy: 'placeholder',
      placeholderApiKey: 'ollama',
    },
  },
  consumers: {
    'content-engine': {
      defaultConsumerContext: 'docker_container',
      env: {
        ENABLE_LLM: 'true',
        ENABLE_LOCAL_LLM: 'true',
        LOCAL_LLM_PROVIDER: 'local',
        LOCAL_LLM_BASE_URL: '{{baseUrl}}',
        LOCAL_LLM_API_KEY: '{{apiKey}}',
        LOCAL_LLM_MODEL: '{{model}}',
      },
    },
  },
};

test('joinEndpoint preserves OpenAI-compatible base path', () => {
  assert.equal(
    joinEndpoint('http://localhost:11434/v1', '/models'),
    'http://localhost:11434/v1/models',
  );
});

test('normalizeLocalLlmSpec creates target and content-engine consumer from flat metadata', () => {
  const normalized = normalizeLocalLlmSpec(flatLocalLlm);

  assert.equal(normalized.providerFamily, 'openai_compatible');
  assert.equal(
    normalized.targets.mac_host.consumerUrls.docker_container,
    'http://host.docker.internal:11434/v1',
  );
  assert.equal(
    normalized.consumers['content-engine'].env.LOCAL_LLM_API_KEY,
    'ollama',
  );
});

test('resolveLocalLlmConfig resolves docker URL for content-engine consumer', () => {
  const resolved = resolveLocalLlmConfig({
    runtime: 'ollama',
    localLlm: targetLocalLlm,
    target: 'mac_host',
    consumer: 'content-engine',
    model: 'llama3.2:3b',
  });

  assert.equal(resolved.baseUrl, 'http://host.docker.internal:11434/v1');
  assert.equal(resolved.healthUrl, 'http://host.docker.internal:11434/v1/models');
  assert.equal(resolved.apiKey, 'ollama');

  const env = renderConsumerEnv(resolved);
  assert.deepEqual(env, {
    ENABLE_LLM: 'true',
    ENABLE_LOCAL_LLM: 'true',
    LOCAL_LLM_PROVIDER: 'local',
    LOCAL_LLM_BASE_URL: 'http://host.docker.internal:11434/v1',
    LOCAL_LLM_API_KEY: 'ollama',
    LOCAL_LLM_MODEL: 'llama3.2:3b',
  });
});

test('resolveLocalLlmConfig defaults status checks to host process URL', () => {
  const resolved = resolveLocalLlmConfig({
    runtime: 'runtime:ollama',
    localLlm: targetLocalLlm,
    target: 'mac_host',
  });

  assert.equal(resolved.runtime, 'ollama');
  assert.equal(resolved.consumerContext, 'host_process');
  assert.equal(resolved.baseUrl, 'http://localhost:11434/v1');
});

test('queryOpenAICompatibleModels normalizes OpenAI model responses', async () => {
  const config = resolveLocalLlmConfig({
    runtime: 'ollama',
    localLlm: targetLocalLlm,
  });
  const calls = [];
  const result = await queryOpenAICompatibleModels(config, {
    fetchImpl: async (url, options) => {
      calls.push({ url, options });
      return {
        ok: true,
        status: 200,
        async json() {
          return {
            object: 'list',
            data: [
              { id: 'qwen2.5:3b' },
              { id: 'llama3.2:3b' },
            ],
          };
        },
      };
    },
  });

  assert.equal(calls[0].url, 'http://localhost:11434/v1/models');
  assert.equal(result.available, true);
  assert.deepEqual(result.models, ['llama3.2:3b', 'qwen2.5:3b']);
});

test('extractModelIds supports native models arrays', () => {
  assert.deepEqual(
    extractModelIds({ models: [{ name: 'nomic-embed-text' }, { model: 'custom' }] }),
    ['custom', 'nomic-embed-text'],
  );
});

test('getLocalLlmStatus loads registry metadata and returns schema-backed daemon status', async () => {
  const status = await getLocalLlmStatus({
    runtime: 'ollama',
    timeoutMs: 100,
  }, {
    getPackage: async (id) => ({ id, kind: 'runtime', name: 'ollama' }),
    getManifest: async () => ({ meta: { localLlm: targetLocalLlm } }),
    fetchImpl: async () => ({
      ok: true,
      status: 200,
      async json() {
        return { data: [{ id: 'qwen2.5:3b' }] };
      },
    }),
  });

  assert.deepEqual(status, {
    runtime: 'ollama',
    providerFamily: 'openai_compatible',
    target: 'mac_host',
    consumer: null,
    consumerContext: 'host_process',
    baseUrl: 'http://localhost:11434/v1',
    healthUrl: 'http://localhost:11434/v1/models',
    apiKeyPolicy: 'placeholder',
    available: true,
    statusCode: 200,
    models: ['qwen2.5:3b'],
    error: null,
  });
});

test('getLocalLlmEnvExport returns consumer-specific daemon env export', async () => {
  const result = await getLocalLlmEnvExport({
    runtime: 'runtime:ollama',
    consumer: 'content-engine',
    model: 'llama3.2:3b',
  }, {
    getPackage: async (id) => ({ id, kind: 'runtime', name: 'ollama' }),
    getManifest: async () => ({ meta: { localLlm: targetLocalLlm } }),
  });

  assert.equal(result.consumer, 'content-engine');
  assert.equal(result.consumerContext, 'docker_container');
  assert.equal(result.baseUrl, 'http://host.docker.internal:11434/v1');
  assert.equal(result.env.LOCAL_LLM_MODEL, 'llama3.2:3b');
});

test('buildLocalLlmSidecarPath targets the daemon broker routes', () => {
  assert.equal(
    buildLocalLlmSidecarPath('env', {
      runtime: 'ollama',
      target: 'mac_host',
      consumer: 'content-engine',
      consumerContext: 'docker_container',
      model: 'llama3.2:3b',
    }),
    '/local-llm/env/content-engine?runtime=ollama&target=mac_host&context=docker_container&model=llama3.2%3A3b',
  );
  assert.equal(
    buildLocalLlmSidecarPath('models', { runtime: 'ollama', timeoutMs: 750 }),
    '/local-llm/models?runtime=ollama&target=mac_host&timeoutMs=750',
  );
});

test('resolveLocalLlmCommandResult uses sidecar when it is available', async () => {
  const calls = [];
  let directCalled = false;

  const { source, result } = await resolveLocalLlmCommandResult('status', {
    runtime: 'ollama',
    target: 'mac_host',
    timeoutMs: 500,
  }, {
    readSidecarInfo: () => ({ port: 8123, token: 'secret-token' }),
    sidecarRequest: async (request) => {
      calls.push(request);
      return {
        runtime: 'ollama',
        providerFamily: 'openai_compatible',
        target: 'mac_host',
        consumer: null,
        consumerContext: 'host_process',
        baseUrl: 'http://localhost:11434/v1',
        healthUrl: 'http://localhost:11434/v1/models',
        apiKeyPolicy: 'placeholder',
        available: true,
        statusCode: 200,
        models: ['qwen2.5:3b'],
        error: null,
      };
    },
    getPackage: async () => {
      directCalled = true;
      return null;
    },
  });

  assert.equal(source, 'sidecar');
  assert.equal(directCalled, false);
  assert.equal(calls[0].port, 8123);
  assert.equal(calls[0].token, 'secret-token');
  assert.equal(calls[0].pathname, '/local-llm/status?runtime=ollama&target=mac_host&timeoutMs=500');
  assert.equal(calls[0].timeoutMs, 1500);
  assert.deepEqual(result.models, ['qwen2.5:3b']);
});

test('resolveLocalLlmCommandResult falls back to direct operation when sidecar is absent', async () => {
  const { source, result } = await resolveLocalLlmCommandResult('models', {
    runtime: 'ollama',
    timeoutMs: 100,
  }, {
    readSidecarInfo: () => {
      const error = new Error('not running');
      error.code = 'SIDECAR_NOT_RUNNING';
      throw error;
    },
    getPackage: async (id) => ({ id, kind: 'runtime', name: 'ollama' }),
    getManifest: async () => ({ meta: { localLlm: targetLocalLlm } }),
    fetchImpl: async () => ({
      ok: true,
      status: 200,
      async json() {
        return { data: [{ id: 'llama3.2:3b' }] };
      },
    }),
  });

  assert.equal(source, 'direct');
  assert.deepEqual(result, {
    runtime: 'ollama',
    target: 'mac_host',
    consumerContext: 'host_process',
    available: true,
    models: ['llama3.2:3b'],
    error: null,
  });
});

test('resolveLocalLlmCommandResult falls back when running sidecar lacks local LLM metadata', async () => {
  const { source, result } = await resolveLocalLlmCommandResult('env', {
    runtime: 'ollama',
    consumer: 'content-engine',
    model: 'llama3.2:3b',
  }, {
    readSidecarInfo: () => ({ port: 8123, token: 'secret-token' }),
    sidecarRequest: async () => {
      const error = new Error('Runtime does not declare meta.localLlm: runtime:ollama');
      error.statusCode = 400;
      throw error;
    },
    getPackage: async (id) => ({ id, kind: 'runtime', name: 'ollama' }),
    getManifest: async () => ({ meta: { localLlm: targetLocalLlm } }),
  });

  assert.equal(source, 'direct');
  assert.equal(result.env.LOCAL_LLM_BASE_URL, 'http://host.docker.internal:11434/v1');
  assert.equal(result.env.LOCAL_LLM_MODEL, 'llama3.2:3b');
});

test('resolveLocalLlmCommandResult does not hide reachable sidecar request failures', async () => {
  let directCalled = false;

  await assert.rejects(
    () => resolveLocalLlmCommandResult('status', { runtime: 'ollama' }, {
      readSidecarInfo: () => ({ port: 8123, token: 'secret-token' }),
      sidecarRequest: async () => {
        const error = new Error('Invalid runtime target');
        error.statusCode = 400;
        throw error;
      },
      getPackage: async () => {
        directCalled = true;
        return { id: 'runtime:ollama' };
      },
    }),
    /Invalid runtime target/,
  );

  assert.equal(directCalled, false);
});
