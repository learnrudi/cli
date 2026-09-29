# RUDI CLI

A local capability and integration manager for MCP stacks, CLI tools,
runtimes, and externally installed AI Agent Hosts.

RUDI installs and manages its local capability infrastructure and integrates
with provider-owned agent software:
- **MCP Stacks** - Model Context Protocol servers for Claude, Codex, and Gemini
- **CLI Tools** - Any npm package or upstream binary (ffmpeg, ripgrep, etc.)
- **Runtimes** - Node.js, Python, Deno, Bun
- **Agent Host integration** - Discovery, readiness checks, MCP wiring, and
  launch support for vendor-installed Claude, Codex, Gemini, and Antigravity

## Installation

```bash
npm install -g @learnrudi/cli
```

Requires Node.js 18 or later. The installer creates `~/.rudi/`.

Shims are opt-in. If you want PATH exposure for installed tools:

```bash
rudi shims rebuild
export PATH="$HOME/.rudi/bins:$PATH"
```

## Core Concepts

### Shim-Based Architecture

When you opt in (`rudi shims rebuild`), tools installed through RUDI get a wrapper script (shim) in `~/.rudi/bins/`. This provides:

- Clean PATH integration without modifying system directories
- Version isolation per package
- Ownership tracking for clean uninstalls
- Consistent invocation across different package sources

When you run `tsc`, the shell finds `~/.rudi/bins/tsc`, which delegates to the actual TypeScript installation at `~/.rudi/binaries/npm/typescript/node_modules/.bin/tsc`.

### Package Sources

RUDI supports three installation sources:

1. **Dynamic npm** (`npm:<package>`) - Any npm package with a `bin` field
2. **Curated Registry** - Pre-configured stacks and binaries with documentation
3. **Public GitHub stacks** - Commit-pinned RUDI stack directories
4. **Upstream Binaries** - Direct downloads from official sources

### Secret Management

MCP stacks often require API keys and tokens. RUDI stores secrets in `~/.rudi/secrets.json` (mode 0600) and injects them as environment variables when running stacks. Secrets are never exposed in process listings or logs.

## Usage

### Installing Packages

```bash
# Install any npm CLI tool
rudi install npm:typescript       # Installs tsc, tsserver
rudi install npm:@stripe/cli      # Installs stripe
rudi install npm:vercel           # Installs vercel

# Install from curated registry
rudi install slack                # MCP stack for Slack
rudi install binary:ffmpeg        # Upstream ffmpeg binary
rudi install binary:supabase      # Supabase CLI

# Install a RUDI-compatible stack from a public GitHub tree
rudi install https://github.com/acme/rudi-packages/tree/main/catalog/stacks/demo

# Install with scripts enabled (when needed)
rudi install npm:puppeteer --allow-scripts

# Optional: create shims immediately (opt-in)
rudi install binary:ffmpeg --with-shims
```

GitHub source installs accept only the exact public HTTPS form
`https://github.com/<owner>/<repo>/tree/<ref>/<stack-path>`. RUDI resolves the
ref to a full commit SHA, downloads only files and directories from that pinned
subtree, rejects symlinks/submodules and foreign download URLs, and records the
source plus a content checksum in the package lockfile. Private repositories,
other Git hosts, repository-root shorthand, and arbitrary non-RUDI source are
not supported.

The external stack must use a canonical `stack:` manifest. Its `related`
metadata must name the operator skill in `operatorSkill` and `skills`, and must
add `operatorSkillPath` as a repository-relative bundle directory containing
`SKILL.md`:

```json
{
  "related": {
    "operatorSkill": "skill:demo",
    "skills": ["skill:demo"],
    "operatorSkillPath": "catalog/skills/demo"
  }
}
```

Downloaded GitHub code is not executed during installation by default: Node
dependency lifecycle/build scripts are suppressed, and Python requirements that
may run package builds are rejected. MCP indexing is also deferred because it
launches the stack command. Use `--allow-scripts` only after reviewing the pinned
source and dependencies; that opt-in permits dependency/build execution and
post-install tool indexing.

### Listing Installed Packages

```bash
rudi list                # All installed packages
rudi list stacks         # MCP stacks only
rudi list binaries       # CLI tools only
rudi list runtimes       # Language runtimes
rudi list agents         # External Agent Host readiness
```

### Searching the Registry

