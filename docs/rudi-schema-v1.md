# RUDI Session Schema v1

`rudi-schema v1` defines a provider-agnostic document contract for session intelligence.
It is built from the existing local DB (`sessions`, `turns`) and is designed for:

- cross-agent adapters (Claude, Codex, others)
- local/cloud sync payloads
- stable analytics and policy engines

## Namespace and Version

- `schemaNamespace`: `io.rudi.session.v1`
- `schemaVersion`: `1.0.0`

### Version Compatibility Policy

- Producers emit the current stable version (`1.0.0` right now).
- Consumers must accept any `1.x.y` version for `io.rudi.session.v1`.
- Breaking changes require a new namespace/major (`io.rudi.session.v2` + `2.0.0`).
- Non-semver values and major `2+` are rejected by v1 validators.

## Document Kinds

1. `session`
2. `turn`

## Session Document (high level)

Required:

- identity: `id`, `provider`, `status`
- schema: `schemaNamespace`, `schemaVersion`, `kind=session`
- metrics: `turnCount`, `totalCostUsd`, `totalInputTokens`, `totalOutputTokens`, `totalDurationMs`

Optional/enrichment:

- linkage: `parentSessionId`, `sessionType`
- context: `cwd`, `projectPath`, `projectId`, `gitBranch`, `originNativeFile`
- metadata: `title`, `snippet`, `model`, `agentId`, `permissionMode`, `compactMetadata`
- timestamps: `startedAt`, `lastActiveAt`, `completedAt`

Reference JSON Schema:

- `src/schema/rudi-session/v1/session.schema.json`

## Turn Document (high level)

Required:

- identity: `id`, `sessionId`, `provider`, `turnNumber`, `ts`
- schema: `schemaNamespace`, `schemaVersion`, `kind=turn`
- content object:
  - `userMessage`, `assistantResponse`, `thinking`
- usage object:
  - `inputTokens`, `outputTokens`, `cacheReadTokens`, `cacheCreationTokens`, `contextTokens`, `costUsd`, `durationMs`, `durationApiMs`
- tooling object:
  - `toolsUsed`, `toolResults`, `todos`, `imageIds`

Optional/enrichment:

- execution: `model`, `permissionMode`, `finishReason`, `error`, `kind`, `serviceTier`, `apiRequestId`
- linkage: `providerSessionId`, `providerTurnId`, `parentTurnId`, `uuid`, `logicalParentId`, `leafUuid`
- compaction metadata via `tooling.compaction`

Reference JSON Schema:

- `src/schema/rudi-session/v1/turn.schema.json`

## Mapper and Validator API

Implemented in:

- `src/schema/rudi-session/v1/index.js`

Exports:

- `toSessionDocument(row)`
- `toTurnDocument(row)`
- `validateSessionDocument(doc)`
- `validateTurnDocument(doc)`
- `isSchemaEnvelopeCompatible(doc, expectedKind?)`
- `RUDI_SCHEMA_NAMESPACE`
- `RUDI_SCHEMA_VERSION`
- `RUDI_SCHEMA_MAJOR`

## Compatibility Test

`src/__tests__/unit/session-schema-v1.test.js` verifies:

- ingester output maps to valid v1 session/turn docs
- context/cost fields flow through
- compaction metadata survives mapping

Run:

```bash
cd cli
node scripts/run-tests.js src/__tests__/unit/session-schema-v1.test.js
```

## Design Notes

- This contract intentionally allows additional fields (`additionalProperties: true`) for forward compatibility.
- v1 is local-first: it standardizes the envelope for adapters and sync, without forcing a migration of internal DB tables.
- JSON schemas in `v1/` enforce `schemaVersion` pattern `^1\.\d+\.\d+$` (major-compatible, not patch-pinned).
