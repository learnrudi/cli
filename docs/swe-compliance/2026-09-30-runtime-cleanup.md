# Runtime selection and CLI cleanup

## Phase 0: Baseline and manual lookup

- User authorized stepwise runtime fixes and safe removal of dead/old material.
- Medium risk: shell precedence, installer subprocess environments, generated launchers.
- Baseline: both canonical checkouts at `60c78b0`, with matching pending runtime-binding and native-skill changes. Published/main CLI is `1.10.27` at `be4593d`; active local CLI is already 1.10.27.
- Preservation: task baseline under `~/.rudi/outputs/runtime-cleanup/2026-09-30/` on the primary Mac. Preserve remote preimages before any remote change.
- Standards: manual index, Agent Co-Pilot, master doctrine testing/debugging, Horizontal Engineering standard, workspace retirement policy.
- Horizontal scan: installation already uses `buildNodeToolEnv`; postInstall is the diverging consumer. Reuse that mechanism. Two router test paths use a newer Node API than the supported runtime; use portable URL resolution.

## Phase 1: Scope lock

- Fix primary noninteractive login shell selection while preserving shared RUDI and explicit project/tool runtimes.
- Finish npm runtime binding through postInstall; retain fail-closed missing-runtime behavior.
- Restore supported-runtime compatibility of router tests.
- Reconcile already-published native-skill changes with current main without losing pending runtime work.
- Verify source/build/package lineage before any installed launcher change. Use published delivery for production; no silent replacement of a release with a dirty development bundle.
- Audit cleanup only within this runtime/CLI scope. Retain dependencies, tracked build output, archives, unknown files, and worktrees unless retirement gates pass.
- Expected edits: shell profile; installer and binding test; router characterization test; README; this ledger; generated CLI bundle after validation. Existing runtime helper/resolver/shim changes are part of the reviewed pending slice.
- Authorized: local fixes, read-only inspection, tests/builds, verified safe cleanup, peer reconciliation. No commits, pushes, PRs, npm publication, service restart, or branch deletion authorized.
- Commit slices when authorized: runtime behavior/tests/docs; generated bundle; distinct environment/retirement evidence. Keep unrelated published native-skill work out of the pending diff.

## Phase 2: Red tests

- Shell: fresh noninteractive login selects Homebrew Node 25 and fails on missing simdjson library.
- Binding: add one fixture exercising postInstall with a poisoned ambient Node; installation must still succeed through its bound runtime.
- Router: existing characterization tests fail under RUDI Node 20.10 because import.meta.dirname is undefined.

## Phase 3: Implementation

- Reuse the selected npm runtime environment for postInstall.
- Resolve router fixture paths with fileURLToPath(new URL(..., import.meta.url)).
- Keep edits narrow and preserve pre-existing user work.

## Phase 4: Green tests and refactor

- Rerun each red command unchanged, then the related installer/shim/integration/router suites.
- No speculative refactor. Record exact commands and results below.

## Phase 5: Full verification

- Required: pnpm test, pnpm build, focused SWE debt scan, repository debt runner, npm pack --dry-run, git diff --check.
- Live: shell modes, node/npm/pnpm versions; MCP initialization, tools/list and harmless stack call.
- Fresh-context read-only Standards/Spec/Proof review before closure.
- Peer: verify matching source hashes and affected tests, preserve any conflicting work.

## Phase 6: Closure

- Status: engineering verification and scoped cleanup complete; publication and hosted Dot connection remain separate delivery decisions.
- Publication: none authorized or performed.
- Cleanup inventory, removal evidence, preserved items, peer status, independent verdict and proof gaps to be recorded here.
- No new task worktree created. Existing worktrees require separate exact-path retirement evidence.

## Execution evidence

- Shell: `.zprofile` now selects the executable managed RUDI default after Homebrew initialization. Inherited non-login, fresh login, interactive login and minimal-environment login all pass: Node 20.10.0, npm 10.2.3, pnpm 10.22.0. Node 22 tool bindings remain explicit; Wrangler reports 4.131.1.
- Red command: `pnpm test --test-concurrency=1 packages/core/src/__tests__/unit/npm-runtime-binding.test.js src/__tests__/unit/router-mcp-characterization.test.js`. All three tests failed as expected: poisoned ambient Node reached by postInstall; two undefined import.meta.dirname paths.
- Same command green after the environment/path fixes: 3/3. Evidence: task output `red.log` and `green.log`.
- Both source checkouts fast-forwarded through normal Git history to `be4593d` (1.10.27), after preserving and verifying every preimage. Recovery stashes: primary `d3e00afcd5f318d15a07cfdb18af41609f2f90a5`; admin `3e6c4083c8907d8bab931d4215baffb8db3aafda`. Already-published native-skill changes are no longer duplicated in the pending diff. Newer published evidence replaces the stale local report; the old report is preserved in recovery.
- `pnpm install --frozen-lockfile --ignore-scripts` reconciled the accepted lockfile without running package lifecycle scripts.
- Full local `pnpm test`: 827/827 passed on the shared Node 20.10.0, no skips. `pnpm build`, `npm pack --dry-run --json`, and `git diff --check` passed.
- Removed unused `SCRIPT_DIR` and its now-unused URL import from the test wrapper; focused rerun required after this behavior-neutral cleanup.
- Focused `swe_debt_scan` (`pr-review`, nine exact JS files including untracked runtime helper/test): 0 findings. Repository `node scripts/agent-debt-runner.mjs --changed-since origin/main --no-log`: passed, 0 findings.
- Installed CLI remains published 1.10.27. The pending source bundle is distinguishable from that release and has not replaced it.
- Cleanup audit: no broken symlinks or editor/OS debris in the scoped CLI tree. `shims check` flags README and six dynamic TARGET wrappers; treat these as validator limitations until actual executable checks establish failure. Do not remove them on that report alone.
- Homebrew dependency audit was blocked by an untrusted MongoDB tap; no trust changes or Homebrew removals authorized by inference. The broken Node 25 stays outside default selection, pending a separate complete dependency audit.
- Retired `packages/embeddings` has no tracked files or package manifest, no source files, only leftover dependencies and empty source directories. Consumer/recovery checks pending before exact removal.
- The remaining checks at this intermediate checkpoint were completed below.

