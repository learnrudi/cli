/**
 * Auth command - Authenticate OAuth-based stacks
 *
 * Usage:
 *   rudi auth <stack-id>              # Auth with default account
 *   rudi auth <stack-id> user@gmail.com
 */

import * as fs from 'fs/promises';
import * as path from 'path';
import { execFileSync as defaultExecFileSync } from 'child_process';
import { listInstalled } from '@learnrudi/core';
import { getSecret } from '@learnrudi/secrets';
import * as net from 'net';

/**
 * Find an available port starting from a base port
 */
async function findAvailablePort(basePort = 3456) {
  for (let port = basePort; port < basePort + 10; port++) {
    if (await isPortAvailable(port)) {
      return port;
    }
  }
  throw new Error(`No available ports found in range ${basePort}-${basePort + 10}`);
}

/**
 * Check if a port is available
 */
function isPortAvailable(port) {
  return new Promise((resolve) => {
    const server = net.createServer();

    server.once('error', (err) => {
      if (err.code === 'EADDRINUSE') {
        resolve(false);
      } else {
        resolve(false);
      }
    });

    server.once('listening', () => {
      server.close();
      resolve(true);
    });

    server.listen(port);
  });
}

/**
 * Detect runtime from stack directory
 */
export async function detectRuntime(stackPath) {
  const layouts = [
    { runtime: 'node', runtimePath: path.join(stackPath, 'node') },
    { runtime: 'node', runtimePath: stackPath },
    { runtime: 'python', runtimePath: path.join(stackPath, 'python') },
    { runtime: 'python', runtimePath: stackPath },
  ];

  for (const { runtime, runtimePath } of layouts) {
    try {
      await fs.access(runtimePath);

      // Check for auth script
      if (runtime === 'node') {
        const authTs = path.join(runtimePath, 'src', 'auth.ts');
        const authJs = path.join(runtimePath, 'dist', 'auth.js');

        try {
          await fs.access(authTs);
          return { runtime: 'node', authScript: authTs, useTsx: true };
        } catch {
          try {
            await fs.access(authJs);
            return { runtime: 'node', authScript: authJs, useTsx: false };
          } catch {
            // No auth script
          }
        }
      } else if (runtime === 'python') {
        const authPy = path.join(runtimePath, 'src', 'auth.py');

        try {
          await fs.access(authPy);
          return { runtime: 'python', authScript: authPy, useTsx: false };
        } catch {
          // No auth script
        }
      }
    } catch {
      continue;
    }
  }

  return null;
}

function requireSubprocessArg(value, name) {
  if (typeof value !== 'string' || value.length === 0) {
    throw new Error(`${name} must be a non-empty string`);
  }
  if (value.includes('\0')) {
    throw new Error(`${name} must not contain NUL bytes`);
  }
  return value;
}

function accountArg(accountEmail) {
  if (accountEmail === undefined || accountEmail === null || accountEmail === '') {
    return [];
  }
  return [requireSubprocessArg(accountEmail, 'account email')];
}

function getRequiredSecrets(manifest) {
  const secrets = manifest?.requires?.secrets || manifest?.secrets || [];
  return secrets.map((secret) => ({
    name: typeof secret === 'string' ? secret : (secret.name || secret.key),
    required: typeof secret === 'object' ? secret.required !== false : true,
  })).filter((secret) => secret.name);
}

async function buildAuthEnv(stack) {
  const env = { ...process.env };
  for (const secret of getRequiredSecrets(stack)) {
    const value = await getSecret(secret.name);
    if (value) {
      env[secret.name] = value;
    }
  }
  return env;
}

export function createAuthSubprocess({
  runtime,
  scriptPath,
  useTsx = false,
  accountEmail,
}) {
  const safeScriptPath = requireSubprocessArg(scriptPath, 'auth script path');
  const accountArgs = accountArg(accountEmail);

  if (runtime === 'node') {
    if (useTsx) {
      return { command: 'npx', args: ['tsx', safeScriptPath, ...accountArgs] };
    }
    return { command: 'node', args: [safeScriptPath, ...accountArgs] };
  }

  if (runtime === 'python') {
    return { command: 'python3', args: [safeScriptPath, ...accountArgs] };
  }

  throw new Error(`Unsupported auth runtime: ${runtime}`);
}

export function runAuthSubprocess(plan, options = {}) {
  const execFileSync = options.execFileSync || defaultExecFileSync;
  const command = requireSubprocessArg(plan?.command, 'auth command');
  const args = Array.isArray(plan?.args)
    ? plan.args.map((arg, index) => requireSubprocessArg(arg, `auth arg ${index}`))
    : [];

  execFileSync(command, args, {
    cwd: options.cwd,
    stdio: options.stdio || 'inherit',
    ...(options.env ? { env: options.env } : {}),
  });
}

