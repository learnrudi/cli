# RUDI Core Tests

Three-layer test suite for RUDI registry schema v2, resolver, and installer.

## Test Structure

```
__tests__/
├── unit/                    # Fast, deterministic unit tests
│   └── platform-resolver.test.js
├── integration/             # Real filesystem, but isolated
│   └── install-detect.test.js
├── e2e/                     # Full user journeys
│   └── ollama-setup.test.js
└── fixtures/                # Test data
    └── manifests.js
```

## Quick Start

```bash
# Run all tests
pnpm test --filter @learnrudi/core

# Run specific test layer
pnpm test:unit
pnpm test:integration
pnpm test:e2e

# Run single test file
node ../../scripts/run-tests.js src/__tests__/unit/platform-resolver.test.js
```

## Test Layers

### 1. Unit Tests (Fast)

**Location:** `unit/platform-resolver.test.js`

Tests schema validation and resolution logic without I/O:
- Platform resolution order (exact → OS-only → default)
- Merge behavior (top-level → platform override wins)
- Source-specific validation (download, system, npm, pip)
- Kind-specific requirements (bins for runtime/binary/agent)

**Run time:** <100ms

```bash
node ../../scripts/run-tests.js src/__tests__/unit/platform-resolver.test.js
```

### 2. Integration Tests (Moderate)

**Location:** `integration/install-detect.test.js`

Tests install and detect flows with real filesystem operations in isolated temp directories:
- System binary detection via `detect.command`
- Shim creation in `~/.rudi/bins/`
- Manifest writing and validation
- SHA256 checksum verification
- Tar.gz extraction with strip levels
- NPM package bin discovery
- Platform-specific install paths

**Run time:** ~5 seconds (some tests require system binaries like `tar`, `npm`)

**Environment:**
- Uses temp directories (OS tmpdir)
- Does NOT touch real `~/.rudi/`
- Skips tests if required binaries missing

```bash
# Run all integration tests
pnpm test:integration:full

# Skip slow npm tests
pnpm test:integration
```

### 3. E2E Tests (Slow)

**Location:** `e2e/ollama-setup.test.js`

Tests full user journey: setup → install → detect → embeddings → search

**Prerequisites:**
- Ollama installed (`brew install ollama` or `https://ollama.com/download`)
- Ollama server running (`ollama serve`)
- Embedding model pulled (`ollama pull nomic-embed-text`)

**Run time:** ~10-30 seconds (network requests to Ollama)

```bash
# Run E2E tests (requires Ollama)
pnpm test:e2e

# Skip E2E tests
SKIP_E2E=true pnpm test:all
```

**E2E Flow:**
1. Detect Ollama installation via `ollama --version`
2. Check server reachable at `localhost:11434`
3. Verify `nomic-embed-text` model available
4. Generate embeddings for test corpus
5. Perform semantic search with cosine similarity
6. Simulate MCP tool call

## Environment Variables

| Variable | Effect |
|----------|--------|
| `SKIP_NPM_TESTS=true` | Skip slow npm install tests |
| `SKIP_E2E=true` | Skip all E2E tests (Ollama not required) |

## CI/CD Recommendations

### Fast CI (Pull Requests)

```yaml
- name: Unit tests
  run: pnpm test:unit --filter @learnrudi/core

- name: Integration tests (no npm)
  run: pnpm test:integration --filter @learnrudi/core
  env:
    SKIP_E2E: true
```

**Run time:** <5 seconds

### Full CI (Main Branch)

```yaml
- name: Install Ollama
  run: brew install ollama

- name: Start Ollama
  run: ollama serve &

- name: Pull embedding model
  run: ollama pull nomic-embed-text

- name: All tests
  run: pnpm test --filter @learnrudi/core
```

**Run time:** ~2 minutes (includes Ollama setup)

## Writing New Tests

### Unit Test Template

```javascript
import { test } from 'node:test';
import assert from 'node:assert';
import { resolveInstall } from '../../platform-resolver.js';

test('my test: description', () => {
  const manifest = { /* test manifest */ };
  const resolved = resolveInstall(manifest, { platformKey: 'darwin-arm64' });

  assert.strictEqual(resolved.source, 'system');
});
```

### Integration Test Template

```javascript
import { test } from 'node:test';
import assert from 'node:assert';
import fs from 'fs';
import path from 'path';
import os from 'os';

test('my install test', async () => {
  const testDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rudi-test-'));

  try {
    // Test logic using testDir
    assert.ok(true);
  } finally {
    fs.rmSync(testDir, { recursive: true, force: true });
  }
});
```

### E2E Test Template

```javascript
import { test } from 'node:test';
import assert from 'node:assert';

const SKIP_E2E = process.env.SKIP_E2E === 'true';

test('my e2e test', { skip: SKIP_E2E }, async () => {
  // Check prerequisites
  if (!prerequisiteMet()) {
    console.log('Skipping: prerequisite not met');
    return;
  }

  // Test logic
  assert.ok(true);
});
```

## Test Manifests

Test fixtures are in `fixtures/manifests.js`:

- `sqliteBinary` - System binary with platform overrides
- `nodejsRuntime` - Download runtime with checksums
- `ffmpegNpmTool` - NPM-based tool
- `ollamaAgent` - System agent with detect pattern
- `invalidDownloadNoChecksum` - Invalid (no checksum)
- `invalidSystemNoDetect` - Invalid (no detect.command)
- `invalidNpmNoPackage` - Invalid (no package field)
- `invalidNoBins` - Invalid (no bins for runtime)

## Coverage Goals

| Layer | Coverage | Speed | Isolation |
|-------|----------|-------|-----------|
| Unit | ~90% | Fast | Full |
| Integration | ~70% | Moderate | Partial |
| E2E | ~50% | Slow | None |

## Debugging

### Run single test with verbose output

```bash
VERBOSE=true pnpm test:unit
```

### Run tests matching pattern

```bash
node ../../scripts/run-tests.js --test-name-pattern="platform resolution" src/__tests__/
```

### Debug with Node inspector

```bash
node --inspect-brk ../../scripts/run-tests.js src/__tests__/unit/platform-resolver.test.js
```

## Related Documentation

- [Registry Schema v2](../../../../../../registry/SCHEMA.md)
- [Platform Resolver API](../../platform-resolver.js)
- [Installer API](../../installer.js)

## Test Data

Sample manifests for manual testing are in `/Users/hoff/dev/RUDI/registry/`.

To test against local registry:

```bash
USE_LOCAL_REGISTRY=true pnpm test --filter @learnrudi/core
```
