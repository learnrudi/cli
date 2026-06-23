import assert from 'node:assert/strict';
import test from 'node:test';

import {
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
