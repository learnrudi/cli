import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildAuthEnvironment,
  createAuthSubprocess,
  getTempAuthScriptPath,
  runAuthSubprocess,
} from '../../commands/auth.js';

test('createAuthSubprocess passes account input as a literal node argv value', () => {
  const suspiciousAccount = 'user@example.com; touch /tmp/rudi-auth-should-not-run';
  const plan = createAuthSubprocess({
    runtime: 'node',
    scriptPath: '/tmp/stack auth/dist/auth.js',
    accountEmail: suspiciousAccount,
  });

  assert.deepEqual(plan, {
    command: 'node',
    args: ['/tmp/stack auth/dist/auth.js', suspiciousAccount],
  });
});

test('createAuthSubprocess builds tsx and python auth commands as argv arrays', () => {
  assert.deepEqual(createAuthSubprocess({
    runtime: 'node',
    scriptPath: '/tmp/stack auth/src/auth.ts',
    useTsx: true,
    accountEmail: 'rudi@example.com',
  }), {
    command: 'npx',
    args: ['tsx', '/tmp/stack auth/src/auth.ts', 'rudi@example.com'],
  });

  assert.deepEqual(createAuthSubprocess({
    runtime: 'python',
    scriptPath: '/tmp/stack auth/src/auth.py',
    accountEmail: 'rudi@example.com',
  }), {
    command: 'python3',
    args: ['/tmp/stack auth/src/auth.py', 'rudi@example.com'],
  });
});

test('createAuthSubprocess rejects NUL bytes in account input', () => {
  assert.throws(
    () => createAuthSubprocess({
      runtime: 'node',
      scriptPath: '/tmp/auth.js',
      accountEmail: 'user@example.com\0--flag',
    }),
    /account email must not contain NUL bytes/,
  );
});

test('getTempAuthScriptPath keeps generated auth script beside source script', () => {
  assert.equal(
    getTempAuthScriptPath('/tmp/google-workspace/src/auth.ts', true),
    '/tmp/google-workspace/src/auth-temp.ts',
  );
  assert.equal(
    getTempAuthScriptPath('/tmp/google-workspace/dist/auth.js', false),
    '/tmp/google-workspace/dist/auth-temp.mjs',
  );
});

test('runAuthSubprocess dispatches command and args without a shell option', () => {
  const calls = [];
  runAuthSubprocess({
    command: 'node',
    args: ['/tmp/auth.js', 'user@example.com; touch /tmp/probe'],
  }, {
    cwd: '/tmp',
    env: { TEST_ENV: '1' },
    stdio: 'inherit',
    execFileSync(command, args, options) {
      calls.push({ command, args, options });
    },
  });

  assert.equal(calls.length, 1);
  assert.equal(calls[0].command, 'node');
  assert.deepEqual(calls[0].args, ['/tmp/auth.js', 'user@example.com; touch /tmp/probe']);
  assert.equal(calls[0].options.shell, undefined);
  assert.equal(calls[0].options.cwd, '/tmp');
  assert.deepEqual(calls[0].options.env, { TEST_ENV: '1' });
});

test('buildAuthEnvironment injects required stack secrets from the RUDI secrets store', async () => {
  const lookups = [];
  const env = await buildAuthEnvironment({
    stack: {
      id: 'stack:google-workspace',
      name: 'Google Workspace',
      requires: {
        secrets: [
          { name: 'GOOGLE_CREDENTIALS' },
          { key: 'OPTIONAL_GOOGLE_TOKEN', required: false },
        ],
      },
    },
    baseEnv: {
      PATH: '/usr/bin',
      GOOGLE_CREDENTIALS: 'stale-shell-value',
    },
    getSecret: async (name) => {
      lookups.push(name);
      return name === 'GOOGLE_CREDENTIALS' ? '{"installed":{"client_id":"id","client_secret":"secret"}}' : null;
    },
  });

  assert.deepEqual(lookups, ['GOOGLE_CREDENTIALS', 'OPTIONAL_GOOGLE_TOKEN']);
  assert.equal(env.PATH, '/usr/bin');
  assert.equal(env.GOOGLE_CREDENTIALS, '{"installed":{"client_id":"id","client_secret":"secret"}}');
  assert.equal(env.OPTIONAL_GOOGLE_TOKEN, undefined);
});

test('buildAuthEnvironment fails clearly when a required stack secret is missing', async () => {
  await assert.rejects(
    () => buildAuthEnvironment({
      stack: {
        id: 'stack:google-workspace',
        requires: {
          secrets: [{ key: 'GOOGLE_CREDENTIALS' }],
        },
      },
      baseEnv: {},
      getSecret: async () => null,
    }),
    /Missing required secret\(s\) for stack:google-workspace: GOOGLE_CREDENTIALS/,
  );
});
