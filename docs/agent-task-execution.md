# Registered shared-workspace task execution v1

Fixture candidate; GitHub source integration is separate from an npm release.
The containment fixture currently qualifies **Darwin 24,
x86_64, with native Codex 0.160.1**. Claude qualification is specified below; other hosts/providers fail closed. This is
not deployment, launchd acceptance, or proof of NFL research.

Claude workspace tasks require an explicit account and native Claude Code
2.1.294 on qualified Darwin 24 x86_64. Preflight verifies the selected seat,
organization, config directory, native version and OS containment capability.
There is no default-account fallback. Managed native policy requires separate
qualification and fails closed.

Claude uses `--safe-mode`, `--restricted`, `dontAsk`, Read/Write/Edit only,
empty MCP/settings sources, disabled hooks and explicit write-root rules.
An OS sandbox additionally limits data reads and writes, denies audit-session
escape and signals to the supervisor, and follows resolved paths for symlink
checks. The shared audit-session custody supervisor drains descendants after
completion, timeout, cancellation or owner crash. Inference network transport
remains enabled; `network: disabled` denies model network tools, not transport
to Anthropic. No shell, browser, plugins, MCP or web tools are exposed.

A Claude profile adds this required non-secret account object to the profile
below (with `provider: "claude"` and an exact Claude model):

```json
"account": {
  "id": "claude-example",
  "email": "operator@example.test",
  "organization_id": "native-auth-status-org-id",
  "config_directory": "/Users/operator/.rudi/agent-identities/claude-example/claude",
  "anthropic_directory": "/Users/operator/.rudi/agent-identities/claude-example/anthropic"
}
```

Both directories must be canonical, owned by the execution user, private
(mode 0700) and disjoint from all task roots. Authentication stays on that host;
profiles contain no tokens. Native sessions are persisted under the selected
`config_directory/projects/<encoded-workspace>/<session-id>.jsonl`. Each task
starts a fresh session. Receipts record the selected account, observed account,
projects directory and native session ID. Client workspaces hold work outputs,
not login state. Per-account directories prevent accidental selection crossover;
they are not separate macOS users or a security boundary against the operator.

Claude completion requires exactly one successful result bound to the initialized
session, no native error or permission denials, and a valid final manifest.
Task launches request that manifest using native `--json-schema`. The terminal
event's `structured_output` object is the machine contract; `result` may contain
human-readable prose. A present invalid structured record fails without falling
back to prose. Older terminal events without that field must still contain a
strict JSON manifest in `result`; report files alone never imply completion.
The shared receipt path verifies output roots and hashes after custody closes.
Native executable pins use `RUDI_AGENT_TASK_CLAUDE_PATH` and
`RUDI_AGENT_TASK_CLAUDE_SHA256`; cross-provider pins are rejected.

The October 17 account qualification used synthetic data: all three native
accounts concurrently read approved inputs, wrote approved outputs and persisted
separate sessions. OS read/write and symlink denials, audit/signal denials,
eight generic custody modes and native owner-crash cleanup passed. See the
[account qualification ledger](swe-compliance/2026-10-17-claude-account-selection.md).
Qualification evidence does not itself deploy a release or activate a schedule.

Compute owns jobs, leases and recurring admission. Agent Host owns native arguments,
authentication checks, session pointers, permission enforcement and launch
artifacts. The provider owns inference and native transcripts. The bridge uses
foreground completion through a temporary launchd audit-session capsule. It requires
the signed-in user's `gui/<uid>` domain; no RUDI daemon or copied project is required.

On Node 24, use 24.22 or newer. Agent Host rejects earlier Node 24 versions before
opening SQLite state because allocation-driven garbage collection can abort
native addons. Qualification must run `node --max-semi-space-size=1
scripts/verify-sqlite-teardown.mjs` from the packaged CLI with its pinned Node
binary. This exercises GC, worker environment teardown, and database integrity
after reopening; a one-query SQLite smoke test is insufficient. Compute's
Python `sqlite3` job store is independent of this Node compatibility constraint.

## Execution profile

A Compute task revision pins this UTF-8 JSON file by path and SHA-256. The fields shown below plus the documented `account` object and optional
`reasoning_effort` are accepted; directories must exist and be canonical, without symlink or
glob spellings. Replace the illustrative paths with isolated fixture paths.

```json
{
  "schema_version": 1,
  "provider": "codex",
  "model": "gpt-6.1-sol",
  "reasoning_effort": "high",
  "workspace_mode": "registered-shared",
  "working_directory": "/absolute/shared/project",
  "read_roots": ["/absolute/shared/project"],
  "write_roots": ["/absolute/shared/project/reports"],
  "network": "disabled",
  "timeout_ms": 300000
}
```