export function getTempAuthScriptPath(authScript, useTsx) {
  const tempExt = useTsx ? '.ts' : '.mjs';
  return path.join(path.dirname(authScript), `auth-temp${tempExt}`);
}

/**
 * Run authentication for a stack
 */
export async function cmdAuth(args, flags) {
  const stackId = args[0];
  const accountEmail = args[1];

  if (!stackId) {
    console.error('Usage: rudi auth <stack-id> [account-email]');
    console.error('Example: rudi auth google-workspace user@gmail.com');
    process.exit(1);
  }

  try {
    // Get all installed stacks
    const packages = await listInstalled('stack');

    // Find stack by ID or name
    const stack = packages.find(p => {
      const pId = p.id || '';
      const pName = p.name || '';
      return pId === stackId || pId === `stack:${stackId}` || pName === stackId;
    });

    if (!stack) {
      console.error(`Stack not found: ${stackId}`);
      console.error(`\nInstalled stacks:`);
      packages.forEach(p => console.error(`  - ${p.id}`));
      process.exit(1);
    }

    const stackPath = stack.path;
    const authEnv = await buildAuthEnv(stack);

    // Detect runtime and auth script
    const authInfo = await detectRuntime(stackPath);

    if (!authInfo) {
      console.error(`No authentication script found for ${stackId}`);
      console.error(`This stack may not support OAuth authentication.`);
      process.exit(1);
    }

    console.log('');
    console.log('═'.repeat(60));
    console.log(`  Authenticating ${stack.name || stackId}`);
    console.log('═'.repeat(60));
    console.log('');

    // Find available port
    console.log('Finding available port for OAuth callback...');
    const port = await findAvailablePort(3456);
    console.log(`Using port: ${port}`);
    console.log('');

    const cwd = path.dirname(authInfo.authScript);

    if (authInfo.runtime === 'node') {
      // Try to use the compiled dist/auth.js if available (already has port detection built-in)
      const distAuth = path.join(cwd, '..', 'dist', 'auth.js');
      let useBuiltInPort = false;
      let tempAuthScript = null;

      try {
        await fs.access(distAuth);
        // Check if the built version already has dynamic port support
        const distContent = await fs.readFile(distAuth, 'utf-8');
        if (distContent.includes('findAvailablePort')) {
          // Use the compiled version directly - it already has dynamic port support!
          console.log('Using compiled authentication script...');
          useBuiltInPort = true;
        }
      } catch {
        // dist/auth.js doesn't exist or doesn't have dynamic port support
      }

      if (!useBuiltInPort) {
        // Fallback: Create temporary script with dynamic port
        const authContent = await fs.readFile(authInfo.authScript, 'utf-8');
        tempAuthScript = getTempAuthScriptPath(authInfo.authScript, authInfo.useTsx);

        // Replace hardcoded port with dynamic port
        const modifiedContent = authContent
          .replace(/localhost:3456/g, `localhost:${port}`)
          .replace(/server\.listen\(3456/g, `server.listen(${port}`);

        await fs.writeFile(tempAuthScript, modifiedContent);
      }

      console.log('Starting OAuth flow...');
      console.log('');

      try {
        const plan = createAuthSubprocess({
          runtime: 'node',
          scriptPath: useBuiltInPort ? distAuth : tempAuthScript,
          useTsx: useBuiltInPort ? false : authInfo.useTsx,
          accountEmail,
        });
        runAuthSubprocess(plan, {
          cwd,
          stdio: 'inherit',
          env: authEnv,
        });

        // Clean up temp file if we created one
        if (tempAuthScript) {
          await fs.unlink(tempAuthScript);
        }

      } catch (error) {
        // Clean up temp file even on error
        if (tempAuthScript) {
          try {
            await fs.unlink(tempAuthScript);
          } catch {}
        }

        throw error;
      }

    } else if (authInfo.runtime === 'python') {
      console.log('Starting OAuth flow...');
      console.log('');

      const plan = createAuthSubprocess({
        runtime: 'python',
        scriptPath: authInfo.authScript,
        accountEmail,
      });
      runAuthSubprocess(plan, {
        cwd,
        stdio: 'inherit',
        env: {
          ...authEnv,
          OAUTH_PORT: port.toString(),
        },
      });
    }

    console.log('');
    console.log('✓ Authentication complete!');
    console.log('');

  } catch (error) {
    console.error(`Authentication failed: ${error.message}`);
    if (flags.verbose) {
      console.error(error.stack);
    }
    process.exit(1);
  }
}
