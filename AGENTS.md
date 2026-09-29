# RUDI CLI — Agent Instructions
<!-- CODEX-AGENTS-LOADED:cli -->

Local capability CLI, daemon lifecycle manager, and MCP router for RUDI.
Node.js, plain JavaScript. Package: `@learnrudi/cli`.

RUDI owns local tools, secrets, package/index state, MCP access, durable
artifacts, safe workspaces, and bounded detached-launch lifecycle. Claude,
Codex, Gemini, and other native hosts own normal model execution, sessions,
transcripts, and provider-native orchestration.

## Command Surface

The default help is deliberately divided into four groups. Keep new commands
in the narrowest appropriate group and update the command-surface contract
tests when the grouping changes.

### Core

- `rudi init`, `search`, `install`, `remove`, `update`, `list`
- `rudi skills`, `home`, `status`, `doctor`, `run`, `secrets`
- `rudi integrate`, `instructions`, `index`
- `rudi agent hosts|models|launch|resume|list|status|attach|stop|diff|promote|discard|group`

### Advanced

- `rudi auth`, `check`, `info`, `local-llm`, `mcp`, `runtime`
- `rudi daemon`, `shims`, `studio`, `which`, `lanes`, `leverage`

### Internal

- `rudi serve` is the daemon process entrypoint. Users should manage it with
  `rudi daemon`.

### Retired names

`apply`, `db`, `database`, `import`, `logs`, `par`, `parallel`, `project`,
`projects`, `run-group`, `run-groups`, `session`, and `sessions` are bounded
migration notices. They exit nonzero and never load retired runtime code. Do
not reintroduce implementations or compatibility routes behind these names.

## Architecture

```text
src/index.js
├── src/commands/                 CLI validation, dispatch, presentation
├── src/agent-host/               provider adapters and launch/workspace core
├── src/daemon/                   loopback HTTP API and lifecycle runtime
├── src/router-mcp.js             installed-stack MCP router
└── packages/*                    reusable installer/runner/env/MCP packages
```

Important boundaries:

- Foreground Agent Host launches call native provider CLIs directly and need
  neither the daemon nor a GUI.
- Detached launches use a dedicated RUDI worker. The daemon exposes their
  bounded control plane under `/agent-host/v1` but does not become the model
  loop or transcript authority.
- `src/agent-host/lifecycle.js` is a stable facade over separate process and
  workspace lifecycle modules.
- `src/commands/daemon.js` is a terminal adapter; lifecycle orchestration lives
  in `src/daemon/runtime/lifecycle.js`.
- `src/commands/serve.js` composes only health, environment, local-LLM,
  package, and Agent Host routes.
- `packages/db` remains an isolated compatibility package for checked-in
  Studio consumers. CLI production code and `packages/runner` must not import
  it. Existing `~/.rudi/rudi.db` files are preserved but never opened,
  migrated, repaired, or deleted by the CLI.

The active home connection files are `~/.rudi/daemon.port` and
`~/.rudi/daemon.token`. The loopback API uses `x-rudi-token`; never put tokens
in URLs or logs.

## Daemon Contract

Canonical sources:

- OpenAPI source: `src/contracts/daemon-openapi.js`
- Generated artifact: `docs/daemon/openapi.json`
- Route composition: `src/daemon/routes/index.js`

Retained route families are:

- public `GET /health`
- authenticated `/ready`, `/version`, `/daemon/status`, `/env`
- authenticated `/local-llm/*` and `/packages/*`
- authenticated `/agent-host/v1/*`

Removed `/agent/*`, `/sessions/*`, filesystem, shell, terminal, analytics,
notes, projects, plans, and WebSocket sidecar contracts must return the normal
authenticated 404. Do not add compatibility adapters.

## Agent Integration

MCP config, managed instructions, and native skill projections are separate:

- `rudi integrate <agent>` writes one MCP server entry for
  `~/.rudi/bins/rudi-router`.
- `rudi instructions <agent> --install` updates the managed instruction block.
- `~/.rudi/skills` is the canonical installed package layer. `rudi install
  skill:<id>` reconciles that exact skill to configured native hosts by default;
  use `--no-sync-skills` to opt out or `--sync-skills=<host[,host]|all>` to
  select hosts explicitly.
- `rudi skills sync <agent>` reconciles complete derived trees in the host's
  native skill directory and records ownership receipts under
  `~/.rudi/state/native-skills/<host>/`. Receipts bind the canonical source,
  complete package, and rendered tree digests to the exact host target. Managed unchanged trees update
  automatically; drifted and unmanaged trees are preserved unless exact scoped
  `--force` is supplied. Whole-inventory force also requires `--all`.
- Native skill changes set `restartRequired`; RUDI does not claim host hot reload.
- Private native names and allowed hosts come from `$RUDI_HOME/native-skills.json`.
  Package IDs and receipt filenames remain stable. Receipt schema 3 separates
  package ID from native name; schema 2 remains readable. Never infer ownership
  from a matching name, move old targets automatically, or overwrite private
  variants during a rename. Keep naming policy in the shared native lifecycle,
  not individual command adapters.

Discover installed stacks with `rudi list stacks --json` or inspect
`~/.rudi/cache/tool-index.json`. Rebuild with `rudi index --json`. Do not use or
document `rudi mcp --list`; it is unsupported.

## Registry

- Index: `https://raw.githubusercontent.com/learnrudi/registry/main/index.json`
- Remote contract: schema version 2 only
- Canonical stack metadata: `catalog/stacks/{id}/manifest.json`
- Local development: `file://` paths or `RUDI_REGISTRY_ROOT`

## Verification

Use the repository commands, not ad hoc substitutes:

```bash
pnpm test
pnpm build
node scripts/agent-debt-runner.mjs --changed-since origin/main --no-log
npm pack --dry-run
```

After editing JS/TS, run the focused debt scan described by the global
instructions. Build output under `dist/` is tracked; refresh it in a dedicated
build commit. CI in `.github/workflows/quality.yml` enforces tests, build
reproducibility, changed-file debt scanning, and package contents.