```bash
rudi search pdf          # Search for packages
rudi search --all        # List all available packages
rudi search --stacks     # Filter to MCP stacks
rudi search --binaries   # Filter to CLI tools
rudi search --all --skills --category=web --role=operator
rudi search --all --skills --domain=real-estate
rudi list skills --capability=review
rudi info skill:vercel
```

### Managing Secrets

```bash
rudi secrets list                      # Show configured secrets (masked)
rudi secrets set SLACK_BOT_TOKEN       # Set a secret (prompts for value)
rudi secrets set OPENAI_API_KEY "sk-..." # Set with value
rudi secrets get OPENAI_API_KEY        # Print raw value for scripts only
rudi secrets remove SLACK_BOT_TOKEN    # Remove a secret
```

### Integrating with AI Agent Hosts

See [Frontier Agent Hosts](docs/frontier-agent-hosts.md) for the complete
Claude, Codex, Antigravity, and Gemini headless command matrix, current model
aliases, resume/workspace/JSON controls, and the Google authentication split.

```bash
rudi shims rebuild     # Create rudi-router and rudi-mcp shims (opt-in)
rudi integrate claude      # Add the RUDI router to Claude config
rudi integrate codex       # Add the RUDI router to Codex config
rudi integrate gemini      # Add the RUDI router to Gemini config
rudi integrate antigravity # Add the RUDI router to Antigravity config
rudi integrate all         # Add the router to all detected agents
```

This modifies the agent's MCP configuration to include one managed RUDI router;
stack discovery and secret injection stay inside RUDI.

Every registry stack declares a primary operator skill. A normal stack install
installs that skill automatically and reconciles it through the same native
projection coordinator used for Codex, Claude, Gemini, and Antigravity.
Additional companion workflows remain optional:

```bash
rudi install stack:video-editor                 # operator skill included
rudi install stack:video-editor --with-related-skills # include companions
rudi install stack:video-editor --no-related-skills   # operator only
```

In Claude Code, invoke the operator as `/skill-name`. In Codex, use `/skills`
to select it or mention it as `$skill-name`. The operator guides the host
through the stack's MCP tools; users do not need to know the individual tool
names.

`~/.rudi/skills` is the canonical installed package layer. Each native host has
a derived complete-tree projection, with per-host/per-skill ownership receipts
under `~/.rudi/state/native-skills/<host>/`. Each receipt binds the source-file,
complete canonical-package, and rendered-tree digests to the exact target. A direct skill install reconciles
only that skill to configured native hosts by default; select hosts explicitly
or opt out when needed:

```bash
rudi install skill:rudi-diagnose
rudi install skill:rudi-diagnose --sync-skills=codex,claude
rudi install skill:rudi-diagnose --no-sync-skills
```

Reconciliation creates missing trees, adopts an identical legacy tree, updates
an unchanged managed tree, and replaces the whole directory so stale files are
pruned. A tree that differs from its receipt is `drifted`; a collision without
a receipt is `unmanaged`. Both are preserved until the user reviews the exact
skill and supplies scoped `--force`. Whole-inventory force additionally
requires `--all`:

```bash
rudi skills sync codex                 # reconcile/adopt without replacing conflicts
rudi skills sync claude
rudi skills sync gemini
rudi skills sync antigravity
rudi skills sync codex skill:rudi-change-map skill:rudi-engineering-gate --force
rudi skills sync claude skill:rudi-change-map --force
rudi skills sync codex --all --force  # explicit, reviewed whole-inventory replacement
```

Every result reports `restartRequired` when host state changed. Restart active
native sessions to load the new projection; RUDI does not claim hot reload.
`rudi check skill:<id> --json` reports the canonical package and all four host
states. `rudi agent hosts --json` counts only receipt-backed, digest-matching
trees as synchronized; unrelated skill directories do not qualify.

Private native names and host restrictions can be configured in
`$RUDI_HOME/native-skills.json` (default `~/.rudi/native-skills.json`):

```json
{
  "schemaVersion": 1,
  "skills": {
    "skill:image-generator": { "name": "image-generate" },
    "skill:codex-project-task-archiver": { "hosts": ["codex"] }
  }
}
```

Package IDs, canonical directories, lockfiles, and receipt filenames stay stable:
install/update/check/remove still use `skill:image-generator`; the native folder,
frontmatter name, and exact self-invocations use `image-generate`. Omitted `name`
keeps the package name. Omitted `hosts` permits all supported hosts; an empty
array excludes all hosts. Reconciliation returns `excluded` on disallowed hosts
without creating or removing a tree, including with `--force`. Explicit package
removal still cleans unchanged receipt-owned trees on previously allowed hosts. This is private local policy and
does not rename public registry packages.

