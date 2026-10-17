import { assertTaskProfile } from './task-profile.js';
import { assertClaudeTaskCapabilities } from './task-claude-capabilities.js';
import { assertTaskHostCapabilities as assertCodexCapabilities } from './task-codex.js';

export function assertTaskProviderQualified(profile) {
  assertTaskProfile(profile);
  if (!['codex','claude'].includes(profile.provider)) throw new Error('unsupported task provider');
}

export function assertTaskHostCapabilities(context, dependencies) {
  assertTaskProviderQualified(context.profile);
  return context.profile.provider === 'claude' ? assertClaudeTaskCapabilities(context,dependencies) : assertCodexCapabilities(context, dependencies);
}
