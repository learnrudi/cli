# RUDI Public Readiness Checklist

Date: 2026-06-03

This checklist tracks the work required to make RUDI ready for public use as a clean CLI, registry, and local capability layer. It covers the relationship between:

- `apps/cli`: the user-facing installer, manager, router, and runner.
- `apps/registry`: the source of truth for package definitions and downloadable artifacts.
- `~/.rudi`: the user's local installed state.

## Product Taxonomy

RUDI should expose three first-class package kinds:

| Kind | Definition | Local install path | Registry path |
| --- | --- | --- | --- |
| `stack` | Executable MCP/tool package with code, dependencies, tool schemas, and optional secrets | `~/.rudi/stacks/<id>/` | `catalog/stacks/<id>/` |
| `skill` | Reusable agent instruction/playbook; markdown only, no runtime state | `~/.rudi/skills/<id>.md` | `catalog/skills/<id>.md` |
| `workflow` | Structured repeatable execution with inputs, steps, dependencies, outputs, validation, and permissions | `~/.rudi/workflows/<id>.yaml` | `catalog/workflows/<id>.yaml` |

`prompt` is a deprecated compatibility alias for `skill`. It should not remain a first-class public product term.

## Architecture Contract

The public install flow should be:

```bash
npm install -g @learnrudi/cli
rudi init
rudi search stack:image-generator
rudi install stack:image-generator
rudi install skill:code-review
rudi install workflow:example-review
rudi list stacks
rudi list skills
rudi list workflows
rudi run workflow:example-review
```

The CLI should not ship all stacks, skills, or workflows. It should fetch a registry index, download immutable package artifacts, verify checksums, and install into `~/.rudi`.

## P0: Release Blockers

These block public release.

- [x] CLI packed tarball installs from a fresh temp prefix with `npm install`.
  - Owner: CLI
  - Fixed on 2026-06-03: internal workspace packages moved out of published production dependencies.
  - Exit criteria: `npm pack` followed by `npm install --prefix <temp> <tarball> --ignore-scripts` exits 0.
- [x] CLI package contents are restricted to required runtime files.
  - Owner: CLI
  - Fixed on 2026-06-03: package `files` allowlist narrowed to required runtime artifacts.
  - Exit criteria: `npm pack --dry-run` contains only `dist/index.cjs`, router files, package manifest, templates, README, license, and `package.json`.
- [ ] CLI and registry use one registry index contract.
  - Owner: CLI and Registry
  - Current issue: CLI consumes legacy root `index.json` sections, while registry also compiles a keyed v2 index.
  - Exit criteria: one documented schema supports `stack`, `skill`, and `workflow`, and both repos test against it.
- [ ] Public installs use immutable package artifacts.
  - Owner: Registry
  - Current issue: stack installs can pull mutable GitHub `main` raw files.
  - Exit criteria: registry entries point to versioned tarballs or release artifacts.
- [ ] Every downloadable artifact has a real SHA-256 checksum.
  - Owner: Registry
  - Current issue: public-readiness validation reports 50 all-zero checksum placeholders.
  - Progress: `npm run validate:public` now rejects placeholder checksums.
  - Exit criteria: schema validation rejects placeholder checksums and CI verifies all referenced artifacts.
- [ ] Failed downloads fail hard.
  - Owner: CLI
  - Current issue: binary/runtime failures can create successful placeholder installs.
  - Exit criteria: install returns failure unless explicitly running in a documented development mode.
- [ ] Archive extraction is hardened.
  - Owner: CLI
  - Exit criteria: extracts reject path traversal, absolute paths, symlink escapes, and unexpected binary paths.
- [ ] Public dependency audit passes or has documented accepted risk.
  - Owner: CLI and Registry
  - Exit criteria: production dependency audit has no high severity findings.

## P1: Registry Structure

- [ ] Keep `catalog/stacks/`.
- [ ] Keep `catalog/skills/`.
- [x] Add `catalog/workflows/`.
- [ ] Deprecate `catalog/prompts/`.
- [ ] Keep any `prompt` support as a CLI alias only.
- [ ] Ensure every path referenced by `index.json` exists and is tracked.
  - Current issue: public-readiness validation reports 5 referenced paths with no tracked files.
