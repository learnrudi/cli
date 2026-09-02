## Phase 0: Baseline And Manual Lookup

- Durable issue: `learnrudi/cli#42`, “Preserve bundled Codex metadata during skill sync.”
- Scope: make Codex native-skill reconciliation preserve a canonical package's `agents/openai.yaml` verbatim, including `policy.allow_implicit_invocation: false`, while retaining generated metadata as the fallback when the canonical file is absent.
- Base: isolated worktree `/Users/hoff/RUDI/worktrees/cli/issue-42-codex-skill-metadata`, branch `fix/42-codex-skill-metadata-sync`, based on `origin/main` at `aad3a1d38745eaf52b1623fe92b79123ae72b6cb`.
- Relevant standards: Master Engineering Doctrine; Testing Doctrine and Agent-Assisted Red-Green-Refactor; debugging doctrine; horizontal engineering review standard; repository `AGENTS.md` native-skill lifecycle and generated-artifact requirements.
- Initial evidence: the Registry's canonical `codex-tasks/agents/openai.yaml` contains the non-implicit policy, while current `src/native-skills/lifecycle.js` always renders `agents/openai.yaml` from `buildCodexSkillFiles`; forced reconciliation therefore replaces the authoritative metadata with the generated subset.
- Baseline focused test setup initially failed because the isolated worktree had no workspace links (`ERR_MODULE_NOT_FOUND: @learnrudi/utils`). `pnpm install --frozen-lockfile` restored only lockfile-declared workspace dependencies; this is setup evidence, not the behavior-level red result.
- Risk tier: medium. The change affects persistent, user-visible native host metadata and invocation policy, but is restricted to one projection file and has an explicit fallback.
- Exit criteria: current owner, failing boundary, scope, invariants, proof commands, and authority are recorded before production edits.

## Phase 1: Scope Lock

- In scope: `src/native-skills/lifecycle.js`, one focused regression in `src/__tests__/unit/native-skill-lifecycle.test.js`, tracked `dist/index.cjs`, and this evidence record.
- Non-goals: changing canonical package schema or Registry contents; projecting arbitrary `agents/` content to other hosts; changing parsers, dependencies, receipts, CLI syntax, install behavior, release state, live user projections, admin-Mac state, or unrelated saved work.
- Invariants: an existing canonical Codex metadata file is byte-authoritative; absent metadata uses the existing generated fallback; complete-package validation still rejects symlinks; only Codex receives `agents/openai.yaml`; source packages are never mutated; drift and force semantics remain unchanged.
- Trust boundaries: canonical package paths and file types are untrusted. The complete-tree inspection must validate the package before authoritative metadata is read, and no symlink may be followed.
- Designed failure: unsafe or unreadable package metadata fails the projection as the existing lifecycle does for unsafe package content; no partial target promotion is permitted.
- Horizontal scan: current `main` centralizes native projection in `src/native-skills/lifecycle.js`; `src/commands/skills.js` is an adapter and no competing Codex renderer exists. Disposition: no broader obligation; fix the single owner and preserve the existing portable-host boundary.
- Authorized actions: public issue, isolated issue branch/worktree, checklist, implementation, independent review, coherent commits, push, and pull request. Stop before merge. Release, product install/activation, live projection changes, admin sync, and unrelated cleanup remain unauthorized.
- Commit plan: behavior source/test commit; dedicated generated-dist commit; final evidence/checklist commit. Every commit references issue #42.
- Exit criteria: only the listed behavior and files are admitted, with no dependency or schema changes.

## Phase 2: Red Test

- Behavior: after a Codex projection is drifted and exact force is supplied, reconciliation must restore the canonical `agents/openai.yaml` byte-for-byte, including `policy.allow_implicit_invocation: false`.
- Red command: `node --test --test-name-pattern='preserves bundled Codex metadata verbatim' src/__tests__/unit/native-skill-lifecycle.test.js`.
- Red result: failed 0/1 at the strict content assertion. Actual metadata was the generated interface-only YAML; expected metadata also contained the canonical policy with `allow_implicit_invocation: false`. This was the intended behavioral failure, not a setup or syntax failure.
- Exit criteria: met; the failing assertion and unchanged rerun command were recorded before production edits.

## Phase 3: Implementation

