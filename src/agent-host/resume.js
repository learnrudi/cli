import fs from 'node:fs';
import path from 'node:path';

import {
  appendLaunchEvent,
  createLaunchOwnershipMarker,
  getAgentHostPaths,
  getLaunchArtifactFiles,
} from './artifacts.js';
import { executeForegroundLaunch } from './events/stream.js';
import { createLaunchId } from './launch.js';
import { createLaunchStore } from './launch-store.js';
import { assertAgentHostReady } from './preflight.js';
import {
  buildProviderProcessPlan,
  getMissingAgentProviderMessage,
  resolveAgentProviderBinary,
} from './providers/index.js';

function assertWorkspaceStillExists(workspace) {
  try {
    if (fs.statSync(workspace).isDirectory()) return;
  } catch {}
  throw new Error(`Execution workspace no longer exists: ${workspace}`);
}

export async function resumeAgent(options, dependencies = {}) {
  const ownsStore = !dependencies.store;
  const store = dependencies.store || createLaunchStore();
  try {
    return await resumeAgentWithStore(options, { ...dependencies, store });
  } finally {
    if (ownsStore) store.close();
  }
}

async function resumeAgentWithStore(options, dependencies) {
  const {
    artifactsRoot = getAgentHostPaths().artifactsRoot,
    eventSink = null,
    idFactory = createLaunchId,
    ownerPid = null,
    onSpawn = null,
    preflightImpl = assertAgentHostReady,
    resolveBinaryImpl = resolveAgentProviderBinary,
    spawnImpl,
    stderr = process.stderr,
    stdout = process.stdout,
    signalEmitter = process,
    store,
  } = dependencies;

  const previous = store.get(options?.launchId);
  if (!previous) throw new Error(`Launch not found: ${options?.launchId}`);
  if (previous.workspaceMode === 'registered-shared') throw new Error('registered task launches require fresh sessions; resume is forbidden');
  if (previous.status === 'starting' || previous.status === 'running') {
    throw new Error(`Launch is still active: ${previous.launchId}`);
  }
  if (!previous.nativeSessionId) {
    throw new Error(`Launch has no native provider session ID and cannot be resumed: ${previous.launchId}`);
  }
  assertWorkspaceStillExists(previous.executionWorkspace);

  const launchId = idFactory();
  const binaryPath = resolveBinaryImpl(previous.provider);
  if (!binaryPath) {
    throw new Error(getMissingAgentProviderMessage(previous.provider));
  }
  await preflightImpl({ binaryPath, provider: previous.provider });
  const outputDestination = dependencies.artifactsRoot
    ? path.resolve(artifactsRoot, launchId)
    : getAgentHostPaths({ launchId, rudiHome: dependencies.rudiHome }).launchDirectory;
  if (fs.existsSync(outputDestination)) {
    throw new Error(`Output destination already exists: ${outputDestination}`);
  }
  fs.mkdirSync(outputDestination, { recursive: true, mode: 0o700 });
  createLaunchOwnershipMarker({ launchDirectory: outputDestination, launchId });
  const resolvedEventSink = eventSink || (event => appendLaunchEvent(
    getLaunchArtifactFiles(outputDestination).events,
    event,
  ));

  let plan;
  try {
    plan = buildProviderProcessPlan({
      approvalMode: options.approvalMode,
      binaryPath,
      cwd: previous.executionWorkspace,
      extraArgs: options.extraArgs,
      images: options.images,
      model: options.model || previous.model,
      nativeSessionId: previous.nativeSessionId,
      permissionMode: options.permissionMode,
      prompt: options.prompt,
      provider: previous.provider,
      runtimeDirectory: outputDestination,
      workspaceMode: previous.workspaceMode,
    });
  } catch (error) {
    fs.rmSync(outputDestination, { recursive: true, force: true });
    throw error;
  }

  store.create({
    baseRef: previous.baseRef,
    executionKind: options.executionKind || 'foreground',
    executionWorkspace: previous.executionWorkspace,
    launchId,
    model: plan.model,
    nativeSessionId: previous.nativeSessionId,
    originDirectory: previous.originDirectory,
    ownerPid,
    outputDestination,
    parentLaunchId: previous.launchId,
    projectRoot: previous.projectRoot,
    provider: previous.provider,
    status: 'starting',
    workspaceMode: previous.workspaceMode,
    worktreeBranch: previous.worktreeBranch,
  });

  try {
    return await executeForegroundLaunch({
      eventSink: resolvedEventSink,
      jsonOutput: options.json === true,
      launchId,
      onSpawn,
      plan,
      spawnImpl,
      stderr,
      stdout,
      store,
      signalEmitter,
      timeoutMs: options.timeoutMs || plan.timeouts.runtimeMs,
    });
  } catch (error) {
    const current = store.get(launchId);
    if (current?.status === 'starting' || current?.status === 'running') {
      store.transition(launchId, 'failed', { lastError: error.message });
    }
    throw error;
  }
}