## Review corrections and cleanup result

- Fresh independent review initially returned two P2 findings: non-executable bound Node could fall back to ambient Node; a tool reached through requires.binaries omitted its explicit runtime dependency.
- Executable validation now checks regular-file and execute permission for both Node and npm. Regression uses a non-executable bound Node with usable ambient Node and requires rejection before installation. `nonexecutable-red.log` failed for the prior fallthrough; `nonexecutable-green.log` passed.
- Binary dependency traversal now includes the explicit Node runtime and rejects a missing required runtime. `dependency-red.log` showed the omitted runtime; `dependency-green.log` passed. After green, shared runtime lookup was extracted into resolveRuntimeDependency; adjacent resolver verification passed (`refactor-green.log`).
- Related launch guard now rejects a runtime path replaced by a directory. `directory-red.log` failed with missing expected exception; identical assertion passed in `directory-green.log`.
- The reviewer confirmed both findings closed and reran 8 tests; Standards/Spec/Proof pass for the corrections. This was focused confirmation following the fresh review, not represented as a second independent review.
- Final local full suite: 827/827 pass; build, package dry-run, diff check, repeated nine-file focused debt scan and repository debt runner pass. The additional runtime safety checks extend the existing behavior-level fixture.
- Removed behavior-neutral dead test-wrapper constant/import; final focused test-wrapper run passed 33/33.
- Cleanup: moved exact orphan directory `packages/embeddings` to primary Mac Trash as `rudi-cli-retired-embeddings-2026-09-30`; verified all 1,281 directory/file/symlink entries. No source, manifest, credentials, database or logs were present. 4,257,065 regular-file bytes remain recoverable; this is active-workspace cleanup, not a claim of disk space reclaimed. Recovery inventory lives in task output `embeddings-retirement.json`. Admin peer had no such leftover directory.
- Primary worktree inventory: 24 additional worktrees; four have local changes and eleven have heads not contained in main. All preserved pending owner, ignored-content and active-consumer checks plus exact retirement authorization. No branch deletion or metadata pruning performed.
- Homebrew Node retained: installed receipts for MongoDB community, MongoDB 6.0, mongosh and Gemini CLI declare a Node dependency. Repairing that installation is separate from deleting proven-unused material.
- Live router proofs on both Macs: initialization, tools/list and native router-dispatched swe_manual_list succeed (primary 447 tools, admin 469 tools, 13 manual documents each). No installed launcher or MCP configuration was changed.
- User explicitly authorized messaging the original Dot chat for its native MCP exposure check. It confirmed no RUDI MCP tools are exposed and swe_manual_list is unavailable. Its normal task shell now reports managed Node 20.10.0, npm 10.2.3 and pnpm 10.22.0. No hosted endpoint, tunnel or public exposure was created.

## Final delivery boundary

- Both Macs passed the final 827-test suite after review corrections, build, repository debt runner, package dry-run and diff check. All eleven runtime source/build files have matching SHA-256 values after the peer rebuild. The six package files match the publishing contract.
- Development bundle hash: `ff7f64384fc2000ba796bf382ae40540b251ab0fce6f65c148af21a3af02b0c7`. Both installed CLI bundles still match accepted 1.10.27 exactly: `237bd3a7efa0ec90c73ecfdfa7033d97238d233bf24eb72bce3cdedc68ef8b3a`. The pending changes have not been disguised as an installed release.
- Independent review: initial two P2 findings corrected through red-green tests; focused confirmation passes Standards, Spec and Proof with no remaining deterministic findings. Final full checks above complete the implementation proof.
- Horizontal disposition: consolidate runtime dependency lookup here; reuse existing installation environment here. Retain separate low-level executable probes at their owning boundaries because this binding additionally requires regular files; no global path-resolution rewrite. Task-specific hosted MCP exposure is an integration follow-up, not evidence of a router defect.
- Source publication remains uncommitted/unpushed on both canonical checkouts. No pull request, merge, npm release, deployment or service restart was performed. Future slices: reviewed runtime source/tests/docs, then generated bundle and release metadata through the normal authorized release workflow.
- Dot's native MCP path remains unverified because no RUDI tools are exposed in that hosted chat. A supported connection must be identified and configured before claiming end-to-end Dot access.
- Homebrew Node 25 remains broken but is no longer selected by the repaired normal task shell. It has declared consumers and is not dead material; repair it through a separately reviewed Homebrew dependency/tap operation.
- Unknown/active worktrees, archives, dependencies and preservation stashes remain intact. Cleanup does not infer retirement from age or a clean status.
- Closeout receipts: `runtime-cleanup-20260930-primary` and `runtime-cleanup-20260930-admin`, both version 2, `preservation_required`, read back through each Mac's Repo Steward. Both leases released. Cleanup ineligible; canonical source and recovery evidence must remain. Ledgers live under each Mac's `~/.rudi/state/repo-steward`.
- Final verdict: **ready for publishing authorization**, with local shell repair and scoped recoverable cleanup complete; hosted Dot MCP setup is a separate remaining integration task.
