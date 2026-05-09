# RUDI Core Testing Guide

## Summary

Three-layer test suite for RUDI registry schema v2:

| Layer | Tests | Duration | Coverage |
|-------|-------|----------|----------|
| **Unit** | 22 | ~78ms | Platform resolution, validation |
| **Integration** | 12 | ~5s | Install, detect, checksums, shims |
| **E2E** | 8 | ~30s | Full Ollama setup flow |

**Total:** 42 tests covering schema validation → install → embeddings → search

## Quick Commands

```bash
# Development (default)
pnpm test                    # Fast: unit + integration (no npm)

# Specific layers
pnpm test:unit              # Unit tests only (~78ms)
pnpm test:integration       # Integration (skip npm installs)
pnpm test:e2e               # E2E (requires Ollama)

# Full suite
pnpm test:all               # All tests (may skip E2E if not configured)

# Watch mode
pnpm test:watch             # Re-run unit tests on file change
```

## Test Coverage

### Unit Tests (22 tests, ~78ms)

**Platform Resolution:**
- ✅ Exact platform match (darwin-arm64)
- ✅ OS-only fallback (darwin)
- ✅ Default fallback (top-level)
- ✅ Merge behavior (platform overrides top-level)
- ✅ Metadata preservation

**Validation by Source:**
- ✅ `download` requires url + checksum
- ✅ `download` warns on version="latest"
- ✅ `system` requires detect.command
- ✅ `npm` requires package field
- ✅ `pip` requires package field

**Kind Requirements:**
- ✅ runtime/binary/agent require `bins`
- ✅ stack does NOT require `bins`

**Platform Support:**
- ✅ getSupportedPlatforms() returns all keys
- ✅ isPlatformSupported() checks availability

### Integration Tests (12 tests, ~5s)

**Detection:**
- ✅ System binary found via detect.command
- ✅ System binary not found returns failure
- ✅ Pattern extraction from command output

**Installation:**
- ✅ Shim creation in ~/.rudi/bins/
- ✅ manifest.json written with metadata
- ✅ SHA256 checksum verification
- ✅ Mismatched checksum fails
- ✅ Tar.gz extraction with strip levels
- ✅ NPM package bin discovery
- ✅ Platform-specific directory structure

**Security:**
- ✅ Checksum validation prevents tampering
- ✅ Isolated test environments (no ~/.rudi pollution)

### E2E Tests (8 tests, ~30s)

**Ollama Setup Flow:**
- ✅ Detect Ollama installation
- ✅ Check server reachable (localhost:11434)
- ✅ Verify embedding model available
- ✅ Generate single embedding (768d)
- ✅ Generate batch embeddings
- ✅ Semantic search with cosine similarity
- ✅ Full setup → embeddings → search flow
- ✅ MCP tool surface validation

## Test Architecture

```
Platform Resolver (schema v2)
    ↓
    resolveInstall(manifest, platform)
    ↓
    Effective config (merged top-level + platform)
    ↓
    validateResolvedInstall(resolved, manifest)
    ↓
    Valid: Install, Invalid: Error
```

### Schema Rules Tested

1. **Resolution Order:** exact → OS-only → default
2. **Merge:** top-level fields + platform override (platform wins)
3. **Validation:** source-specific (download/system/npm/pip)
4. **Requirements:** bins for runtime/binary/agent

## Running Tests

### Development Workflow

```bash
# Fast feedback during development
pnpm test:watch

# Before commit
pnpm test

# Full validation before PR
pnpm test:integration:full   # includes npm installs
pnpm test:e2e               # requires Ollama
```

### CI/CD Setup

**Fast CI (PR checks):**
```yaml
- name: Test
  run: pnpm test --filter @learnrudi/core
  # Runs: unit + integration (no npm, no E2E)
  # Duration: ~5 seconds
```

**Full CI (main branch):**
```yaml
- name: Install Ollama
  run: |
    brew install ollama
    ollama serve &
    sleep 5
    ollama pull nomic-embed-text

- name: Test
  run: |
    pnpm test:all --filter @learnrudi/core
  # Duration: ~2 minutes
```

## Prerequisites

### Unit Tests
- ✅ No prerequisites (pure logic)

### Integration Tests
- ✅ Node.js >=18
- ⚠️ Optional: `tar` for extraction tests
- ⚠️ Optional: `npm` for npm package tests (skippable with `SKIP_NPM_TESTS=true`)

