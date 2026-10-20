# CLI layout and installation

The editable CLI lives at `RUDI/apps/platform/cli`. It produces the npm package
`@learnrudi/cli`. A user's `~/.rudi` is a separate directory for installed
capabilities and local state. Building this checkout does not replace an
already installed `rudi` command.

## Annotated repository tree

```text
RUDI/                                  Workspace; not a parent Git repository
└── apps/
    └── platform/
        └── cli/                       This Git repository: @learnrudi/cli
            ├── src/                   Editable CLI and runtime implementation
            │   ├── index.js           Parses argv and dispatches CLI commands
            │   ├── commands/          Command validation, orchestration, output
            │   ├── agent-host/        Native host adapters and launch/workspace lifecycle
            │   ├── daemon/            Local HTTP routes and daemon lifecycle
            │   ├── contracts/         Source of the daemon OpenAPI contract
            │   ├── native-skills/     Native host skill metadata/rendering
            │   ├── utils/             CLI-local process and instruction helpers
            │   ├── __tests__/         CLI unit and end-to-end tests
            │   ├── router-mcp.js      MCP routing to installed stacks
            │   ├── router-settings.js Router settings validation/loading
            │   ├── router-results.js  Durable late-result persistence helper
            │   ├── runtime-inspection.js  Runtime discovery helpers
            │   └── packages-manifest.json Checked-in package bootstrap metadata
            ├── packages/              Shared libraries bundled into the CLI
            │   ├── core/              Resolve, install/remove, locks, shims, index
            │   ├── env/               Paths, platform, local discovery
            │   ├── manifest/          Package schema parsing and validation
            │   ├── mcp/               MCP configuration and router utilities
            │   ├── registry-client/   Registry lookup and verified downloads
            │   ├── runner/            Process execution and streaming
            │   ├── secrets/           Secret storage and resolution
            │   ├── utils/             Argument parsing and help
            │   ├── db/                Legacy Studio compatibility; retained separately
            │   ├── .gitignore         Package-local ignore rules
            │   └── README.md          Package responsibilities and retirement boundary
            ├── scripts/               Test, build-support, contract, debt/release checks
            │   ├── run-tests.js        Node test runner and native-runtime selection
            │   ├── agent-debt-runner.mjs  Repository scanner entrypoint
            │   ├── agent-debt-scan.cjs Packaged scanner implementation
            │   ├── generate-manifest.js  Refresh bootstrap metadata from registry
            │   ├── generate-daemon-openapi.js  Regenerate daemon contract JSON
            │   └── validate-publish-runtime.mjs  Check trusted-publishing npm support
            ├── docs/                  Current guides and historical engineering evidence
            │   ├── adr/               Architectural decisions
            │   ├── daemon/            Generated OpenAPI JSON
            │   ├── swe-compliance/    Dated change and verification records
            │   ├── cli-layout-and-installation.md  This guide
            │   ├── frontier-agent-hosts.md  Native host integration reference
            │   ├── rudi-local-daemon-architecture.md  Local service architecture
            │   └── public-readiness-checklist.md  Historical June readiness plan
            ├── dist/                  Tracked release bundles generated from src/
            ├── node_modules/          Local, reinstallable development dependencies
            ├── .github/workflows/     CI quality and publication workflows
            │   ├── quality.yml        Tests, reproducible build, debt, package checks
            │   ├── publish-npm.yml    CLI npm publication
            │   └── publish-mcp-npm.yml MCP workspace-package publication
            ├── .git/                  Repository history and worktree metadata
            ├── .claude/               Optional ignored workstation agent settings
            ├── .debt-scan.json        Repository debt-scan policy
            ├── .gitignore            Ignore rules; not a deletion policy
            ├── AGENTS.md             Engineering instructions and boundaries
            ├── CLAUDE.md             Claude-specific entry instructions
            ├── package.json          Version, executable, scripts, dependencies, pack list
            ├── pnpm-workspace.yaml   Workspace membership and build approvals
            ├── pnpm-lock.yaml        Reproducible dependency resolution
            ├── README.md             Public installation and usage entrypoint
            └── LICENSE               Package license
```

Tests live beside their owning code under `src/__tests__` inside workspace
packages too. There is no separate root `tests/` directory.

`dist/` is tracked despite the ignore rule: CI compares rebuilt bundles with
the checked-in distribution. Keep it. `node_modules/` is recreatable, but
removing it only forces the next development command to reinstall dependencies.

