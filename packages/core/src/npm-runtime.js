import fs from 'node:fs';
import path from 'node:path';
import { getPackagePath } from '@learnrudi/env';

// An explicit binding must never silently fall back to the shared runtime.
export function validateNodeRuntimeId(id) {
  if (typeof id !== 'string' || !/^runtime:node(?:-[a-z0-9]+)*$/.test(id)) {
    throw new Error(`Invalid npm Node runtime binding: ${String(id)}`);
  }
  return id;
}

export function getNpmNodeRuntimeId(pkg) {
  const id = pkg.install?.nodeRuntime;
  if (id === undefined) return undefined;
  if (pkg.install?.source !== 'npm') {
    throw new Error('install.nodeRuntime is only supported for npm packages');
  }
  return validateNodeRuntimeId(id);
}

function isRuntimeExecutable(filePath) {
  try {
    fs.accessSync(filePath, fs.constants.X_OK);
    return fs.statSync(filePath).isFile();
  } catch {
    return false;
  }
}

export function resolveNpmRuntimeBin(id, bin) {
  const root = getPackagePath(validateNodeRuntimeId(id));
  const candidates = [
    path.join(root, process.arch, 'bin'),
    path.join(root, 'bin'),
  ];
  const binDir = candidates.find(dir => isRuntimeExecutable(path.join(dir, 'node'))
    && isRuntimeExecutable(path.join(dir, bin)));
  if (!binDir) throw new Error(`Node runtime ${id} is missing node/${bin}; install ${id} first`);
  return path.join(binDir, bin);
}
