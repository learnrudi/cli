# Claude structured task completion

## Phase 0: Baseline and diagnosis
- User requests completion-parser fix, real scheduled claude-hoff Opus/low rerun, then removal after verified success. Existing session authorization includes commit/push/PR/merge after checks and Admin adoption.
- Base: CLI origin/main 474d84c. Compute is unchanged. Local feature worktree; preserve all other checkouts/workers/tasks.
- Evidence: native Claude exited 0 and wrote the requested report; its result text began `Static review complete`. Agent Host attempted JSON parsing of prose and failed the completion receipt. First incorrect boundary: task launch only prompts for JSON without selecting native structured output; Claude task event reader ignores structured_output.
- Standards: manual index, co-pilot standard, doctrine boundaries/testing; rudi-diagnose and SWE compliance workflows.
- Risk: medium source boundary change; high operational release adoption, authorized. Never infer success from prose or files; session, terminal, permission, schema, output path/hash and custody checks remain required.

## Phase 1: Scope lock
- Request a native JSON-schema outcome/output manifest for Claude tasks, read structured_output separately from human result text; preserve strict legacy JSON result compatibility.
- Structured field present but invalid must fail, never fall back. Malformed/duplicate JSON, nonzero exit, failed terminal, permissions and mismatched session continue failing.
- No scheduler/concurrency fix, account/permission changes, source-review fixes, credential changes or runtime-state migration.
- Expected source: task-claude.js, events/providers/claude-task.js; focused Claude tests, docs; tracked bundles in separate build commit.
- Horizontal disposition: standardize existing completion contract; reuse existing final-manifest and deliverable verification. No third parser/fallback.

## Phase 2–4: Red / green / refactor
- First observable regression: successful terminal with prose plus valid structured_output yields a validated completion.
- Then launch requests native schema for restricted and trusted task modes.
- Red: `pnpm test --test-name-pattern='Claude task completion requires' src/__tests__/unit/agent-task-claude.test.js` reproduced failed versus completed on prose plus structured output. Same command green after event-reader fix.
- Red: `pnpm test --test-name-pattern='Claude tasks request' src/__tests__/unit/agent-task-claude.test.js` reproduced missing native schema flag in both modes. Same command green after adding the schema.
- Focused suite: 10 passed, including structured completion receipt/output hashes, absent prose, invalid structured record without fallback, legacy JSON, malformed/duplicate events, session/terminal/permission failures, timeout and cancellation.
- No separate refactor required; focused suite rerun after negative coverage passed.
- Explicit test runtime Node22.23.2 via PATH and RUDI_CLI_TEST_NODE. Full suite: 940 passed, 10 skipped, 0 failed (96.4s). Build and npm pack dry-run passed; existing esbuild import.meta warnings remain unchanged.
- Changed-file debt runner: zero findings. Focused SWE scan with actual src/index.js entrypoint: zero findings (default daemon-only roots produced false orphan warnings before entrypoint correction).
- Pinned Admin Claude2.1.294 help confirms native --json-schema support. End-to-end native scheduled acceptance remains a deployment gate.
- First CI run found the new dual-mode argument test depended on the developer's installed router. The test now mocks homedir and creates its own executable router, matching existing trusted-mode fixtures. No product code changed; focused suite rerun passes. Cross-platform CI must pass before merge.

## Phase 5: Verification and delivery
- Focused tests, full pnpm test, pnpm build, changed-file debt scanner, focused SWE debt scan, npm pack dry-run.
- Fresh independent read-only Standards/Spec/Proof source review: pass on all axes, no actionable findings. Reviewer independently reran the 10 Claude tests, debt runner and diff check, and inspected behavioral red logs, full-suite/build/package evidence and generated changes. Release carry-forward and native acceptance remain separate gates.
- New immutable Admin scheduled-Claude release from accepted Git source, full artifact/runtime verification. Preserve installed workers and credentials. Update only required routing after evidence.
- Real scheduler-triggered Cloud static review, claude-hoff, exact Opus/low, report/hash/native evidence, paused after admission, retire after success. Old failed task and test cleanup through supported retirement, never rewrite audit history.

## Phase 6: Closure
- Pending: gates, commits/PR/merge, deployment, scheduled acceptance, retirement, worktree closeout receipt.
- Retained limitation: scheduler skips minutes while another job occupies its synchronous worker. Choose a future slot when idle; do not claim manual admission is scheduled proof.