Ignored `.agent-scans/` may be regenerated by the debt runner when logging is
enabled. The October 15 cleanup removed its old generated history and empty
`tmp/`, `src/adapters/`, and `.rudi/worktrees/` directories on the primary Mac.
The ignored CLI `_archive/` was preserved under the workspace's
`_archive/2026-10-15-cli-folder-cleanup/`, outside active source.

## From source to a user's command

```text
src/index.js + active packages/*
  └─ pnpm build → dist/index.cjs
src/router-mcp.js + its imports
  └─ pnpm build → dist/router-mcp.js
src/packages-manifest.json
  └─ pnpm build → dist/packages-manifest.json
src/agent-host/task-custody-worker.js + task-capsule-worker.js
  └─ pnpm build → dist/task-custody-worker.cjs + dist/task-capsule-worker.cjs
native task-audit helper
  └─ scripts/build-task-audit.mjs → dist/task-audit-darwin

npm package: package.json files allowlist + npm's standard metadata/license files
  └─ npm install -g @learnrudi/cli
      ├─ <npm-prefix>/lib/node_modules/@learnrudi/cli/  (macOS/Linux)
      └─ <npm-prefix>/bin/rudi → package's dist/index.cjs
          ├─ dispatches to command implementations bundled from src/commands/
          └─ reads/writes the selected RUDI home (normally ~/.rudi)

installed stacks/skills/runtimes/tools
  └─ ~/.rudi/...             Downloaded separately as requested
      └─ ~/.rudi/bins/...    Optional command shims and MCP router entrypoint
```

The package includes the task workers, native audit helper and
`scripts/verify-sqlite-teardown.mjs` as well as the CLI/router bundles. Its exact
payload is defined by `package.json` and verified with `npm pack --dry-run`.
It does not ship the source tree, workspace `packages/db`, tests, other
development scripts, archives, or your installed stacks, credentials, and data.
Production dependencies are installed by npm. `better-sqlite3` remains required
by the current Agent Host launch store even though the older database package
is isolated.

To trace a command, start with `package.json`'s `bin` field, then
`src/index.js`, the matching `src/commands/` file, and the workspace library it
imports. For example, `rudi install` reaches core installation/registry/shim
logic; `rudi run` reaches the runner; MCP clients invoke the separate router.

## Fresh installation procedure

Use a supported Node 22 or 24.22+ installation with npm. pnpm is needed only when
building the source checkout; the repository declares pnpm 10.22.0.

```bash
npm install -g @learnrudi/cli
rudi --version
rudi init --skip-downloads
rudi home
rudi install npm:typescript --with-shims
"$HOME/.rudi/bins/tsc" --version
rudi remove npm:typescript -y
```

`--skip-downloads` initializes directories/settings without claiming to provision
managed interpreters. Initialization also creates/updates the Codex managed
instruction block; use `--no-agent-instructions` to opt out.

For a fresh source build:

```bash
git clone https://github.com/learnrudi/cli.git
cd cli
pnpm install --frozen-lockfile
pnpm test
pnpm build
git diff --exit-code -- dist src/packages-manifest.json
npm pack --dry-run
node dist/index.cjs --version
```

This is a Git checkout/build workflow, not a claim that `npm install -g` from a
Git URL is supported. Test the generated tarball with `npm pack` and an isolated
npm install prefix to verify the source-to-package boundary.

## October 15, 2026 installation audit

