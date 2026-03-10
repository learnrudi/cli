import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { fileURLToPath } from 'url';
import { spawnSync } from 'child_process';
import { createLaunchConfig } from '@learnrudi/core/rudi-config';
import { getPlatformArch } from '@learnrudi/env';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

describe('Binary Runtime Support', () => {
  let tempDir;

  before(() => {
    // Create temp directory for tests
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rudi-binary-test-'));
  });

  after(() => {
    // Clean up temp directory
    if (tempDir && fs.existsSync(tempDir)) {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  describe('createLaunchConfig - binary runtime', () => {
    it('creates launch config for relative binary path', () => {
      const stackPath = '/tmp/stack';
      const config = createLaunchConfig(['./my-binary'], 'binary', stackPath);

      assert.equal(config.bin, '/tmp/stack/my-binary');
      assert.deepEqual(config.args, []);
      assert.equal(config.cwd, stackPath);
    });

    it('creates launch config with arguments', () => {
      const stackPath = '/tmp/stack';
      const config = createLaunchConfig(['./my-binary', '--port', '3000'], 'binary', stackPath);

      assert.equal(config.bin, '/tmp/stack/my-binary');
      assert.deepEqual(config.args, ['--port', '3000']);
      assert.equal(config.cwd, stackPath);
    });

    it('preserves absolute binary paths', () => {
      const stackPath = '/tmp/stack';
      const config = createLaunchConfig(['/usr/bin/tool'], 'binary', stackPath);

      assert.equal(config.bin, '/usr/bin/tool');
      assert.deepEqual(config.args, []);
      assert.equal(config.cwd, stackPath);
    });

    it('handles multiple arguments', () => {
      const stackPath = '/tmp/stack';
      const config = createLaunchConfig(
        ['./binary', '--verbose', '--log-level', 'debug', '--output', '/tmp/log.txt'],
        'binary',
        stackPath
      );

      assert.equal(config.bin, '/tmp/stack/binary');
      assert.deepEqual(config.args, ['--verbose', '--log-level', 'debug', '--output', '/tmp/log.txt']);
    });

    it('throws error when command is null', () => {
      assert.throws(
        () => createLaunchConfig(null, 'binary', '/tmp/stack'),
        { message: 'Binary runtime requires a command' }
      );
    });

    it('throws error when command is empty array', () => {
      assert.throws(
        () => createLaunchConfig([], 'binary', '/tmp/stack'),
        { message: 'Binary runtime requires a command' }
      );
    });

    it('strips leading ./ from relative paths', () => {
      const stackPath = '/tmp/stack';
      const config = createLaunchConfig(['./bin/server'], 'binary', stackPath);

      assert.equal(config.bin, '/tmp/stack/bin/server');
    });

    it('handles nested relative paths', () => {
      const stackPath = '/tmp/stack';
      const config = createLaunchConfig(['./dist/bin/app'], 'binary', stackPath);

      assert.equal(config.bin, '/tmp/stack/dist/bin/app');
    });
  });

  describe('createLaunchConfig - node runtime (regression)', () => {
    it('creates launch config for node runtime', () => {
      const stackPath = '/tmp/stack';
      const config = createLaunchConfig(['node', 'dist/index.js'], 'node', stackPath);

      assert.ok(config.bin.includes('node'));
      assert.deepEqual(config.args, ['dist/index.js']);
      assert.equal(config.cwd, stackPath);
    });

    it('creates launch config for npx', () => {
      const stackPath = '/tmp/stack';
      const config = createLaunchConfig(['npx', 'tsx', 'src/index.ts'], 'node', stackPath);

      assert.ok(config.bin.includes('npx'));
      assert.deepEqual(config.args, ['tsx', 'src/index.ts']);
    });
  });

  describe('createLaunchConfig - python runtime (regression)', () => {
    it('creates launch config for python runtime', () => {
      const stackPath = '/tmp/stack';
      const config = createLaunchConfig(['python', '-u', 'src/server.py'], 'python', stackPath);

      assert.ok(config.bin.includes('python'));
      assert.deepEqual(config.args, ['-u', 'src/server.py']);
      assert.equal(config.cwd, stackPath);
    });
  });

  describe('getPlatformArch', () => {
    it('returns valid platform-arch format', () => {
      const platformArch = getPlatformArch();

      assert.ok(platformArch);
      assert.match(platformArch, /^(darwin|linux|win32)-(arm64|x64)$/);
    });
  });

  describe('binary execution simulation', () => {
    let binaryPath;
    let notExecutablePath;

    before(() => {
      // Create a fake executable binary (shell script)
      binaryPath = path.join(tempDir, 'fake-binary');
      const scriptContent = process.platform === 'win32'
        ? '@echo off\r\necho Hello from binary\r\necho Args: %*'
        : '#!/bin/sh\necho "Hello from binary"\necho "Args: $@"';

      fs.writeFileSync(binaryPath, scriptContent);

      // Make executable on Unix-like systems
      if (process.platform !== 'win32') {
        fs.chmodSync(binaryPath, 0o755);
      }

      // Create a non-executable file for testing
      if (process.platform !== 'win32') {
        notExecutablePath = path.join(tempDir, 'not-executable');
        fs.writeFileSync(notExecutablePath, '#!/bin/sh\necho "test"');
        fs.chmodSync(notExecutablePath, 0o644); // Not executable
      }
    });

    it('creates valid launch config for executable binary', () => {
      const config = createLaunchConfig(['./fake-binary'], 'binary', tempDir);

      assert.equal(config.bin, binaryPath);
      assert.ok(fs.existsSync(config.bin));
    });

    it('verifies binary is executable', { skip: process.platform === 'win32' }, () => {
      // Test that our fake binary has execute permissions
      const config = createLaunchConfig(['./fake-binary'], 'binary', tempDir);

      // Check if file is executable using fs.constants.X_OK
      assert.doesNotThrow(() => {
        fs.accessSync(config.bin, fs.constants.X_OK);
      });
    });

    it('detects non-executable binary', { skip: process.platform === 'win32' }, () => {
      // Test that we can detect a non-executable file
      assert.throws(() => {
        fs.accessSync(notExecutablePath, fs.constants.X_OK);
      });
    });

    it('spawns binary and captures output', { skip: process.platform === 'win32' }, () => {
      const config = createLaunchConfig(['./fake-binary', 'arg1', 'arg2'], 'binary', tempDir);

      // Execute the binary
      const result = spawnSync(config.bin, config.args, {
        cwd: config.cwd,
        encoding: 'utf8'
      });

      assert.equal(result.status, 0);
      assert.ok(result.stdout.includes('Hello from binary'));
      assert.ok(result.stdout.includes('Args:'));
    });

    it('passes arguments correctly to binary', { skip: process.platform === 'win32' }, () => {
      const config = createLaunchConfig(
        ['./fake-binary', '--test', 'value'],
        'binary',
        tempDir
      );

      const result = spawnSync(config.bin, config.args, {
        cwd: config.cwd,
        encoding: 'utf8'
      });

      assert.equal(result.status, 0);
      assert.ok(result.stdout.includes('--test value') || result.stdout.includes('--test') && result.stdout.includes('value'));
    });
  });

  describe('validateStackEntryPoint simulation', () => {
    it('validates existing executable binary', { skip: process.platform === 'win32' }, () => {
      const binaryPath = path.join(tempDir, 'valid-binary');
      fs.writeFileSync(binaryPath, '#!/bin/sh\necho "valid"');
      fs.chmodSync(binaryPath, 0o755);

      // Simulate validation logic
      const exists = fs.existsSync(binaryPath);
      let isExecutable = false;
      try {
        fs.accessSync(binaryPath, fs.constants.X_OK);
        isExecutable = true;
      } catch {
        isExecutable = false;
      }

      assert.ok(exists);
      assert.ok(isExecutable);
    });

    it('detects missing binary', () => {
      const binaryPath = path.join(tempDir, 'nonexistent-binary');

      // Simulate validation logic
      const exists = fs.existsSync(binaryPath);

      assert.equal(exists, false);
    });

    it('detects non-executable binary', { skip: process.platform === 'win32' }, () => {
      const binaryPath = path.join(tempDir, 'non-exec-binary');
      fs.writeFileSync(binaryPath, '#!/bin/sh\necho "test"');
      fs.chmodSync(binaryPath, 0o644); // Not executable

      // Simulate validation logic
      const exists = fs.existsSync(binaryPath);
      let isExecutable = false;
      try {
        fs.accessSync(binaryPath, fs.constants.X_OK);
        isExecutable = true;
      } catch {
        isExecutable = false;
      }

      assert.ok(exists);
      assert.equal(isExecutable, false);
    });

    it('validates binary in nested directory', { skip: process.platform === 'win32' }, () => {
      const binDir = path.join(tempDir, 'nested', 'bin');
      fs.mkdirSync(binDir, { recursive: true });

      const binaryPath = path.join(binDir, 'nested-binary');
      fs.writeFileSync(binaryPath, '#!/bin/sh\necho "nested"');
      fs.chmodSync(binaryPath, 0o755);

      // Create launch config and validate
      const config = createLaunchConfig(['./nested/bin/nested-binary'], 'binary', tempDir);

      assert.equal(config.bin, binaryPath);
      assert.ok(fs.existsSync(config.bin));

      let isExecutable = false;
      try {
        fs.accessSync(config.bin, fs.constants.X_OK);
        isExecutable = true;
      } catch {
        isExecutable = false;
      }

      assert.ok(isExecutable);
    });
  });

  describe('edge cases', () => {
    it('handles binary names with special characters', () => {
      const stackPath = '/tmp/stack';
      const config = createLaunchConfig(['./my-binary-v2.1'], 'binary', stackPath);

      assert.equal(config.bin, '/tmp/stack/my-binary-v2.1');
    });

    it('handles binary names with underscores', () => {
      const stackPath = '/tmp/stack';
      const config = createLaunchConfig(['./my_binary_tool'], 'binary', stackPath);

      assert.equal(config.bin, '/tmp/stack/my_binary_tool');
    });

    it('handles deeply nested binary paths', () => {
      const stackPath = '/tmp/stack';
      const config = createLaunchConfig(['./bin/tools/utils/helper'], 'binary', stackPath);

      assert.equal(config.bin, '/tmp/stack/bin/tools/utils/helper');
    });

    it('handles empty arguments array after binary', () => {
      const stackPath = '/tmp/stack';
      const config = createLaunchConfig(['./binary'], 'binary', stackPath);

      assert.deepEqual(config.args, []);
    });

    it('preserves argument ordering', () => {
      const stackPath = '/tmp/stack';
      const args = ['--first', '1', '--second', '2', '--third', '3'];
      const config = createLaunchConfig(['./binary', ...args], 'binary', stackPath);

      assert.deepEqual(config.args, args);
    });
  });

  describe('cross-platform path handling', () => {
    it('normalizes paths correctly for current platform', () => {
      const stackPath = process.platform === 'win32' ? 'C:\\tmp\\stack' : '/tmp/stack';
      const config = createLaunchConfig(['./binary'], 'binary', stackPath);

      const expectedPath = process.platform === 'win32'
        ? path.join('C:\\tmp\\stack', 'binary')
        : '/tmp/stack/binary';

      assert.equal(config.bin, expectedPath);
    });

    it('handles absolute paths on current platform', () => {
      const absolutePath = process.platform === 'win32'
        ? 'C:\\usr\\bin\\tool'
        : '/usr/bin/tool';

      const config = createLaunchConfig([absolutePath], 'binary', '/tmp/stack');

      assert.equal(config.bin, absolutePath);
    });
  });

  describe('integration with existing runtimes', () => {
    it('binary runtime does not interfere with node runtime', () => {
      const stackPath = '/tmp/stack';

      // Create node config
      const nodeConfig = createLaunchConfig(['node', 'index.js'], 'node', stackPath);
      assert.ok(nodeConfig.bin.includes('node'));
      assert.deepEqual(nodeConfig.args, ['index.js']);

      // Create binary config
      const binaryConfig = createLaunchConfig(['./binary'], 'binary', stackPath);
      assert.equal(binaryConfig.bin, '/tmp/stack/binary');
      assert.deepEqual(binaryConfig.args, []);

      // Ensure they're different
      assert.notEqual(nodeConfig.bin, binaryConfig.bin);
    });

    it('binary runtime does not interfere with python runtime', () => {
      const stackPath = '/tmp/stack';

      // Create python config
      const pythonConfig = createLaunchConfig(['python', 'server.py'], 'python', stackPath);
      assert.ok(pythonConfig.bin.includes('python'));
      assert.deepEqual(pythonConfig.args, ['server.py']);

      // Create binary config
      const binaryConfig = createLaunchConfig(['./binary'], 'binary', stackPath);
      assert.equal(binaryConfig.bin, '/tmp/stack/binary');
      assert.deepEqual(binaryConfig.args, []);

      // Ensure they're different
      assert.notEqual(pythonConfig.bin, binaryConfig.bin);
    });
  });
});