Policy objects reject unknown fields, unsupported versions, invalid names,
unknown/duplicate hosts, duplicate target names, and symlinked paths. A name
reserved by another policy entry or owned by another package cannot be taken
over, including with force. Invalid policy prevents native reconciliation.

Receipt schema 3 records the stable `skillId` separately from the native
`skillName`; schema 2 remains readable. During a rename, an existing old target
blocks reconciliation. After that target has been deliberately preserved or
relocated, sync adopts an exact rendered new tree and updates the same receipt
atomically. A customized new tree remains `unmanaged` and the prior receipt is
retained; normal sync never recreates the retired name. A missing new tree may
be created. Use `--dry-run` to inspect these decisions first. Removal follows
the receipt's recorded target and digest, preserving unowned or changed trees.
Changing policy does not automatically move or delete existing directories.

Older CLI versions cannot read schema 3 receipts. Keep receipt backups when
rolling out this feature; reverting the executable alone is not a complete
rollback. Keep the new CLI and private policy together on every participating
workstation before running native reconciliation there.

### Running Headless Agent Hosts

`rudi agent` is the supported headless execution surface. Foreground launches
run directly through the shared CLI core and require no daemon. Native
providers continue to own their complete transcripts; RUDI stores only a
bounded launch/workspace projection and durable launch artifacts.

```bash
# Inspect native installations, auth, RUDI router wiring, skills, and versions
rudi agent hosts
rudi agent models claude
rudi agent models codex
rudi agent models antigravity # `google` remains an accepted alias
rudi agent models gemini

# Writable Git projects automatically receive a dedicated worktree
rudi agent launch codex \
  --workspace . \
  --prompt "Fix the failing tests"

# Read-only work uses the project directly
rudi agent launch claude \
  --workspace . \
  --read-only \
  --prompt-file task.md

# stdin and provider-specific argv are supported
printf '%s' "Explain this repository" | \
  rudi agent launch google --workspace . --read-only --json

rudi agent launch codex \
  --workspace . \
  --prompt "Review the installer" \
  -- --strict-config

# Resume the same provider-owned native session
rudi agent resume <launch-id> --prompt "Continue with the next failure"

# Inspect minimal persisted launch projections
rudi agent list --json
rudi agent status <launch-id> --json
```

Workspace defaults fail closed:

| Project | Access | Execution workspace |
| --- | --- | --- |
| Git repository | Writable | New Git worktree |
| Git repository | Read-only | Project root directly |
| Non-Git directory | Writable | Isolated copied workspace |
| Non-Git directory | Read-only | Directory directly |

RUDI never initializes Git, never falls back to `$HOME`, and never degrades a
failed isolated write launch into shared write access. Detached launches,
reconnect, stop, diff, promote/discard, and provider-neutral groups use the
local background service and dedicated workers:

```bash
rudi agent launch codex --workspace . --prompt-file task.md --detach
rudi agent attach <launch-id>
rudi agent diff <launch-id>
rudi agent promote <launch-id>   # or: rudi agent discard <launch-id>

rudi agent group launch \
  --workspace . \
  --task claude:security.md \
  --task codex:implementation.md \
  --task google:ux.md \
  --detach
```

These dedicated workers survive terminal closure and daemon restarts. The
versioned Agent Host service is a control plane, not the owner or source of
truth for provider sessions or transcripts.

### Inspecting Packages

```bash
rudi pkg slack           # Show package details
rudi pkg npm:typescript  # Show shims and paths

rudi shims list          # List all shims
rudi shims check         # Validate shim targets exist
```

### Maintenance

```bash
rudi update stack:slack             # Update one stack and rebuild its tool index
rudi update stack:slack --preserve-state  # Opt in to preserving install-local state paths
rudi update skill:rudi-diagnose     # Reconcile already-managed host projections
rudi update --all                    # Explicitly update the whole installed inventory
rudi remove skill:rudi-diagnose     # Remove only unchanged RUDI-owned projections
rudi remove slack                    # Uninstall a package
rudi doctor              # Check system health
```

For a stack that declares a suite through Registry `related.skills`, use
`--with-related-skills` to update the stack plus only those related skill
packages that are already installed. Missing related skills are reported and
skipped; `update` never turns them into implicit installs. Exact skill updates
reconcile already-managed host projections without blanket force.
`--sync-skills` explicitly selects hosts and still projects only skill IDs
updated by this command:

```bash
# Resolve the exact package, index, and Codex projection plan without those writes.
# Registry metadata is refreshed in memory without persisting the cache.
rudi update stack:swe-engineering --with-related-skills --sync-skills=codex --dry-run --json

# Apply the same bounded suite update and reconcile only its affected Codex projections.
rudi update stack:swe-engineering --with-related-skills --sync-skills=codex
```

Use `--no-sync-skills` to suppress projection reconciliation. Drifted and
unmanaged update targets remain intact unless one exact selected skill is
updated with scoped `--force`.

`rudi update` without a package now fails closed; use `--all` when broad scope
is intentional. Update JSON mode emits one structured document. Install keeps
human progress output and rejects `--json` instead of mixing formats.
Packages installed from GitHub are immutable snapshots: an explicit update
stops with guidance, while `--all` reports and skips them. To move to another
ref or commit, rerun `rudi install <github-tree-url> --force`.

### Retired Commands

Names from the removed imported-session and RUDI-owned execution architecture
remain visible only as migration notices. They exit nonzero and never load
legacy runtime code:

```bash
rudi help db          # Existing rudi.db is preserved but not opened
rudi help session     # Use the provider-native transcript
rudi help parallel    # Use native orchestration or rudi agent group
rudi help run-group   # Use rudi agent group
```

Removed `/agent/*` and `/sessions/*` endpoints have no compatibility adapter.
Core CLI and daemon paths do not initialize, open, repair, or require
`rudi.db`.

## Directory Structure

```
~/.rudi/
├── stacks/               # Installed MCP stack package code
├── skills/               # Installed reusable skill definitions
├── workflows/            # Installed workflow definitions
├── runtimes/             # Managed language runtimes
├── binaries/             # Managed third-party CLI tools
├── agents/               # Legacy agent-package migration metadata (not executable authority)
│
├── bins/                 # Current command shims and router entrypoints
├── shims/                # Legacy shim directory for older integrations
├── router/               # Local MCP router and permission-hook runtime files
│
├── state/                # Persistent per-stack runtime state
│   ├── agent-hosts.db    # Minimal Agent Host lifecycle projection
│   └── stacks/
│       └── google-workspace/
│           └── accounts/ # OAuth tokens and selected account state
├── secrets/              # Stack-specific secret/env files
├── secrets.json          # Primary secret store (mode 0600)
│
├── rudi.json             # Installed package and stack configuration
├── settings.json         # Local settings
├── shim-registry.json    # Shim ownership tracking
│
├── cache/                # Rebuildable registry/package/tool-index cache
├── locks/                # Package install lock files
├── logs/                 # Daemon and runtime logs
├── artifacts/
│   └── agent-launches/   # Per-launch worktrees or isolated copied workspaces
├── notes/                # Local user artifacts from RUDI workflows
├── archive/              # Manual cleanup archives
├── prompts/              # Legacy prompt directory; new assets map to skills/
│
├── rudi.db               # Retired session data; preserved and never opened by CLI
├── rudi.db-wal           # Retired SQLite journal, if already present
├── rudi.db-shm           # Retired SQLite shared memory, if already present
├── daemon.port           # Active loopback daemon port (mode 0600)
└── daemon.token          # Active loopback daemon token (mode 0600)
```

Use `rudi home` for a lifecycle-oriented view of this tree. It labels each path
as installed code, persistent state, secret material, generated cache,
operational logs, or retired preserved data. Use `rudi home --json` for
machine-readable output. Core commands do not create or open `rudi.db`.

## How MCP Integration Works

When you run `rudi integrate claude`, RUDI:

1. Reads the target host's MCP configuration.
2. Writes one `rudi` server entry pointing to `~/.rudi/bins/rudi-router`.
3. Removes obsolete direct RUDI stack entries that the managed router replaces.

When Claude invokes the MCP server:

1. `rudi-router` loads the generated tool index from
   `~/.rudi/cache/tool-index.json`.
2. It maps the requested tool to its installed stack.
3. It loads only that stack's declared secrets and injects them as environment
   variables.
4. It launches the stack MCP server and proxies the request/response.

This architecture means secrets stay local and are never written to agent config files.

## Security Model

### npm Package Installation

By default, npm packages install with `--ignore-scripts` to prevent arbitrary code execution during install. If a package requires lifecycle scripts (e.g., native compilation), use:

```bash
rudi install npm:puppeteer --allow-scripts
```

### Secret Storage