This section preserves the October 15 observations. It is not a current
publication inventory. At the October 20 source review, Registry `main` already
selects Node 24.21.0; this CLI source requires Node 22 or 24.22+. The remaining
compatibility gap is the Node 24 minimum, not an unpublished move from Node 20.
See [the current installation guidance](../README.md#installation) and inspect
the installed package separately before a rollout.

Public npm version tested: **1.10.29**. Tests use empty temporary homes, separate
npm prefixes/caches/config files, an allowlisted environment, and a working
directory outside the source checkout. The existing RUDI bins and user
configuration are excluded. Node 24.21.0 and OS utilities were prerequisites
for this audit. The October 16 teardown correction below raises the current
Node 24 minimum to 24.22; it does not change what this earlier audit tested.
The same public package is installed independently as `hoff` on the primary Mac
and as `admin` over SSH on the admin Mac.

Verified on both hosts: npm installation, version/help, empty inventory before
installing a tool, home inspection, and TypeScript installation, execution, and
removal. The npm install
alone does not create `~/.rudi`. The published payload contains six files,
excluding its npm dependencies. No legacy `rudi.db` is created. A successful
`doctor` exit is only evidence for the checks it actually performs.

**Published 1.10.29 bootstrap defect (fixed in this checkout):** plain `rudi init` reports Node, Python, SQLite,
and ripgrep as missing from the registry, then prints success and exits 0. None
of those four managed packages is installed. The command still looks for the
old nested `index.packages.<kind>.official` layout; registry consumers elsewhere
use the current schema's package lookup helpers. It also collects failures
without returning a failing exit status. The original audit recorded this defect; the follow-up implementation replaces
that path with the shared verified installer and fails when setup is incomplete.

Follow-up regression tests cover schema-v2 bootstrap, checksum rejection,
missing registry entries, repeat/forced initialization, and opting into system
binary shims after a previous initialization.

**Published 1.10.29 inventory defect (fixed in this checkout):** after TypeScript installs and its shim runs
successfully, `rudi list --json` still returns `[]` on both hosts and in the
packed-source smoke. Dynamic npm tools live under `binaries/npm/<package>`;
the released listing path does not report this nested installation. Successful
empty-inventory checks before installation do not prove installed-package
inventory correctness. The follow-up now discovers this directory level in shared inventory,
preserves `npm:` IDs with binary classification, and tests inclusion followed
by absence after removal. It does not descend into dependencies or directory
symlinks, and rejects mismatched npm manifest identities.

This is clean user-state testing on two existing macOS hosts, not a new OS
account, VM, Linux/Windows run, or permission-isolation test. Provider login,
authenticated stacks, model execution, daemon startup, and Node 22 are outside
this smoke test. See the [audit ledger](swe-compliance/2026-10-15-cli-cleanup-and-fresh-install.md)
for command evidence, source-build results, database disposition, and review.

## Follow-up candidate verification

The unpublished candidate was built on each Mac and installed from its npm
tarball into a new temporary home/prefix/cache. Both hosts passed full
initialization, execution of Node/Python/SQLite/ripgrep and their shims,
idempotent reinitialization, TypeScript install/run/list/remove, and general
and binary-filtered inventory assertions. The tests also invoked the CLI after
putting the new shims first on PATH. These results validate the two CLI fixes;
they do not certify every command under the registry's default runtime.

**Public registry compatibility gap (candidate update prepared):** public `runtime:node` resolves to
20.10.0. The CLI declares Node 22/24 support; putting the managed Node shim first
on PATH therefore selects an unsupported major. The bootstrap package and its
checksum are valid, but the registry default needs its own update and native
dependency/daemon verification before claiming complete onboarding readiness.
No registry definitions or installed user environments were changed here.

See the [fix verification ledger](swe-compliance/2026-10-15-cli-onboarding-fixes.md)
for red/green commands, both-host evidence and publication status.

## Node 24 candidate follow-up

**Teardown correction (October 16):** the 24.21.0 candidate described below is
historical evidence, not the current adoption target. Node 24.22.0 fixes the
native cleanup regression reproduced by the Agent Host suite. Opening a database
once is insufficient acceptance: run the packaged SQLite teardown probe with
the exact selected runtime and dependency closure, followed by the full suite.
The isolated candidate does not replace the installed runtime or registry entry.
See [the teardown ledger](swe-compliance/2026-10-16-sqlite-teardown.md).

The companion registry change pins `runtime:node` to Node 24.21.0 using the
official Darwin/Linux arm64/x64 archives and SHA-256 values. The versioned
Node 20 entry remains available under its separate ID. These local commits
do not update the public registry or npm package.

Fresh-install verification uses the candidate index over loopback HTTP through
`RUDI_REGISTRY_URL`, with local-registry development mode disabled. Archive and
npm downloads still come from their public sources. The expanded smoke checks
require the installed Node and PATH shim to report 24.21.0, open an in-memory
SQLite database with the installed CLI's native dependency, and run a disposable
daemon on an ephemeral loopback port. Existing user services are untouched.

See the [Node 24 follow-up ledger](swe-compliance/2026-10-15-node24-fresh-install-and-commits.md)
for results and commit/publication state.
