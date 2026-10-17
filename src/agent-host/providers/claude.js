import { claudeSandboxPlan } from '../task-claude-sandbox.js';
import { buildArgs } from './catalog.js';
import { taskClaudeArgs, taskClaudeEnvironment } from '../task-claude.js';
import {
  buildPrivateProviderEnvironment,
  finishPlan,
  permissionArgs,
  providerContext,
  validateImages,
} from './common.js';

export function buildClaudePlan(options) {
  const context = providerContext(options, 'claude');
  if (context.taskProfile) {
    if ((options.extraArgs || []).length || (options.images || []).length
        || options.approvalMode != null || options.permissionMode != null || options.privateAutomationProfile) {
      throw new Error('task execution forbids permission overrides, images, private profiles and passthrough arguments');
    }
    return claudeSandboxPlan(context, finishPlan(context, taskClaudeArgs(context), 'registered-shared', taskClaudeEnvironment(context.binaryPath, context.taskProfile)));
  }
  if (context.privateAutomationProfile) {
    if ((options.extraArgs || []).length > 0 || (options.images || []).length > 0) {
      throw new Error('private automation forbids Claude passthrough arguments and images');
    }
    if (options.approvalMode != null) {
      throw new Error('private automation forbids Claude approval overrides');
    }
    if (options.permissionMode != null && options.permissionMode !== 'plan') {
      throw new Error('private automation requires Claude plan permission mode');
    }
    const args = [
      '--output-format', 'stream-json',
      '--verbose',
      '--print',
      '--input-format', 'text',
      '--model', context.model,
      '--no-session-persistence',
      '--safe-mode',
      '--no-chrome',
      '--disable-slash-commands',
      '--tools', '',
      '--strict-mcp-config',
      '--mcp-config', '{"mcpServers":{}}',
      '--setting-sources', '',
      '--permission-mode', 'plan',
    ];
    const environment = buildPrivateProviderEnvironment(
      context.config,
      context.binaryPath,
    );
    return finishPlan(context, args, 'plan', {
      ...environment,
      CLAUDE_CODE_AUTO_MODE_MODEL: context.model,
      CLAUDE_CODE_BG_CLASSIFIER_MODEL: context.model,
      CLAUDE_CODE_DISABLE_AUTO_MEMORY: '1',
      CLAUDE_CODE_DISABLE_BACKGROUND_TASKS: '1',
      CLAUDE_CODE_DISABLE_BUNDLED_SKILLS: '1',
      CLAUDE_CODE_DISABLE_CLAUDE_API_SKILL: '1',
      CLAUDE_CODE_DISABLE_CLAUDE_CODE_SKILL: '1',
      CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: '1',
      CLAUDE_CODE_DISABLE_WORKFLOWS: '1',
      CLAUDE_CODE_ENABLE_PROMPT_SUGGESTION: '0',
      CLAUDE_CODE_ENABLE_TELEMETRY: '0',
      CLAUDE_CODE_NO_MODEL_FALLBACK: '1',
      CLAUDE_CODE_SIMPLE_SYSTEM_PROMPT: '1',
      CLAUDE_CODE_SUBAGENT_MODEL: context.model,
    });
  }
  const images = validateImages(options.images);
  if (images.length > 0) {
    throw new Error('Claude local image attachments are not exposed as a headless CLI flag; reference a readable workspace file in the prompt');
  }
  const permission = permissionArgs(context, options.permissionMode);
  const args = buildArgs(context.config, {
    model: context.model,
    print: true,
    prompt: context.prompt,
    resumeSessionId: context.nativeSessionId,
  });
  args.push(...permission.args, ...context.extraArgs);
  return finishPlan(context, args, permission.mode);
}
