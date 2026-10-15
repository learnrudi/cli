# Fix initialization and dynamic npm inventory

## Phase 0: Baseline and diagnosis

- User authorized both code fixes and fresh-install verification on both Macs.
- Baseline: `65c36efffdeb93c165da5abb3dbaac57725a9ae4`, CLI 1.10.29. Five
  uncommitted documentation files from the preceding audit are preserved in
  `~/.rudi/outputs/cli-onboarding-fixes-20261015/baseline` before updating them.
- Admin canonical checkout is clean at the same revision; existing instructions
  and workspace boundaries still apply. No installed CLI activation authorized.
- Diagnosed causes: init queries obsolete nested registry entries and suppresses
  partial failure; listInstalled scans only immediate binary directories and
  misses dynamic npm manifests under `binaries/npm/<sanitized-name>`.
- Standards: SWE Master Doctrine testing/failure boundaries, Agent Co-Pilot,
  Horizontal Engineering, checklist and independent review workflow.
- Risk: medium; initialization installs software, inventory feeds other callers.

## Phase 1: Scope and interfaces

- Use shared core `installPackage(id, options)` for four bootstrap IDs, honoring
  force and reporting already-installed/failed results. Remove init's obsolete
  downloader. Preserve skip-downloads, optional shims and instruction opt-out.
- Fail initialization on any required installation/instruction failure; retain
  successful work for retry and omit success wording when incomplete.
- Discover nested dynamic npm manifests in shared inventory, preserving their
  `npm:` identity and binary classification used by the installer. Validate the
  new directory boundary and preserve existing package discovery behavior.
- Files: init command/tests, core inventory/tests, shared shim helper, relevant docs, generated dist.
  Shared shim integration only if needed to preserve init's opt-in behavior.
- Non-goals: legacy database retirement, provider auth, publication, existing
  user installs, unrelated refactors or registry-wide changes.
- Commit slices when authorized: behavior/tests/docs; generated distribution.
  Commits, pushes and publication remain unauthorized.
- Both-Mac proof: build candidate packages independently from exact source on each host
  (admin uses a separate temporary checkout); fresh homes/prefixes/caches and public
  registry downloads. No existing user state or credentials enter the test.
- Horizontal disposition: consolidate init installation into the current core
  installer, and fix discovery in shared inventory rather than CLI presentation.

## Phase 2: Red tests

- One regression at a time: schema-v2 initialization; nonzero partial failure;
  npm inventory before/after removal; scoped npm identity and invalid entries.
- Record exact red and unchanged green commands below.

## Phase 3: Implementation — complete

- Removed init's obsolete registry lookup and duplicate downloader. Bootstrap
  IDs now use core `installPackage`, including schema-v2 resolution, checksum
  validation, system-package detection and existing transactional installation.
- Initialization records package errors on stderr, keeps completed work, and
  throws before success wording if any required package/instruction failed.
- Force, skip-downloads, quiet and instruction opt-out remain supported. Runtime
  shims remain opt-in. System SQLite shims can also be enabled on a later init
  with downloads skipped. Init reconciles shims once through the shared helper,
  whose new optional quiet argument suppresses success output but keeps warnings;
  other callers retain the existing default output.
- Shared inventory reads one dynamic-npm directory level, retains `npm:` IDs
  with binary classification, validates the manifest's canonical directory,
  and does not descend into dependency trees or symlinked directories.
- No dependency, version, registry metadata, or installed user-state changes.

## Phase 4: Red/green and refactor — complete

Evidence directory on each host: `~/.rudi/outputs/cli-onboarding-fixes-20261015`.
Primary red/green records:

| Behavior | Command | Red | Green |
| --- | --- | --- | --- |
| Schema-v2 bootstrap | `pnpm test src/__tests__/unit/init-command.test.js` | Exit 1: Node executable absent | Exit 0 (`init-schema-*.log`) |
| Partial checksum failure | Same command | Exit 1: init incorrectly returned 0 | Exit 0 (`init-failure-*.log`) |
| Nested npm inventory | `pnpm test packages/core/src/__tests__/unit/installer-list-installed.test.js` | Exit 1: inventory length 0 instead of 1 | Exit 0 (`list-npm-*.log`) |
| Later system-shim opt-in | Init test command | Exit 1: SQLite shim ENOENT | Exit 0 (`init-system-shim-*.log`) |
| Quiet shim creation | Init test command | Exit 1: shared shim logs violate empty stdout | Exit 0 (`init-quiet-shims-*.log`) |

- Combined targeted command: `pnpm test src/__tests__/unit/init-command.test.js
  packages/core/src/__tests__/unit/installer-list-installed.test.js`: 13 passed.
- Additional regression checks cover repeat/force, quiet missing-entry failure,
  scoped versioned npm IDs, no dependency/symlink traversal, identity mismatch,
  and removal. Existing stack/skill normalization tests remain green.
- No unrelated refactor; obsolete init downloader/helpers removed in the shared
  installer consolidation. Final reruns use unchanged behavioral assertions.
- Two planned commit slices remain uncommitted: behavior/tests/docs; generated
  distribution. Existing cleanup documentation remains preserved.

## Phase 5: Verification