### Reasoning effort and Codex account selection

An explicit `reasoning_effort` is validated against the exact model's
`reasoningEfforts` catalog entry. Codex receives `model_reasoning_effort`;
Claude receives `--effort`. Unsupported values, types and model combinations
are rejected before admission. No aliases, translation between different effort
levels, or silent fallback are accepted. The current catalog accepts:

| Model | Effort values |
| --- | --- |
| GPT-6.1 Sol, GPT-6 Astra, GPT-6 Sol, GPT-5.6 Sol/Terra | low, medium, high, xhigh, max, ultra |
| GPT-6 Luna, GPT-5.6 Luna | low, medium, high, xhigh, max |
| Claude Fable 5.1/5; Opus 5.5/5/4.8/4.7; Sonnet 5.5/5; Haiku 5.5 | low, medium, high, xhigh, max |
| Claude Opus 4.6, Sonnet 4.6 | low, medium, high, max |
| Claude Opus 4.5, Haiku 4.5 | No explicit effort control in this Claude Code adapter |

Catalog refreshed 2026-10-17 from native Codex 0.160.1 `model/list` and
[Claude Code model configuration](https://code.claude.com/docs/en/model-config).
The seven non-hidden Codex models are included; provider-internal hidden models
are excluded. The thirteen active general-purpose Claude models are included per
[model lifecycle status](https://platform.claude.com/docs/en/about-claude/model-deprecations);
restricted Mythos and deprecated/retired models are outside this general-purpose catalog.
Exact model IDs are required for registered tasks. Codex now defaults to GPT-6.1 Sol;
`sol` selects GPT-6.1 Sol, `astra` selects GPT-6 Astra, and `luna` selects GPT-6 Luna.
Older exact IDs remain available for pinned profiles. Claude aliases/defaults are unchanged.
The Codex choices follow [current official model guidance](https://learn.chatgpt.com/docs/models).
Existing guarded workers retain their packaged catalog until a new immutable
release is qualified and adopted; never edit a hash-pinned bundle in place.
Newer Claude models require a sufficiently recent native CLI (Haiku 5.5 requires
2.1.293 or newer). Catalog presence is neither account entitlement nor runtime
qualification; only explicitly tested combinations have live execution evidence.
Opus 4.5 API effort support does not imply Claude Code `--effort` support.

The Claude combinations follow the provider's [model configuration contract](https://code.claude.com/docs/en/model-config#adjust-effort-level).
This is a requested native setting, not a measured amount of model reasoning.
Provider-side policy and availability still apply; native qualification is
required before releasing a new model/runtime combination.

Existing v1 profiles may omit effort and retain native default behavior. New
jobs should pin it whenever the selected model supports it. An older runner
rejects these new fields; register a new profile revision and an upgraded,
hash-pinned runner rather than editing an existing profile in place. Launch and
completion receipts record requested effort together with the profile hash.

Codex profiles can additionally select this non-secret account object:

```json
"account": {
  "id": "codex-example",
  "email": "operator@example.test",
  "config_directory": "/Users/operator/.rudi/agent-identities/codex-example/codex"
}
```

The directory must exist, be canonical, owned by the execution user, private
(no group/other access), and disjoint from all task read/write/runtime roots.
Use a dedicated native account home without `config.toml`,
`managed_config.toml`, or `requirements.toml`. It stores native authentication
and sessions; it is not a project or a deliverable. Authenticate interactively
on the execution host, selecting this directory as Codex's native home and
`cli_auth_credentials_store="file"`. Do not copy credentials from another
profile. The same home and credential-store setting are used at admission,
preflight, and inference. Native sessions stay under that home's `sessions/`.

Agent Host requests only `initialize` and `account/read` from a private native
stdio app-server process, without starting a session or requesting token refresh.
Inspection is bounded to ten seconds and 256 KiB of combined output; raw native
diagnostics are never returned. API-key/absent/mismatched accounts fail closed.
The selected email must match the native ChatGPT account before admission and
again before execution. The public native account response exposes email,
not a ChatGPT workspace ID, so this contract does not assert workspace identity.
Receipts distinguish the selected account from the observed account metadata.
Global login state and API-key environment variables are not used for selected
accounts. Legacy Codex profiles without an account retain their prior login
behavior; Claude continues to require its explicit account object above.

Both optional fields are part of the hashed execution profile. Compute continues
to treat that profile as opaque; Agent Host owns validation and provider arguments.
This source increment requires separate selected-account/effort native acceptance
on Admin before an installed worker can claim support.

The rules below describe the default restricted profile. For authorized project
maintenance and native integrations, opt into `access_mode: "trusted"` as
documented in [Trusted Compute workspaces](compute-trusted-access.md). Existing
profiles do not change implicitly; trusted mode still requires explicit roots,
account selection, enabled network and a supporting installed release.

Model IDs must be exact configured IDs, not aliases. The only session mode is
fresh. Read roots explicitly include the working directory. Write roots exactly
match the task's deliverable roots; they cannot grant the entire working
directory or overlap Agent Host runtime. Include any approved external domain
state folder in deliverables rather than granting a parent home directory.
The task request, instruction file and profile cannot be writable outputs.

The permission plan grants minimal native runtime reads plus declared roots.
It does not automatically make the working directory writable. Add interpreter
or tool installation directories as explicit read roots when required (for
example, the resolved Python installation used by a project). Network is an
explicit enabled/disabled policy for native commands; enabled means unrestricted
command network access, not a domain allowlist. MCP, apps, plugins, browser,
subagents and native web search are disabled in this bounded slice. Research
integration/tool qualification remains a later step.

The qualified native release requires `code_mode_host` for command-tool
execution, so task plans enable that transport explicitly. Command permissions
still come from the registered filesystem/network profile; private automation
retains its separate tool-free policy. Native helper startup also needs read
access through the vendor executable's entire symlink chain. On the verified
standalone installation, explicit read roots include `/Users/admin/.local/bin`
and `/Users/admin/.codex/packages/standalone`; the resolved version's `bin`
directory alone is insufficient when the launcher traverses `current`. Resolve
the actual installation on each host instead of granting its whole home.

Native user config and rules are ignored. Ancestor project configs and system
Codex config are rejected pending explicit qualification; the adapter performs
an empty-stdin native configuration probe before launching. The child inherits
only operational environment fields, not API-key environment variables, and
uses native authentication. No provider/model fallback or permission override
is accepted. The empty-stdin probe does not start a session: live qualification
must also prove helper read access and command-tool availability. Capability
validation does not prove successful inference or subscription availability.

Permission profiles use Codex's native sandbox. See the official
[permission profile semantics](https://learn.chatgpt.com/docs/permissions).
This implementation deliberately qualifies one release and proves the generated
policy with `scripts/verify-task-permissions.mjs`; it does not infer support from
a version number alone.

Writable trees are checked at validation and immediately before spawn. Existing
symlinks, special files and multiply-linked files are rejected; the scan is
bounded at 100,000 entries. This prevents a pre-existing hardlink from exposing a
read-only inode through a writable name. Native tests also prove that creation
of a new hardlink from a read-only source is denied. These controls assume
trusted same-user operators; they are not isolation from malicious concurrent
processes running under the same OS identity.

## Request, admission and supervision

`rudi agent task-check <request-path> <sha256>` validates the closed request and
profile and rejects unqualified providers. It returns a versioned `agent-task-check` response bound to that exact
reference. `rudi agent task-run <request-path> <sha256>` additionally requires
Compute's job ID, spec hash and first-attempt environment bindings. It accepts
no permission/passthrough flags or alternate session. References are bounded
regular files, read without following links or blocking on FIFOs; duplicate JSON
keys and non-finite numbers are rejected.

The request contains `schema_version`, `task` (id/revision/definition_sha256),
`instructions`, `execution_profile`, `working_directory`, `outputs`, and
`timeout_seconds`. The profile's native timeout must leave 20 seconds inside
Compute's timeout. Compute additionally retains its 10-second shutdown grace.
The provider runs in a separate process group inside the capsule's audit session.
Startup receipt failure, output overflow, timeout, native exit and signals enter
supervised audit-session cleanup, including descendants that detach from that group.
Resume, promote and discard reject registered shared launches: the shared
workspace belongs to its operator.

## Completion and evidence

A zero provider exit is insufficient. Agent Host requires a native session
pointer, `turn.completed`, no native terminal failure, and a final JSON object:

```json
{"outcome":"complete","outputs":["/absolute/shared/project/reports/report.txt"]}
```

Outcomes are `complete`, `no_work`, `partial`, `needs_evidence`, or `failed`.
Complete requires at least one file; no_work requires none. Partial and
needs_evidence preserve a valid checkpoint and are not claims of completed
research. Failed exits nonzero. Outputs are at most 64 canonical regular files
under declared write roots, at most 32 MiB each, without symlinks/hardlinks. The
host hashes actual bytes and detects file changes during verification. It does
not certify domain truth or NFL eligibility.

Each attempt creates an exclusive `<runtime>/<job-id>-attempt-1/` directory.
`launch.json` records the request/task/job/profile/model/workspace bindings;
`completion.json` binds that receipt, native session pointer, application outcome,
and verified output hashes. Existing directories or receipts are never replaced.
Agent Host's launch projection is in `<runtime>/agent-hosts.db`; its CHECK
migration preserves old launches and parent/native pointers. Native transcripts
remain provider-owned. Normalized host events stay in the host subdirectory;
Compute receives receipt metadata, not duplicated provider output.

Compute verifies the completion envelope and its launch-receipt hash/bindings
before recording success, then stores the completion receipt path/hash/outcome
in the existing succeeded event. Missing/mismatched receipts cause
`task_receipt_invalid`; an exhausted single attempt is `dead`. Abrupt loss of
the bridge or storage can leave incomplete evidence and must be reconciled,
never silently replayed in the same directory. The independent watchdog is armed
before native spawn and its current identity is checked before prompt delivery.
It drains the audit session on supervisor loss. Crash recovery retains a durable quarantine;
subsequent execution fails closed. `rudi agent task-recover REQUEST SHA256` is the
bounded provider-neutral reconciliation interface used by Compute before lease
recovery. There is no automatic quarantine-clear operation.

The package includes `dist/task-custody-worker.cjs`, `dist/task-capsule-worker.cjs`
and the compiled `dist/task-audit-darwin` helper. Each task's temporary
`com.learnrudi.containment.<uuid>` job uses `SessionCreate`; setsid, setpgid,
double-fork and exec preserve its kernel audit session. Cleanup signals exact
audit-token generations with no PID-only fallback. Output hashes are computed
only after cleanup completes.

The helper requires a complete Darwin live-process census (PID 0 sentinel),
uses kernel creation IDs instead of wall-clock birth times, and revalidates
creation ID and PID version around token reads. Missing or changing identities
make the census uncertain. Two complete empty sweeps are required; uncertainty
past the seven-second budget blocks completion. The creation counter is kept as
uint64/decimal text and bounded below 2^63. This depends on the qualified Darwin
24 kernel implementation, not a portable process-list guarantee.

Native Codex and the two supervisors are trusted. Command tools remain inside
Codex's native sandbox; preflight proves foreign audit-session access, session
creation and supervisor signaling are denied. Fixture proof also rejects launchd
job creation. No outer nested sandbox is applied. Loss of both supervisor and
watchdog anchors, inaccessible candidates or unresolved cleanup keeps custody
quarantined. This does not authorize automatic replay, quarantine clearing or
production operation. Compute's existing release manifest remains ineligible.
Compute PR #22 now records passing isolated launchd acceptance and schema-safe
rollback. App-closed, login/boot/FileVault, other-platform and production-path
qualification remain separate gates; source merges do not promote that manifest.
The guarded package runner supplies `RUDI_AGENT_TASK_CODEX_PATH` and
`RUDI_AGENT_TASK_CODEX_SHA256`. Task validation checks that canonical executable
and its bytes, and task execution selects it instead of the ambient provider
search path. These pins are launcher inputs, not credentials or profile fields.

## Repeatable isolated proof

From the CLI checkout:

```bash
node --test src/__tests__/unit/agent-task-profile.test.js src/__tests__/unit/agent-task-launch.test.js src/__tests__/unit/agent-task-run.test.js
node scripts/verify-task-permissions.mjs /absolute/native/codex /absolute/artifact-root
node scripts/verify-task-containment.mjs normal
node scripts/verify-task-containment.mjs double-fork
node scripts/verify-task-containment.mjs census-race
```

The native sandbox probe uses a disposable home and no inference. The Compute
script `scripts/verify_agent_task_bridge.py` predates capsule dispatch and supplies
in-process provider overrides. Public `runAgentTask` now explicitly rejects those
overrides before resolving a provider; that old fixture must be migrated to the
explicit `runAgentTaskInSession` fixture interface. It cannot silently invoke real
inference. The custody suite exercises isolated launchd jobs, crash quarantine,
double-fork and a controlled fork/exit during census; unrelated canaries must survive.
Native/package fixtures and immutable evidence for this change are recorded in
`docs/swe-compliance/2026-10-16-detached-process-containment.md`.
