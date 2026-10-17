import crypto from 'node:crypto';

import {
  appendLaunchEvent,
  getAgentHostPaths,
  getLaunchArtifactFiles,
} from './artifacts.js';
import { executeForegroundLaunch } from './events/stream.js';
import { createLaunchStore } from './launch-store.js';
import { assertAgentHostReady } from './preflight.js';
import {
  buildProviderProcessPlan,
  getMissingAgentProviderMessage,
  resolveAgentProviderBinary,
  resolveAgentProviderId,
} from './providers/index.js';
import {
  cleanupUnstartedWorkspace,
  resolveAgentWorkspace,
} from './workspace.js';
import { assertTaskHostCapabilities } from './task-provider.js';
import { assertTaskProfile, assertWritableTaskRoots } from './task-profile.js';
import { assertPrivateAutomationHostCapabilities } from './private-automation-profile.js';

export function createLaunchId() {
  return `launch_${crypto.randomUUID().replaceAll('-', '')}`;
}

export async function launchAgent(options, dependencies = {}) {
  const {
    artifactsRoot = getAgentHostPaths().artifactsRoot,
    eventSink = null,
    idFactory = createLaunchId,
    ownerPid = null,
    onSpawn = null,
    preflightImpl = assertAgentHostReady,
    privatePreflightImpl = assertPrivateAutomationHostCapabilities,
    taskPreflightImpl = assertTaskHostCapabilities,
    resolveBinaryImpl = resolveAgentProviderBinary,
    spawnImpl,
    taskStop,
    stderr = process.stderr,
    stdout = process.stdout,
    signalEmitter = process,
    workspaceResolver = resolveAgentWorkspace,
  } = dependencies;

  const launchId = idFactory();
  const privateAutomationProfile = options?.privateAutomationProfile || null;
  if (privateAutomationProfile && options?.executionKind && options.executionKind !== 'foreground') {
    throw new Error('private automation supports foreground execution only');
  }
  const taskProfile = options?.taskProfile || null;
  if (taskProfile) {
    assertTaskProfile(taskProfile);
    if (options.executionKind && options.executionKind !== "foreground") throw new Error("task execution is foreground only");
  }
  const provider = resolveAgentProviderId(options?.provider);
  const binaryPath = resolveBinaryImpl(provider);
  if (!binaryPath) {
    throw new Error(getMissingAgentProviderMessage(provider));
  }
  if (!taskProfile || provider !== 'claude') await preflightImpl({ binaryPath, provider });
  if (privateAutomationProfile) {
    await privatePreflightImpl({ binaryPath, profile: privateAutomationProfile });
  }

  const taskCapabilities = taskProfile ? await taskPreflightImpl({ binaryPath, profile: taskProfile }) : null;

  const workspace = workspaceResolver({
    artifactsRoot,
    launchId,
    mode: options.workspaceMode || 'auto',
    originDirectory: options.originDirectory || process.cwd(),
    outputDirectory: options.outputDirectory || null,
    privateAutomation: privateAutomationProfile != null,
    taskProfile,
    workspace: options.workspace || null,
  });
  const resolvedEventSink = eventSink || (event => appendLaunchEvent(
    getLaunchArtifactFiles(workspace.outputDestination).events,
    event,
  ));
  let plan;
  try {
    plan = buildProviderProcessPlan({
      approvalMode: options.approvalMode,
      binaryPath,
      cwd: workspace.executionWorkspace,
      extraArgs: options.extraArgs,
      images: options.images,
      model: options.model,
      permissionMode: options.permissionMode,
      privateAutomationProfile,
      taskProfile,
      prompt: options.prompt,
      provider,
      runtimeDirectory: workspace.outputDestination,
      workspaceMode: workspace.mode,
    });
  } catch (error) {
    cleanupUnstartedWorkspace(workspace);
    throw error;
  }

  const ownsStore = !dependencies.store;
  const store = dependencies.store || createLaunchStore();
  try {
    store.create({
      baseRef: workspace.baseRef,
      executionKind: options.executionKind || 'foreground',
      executionWorkspace: workspace.executionWorkspace,
      launchId,
      model: plan.model,
      originDirectory: workspace.originDirectory,
      ownerPid,
      outputDestination: workspace.outputDestination,
      projectRoot: workspace.projectRoot,
      provider,
      status: 'starting',
      workspaceMode: workspace.mode,
      worktreeBranch: workspace.worktreeBranch,
    });

    if (taskProfile) assertWritableTaskRoots(taskProfile);
    const result = await executeForegroundLaunch({
      eventSink: resolvedEventSink,
      jsonOutput: options.json === true,
      launchId,
      onSpawn: onSpawn ? value => onSpawn({...value, taskAccount: taskCapabilities?.account || null}) : null,
      plan,
      spawnImpl,
        taskStop,
      stderr,
      stdout,
      store,
      signalEmitter,
      timeoutMs: taskProfile?.timeout_ms || options.timeoutMs || plan.timeouts.runtimeMs,
    });
    return taskProfile ? {...result, taskAccount: taskCapabilities?.account || null} : result;
  } catch (error) {
    const current = store.get(launchId);
    if (current?.status === 'starting' || current?.status === 'running') {
      store.transition(launchId, 'failed', { lastError: error.message });
    } else if (!current) {
      cleanupUnstartedWorkspace(workspace);
    }
    throw error;
  } finally {
    if (ownsStore) store.close();
  }
}
