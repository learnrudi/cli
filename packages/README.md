# RUDI workspace packages

These libraries belong to the `@learnrudi/cli` pnpm workspace. The CLI build
bundles the libraries it uses into `dist/index.cjs` and `dist/router-mcp.js`.
End users install `@learnrudi/cli`; they do not need this source directory or
separate installs of the workspace packages.

| Directory | Package | Responsibility and consumers |
| --- | --- | --- |
| `core/` | `@learnrudi/core` | Package resolution, installation/removal, locks, shims, configuration, and tool indexing; used by CLI commands. |
| `env/` | `@learnrudi/env` | Home paths, platform detection, and installed-package discovery; shared foundation. |
| `manifest/` | `@learnrudi/manifest` | Parse and validate package manifests; used by installation and execution. |
| `mcp/` | `@learnrudi/mcp` | MCP configuration, router, and tool-name helpers; used by integration and indexing. |
| `registry-client/` | `@learnrudi/registry-client` | Registry fetching/search, artifact downloads, and verification; used by core and CLI commands. |
| `runner/` | `@learnrudi/runner` | Process spawning, streaming, and execution-time environment preparation; used by `rudi run`. |
| `secrets/` | `@learnrudi/secrets` | Secret storage and resolution; used by CLI and runner. |
| `utils/` | `@learnrudi/utils` | Argument parsing and terminal help; used by the CLI entrypoint. |
| `db/` | `@learnrudi/db` | Retained Studio compatibility code. Not imported by the CLI production runtime or runner, and not shipped in the CLI npm package. |

## Development

Run these commands from the CLI repository root:

```bash
pnpm install --frozen-lockfile
pnpm test
pnpm build
npm pack --dry-run
```

The root test wrapper discovers workspace unit tests. To run one package's
tests, use its declared script, for example `pnpm --filter @learnrudi/core test`.
The root build produces the CLI bundles; there is no per-package build command.
Use a supported Node version and install native dependencies with that version.
See the [repository guide](../docs/cli-layout-and-installation.md) for the tree,
source-to-install trace, and clean installation checks.

## Database retirement boundary

`packages/db` implements the older imported-session database. The current
Agent Host launch store is implemented separately in
`src/agent-host/launch-store.js`; it still uses `better-sqlite3`. Removing the
legacy package would not justify removing that production dependency.

[ADR 0001](../docs/adr/0001-retire-legacy-agent-execution.md) requires coordinated
Studio retirement or migration before deleting this package. The October 15,
2026 audit found no CLI production imports, but the admin Mac's archived Studio
checkout still declares `file:../cli/packages/db` and imports its service API.
That archived relative path is not evidence of a working current deployment;
it is an unresolved source/recovery dependency. Keep the package until that
consumer's preservation or migration decision is recorded on both peers.

The audit and remaining retirement checks are recorded in the
[cleanup ledger](../docs/swe-compliance/2026-10-15-cli-cleanup-and-fresh-install.md).
Existing user `rudi.db` files remain preserved independently of this source-code
decision. They are never opened, migrated, or deleted by the CLI.
