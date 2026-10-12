# Speech timeout and late-result recovery

## Scope and baseline

User authorized a 150-second speech generation router timeout and preservation
of late results. Both Macs started with clean CLI source at `67043c0` and the
installed router matching `dist/router-mcp.js` (SHA-256
`9e8ca64cb094d03340e0dcde2ddd00beaf2ea98992bb715131fb24c7848486e4`).

Confirmed cause: the router's default 30-second deadline precedes speech's
120-second provider timeout / 125-second outer allowance. Timeout deleted the
pending request, so later responses were discarded and unfinished stacks could
be evicted as idle. The original provider outcome remains unknown; no evidence
establishes provider throttling or a serialized router queue.

Installed discovery reports configured credentials for OpenAI, ElevenLabs, and
Gemini. This is configuration evidence, not a live quota or provider-health test.

## Contract and exit criteria

- Speech `generate_speech` defaults to 150000 ms, with explicit per-tool settings
  retaining precedence. Other defaults remain unchanged.
- A timed-out call is not automatically retried or falsely reported cancelled.
  Its timeout identifies a private JSON recovery receipt under the local
  `outputs/router-results` directory. Inputs and environment are not recorded.
- Keep unfinished calls active for pool cleanup. Preserve final responses,
  including provider errors; make stack exit/shutdown an explicit unknown
  outcome. Bound retained calls rather than silently evicting them.
- Receipts use atomic replacement and owner-only permissions; persistence
  failures must be reported without exposing response bodies.
- Verify real stdio behavior with local deterministic fixtures, including a
  response after 30 seconds, late success/error, lifecycle and storage failures.
- Run focused regressions, repository tests/build/package checks, JS debt scan,
  and the same relevant checks on the admin Mac. No paid synthesis needed.

## Delivery boundaries

Planned slices: router behavior plus tests; documentation and release metadata;
generated bundle. The user explicitly authorized committing and releasing the
fix and installing the released version on both Macs. Release `1.10.29` through
a feature-branch PR, required quality checks, a normal merge commit, and the
existing `publish-npm.yml` trusted-publishing workflow. Never push to main.
Reconcile the verified peer patch into the accepted Git history without losing
remote work, then install the exact npm version on each Mac. Each Mac retains
its own rollback copies; no credentials or runtime state are transferred.
Existing MCP sessions require reconnect; do not interrupt other active work.

## Test record

- Red: `pnpm test src/__tests__/unit/router-settings.test.js` failed because the
  timeout supplied no recovery file. Green: same command passed all five tests,
  including actual late receipt content and protection from idle cleanup.
- Speech boundary: `pnpm test --test-name-pattern='speech generation can finish' src/__tests__/unit/router-settings.test.js` initially failed after 30000 ms;
  after the 150000 ms default, the same 30.5-second operation passed.
- Additional sequential red/green commands used the same test file with
  `--test-name-pattern='stack exit after'`, `'storage recovers'`,
  `'retained calls apply'`, and `'router shutdown marks'`. Each first failed on
  the missing observable behavior (stale pending status, lost write retry,
  undispatched-work capacity, or shutdown status), then passed unchanged.
- Adjacent coverage preserves late JSON-RPC errors and `result.isError`, verifies
  no provider replay, and verifies capacity becomes available after completion.
- Full `pnpm test`: **869 tests / 43 suites passed**, no failures or skips.
- `pnpm build`, `npm pack --dry-run --json`, `git diff --check`, and
  `node scripts/agent-debt-runner.mjs --changed-since origin/main --no-log` passed.
- Focused `swe_debt_scan` included all four edited/new JS/MJS files with the
  standalone router entrypoint: zero errors, warnings, or informational findings.
- No broad refactor or dependencies. Receipt I/O is isolated in a small module.

## Operational limits

Receipts preserve the original response, not a claim of provider success. No
automatic retry occurs. Disk-write failures retain the latest state in bounded
memory and retry the local write during cleanup. Shutdown or process loss while
storage is unavailable can lose in-memory state; stale `pending` with a dead
router PID means unknown outcome. Normal shutdown records `interrupted`.

The host's MCP deadline is 960 seconds on the primary Mac, already sufficient.
Validation uses deterministic local stacks and no paid speech generation;
provider latency, quota, and audio quality remain outside this repair's proof.

## Installation and peer verification

- Before release preparation, both canonical checkouts retained the same
  verified source patch and were reconciled by checksum.
- Admin Mac: **32 focused source tests passed**, build, package dry run, repository
  debt scan, and diff checks passed.
- Reused the unchanged behavior tests against each actual installed router
  bundle: **11/11 passed on each Mac**, including the 30.5-second speech case,
  late success/error recovery, temporary storage failure, capacity, and shutdown.
- Installed router and CLI distribution router on each Mac have SHA-256
  `57cebf20bf822db50f58b68d8b1f484ff9dd386b1c2d5503ae26813b8d3c130c`.
- Each Mac's own settings now contain
  `stacks["stack:speech-generator"].toolTimeoutMs.generate_speech = 150000`.
  Other settings, including audio transcription, were preserved. Both Codex
  host deadlines are 960 seconds. No credential or runtime-state transfer.
- Local evidence and rollback copies on each Mac:
  `~/.rudi/outputs/speech-router-fix-2026-10-12/`. Keep these until this repair is
  incorporated into an accepted CLI release; a future CLI update may replace
  the unreleased router bundle. Restore that Mac's `router-before.js`,
  `cli-router-before.js`, and `router-settings-before.json` only for an explicitly
  requested rollback, then reconnect.
- Rerun installed checks from the CLI repository with
  `pnpm test ~/.rudi/outputs/speech-router-fix-2026-10-12/installed-router.test.mjs`.
- Existing MCP connections were not killed. Reconnect RUDI MCP or restart Codex
  to load the repair in already-running chats. New router processes use the fix.

## Release 1.10.29

- Publication authorization: explicit user request to commit, release, and put
  both Macs on the released version. Required PR and merge steps are part of
  the repository's release route.
- Baseline `origin/main` remained `67043c0`; npm latest was `1.10.28`, and
  `1.10.29` was absent at preflight. No unrelated source changes were present.
- All seven task files on both Macs matched the already-tested snapshot before
  staging. `pnpm audit --prod --audit-level=moderate` found no known advisories.
- Only package metadata and its generated CLI bundle change for the version
  bump; router behavior remains the implementation proven above. Red/green
  testing is not repeated for the metadata-only bump. CI and the publication
  workflow rerun the full test/build/debt/package gates on accepted source.
- Release proof must verify npm version, integrity and provenance, compare
  published router bytes with the accepted bundle, install from npm on both
  Macs, and rerun the installed-router tests. Preserve machine-local settings
  and leave already-running MCP connections undisturbed.
