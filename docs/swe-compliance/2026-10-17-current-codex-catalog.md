# Current Codex model catalog

## Scope and evidence

- User requested current model choices after a Compute review selected GPT-5.6 Sol/high from the stale packaged catalog.
- Baseline: `fb2405c` (`origin/main`), isolated branch `codex/current-codex-catalog-20261017`.
- Manual: engineering index and agent co-pilot operating standard; red-green-refactor and explicit boundary validation apply.
- Official source, retrieved October 17, 2026: https://learn.chatgpt.com/docs/models and https://developers.openai.com/api/docs/guides/latest-model.
- Add GPT-6 Astra, GPT-6.1 Sol, GPT-6 Sol, and GPT-6 Luna with Codex reasoning controls. Default/sol becomes GPT-6.1 Sol; luna becomes GPT-6 Luna. Exact older IDs remain supported, preserving pinned profiles.
- No account, permission, timeout, custody, credential, provider-selection, or worker lifecycle changes. Unsupported model/effort combinations still fail before admission. No new dependencies.
- Commit boundaries, when authorized: catalog/tests/docs; generated distributions separately. No commit, publication, merge, or installed-worker adoption is authorized by this change record.

## Red-green evidence

Using `/Users/hoff/.rudi/runtimes/node-22-23-2/bin/node` (22.23.2):

1. `node --test src/__tests__/unit/agent-task-effort.test.js` failed with `task requires an exact configured model` before catalog additions. After additions: 4 tests passed.
2. `node --test src/__tests__/unit/provider-models.test.js` failed because the default remained `gpt-5.6-sol`. After alias/default changes: 11 tests passed.
3. Combined command passed all 15 tests. No refactor was needed. Native invocation assertions prove the exact model and xhigh argument survive validation; Luna/ultra and Astra/none are rejected.

Initial setup failures were not counted as red proof: missing worktree dependencies, then Node 22 versus Node 24 native SQLite ABI mismatch. Installed locked dependencies offline into the isolated worktree and rebuilt its SQLite dependency for Node 22. No lockfile or global runtime changed.

## Verification and delivery

- `pnpm build`: passed; existing CJS/import.meta warnings remain. Generated changes are confined to the catalog in `dist/index.cjs` and `dist/task-capsule-worker.cjs`.
- `node dist/index.cjs agent models codex --json`: exposes the seven models, current default, and per-model efforts.
- Focused `swe_debt_scan` on both edited JS tests: zero findings.
- `node scripts/agent-debt-runner.mjs --changed-since origin/main --no-log`: passed with zero findings.
- `npm pack --dry-run` and `git diff --check`: passed.
- Full `pnpm test` with `PATH=/Users/hoff/.rudi/runtimes/node-22-23-2/bin:$PATH` and `RUDI_CLI_TEST_NODE=/Users/hoff/.rudi/runtimes/node-22-23-2/bin/node`: passed, 928 passed / 10 skipped / 0 failed (938 total). Native Admin account/model acceptance is not covered by this local suite.

Admin still runs the immutable October 17 Codex bundle. Do not edit it in place or bypass its guard. Source publication, accepted Admin checkout update, new bundle qualification, selected-account native model acceptance, and catalog pointer adoption remain delivery gates. Unit tests and catalog metadata do not prove `codex-hoff` account access to the new models.

The original project-root write rejection is separate: registered task write roots must match deliverables and exclude the project/control roots. The narrowed Cloud review was a manual revision-2 job with report-only writes; it did not update repository files and has no recurring schedule. Its validated completion receipt reports `needs_evidence`, with the selected and observed identity both `codex-hoff` / `hoff@learnrudi.com`. GitHub credentials and executable Node/pnpm were unavailable inside the restricted job. The checkout was clean at `bdc67e9b45b0ca13181cfc0fdcd71eb87a635609`; live freshness was not proved. The report hash is `9a9e5b6e0ed6214a0a88c857d69985d8104446e04d08eefc0c102b4e63910eb4`.
