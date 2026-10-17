import {
  buildArgs,
  buildSubcommandArgs,
} from './catalog.js';
import {
  finishPlan,
  permissionArgs,
  providerContext,
  validateImages,
} from './common.js';
import { taskCodexArgs, taskEnvironment } from '../task-codex.js';
import { getPrivateCodexDisabledFeatures } from '../private-automation-profile.js';

const APPROVAL_ALIASES = Object.freeze({
  onRequest: 'on-request',
  'on-request': 'on-request',
  never: 'never',
  untrusted: 'untrusted',
});

function approvalPolicy(value) {
  if (value == null) return null;
  const normalized = APPROVAL_ALIASES[value];
  if (!normalized) {
    throw new Error('Unknown approval mode for codex. Available: untrusted, on-request, never');
  }
  return normalized;
}

export function buildCodexPlan(options) {
  const context = providerContext(options, 'codex');
  if (context.taskProfile) {
    if ((options.extraArgs || []).length || (options.images || []).length || options.approvalMode || options.permissionMode) {
      throw new Error('task execution forbids permission overrides, images and passthrough arguments');
    }
    return finishPlan(context, taskCodexArgs(context), 'registered-shared', taskEnvironment(context.binaryPath, context.taskProfile));
  }
  if (context.privateAutomationProfile) {
    if ((options.extraArgs || []).length > 0 || (options.images || []).length > 0) {
      throw new Error('private automation forbids Codex passthrough arguments and images');
    }
    if (options.approvalMode != null && options.approvalMode !== 'never') {
      throw new Error('private automation requires Codex approval mode never');
    }
    if (options.permissionMode != null && !['readonly', 'read-only'].includes(options.permissionMode)) {
      throw new Error('private automation requires Codex read-only sandbox');
    }
    const disabledFeatures = getPrivateCodexDisabledFeatures();
    const args = ['--ask-for-approval', 'never'];
    for (const feature of disabledFeatures) args.push('--disable', feature);
    args.push(
      '-c', 'mcp_servers={}',
      '-c', 'web_search="disabled"',
      'exec', '-',
      '--json',
      '--skip-git-repo-check',
      '--color', 'never',
      '-C', context.cwd,
      '-m', context.model,
      '--output-schema', context.privateAutomationProfile.outputSchema.path,
      '--ephemeral',
      '--strict-config',
      '--ignore-user-config',
      '--ignore-rules',
      '-s', 'read-only',
    );
    return finishPlan(context, args, 'readonly');
  }
  const images = validateImages(options.images);
  const permission = permissionArgs(context, options.permissionMode);
  const approval = approvalPolicy(options.approvalMode);
  let args;

  if (context.nativeSessionId) {
    args = [];
    if (approval) args.push('--ask-for-approval', approval);
    args.push('-C', context.cwd, '-m', context.model, ...permission.args);
    args.push(...buildSubcommandArgs(context.config, 'resume', {
      image: images.length === 1 ? images[0] : null,
      prompt: context.prompt,
      sessionId: context.nativeSessionId,
    }));
    for (const image of images.slice(1)) args.push('-i', image);
    args.push('--json', ...context.extraArgs);
  } else {
    args = buildArgs(context.config, {
      approvalPolicy: approval,
      cwd: context.cwd,
      image: images.length > 0 ? images : null,
      model: context.model,
      prompt: context.prompt,
    });
    args.push(...permission.args, ...context.extraArgs);
  }

  return finishPlan(context, args, permission.mode);
}