- Implementation rule: after the existing complete-package inspection validates a bundled skill, use its regular-file `agents/openai.yaml` bytes for the Codex projection when present; otherwise use `buildCodexSkillFiles` exactly as before.
- Boundary rule: do not add `agents` to the portable resource-directory allowlist, because that would project Codex-only metadata to Claude, Gemini, and Antigravity.
- Implemented boundary: `readBundledCodexMetadata` accepts only a real regular file and is called only after complete-tree inspection. The projection uses canonical bytes when available and retains generated bytes otherwise.
- Exit criteria: met; the smallest lifecycle change made the unchanged focused test pass without changing source safety or fallback generation.

## Phase 4: Green Tests And Refactor

- Green command: the unchanged Phase 2 command passed 1/1.
- Adjacent regression command: `node --test src/__tests__/unit/native-skill-lifecycle.test.js src/__tests__/unit/skills-sync.test.js` passed 36/36.
- Refactor constraint: no unrelated lifecycle restructuring; retain generated metadata as a directly tested fallback.
- Exit criteria: met; focused and adjacent tests pass, the diff remains narrow, and `git diff --check` passes.

## Phase 5: Full Verification

- Full suite: `pnpm test` passed 788/788 with zero failures.
- Build: `pnpm build` passed twice; the second build reproduced `dist/index.cjs` at SHA-256 `513d9f274fe28346f18ed55ab82894f3de36d6e2a173119da9c5485c6e3f4a24`.
- Repository debt gate: `node scripts/agent-debt-runner.mjs --changed-since origin/main --no-log` passed with zero findings.
- SWE debt scan: the configured `pr-review` scan through `stack:swe-engineering` passed with zero error, warning, or informational findings.
- Package gate: `npm pack --dry-run --json` passed for six files at version 1.10.26 (328,708 packed bytes; 1,586,154 unpacked bytes).
- Integration proof: an isolated temporary-root projection of the Registry's actual `codex-tasks` bundle was created, deliberately drifted, and force-reconciled. Result: `metadataMatches=true` and `policyPreserved=true`. No live install or host mutation occurred.
- Smoke harness correction: the first probe used a string source identity that the command correctly filters as externally owned, so it selected zero skills and the harness later hit `ENOENT`. The rerun used the installed Registry object-source shape and passed; no production change was made for the harness error.
- Independent review: fresh-context `rudi-code-review` returned Standards pass, Spec pass, Proof pass, and Overall pass with no P0-P3 findings. The reviewer independently reproduced red 0/1, unchanged green 1/1, adjacent 36/36, full 788/788, zero debt, six-file pack, deterministic bundle hash, actual Registry smoke, and unsafe metadata probes.
- Residual review gate: human review of the metadata-precedence boundary remains required before merge. This issue loop stops before merge.
- Exit criteria: met for implementation proof; all gates pass with no accepted implementation debt or proof gap.

## Phase 6: Docs, Contracts, And Closure

- Public ledger: issue `learnrudi/cli#42` and its implementation comment point to this checklist and the current lifecycle ownership boundary.
- Pull request: `learnrudi/cli#43` includes `Fixes #42`, medium risk, invariants, proof, this checklist path, the independent-review verdict, and the stop-before-merge boundary.
- CI/review: required `quality` CI passed in 37 seconds on the implementation/evidence head. This final ledger-only commit must receive the same remote gate; its result is recorded on the PR and issue rather than creating another self-referential checklist commit.
- Commit ledger: behavior source/test commit `07e7aa1`; dedicated generated-dist commit `add3f73`; initial evidence commit `e8d6240`; final ledger commit is the commit containing this paragraph.
- Saved-work preservation: the unrelated Registry worktree remains untouched. The earlier duplicate CLI patch in `/Users/hoff/RUDI/apps/platform/cli` may be removed only after this branch safely contains and publishes the accepted fix.
- Administrative closeout: Repo Steward records the non-mutating retained-worktree receipt only after the final commit is pushed, so the receipt can bind the exact published HEAD. Its identifier and version are posted to the issue ledger; no cleanup or archive action is authorized.
- Publication state: branch and PR are published; merge, release, installation, activation, live host reconciliation, admin-Mac synchronization, and branch/worktree cleanup were not performed.
- Human gate: human review of the metadata-precedence boundary remains required before merge.
- Accepted debt: none.
- Proof gaps: none for the implementation or pre-merge delivery. Human merge review is an intentionally outstanding approval gate, not missing implementation proof.
- Final verdict: PASS for the authorized issue-loop boundary; stop before merge.
