export const SUPPORTED_NODE_DESCRIPTION = 'Node 22 LTS or Node 24.22+ LTS';

export function isSupportedNodeVersion(version) {
  const parsed = typeof version === 'string' && /^v?(\d+)\.(\d+)\.\d+$/.exec(version);
  if (!parsed) return false;
  const major = Number(parsed[1]);
  const minor = Number(parsed[2]);
  // Node 24.19 introduced ObjectWrap cleanup hooks without the registry needed
  // during automatic GC. 24.22 contains both the registry and its teardown fix.
  // Use one conservative minimum for the supported Node 24 line.
  return major === 22 || (major === 24 && minor >= 22);
}

export function assertSupportedNodeVersion(version = process.version) {
  if (isSupportedNodeVersion(version)) return;
  const error = new Error(
    `Unsupported Node.js ${version}; use ${SUPPORTED_NODE_DESCRIPTION}. ` +
    'Earlier Node 24 runtimes can abort during native SQLite cleanup.',
  );
  error.code = 'RUDI_UNSUPPORTED_NODE';
  throw error;
}