- [ ] Remove local runtime artifacts from registry source:
  - [ ] `node_modules/`
  - [ ] Python `venv/`
  - [ ] `.env`
  - [ ] OAuth `state.json`
  - [ ] OAuth `credentials.json`
  - [ ] generated outputs
  - [ ] sample run directories
- [x] Decide whether registry is published to npm.
  - Decision for now: keep it publishable, but publish only indexes, catalog metadata, skills, and compiled stack tarballs.
  - Fixed on 2026-06-03: added strict `files` allowlist and `.npmignore`.
  - `npm pack --dry-run`: 117 files, 215.7 KB packed, 918.2 KB unpacked.
  - If no, add `"private": true` or remove npm publication assumptions.

## P2: Schemas

### Stack Schema

- [ ] Requires `id`, `kind`, `name`, `version`, `runtime`, `mcp`, `provides`.
- [ ] Declares required binaries and secrets.
- [ ] Declares package artifact URL and checksum for public installs.
- [ ] Declares tool names in a stable shape.
- [ ] Rejects unsupported install hooks unless explicitly reviewed.

### Skill Schema

- [ ] Markdown file with frontmatter.
- [ ] Requires `id`, `name`, `description`, `version`, `category`.
- [ ] May declare compatible stacks.
- [ ] Must not declare executable steps, secrets, runtime commands, or persistent state.

### Workflow Schema

- [ ] Requires `id`, `name`, `version`, `inputs`, `requires`, `steps`, `outputs`, `validation`, `permissions`.
  - Progress: CLI manifest validation now recognizes `workflow` and requires executable `steps`.
- [ ] Supports step types:
  - [ ] `skill`
  - [ ] `tool`
  - [ ] `command` only when explicitly allowed
- [ ] Supports compatibility constraints:

```yaml
requires:
  stacks:
    image-generator: ">=0.1.0 <1.0.0"
  skills:
    code-review: ">=1.0.0"
```

- [ ] Declares permission posture:
  - [ ] read local files
  - [ ] write local files
  - [ ] call external APIs
  - [ ] publish externally
  - [ ] spend money
  - [ ] destructive action

## P3: CLI Package Behavior

- [x] `rudi init` creates:
  - [x] `~/.rudi/stacks/`
  - [x] `~/.rudi/skills/`
  - [x] `~/.rudi/workflows/`
  - [x] `~/.rudi/runtimes/`
  - [x] `~/.rudi/binaries/`
  - [x] `~/.rudi/agents/`
  - [x] `~/.rudi/bins/`
  - [x] `~/.rudi/cache/`
  - [x] `~/.rudi/locks/`
- [x] `rudi search` supports `stack`, `skill`, and `workflow`.
- [ ] `rudi install stack:<id>` installs to `~/.rudi/stacks/<id>/`.
- [x] `rudi install skill:<id>` installs to `~/.rudi/skills/<id>.md`.
- [x] `rudi install workflow:<id>` installs to `~/.rudi/workflows/<id>.yaml`.
- [x] `rudi list workflows` works.
- [x] `rudi remove workflow:<id>` works.
- [ ] `rudi run workflow:<id>` validates required stacks and skills before execution.
- [ ] `rudi index` indexes installed stack tools without requiring the daemon.
- [ ] The DB is used for workflow runs, artifacts, session history, daemon state, and analytics, not for package definitions.

## P4: Workflow Runner

Start with a small, deterministic runner.

- [ ] Sequential steps only.
- [ ] Validates all inputs before first step.
- [ ] Resolves installed stack tools from the local tool index.
- [ ] Resolves installed skills from `~/.rudi/skills/`.
- [ ] Creates one run directory per workflow execution.
- [ ] Persists run metadata to the DB when the DB is initialized.
- [ ] Continues to run without DB only when configured for stateless mode.
- [ ] Records outputs and artifacts.
- [ ] Runs output validation after each relevant step.
- [ ] Fails with structured errors.
- [ ] Requires confirmation for external publishing, destructive actions, and spend-money actions.

## P5: Security

- [ ] No secrets in registry files.
  - Current issue: public-readiness validation reports 13 secret-like local files under the registry catalog.
