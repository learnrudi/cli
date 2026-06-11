import { execFileSync as defaultExecFileSync } from 'node:child_process';

function assertCommandValue(value, label) {
  if (typeof value !== 'string' || value.length === 0 || value.includes('\0')) {
    throw new Error(`Invalid command ${label}`);
  }
  return value;
}

export function createCommandPlan(command, args = []) {
  return {
    command: assertCommandValue(command, 'name'),
    args: Array.isArray(args)
      ? args.map((arg, index) => assertCommandValue(arg, `arg ${index}`))
      : [],
  };
}

export function createWhichCommand(commandName) {
  return createCommandPlan('which', [commandName]);
}

export function createGitCommand(cwd, args = []) {
  return {
    ...createCommandPlan('git', args),
    cwd: assertCommandValue(cwd, 'cwd'),
  };
}

export function runCommand(command, args = [], options = {}) {
  const { execFileSync = defaultExecFileSync, ...execOptions } = options;
  const plan = createCommandPlan(command, args);
  return execFileSync(plan.command, plan.args, execOptions);
}

export function runCommandPlan(plan, options = {}) {
  const { execFileSync = defaultExecFileSync, ...execOptions } = options;
  const normalized = createCommandPlan(plan?.command, plan?.args || []);
  const mergedOptions = plan?.cwd
    ? { cwd: assertCommandValue(plan.cwd, 'cwd'), ...execOptions }
    : execOptions;
  return execFileSync(normalized.command, normalized.args, mergedOptions);
}

export function runGit(cwd, args = [], options = {}) {
  const plan = createGitCommand(cwd, args);
  return runCommandPlan(plan, options);
}
