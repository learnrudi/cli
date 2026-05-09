/**
 * Test manifest fixtures for registry schema v2
 */

/**
 * Binary with platform-specific overrides
 * Tests: exact platform match, OS-only fallback, merge behavior
 */
export const sqliteBinary = {
  id: 'binary:sqlite',
  kind: 'binary',
  name: 'SQLite',
  version: 'system',
  delivery: 'system', // Top-level default
  install: {
    source: 'system', // Top-level default
    platforms: {
      // Exact platform match
      'darwin-arm64': {
        preinstalled: true,
        detect: { command: 'sqlite3 --version' }
      },
      // OS-only match
      darwin: {
        preinstalled: true,
        detect: { command: 'sqlite3 --version' }
      },
      // Platform with download override
      'win32-x64': {
        source: 'download',
        delivery: 'remote',
        url: 'https://www.sqlite.org/2024/sqlite-tools-win-x64-3450000.zip',
        checksum: {
          algo: 'sha256',
          value: 'abc123def456'
        }
      }
    }
  },
  bins: ['sqlite3'],
  detect: { command: 'sqlite3 --version' }
};

/**
 * Runtime with download source requiring checksum
 */
export const nodejsRuntime = {
  id: 'runtime:node',
  kind: 'runtime',
  name: 'Node.js',
  version: '22.12.0',
  delivery: 'remote',
  install: {
    source: 'download',
    platforms: {
      'darwin-arm64': {
        url: 'https://github.com/learnrudi/registry/releases/download/v1.0.0/node-22.12.0-darwin-arm64.tar.gz',
        checksum: {
          algo: 'sha256',
          value: 'deadbeef123456'
        },
        extract: {
          format: 'tar.gz',
          strip: 1
        }
      },
      'linux-x64': {
        url: 'https://github.com/learnrudi/registry/releases/download/v1.0.0/node-22.12.0-linux-x64.tar.gz',
        checksum: {
          algo: 'sha256',
          value: 'cafebabe789'
        },
        extract: {
          format: 'tar.gz',
          strip: 1
        }
      }
    }
  },
  bins: ['node', 'npm', 'npx']
};

/**
 * Tool with npm source
 */
export const ffmpegNpmTool = {
  id: 'binary:ffmpeg',
  kind: 'binary',
  name: 'ffmpeg',
  version: 'latest',
  delivery: 'remote',
  install: {
    source: 'npm',
    package: '@ffmpeg-installer/ffmpeg',
    platforms: {
      darwin: {},
      linux: {},
      win32: {}
    }
  },
  bins: ['ffmpeg']
};

/**
 * Agent with system detect
 */
export const ollamaAgent = {
  id: 'agent:ollama',
  kind: 'agent',
  name: 'Ollama',
  version: 'system',
  delivery: 'system',
  install: {
    source: 'system',
    platforms: {
      darwin: {
        detect: {
          command: 'ollama --version',
          pattern: /ollama version is (\d+\.\d+\.\d+)/
        },
        hints: [
          'Install from https://ollama.com/download',
          'Or use: brew install ollama'
        ]
      },
      linux: {
        detect: {
          command: 'ollama --version',
          pattern: /ollama version is (\d+\.\d+\.\d+)/
        },
        hints: [
          'Install: curl -fsSL https://ollama.com/install.sh | sh'
        ]
      }
    }
  },
  bins: ['ollama'],
  detect: {
    command: 'ollama --version',
    pattern: /ollama version is (\d+\.\d+\.\d+)/
  }
};

/**
 * Invalid manifest - download without checksum (should fail validation)
 */
export const invalidDownloadNoChecksum = {
  id: 'binary:bad-tool',
  kind: 'binary',
  name: 'Bad Tool',
  version: 'latest', // "latest" should warn for downloads
  delivery: 'remote',
  install: {
    source: 'download',
    platforms: {
      'darwin-arm64': {
        url: 'https://example.com/tool.tar.gz'
        // Missing checksum - INVALID
      }
    }
  },
  bins: ['bad-tool']
};

/**
 * Invalid manifest - system without detect
 */
export const invalidSystemNoDetect = {
  id: 'binary:no-detect',
  kind: 'binary',
  name: 'No Detect',
  version: 'system',
  delivery: 'system',
  install: {
    source: 'system'
    // Missing detect.command - INVALID
  },
  bins: ['no-detect']
};

/**
 * Invalid manifest - npm without package field
 */
export const invalidNpmNoPackage = {
  id: 'binary:no-package',
  kind: 'binary',
  name: 'No Package',
  version: 'latest',
  delivery: 'remote',
  install: {
    source: 'npm'
    // Missing package field - INVALID
  },
  bins: ['no-package']
};

/**
 * Invalid manifest - runtime/binary without bins
 */
export const invalidNoBins = {
  id: 'runtime:no-bins',
  kind: 'runtime',
  name: 'No Bins',
  version: '1.0.0',
  delivery: 'remote',
  install: {
    source: 'download',
    platforms: {
      'darwin-arm64': {
        url: 'https://example.com/runtime.tar.gz',
        checksum: { algo: 'sha256', value: 'abc123' }
      }
    }
  }
  // Missing bins - INVALID for runtime/binary/agent
};
