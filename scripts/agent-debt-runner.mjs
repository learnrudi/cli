#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(SCRIPT_DIR, '..');
const DEFAULT_SCANNER = '/Users/hoff/dev/dev-help/agent-debt-scan.js';
const DEFAULT_PROFILE = 'pr-review';
const DEFAULT_LOG_PATH = '.agent-scans/history.ndjson';
const SCANNABLE_EXTENSIONS = new Set(['.js', '.jsx', '.mjs', '.cjs', '.ts', '.tsx']);

function usage() {
  console.error(`Usage:
  node scripts/agent-debt-runner.mjs --edited <comma,list> [options]
  node scripts/agent-debt-runner.mjs --changed-since <git-ref> [options]

Options:
  --edited <paths>           Comma-separated edited file list. Repeatable.
  --changed-since <git-ref>  Resolve changed files from git diff.
  --profile <name>           Debt-scan profile to use (default: ${DEFAULT_PROFILE})
  --scope <path>             Optional scope override.
  --scanner <path>           Scanner path (default: ${DEFAULT_SCANNER})
  --config <path>            Optional config override.
  --log-path <path>          Override log path (default: ${DEFAULT_LOG_PATH})
  --no-log                   Do not append scan history.
  --help                     Show this message`);
}

function parseArgs(argv) {
  const parsed = {
    edited: [],
    changedSince: null,
    profile: DEFAULT_PROFILE,
    scope: null,
    scanner: DEFAULT_SCANNER,
    config: null,
    logPath: DEFAULT_LOG_PATH,
    noLog: false,
    help: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    switch (arg) {
      case '--edited':
        parsed.edited.push(argv[++index]);
        break;
      case '--changed-since':
        parsed.changedSince = argv[++index];
        break;
      case '--profile':
        parsed.profile = argv[++index];
        break;
      case '--scope':
        parsed.scope = argv[++index];
        break;
      case '--scanner':
        parsed.scanner = argv[++index];
        break;
      case '--config':
        parsed.config = argv[++index];
        break;
      case '--log-path':
        parsed.logPath = argv[++index];
        break;
      case '--no-log':
        parsed.noLog = true;
        break;
      case '--help':
        parsed.help = true;
        break;
      default:
        throw new Error(`Unknown argument: ${arg}`);
    }
  }

  return parsed;
}

function parseEditedLists(values) {
  return values
    .flatMap((value) => value.split(','))
    .map((value) => value.trim())
    .filter(Boolean);
}

function relativeToRepo(filePath) {
  return path.relative(REPO_ROOT, filePath).replace(/\\/g, '/');
}

function resolvePath(filePath) {
  return path.isAbsolute(filePath) ? path.resolve(filePath) : path.resolve(REPO_ROOT, filePath);
}

function isScannable(filePath) {
  return SCANNABLE_EXTENSIONS.has(path.extname(filePath));
}

function findRepoFilesFromGit(ref) {
  const result = spawnSync('git', ['diff', '--name-only', ref], {
    cwd: REPO_ROOT,
    encoding: 'utf8',
    timeout: 10000,
  });

  if (result.status !== 0) {
    throw new Error(result.stderr?.trim() || `git diff failed for ref ${ref}`);
  }

  return result.stdout
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
}

function ensureDirectory(filePath) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
}

function appendLog(logPath, payload) {
  ensureDirectory(logPath);
  fs.appendFileSync(logPath, `${JSON.stringify(payload)}\n`, 'utf8');
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    usage();
    process.exit(0);
  }

  if (!args.changedSince && args.edited.length === 0) {
    usage();
    throw new Error('Provide --edited or --changed-since.');
  }

  const editedFiles = args.changedSince
    ? findRepoFilesFromGit(args.changedSince)
    : parseEditedLists(args.edited);
  const resolvedFiles = [...new Set(editedFiles.map(resolvePath))];
  const scannableFiles = resolvedFiles.filter(isScannable);
  const skippedFiles = resolvedFiles
    .filter((filePath) => !isScannable(filePath))
    .map(relativeToRepo);

  if (scannableFiles.length === 0) {
    const payload = {
      status: 'no-scan-targets',
      repo_root: REPO_ROOT,
      profile: args.profile,
      edited_files: resolvedFiles.map(relativeToRepo),
      scannable_files: [],
      skipped_files: skippedFiles,
    };
    if (!args.noLog) {
      const logPath = path.resolve(REPO_ROOT, args.logPath);
      appendLog(logPath, payload);
      payload.log_path = logPath;
    }
    console.log(JSON.stringify(payload, null, 2));
    return;
  }

  const commandArgs = [
    args.scanner,
    '--repo', REPO_ROOT,
    '--profile', args.profile,
    '--files', scannableFiles.map(relativeToRepo).join(','),
    '--json',
  ];
  if (args.scope) {
    commandArgs.push('--scope', args.scope);
  }
  if (args.config) {
    commandArgs.push('--config', path.resolve(REPO_ROOT, args.config));
  }

  const child = spawnSync(process.execPath, commandArgs, {
    cwd: REPO_ROOT,
    encoding: 'utf8',
    timeout: 30000,
  });

  let scannerOutput = null;
  if (child.stdout?.trim()) {
    try {
      scannerOutput = JSON.parse(child.stdout);
    } catch (error) {
      scannerOutput = {
        status: 'scanner-output-parse-error',
        error: error.message,
        raw_stdout: child.stdout,
      };
    }
  }

  const payload = {
    status: child.status === 0 ? 'ok' : 'error',
    repo_root: REPO_ROOT,
    profile: args.profile,
    edited_files: resolvedFiles.map(relativeToRepo),
    scannable_files: scannableFiles.map(relativeToRepo),
    skipped_files: skippedFiles,
    scanner_path: path.resolve(args.scanner),
    scanner_exit_code: child.status ?? 1,
    scanner_stderr: child.stderr?.trim() || null,
    scanner_output: scannerOutput,
  };

  if (!args.noLog) {
    const logPath = path.resolve(REPO_ROOT, args.logPath);
    appendLog(logPath, payload);
    payload.log_path = logPath;
  }

  console.log(JSON.stringify(payload, null, 2));
  process.exit(child.status ?? 1);
}

try {
  main();
} catch (error) {
  console.error(JSON.stringify({
    status: 'runner-error',
    error: error.message,
  }, null, 2));
  process.exit(1);
}
