#!/usr/bin/env node
// No inference or credentials: prove the generated policy using the native sandbox.
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { taskPermissionArgs, TASK_CODEX_VERSION } from '../src/agent-host/task-codex.js';
import { validateTaskProfile } from '../src/agent-host/task-profile.js';

const [binary, outputRoot] = process.argv.slice(2);
if (!binary || !outputRoot) throw new Error('Usage: node scripts/verify-task-permissions.mjs <codex> <artifact-root>');
const root = fs.realpathSync(fs.mkdtempSync(path.join(outputRoot, 'native-permissions-')));
for (const dir of ['project', 'out', 'control', 'home']) fs.mkdirSync(path.join(root, dir));
fs.writeFileSync(path.join(root, 'project', 'dirty.txt'), 'dirty-input');
fs.writeFileSync(path.join(root, 'project', 'untracked.txt'), 'untracked-input');

const profile = validateTaskProfile({ schema_version: 1, provider: 'codex', model: 'gpt-5.6-sol',
  workspace_mode: 'registered-shared', working_directory: path.join(root, 'project'),
  read_roots: [path.join(root, 'project')], write_roots: [path.join(root, 'out')], network: 'disabled', timeout_ms: 1000 },
{ working_directory: path.join(root, 'project'), outputs: { deliverables: [path.join(root, 'out')], runtime: path.join(root, 'control') } });
fs.symlinkSync(path.join(root, 'control'), path.join(root, 'out', 'escape'));
const env = { HOME: path.join(root, 'home'), CODEX_HOME: path.join(root, 'home'), PATH: '/usr/bin:/bin' };
const version = spawnSync(binary, ['--version'], { env, encoding: 'utf8' });
if (version.status !== 0 || version.stdout.trim() !== `codex-cli ${TASK_CODEX_VERSION}`) throw new Error('unqualified native version');
const script = 'cat dirty.txt untracked.txt; echo permitted > ../out/report; echo denied > blocked; echo denied > ../control/blocked; echo denied > ../out/escape/blocked; ln dirty.txt ../out/new-link';
const args = ['sandbox', '-P', 'rudi_task', ...taskPermissionArgs(profile), '-C', profile.working_directory, '--', '/bin/sh', '-c', script];
const result = spawnSync(binary, args, { env, encoding: 'utf8', timeout: 10000, maxBuffer: 65536 });
const checks = { readShared: result.stdout === 'dirty-inputuntracked-input', wroteAllowed: fs.existsSync(path.join(root, 'out/report')),
  deniedProject: !fs.existsSync(path.join(root, 'project/blocked')), deniedNewHardlink: !fs.existsSync(path.join(root, 'out/new-link')),
  sharedUnchanged: fs.readFileSync(path.join(root, 'project/dirty.txt'), 'utf8') === 'dirty-input', deniedControl: !fs.existsSync(path.join(root, 'control/blocked')) };
const receipt = { version: version.stdout.trim(), root, args, status: result.status, checks, stderr: result.stderr };
fs.writeFileSync(path.join(root, 'receipt.json'), `${JSON.stringify(receipt, null, 2)}\n`);
console.log(JSON.stringify({ root, checks }));
if (!Object.values(checks).every(Boolean)) process.exitCode = 1;
