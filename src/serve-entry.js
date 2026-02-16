/**
 * Minimal entry point for the RUDI sidecar binary.
 *
 * Compiled via bun build --compile into a standalone native executable.
 * Tauri launches this as an external binary — it starts the HTTP/WS server.
 */

import { cmdServe } from './commands/serve.js';

const flags = {};
for (let i = 2; i < process.argv.length; i++) {
  const arg = process.argv[i];
  if (arg === '--port' && process.argv[i + 1]) {
    flags.port = parseInt(process.argv[i + 1], 10);
    i++;
  } else if (arg.startsWith('--port=')) {
    flags.port = parseInt(arg.split('=')[1], 10);
  }
  // "serve" arg from Tauri sidecar is harmless — we always start the server
}

cmdServe([], flags).catch(err => {
  console.error('[entry] cmdServe FAILED:', err);
  process.exit(1);
});
