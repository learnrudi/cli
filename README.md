# RUDI CLI

A universal tool manager for MCP stacks, CLI tools, runtimes, and AI agents.

RUDI provides a unified installation and management system for:
- **MCP Stacks** - Model Context Protocol servers for Claude, Codex, and Gemini
- **CLI Tools** - Any npm package or upstream binary (ffmpeg, ripgrep, etc.)
- **Runtimes** - Node.js, Python, Deno, Bun
- **AI Agents** - Claude Code, Codex CLI, Gemini CLI

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
3. **Upstream Binaries** - Direct downloads from official sources

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

# Install with scripts enabled (when needed)
rudi install npm:puppeteer --allow-scripts

# Optional: create shims immediately (opt-in)
rudi install binary:ffmpeg --with-shims
```

### Listing Installed Packages

```bash
rudi list                # All installed packages
rudi list stacks         # MCP stacks only
rudi list binaries       # CLI tools only
rudi list runtimes       # Language runtimes
rudi list agents         # AI agent CLIs
```

### Searching the Registry

```bash
rudi search pdf          # Search for packages
rudi search --all        # List all available packages
rudi search --stacks     # Filter to MCP stacks
rudi search --binaries   # Filter to CLI tools
```

### Managing Secrets

```bash
rudi secrets list                      # Show configured secrets (masked)
rudi secrets set SLACK_BOT_TOKEN       # Set a secret (prompts for value)
rudi secrets set OPENAI_API_KEY "sk-..." # Set with value
rudi secrets remove SLACK_BOT_TOKEN    # Remove a secret
```

### Integrating with AI Agents

```bash
rudi shims rebuild     # Create rudi-router and rudi-mcp shims (opt-in)
rudi integrate claude    # Add stacks to Claude Desktop config
rudi integrate codex     # Add stacks to Codex config
rudi integrate gemini    # Add stacks to Gemini config
rudi integrate all       # Add to all detected agents
```

This modifies the agent's MCP configuration file (e.g., `~/Library/Application Support/Claude/claude_desktop_config.json`) to include your installed stacks with proper secret injection.

### Inspecting Packages

```bash
rudi pkg slack           # Show package details
rudi pkg npm:typescript  # Show shims and paths

rudi shims list          # List all shims
rudi shims check         # Validate shim targets exist
```

### Maintenance

```bash
rudi update              # Update all packages
rudi update slack        # Update specific package
rudi remove slack        # Uninstall a package
rudi doctor              # Check system health
```

## Directory Structure

```
~/.rudi/
├── bins/                 # Shims (opt-in; add to PATH if desired)
│   ├── tsc              # → binaries/npm/typescript/...
│   ├── ffmpeg           # → binaries/ffmpeg/...
│   └── rudi-mcp         # MCP router for agents
│
├── stacks/               # MCP server installations
│   ├── slack/
│   │   ├── manifest.json
│   │   ├── index.js
│   │   └── node_modules/
│   └── google-workspace/
│
├── binaries/             # CLI tool installations
│   ├── ffmpeg/           # Upstream binary
│   ├── supabase/         # npm-based CLI
│   └── npm/              # Dynamic npm packages
│       ├── typescript/
│       └── vercel/
│
├── runtimes/             # Language runtimes
│   ├── node/
│   └── python/
│
├── agents/               # AI agent CLI installations
│
├── secrets.json          # API keys (mode 0600)
├── shim-registry.json    # Shim ownership tracking
└── rudi.db               # Local metadata database
```

## How MCP Integration Works

When you run `rudi integrate claude`, RUDI:

1. Reads the Claude Desktop config at `~/Library/Application Support/Claude/claude_desktop_config.json`
2. Adds entries for each installed stack pointing to `~/.rudi/bins/rudi-mcp`
3. Passes the stack ID as an argument

When Claude invokes the MCP server:

1. `rudi-mcp` receives the stack ID
2. Loads secrets from `~/.rudi/secrets.json`
3. Injects secrets as environment variables
4. Spawns the actual MCP server process
5. Proxies stdio between Claude and the server

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

| Stack | Description | Required Secrets |
|-------|-------------|------------------|
| slack | Channels, messages, reactions | `SLACK_BOT_TOKEN` |
| google-workspace | Gmail, Sheets, Docs, Drive | `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` |
| notion-workspace | Pages, databases, search | `NOTION_API_KEY` |
| github | Issues, PRs, repos, actions | `GITHUB_TOKEN` |
| postgres | SQL queries | `DATABASE_URL` |
| stripe | Payments, subscriptions | `STRIPE_SECRET_KEY` |
| openai | DALL-E, Whisper, TTS | `OPENAI_API_KEY` |
| google-ai | Gemini, Imagen | `GOOGLE_AI_API_KEY` |

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

- Documentation: https://learn-rudi.github.io/cli/
- Repository: https://github.com/learn-rudi/cli
- Registry: https://github.com/learn-rudi/registry
- npm: https://www.npmjs.com/package/@learnrudi/cli
- Issues: https://github.com/learn-rudi/cli/issues

## License

MIT
