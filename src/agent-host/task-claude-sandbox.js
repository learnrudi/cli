import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { canonicalDirectory } from './task-profile.js';

// The native host needs its own account/session files and inference transport.
// Its file tools have a second, narrower boundary: only registered task roots.
export function claudeSandboxPolicy(binaryPath, profile, temporaryDirectory, homeDirectory = os.homedir()) {
  const account = profile.account;
  if (!account) throw new Error('Claude sandbox requires an explicit account');
  const read = ['/System', '/usr/lib', '/usr/bin', '/usr/sbin', '/usr/share', '/bin', '/sbin', '/dev',
    '/Library/Apple', '/Library/Preferences', '/private/etc', '/private/var/db/timezone',
    `/private/var/db/mds/messages/${process.getuid()}`, binaryPath,
    account.config_directory, account.anthropic_directory, temporaryDirectory,
    ...profile.read_roots, ...profile.write_roots];
  const write = [account.config_directory, account.anthropic_directory, temporaryDirectory, ...profile.write_roots];
  const subpaths = values => [...new Set(values)].map(value => `(subpath ${JSON.stringify(value)})`).join('');
  // Bun opens the root and HOME directories themselves during startup. These
  // literal exceptions permit directory enumeration, not reading their files.
  const directories = new Set(['/', path.dirname(binaryPath), path.dirname(account.config_directory),
    path.join(homeDirectory,'.CFUserTextEncoding')]);
  for (let cursor = homeDirectory; cursor !== path.dirname(cursor); cursor = path.dirname(cursor)) directories.add(cursor);
  return '(version 1)(allow default)(deny system-audit)(deny signal)(allow signal (target self))'
    + '(deny file-read-data)(deny file-write*)'
    + `(allow file-read-data ${subpaths(read)}${[...directories].map(value => `(literal ${JSON.stringify(value)})`).join('')})`
    + `(allow file-write* (literal "/dev/null")${subpaths(write)})`;
}

export function claudeSandboxPlan(context, plan) {
  const temporaryDirectory = path.join(canonicalDirectory(context.runtimeDirectory, 'Claude runtime'), 'native-tmp');
  fs.mkdirSync(temporaryDirectory, {mode:0o700});
  canonicalDirectory(temporaryDirectory, 'Claude temporary directory');
  return Object.freeze({...plan,
    args: ['-p', claudeSandboxPolicy(context.binaryPath,context.taskProfile,temporaryDirectory), context.binaryPath, ...plan.args],
    spawn: Object.freeze({command:'/usr/bin/sandbox-exec',cwd:context.cwd}),
    environment: {...plan.environment,TMPDIR:temporaryDirectory,CLAUDE_CODE_TMPDIR:temporaryDirectory},
  });
}