- [ ] No secrets in package artifacts.
- [ ] No secrets printed by CLI diagnostics.
- [x] Secret files remain local under `~/.rudi`.
  - Fixed on 2026-06-03: runner secret access now delegates to `@learnrudi/secrets`, so CLI commands and stack execution use the same `RUDI_HOME`-backed `secrets.json` path.
- [ ] Decide whether public release accepts the current `0600` JSON file backend or requires OS keychain/encrypted fallback.
  - Current issue: secret values are local and permission-restricted, but not encrypted by the active file backend.
- [ ] Show required secrets before install.
- [ ] Confirm before destructive or externally visible actions.
- [ ] Prefer argument-array process execution over shell strings.
- [ ] Shell-string install hooks require explicit review and schema declaration.
- [ ] Verify checksums before extraction.
- [ ] Reject archives with path traversal or symlink escapes.
- [ ] Use least-privilege permissions in workflows.

## P6: CI And Verification

### CLI CI

- [x] `pnpm test`
- [x] `pnpm build`
- [x] `npm pack --dry-run`
- [x] temp install packed tarball
- [x] `rudi --version` from temp install
- [ ] `RUDI_HOME=<temp> rudi init --skip-downloads`
- [x] `RUDI_HOME=<temp>` shared secrets store and runner secrets access smoke
- [ ] install smoke for one stack, one skill, and one workflow
- [ ] production dependency audit

### Registry CI

- [x] schema validation
- [x] index compile
- [x] all referenced paths exist
- [ ] all referenced files are tracked
- [ ] no placeholder checksums
- [ ] artifact checksum verification
- [ ] no secret filename patterns
- [ ] no common token/private-key patterns
- [x] npm package dry-run only if registry is intentionally published to npm

## Definition Of Done

RUDI is public-ready when a fresh user can run:

```bash
npm install -g @learnrudi/cli
rudi init
rudi install stack:web-export
rudi install skill:code-review
rudi install workflow:example-review
rudi list stacks
rudi list skills
rudi list workflows
rudi run workflow:example-review
```

and every downloaded artifact is immutable, verified, reproducible, and documented.

## Current Execution Log

- 2026-06-03: Initial checklist created.
- 2026-06-03: First execution target selected: CLI `npm pack` plus temp install from tarball.
- 2026-06-03: CLI tarball contents reduced from about 22.9 MB packed / 64.6 MB unpacked to about 598 KB packed / 3.0 MB unpacked.
- 2026-06-03: CLI temp install from packed tarball completed successfully and installed binary returned `rudi v1.10.12`.
- 2026-06-03: Temp-installed CLI package audit returned 0 vulnerabilities. Workspace-level `pnpm audit --prod` still reports findings in internal workspace packages and remains open.
- 2026-06-03: CLI workflow package-kind support added for paths, init, search, install, list, remove, lockfiles, manifest validation, home, doctor, help, and OpenAPI package vocabulary.
- 2026-06-03: Registry public-readiness validator added as `npm run validate:public`.
- 2026-06-03: Registry `catalog/workflows/` added.
- 2026-06-03: Registry npm package allowlist added and narrowed. `npm pack --dry-run` now reports 117 files, 215.7 KB packed, 918.2 KB unpacked.
- 2026-06-03: Registry public-readiness gate currently fails by design with 68 errors and 1 warning: 5 untracked referenced paths, 50 placeholder checksums, 13 secret-like local files, and the deprecated prompt catalog warning.
- 2026-06-03: Verification run: CLI `pnpm build` passed; CLI `pnpm test` passed with 636 passing and 5 skipped; CLI `npm pack --dry-run` passed with 11 files and 599.4 KB packed.
- 2026-06-03: Verification run: Registry `npm test` passed with 91 tests; registry `npm run build` passed; registry `npm pack --dry-run` passed; registry `npm run validate:public -- --json` failed as expected on remaining blockers.
- 2026-06-03: CLI secrets storage consolidated: runner secret reads/writes now use `@learnrudi/secrets`, preserving local `RUDI_HOME/secrets.json` semantics for both CLI commands and stack execution.
- 2026-06-03: Verification run: focused CLI secrets tests passed; CLI `pnpm build` passed; CLI `pnpm test` passed with 636 passing and 5 skipped; CLI `npm pack --dry-run` passed with 11 files and 599.5 KB packed.
