# CLI platform delivery binding — 2026-10-21

## Phase 0: Baseline and manual lookup

- [x] Final node `cli-binding-final`, attempt `cli-binding-final-1`, prepared
  plan117; branch `codex/platform-delivery-binding-20261021`, unchanged HEAD
  `510dee13a803e772023d87fe55f9b6ef5c3dfdd2`. Earlier v2 candidate uncommitted.
- [x] Read current CLI/workspace AGENTS, README, Quality workflow, source proof,
  and exact corrected System generator/focused Astra approval. Follow SWE
  checklist, doctrine, Agent Co-Pilot, Security F8 and Infrastructure H1.
- Risk: high CI identity trust boundary; no application behavior change.
- Invariants: preserve every old event/job/command/runtime/action pin/permission,
  strict aggregate, tracked distribution and manual publishing workflows.

## Phase 1: Scope lock

- Only `.github/workflows/quality.yml`, README and this record may change.
- No application/test/manifest/lock/dist/manual-workflow edits, actual token or
  credential requests, publication/settings, Admin, runtime/provider/deploy/DB.
- Corrected producer: `rudi-system/scripts/platform-delivery/binding-job.mjs`,
  SHA-256 `a69af1e7d8455c3f5fbdd001d5fd9c08a278a58af8ca08a4607a2f21d9413c16`.
  Exact Node-rendered job SHA-256
  `d2cd4aefe1d39496712059758bfdfa4996d0bd5f32b379ecd2305ebe38284646`.
- Schema2 keeps repository/PR/head/base/merge/run/attempt fields and opaque
  GitHub job-specific JWT for audience `urn:rudi:platform-delivery:ci-proof`.
  Metadata checks out no source; only it has job-local id-token:write alongside
  contents:read. All original jobs retain contents:read without token minting.
- Redirects prohibited, request/response bounded, failures sanitized before any
  output; exclusive immutable artifact and custody markers remain. No cloud
  exchange or producer signature validation. Controller crypto remains separate.
- One planned uncommitted slice: corrected job, DAG and docs after consumer-wide
  independent review. User requires CI/review results and remaining gates before
  automatic live behavior. No commit, push or activation is authorized here.
- Horizontal disposition: standardize semantics at canonical System generator;
  intentional exact projections across Git repositories. System owns source;
  manager owns hashes/regeneration/policy/hosted qualification. Source change
  triggers re-review; exact projection/DAG/custody closes the contract.

## Phase 2: Configuration red

- [x] Final unchanged `cli-binding-final-proof.py` command fails on pre-redirect
  candidate with exit1 `approved_v2_binding_projection_missing_or_changed`.
- Earlier CLI source/log/proof/result snapshots remain immutable. Their producer
  eaf3f0ad snapshot and 16-case local proof do not cover this corrected job.

## Phase 3: Implementation

- [x] Regenerate only metadata job; retain scalar quality-matrix dependency on
  delivery-binding, existing quality aggregate and every old workflow value.
- [x] Main-push program exits successfully before identity inputs/requests;
  PR-only artifact/custody skip and normal matrix verification remains eligible.
- [x] Metadata-only OIDC grant, README current source hash/approval/limits.

## Phase 4: Green and actual projected-code proof

- [x] Same final proof command exits0. Raw/parsed generated job equals frozen
  approved rendering. Remove only metadata and the matrix's new dependency edge
  and entire parsed workflow equals published baseline, including action tags,
  Node22/24 matrix and Node24.22 runtime pin, commands, events and permissions.
- [x] Every actual run block passes bash syntax. Existing unchanged quality
  aggregate runs six result values: only success passes; failed/cancelled/skipped/
  empty/unknown fail. No refactor or weakened assertion.
- [x] Actual projected Python metadata/custody bodies run through the unchanged
  hash-bound focused producer probe: 41/41 cases pass, including schema2/attempt,
  custom audience/time/size, non-PR zero-request behavior, invalid input/endpoint/
  envelope, exclusive output, sanitized failure/custody and 15 redirect cases.
- Actual urllib redirect processing executes with transport mocked, real sockets
  disabled and synthetic identity environment. No real token/credential/provider
  access, token logging, signature or real hosted claim qualification occurs.
- [x] Both manual publishing workflows byte-identical; dist and manifests clean.

## Phase 5: Current application proof reuse

- [x] Earlier five hash-bound proof logs inspected and unchanged. Application,
  tests, package/lock and tracked dist remain unchanged; no broad repeat.
- Previous supported Node22.23.2 / pnpm10.22.0 proof remains current:
  pnpm frozen install passed; RUDI_CLI_TEST_WRAPPER_ACTIVE=1 pnpm test passed
  947/10 skipped of957,72.422s; pnpm build passed with inherited CJS import.meta
  warnings and identical dist; prescribed changed-debt runner no-scan-targets;
  npm pack dry-run passed with10 files. Ambient24.21 was not used for packages
  because it is below CLI's declared24.22 floor.
- [x] git diff --check and exact three-path/empty-index checks pass. No JS/TS
  edits/new dependency; no additional debt/source/build run justified here.
- Hosted Node24.22/Linux and actual OIDC eligibility, official issuer/JWKS/alg/
  audience/time and signed exact job/run/attempt/repository/event/ref/sha/workflow
  claims, final workflow/DAG, artifact bytes/ID/digest and own-log/timestamp custody,
  merge parents and metadata-before-code ordering remain unqualified.
- Actionlint/provider execution and full runtime R2 crypto not established by
  mocked fixtures; controller/automatic live behavior remain disabled.

## Phase 6: Docs, review and closure

- [x] README matches corrected source, source authority and privilege boundaries.
  No command/daemon/install/bridge/runtime contract changes need other guides.
- Focused producer approval: `astra-ci-identity-focused`, attempt
  `binding-v2-focused-confirmation-1`, completed2026-10-21T13:34:54Z, all axes pass
  for corrected producer/rendering; CI1 closed. Consumer DAG/runtimeR2/hosted/
  Admin/activation are excluded from this producer approval.
- [ ] Fresh consumer-wide Astra confirmation before publication; complete runtime
  R2 crypto, hosted/Admin qualification and existing authority/holds before live.
- All merges/auto-live disabled. No commit/push/PR/settings/Admin/provider/deploy/
  database/activation or other-repository edits. Existing source evidence retained.
- New manager artifacts: cli-binding-final proof, red log, green JSON, diff and
  result with exact final hashes. Prior snapshots are not modified.
- Worktree retained; manager owns non-mutating closeout after acceptance naming
  node/attempt, worktree/lineage and exact revision. No cleanup authorized.
- Accepted application debt: none introduced; inherited package warnings remain.
- Verdict: local corrected projection ready for consumer review; publication and
  automatic live behavior held pending separate review/qualification results.