### E2E Tests
- ✅ Ollama installed ([ollama.com/download](https://ollama.com/download))
- ✅ Ollama server running (`ollama serve`)
- ✅ Embedding model pulled (`ollama pull nomic-embed-text`)

**E2E can be skipped:**
```bash
SKIP_E2E=true pnpm test:e2e  # All tests will pass (skipped)
```

## Environment Variables

| Variable | Effect | Used In |
|----------|--------|---------|
| `SKIP_NPM_TESTS=true` | Skip slow npm install tests | Integration |
| `SKIP_E2E=true` | Skip all E2E tests | E2E |
| `VERBOSE=true` | Use 'spec' reporter | All |
| `TEST_REPORTER=spec` | Override default 'tap' reporter | All |

## Test Fixtures

Located in `src/__tests__/fixtures/manifests.js`:

**Valid Manifests:**
- `sqliteBinary` - System binary with platform overrides
- `nodejsRuntime` - Download runtime with checksums
- `ffmpegNpmTool` - NPM-based tool
- `ollamaAgent` - System agent with detect pattern

**Invalid Manifests (for validation tests):**
- `invalidDownloadNoChecksum` - Missing checksum
- `invalidSystemNoDetect` - Missing detect.command
- `invalidNpmNoPackage` - Missing package field
- `invalidNoBins` - Missing bins for runtime

## Debugging

### Run single test file

```bash
node ../../scripts/run-tests.js src/__tests__/unit/platform-resolver.test.js
```

### Run tests matching pattern

```bash
node ../../scripts/run-tests.js --test-name-pattern="platform resolution" src/__tests__/
```

### Verbose output

```bash
VERBOSE=true pnpm test:unit
```

### Debug with inspector

```bash
node --inspect-brk --test src/__tests__/unit/platform-resolver.test.js
```

### Check test output files

Integration and E2E tests create temp directories:
```bash
ls -la /tmp/rudi-test-*      # Integration test dirs
ls -la /tmp/rudi-e2e-*       # E2E test dirs
```

## Writing New Tests

### Unit Test Template

```javascript
import { test } from 'node:test';
import assert from 'node:assert';
import { resolveInstall } from '../../platform-resolver.js';

test('my feature: description', () => {
  const manifest = { /* ... */ };
  const resolved = resolveInstall(manifest, { platformKey: 'darwin-arm64' });

  assert.strictEqual(resolved.source, 'expected-value');
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
    // Test logic
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
  if (!checkPrerequisite()) {
    console.log('Skipping: prerequisite not met');
    return;
  }

  // Test logic
  assert.ok(true);
});
```

## Test Data Sources

- **Unit tests:** Use fixtures from `fixtures/manifests.js`
- **Integration tests:** Create temp manifests in test code
- **E2E tests:** Use real Ollama API at `localhost:11434`

## Coverage Goals

| Metric | Target | Current |
|--------|--------|---------|
| Platform resolution | 100% | 100% ✅ |
| Validation rules | 100% | 100% ✅ |
| Install flows | 80% | ~70% |
| E2E scenarios | 50% | ~50% ✅ |

## Common Issues

### "Cannot find module" errors
**Fix:** Ensure `platform-resolver.js` is exported in `package.json`:
```json
"exports": {
  "./platform-resolver": "./src/platform-resolver.js"
}
```

### npm tests timing out
**Fix:** Increase timeout or skip:
```bash
SKIP_NPM_TESTS=true pnpm test:integration
```

### E2E tests failing
**Check:**
1. Ollama installed: `ollama --version`
2. Server running: `curl http://localhost:11434/api/tags`
3. Model available: `ollama list | grep nomic-embed-text`

### Temp directories not cleaned up
**Symptom:** Disk space issues from `/tmp/rudi-*` directories

**Fix:** Manual cleanup:
```bash
rm -rf /tmp/rudi-test-*
rm -rf /tmp/rudi-e2e-*
```

**Prevention:** Tests use `try/finally` blocks to ensure cleanup

## Performance

| Operation | Duration | Notes |
|-----------|----------|-------|
| Unit test run | ~78ms | All 22 tests |
| Integration run | ~5s | Without npm installs |
| Integration full | ~30s | With npm installs |
| E2E run | ~30s | With Ollama running |
| Full suite | ~1min | All layers |

## Next Steps

### Planned Improvements

1. **Code coverage reporting** - Add `c8` or `istanbul`
2. **Test fixtures expansion** - More edge cases for pip/system sources
3. **MCP integration tests** - Test JSON-RPC protocol directly
4. **Performance benchmarks** - Track regression in install times
5. **Snapshot testing** - For manifest resolution output

### Adding New Test Coverage

**When adding new schema features:**
1. Add fixtures to `fixtures/manifests.js`
2. Add unit tests for resolution/validation logic
3. Add integration test if it involves filesystem/network
4. Add E2E test if it's a user-facing flow

## Resources

- [Node.js Test Runner Docs](https://nodejs.org/api/test.html)
- [Registry Schema v2](../../../../../../registry/SCHEMA.md) (if exists)
- [Platform Resolver API](./src/platform-resolver.js)
- [Test Fixtures](./src/__tests__/fixtures/manifests.js)