| Check | Result |
| --- | --- |
| Primary full `pnpm test` | 878 passed, 0 failed/skipped; `full-tests-primary-reviewed.log` |
| Admin full `pnpm test` | 878 passed, 0 failed/skipped; `full-tests-admin-reviewed.log` |
| `pnpm build` | Passed independently on both Macs |
| Focused stack debt scans | Init/tests and shared inventory/tests: 0 errors/warnings/findings |
| Repository debt runner | Passed on both Macs; 0 findings |
| npm package | Independently built tarballs are byte-identical; six payload files |
| Fresh-home tests | Both hosts passed all 40 requested-flow assertions |
| Independent Standards/Spec/Proof review | All axes pass after focused confirmation of quiet-output correction |

The smoke harness performs npm installation from a candidate tarball into a
new prefix/home/cache, then exercises version/help, empty inventory, full init,
Node/Python/SQLite/ripgrep executables and shims, repeat init, TypeScript install
and execution, general/binary/text inventory, removal, and post-removal
inventory. It tests the CLI after putting the new managed shims first on PATH.
Fresh installs create no legacy database. Each subprocess must exit zero and
each semantic assertion must hold; the original false-success cases cannot
pass solely through exit status.

Reproduce: `python3 fresh_install.py --node <absolute-supported-node>
--package <absolute-candidate-tgz> --output <new-evidence-directory>`.
Final reports are `fresh-primary-reviewed/report.json` on primary and
`fresh-admin-reviewed/report.json` on admin. Scripts/logs remain host-local.
Only the explicit non-secret source patch and test harness were transferred;
admin installed dependencies, built the bundle and packed it independently.

Exact-candidate correspondence:

- Source patch SHA-256: `bee72fe25a66e64bd30134328dfe1182f84005d3b8db596a737f9f12d0be5385`.
- `dist/index.cjs`: `8f7753e9ca2ed1f68359a91cc084bbd9a225c1394bed05480d01978e035ad702`.
- Candidate npm tarball: `cf46b68562748fcad05d7a14c487164ff319b640b8a36d9a8d56b5f7b055db48`.

### Separate registry compatibility gap

Both public-registry tests resolved `runtime:node` to **20.10.0**, while the CLI
requires Node 22/24. The requested initialization/inventory checks pass, but
this is not complete onboarding acceptance: a managed Node shim first on PATH
selects an unsupported major. Reports explicitly record
`requested_fixes_passed: true`, `managed_node_supported: false`, and
`complete_onboarding_ready: false`. No claim is made about native dependencies
or daemon operation on Node 20.

Owner: registry/CLI maintainer. Trigger: before the next onboarding release.
Closing proof: update the public default runtime through its owning registry
workflow, verify downloads/checksums on both architectures, then repeat fresh
bootstrap including native dependency and daemon checks on supported Node.
This separate registry change is outside the two approved CLI fixes.

## Phase 6: Closure

- Docs distinguish published 1.10.29 defects from this unpublished candidate,
  and document the separate registry compatibility gap. The original cleanup
  ledger remains historical; its two implementation obligations are closed by
  this change and its assertions.
- Main production changes: init command, core installer inventory and optional
  quiet output in the shared shim helper; regression
  tests beside each; generated `dist/index.cjs`. No unrelated runtime changes.
- Admin canonical checkout remains clean at baseline. Matching candidate source
  is preserved in `/Users/admin/RUDI/worktrees/cli-onboarding-fixes-20261015`.
  Canonical peer reconciliation is deferred until Git publication is authorized.
- No commits, pushes, PRs, releases, service restarts or installed CLI upgrades.
- Independent review: the first pass found success output leaking through
  `init --quiet --with-shims`. A behavior-level red test reproduced it; the
  shared-helper quiet option and single init shim pass fix it. Focused confirmation passes Standards, Spec and Proof, including the
  exact rebuilt packages and both-host tests. No unresolved actionable findings.
  Review artifact: `independent-review.md` in the evidence directory.
- All six disposable installation homes were removed after verification (three
  per Mac); scripts, command logs, reports, source patches and candidate tarballs
  remain in their host-local evidence directories. Tests did not modify either
  real RUDI home or existing installed CLI.
- Canonical primary Repo Steward receipt: `cli-onboarding-fixes-20261015`,
  version 2, `preservation_required`, read back successfully; lease released.
  Cleanup is ineligible because the checkout is dirty and source/evidence must
  remain preserved. Ledger root: `~/.rudi/state/repo-steward`. No cleanup approval
  was requested or inferred.
- Admin verification checkout is retained as an exact, checksum-verified source
  copy; it contains no unique edits. Its dedicated remote Repo Steward receipt
  is a closeout proof gap: the active tool connection records only this primary
  checkout. Owner: CLI maintainer; trigger: publication/retirement of this test
  checkout; closing proof: record/read back its remote receipt and verify the
  accepted commit or preserved source patch before cleanup. No remote checkout
  cleanup was attempted.
- Proof limits: tests use isolated user state on existing Macs (primary arm64,
  admin x64), supported standalone Node 24.21.0 and OS utilities. No new OS
  accounts, Linux/Windows, Node 22, provider login, authenticated stacks or daemon
  acceptance are claimed. Registry Node compatibility remains a separate gap.
- Final scope verdict: **ready for review/publication of the two CLI fixes**.
  Both-Mac requested-flow verification and independent review pass. Complete
  onboarding readiness remains blocked by the separate registry runtime gap.
  Remote verification-checkout closeout remains the explicit administrative
  proof gap above; preserve it until the owning maintainer records disposition.