Secrets are stored in `~/.rudi/secrets.json` with file permissions `0600` (owner read/write only). This matches the security model used by SSH, AWS CLI, and other credential stores.

### Shim Isolation

Each package installs to its own directory. Shims are thin wrappers that set up the environment and delegate to the real binary. This prevents packages from interfering with each other.

## Available Stacks

The registry inventory changes independently of the CLI. Discover the current
catalog instead of relying on a checked-in list:

```bash
rudi search --all --stacks
```

When a registry package declares lifecycle metadata, package search, listings,
and `rudi info` show its maturity, support posture, and any deprecation,
replacement, or removal guidance. Packages without lifecycle metadata are
unclassified; the CLI does not infer support from version numbers.

## Available Binaries

| Binary | Description | Source |
|--------|-------------|--------|
| ffmpeg | Video/audio processing | Upstream |
| ripgrep | Fast text search | Upstream |
| supabase | Supabase CLI | npm |
| vercel | Vercel CLI | npm |
| uv | Python package manager | Upstream |

## Troubleshooting

### Command not found after install

Ensure `~/.rudi/bins` is in your PATH:

```bash
echo $PATH | grep -q '.rudi/bins' && echo "OK" || echo "Add ~/.rudi/bins to PATH"
```

### Shim points to missing target

Run `rudi shims check` to validate all shims. If a target is missing, reinstall the package:

```bash
rudi remove npm:typescript
rudi install npm:typescript
```

### MCP stack not appearing in agent

1. Check the stack is installed: `rudi list stacks`
2. Run integration: `rudi integrate claude`
3. Restart the AI agent application

### Permission denied on secrets

Ensure correct permissions:

```bash
chmod 600 ~/.rudi/secrets.json
```

## Links

- Documentation: https://learnrudi.github.io/cli/
- Repository: https://github.com/learnrudi/cli
- Registry: https://github.com/learnrudi/registry
- npm: https://www.npmjs.com/package/@learnrudi/cli
- Issues: https://github.com/learnrudi/cli/issues

## License

MIT

## Stack and skill categories; skill upgrades

Stacks and skills use seven primitive categories: web, code, data, documents, media,
communication and agents. Capability, domain and provider values are read from
`capability:`, `domain:` and `provider:` tags. Search and list accept
`--category`, `--capability`, `--domain`, `--provider` and `--role` filters.
`--role=workflow` refers to a skill's role; `--workflows` still selects the
separate workflow package kind.

Stacks expose the same `facets` in search, installed listings and
`rudi info stack:<id> --json`, without `skillRole` or `operatorFor` fields.
For example, `rudi search --all --stacks --provider=vercel --capability=deploy`
finds the deployment stack, and `rudi list stacks --category=web` filters the
installed inventory. The role filter applies only to skills.

The primary operator role is derived from a stack's `related.operatorSkill`.
Requiring a stack does not make a workflow its operator. Skill JSON includes
`skillRole`, `operatorFor` and `facets`; installed inventory uses local/cached
catalog context without a network request and reports unknown role for external
or unidentified installs. `rudi info skill:<id>` reads the actual skill entrypoint
and supports `--json`.

Canonical skill packages install as `~/.rudi/skills/<id>/SKILL.md`; legacy flat
installs remain readable. Updating an owned skill stages the complete package,
verifies existing content against the installation checksum, replaces the
source and writes the new lock. Failed updates restore the prior source and
lock when recovery is safe. Edited files and missing ownership evidence are
preserved, even when update internally requests reinstall. `rudi update skill:<id>
--dry-run --no-sync-skills` checks ownership and reports the proposed migration
without replacing content. Files excluded from historical checksums also block
replacement until their ownership is reconciled.

Successful replacements retain the previous file/tree under a hidden transaction
folder, return `backupPath` in the install result and print it during updates.
This preserves late writes through already-open files. Reconcile these backups
before any separately authorized cleanup; the updater never deletes them automatically.

Same-ID loose-file/folder collisions are explicit errors for path resolution
and native sync; `rudi list skills` exposes their paths for reconciliation.
If a concurrent edit prevents rollback, preserve the reported transaction
folder and resolve its contents and `.install-lock` before retrying. Do not
remove a recovery guard until its prior package and edited replacement have
been accounted for.

Native projections retain complete trigger descriptions and bundled Codex
metadata. Ownership receipts, exact force scope, conflict preservation and
restartRequired reporting continue to govern native updates. Deploy the
compatible CLI before publishing a registry that migrates existing flat skills.
