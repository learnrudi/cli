/**
 * Help and version display
 */

export function printVersion(version) {
  console.log(`rudi v${version}`);
}

export function printHelp(topic) {
  if (topic) {
    printCommandHelp(topic);
    return;
  }

  console.log(`
rudi - RUDI CLI

USAGE
  rudi <command> [options]

SETUP
  init                  Bootstrap RUDI (download runtimes, optional shims)

REGISTRY
  search <query>        Search registry for packages
  search --all          List all available packages
  install <pkg>         Install a package
  remove <pkg>          Remove a package
  update [pkg]          Update packages

INSTALLED
  list [kind]           List installed packages (stacks, skills, workflows, runtimes, binaries, agents)
  skills                List skills or sync installed skills to native agents
  home                  Show ~/.rudi structure and status
  doctor                Check system health and dependencies
  which <cmd>           Show path to a command
  info <pkg>            Show package details
  shims [cmd]           Manage shims in ~/.rudi/bins (list, check, fix, rebuild)
  local-llm <cmd>       Check local OpenAI-compatible LLM runtimes and export env
  runtime <cmd>         Inspect runtime registry entries and status
  daemon <cmd>          Start, stop, restart, or inspect the local daemon

AGENT INTEGRATION
  integrate <agent>     Wire up RUDI router (claude, cursor, gemini, codex, all)
  integrate --list      Show detected agents
  instructions [agent]  Print or install RUDI agent instruction blocks
  index                 Rebuild tool cache for router

RUN
  run <stack>           Run a stack directly
  lanes <cmd>           Manage the local main/dev lane worktree layout
  leverage [preset]     Calculate human-attention leverage for agent workflows

SECRETS
  secrets set <name>    Set a secret
  secrets get <name>    Print a secret value for scripts
  secrets list          List configured secrets
  secrets remove <name> Remove a secret

OPTIONS
  -h, --help           Show help
  -v, --version        Show version
  --verbose            Verbose output
  --json               Output as JSON

EXAMPLES
  rudi search --all              List all available packages
  rudi install slack             Install Slack stack
  rudi secrets set SLACK_TOKEN   Configure secret
  rudi integrate claude          Wire up Claude Desktop/Code
  rudi instructions codex        Print Codex instruction block
  rudi skills sync codex         Create native Codex wrappers for RUDI skills
  rudi skills sync claude        Create native Claude wrappers for RUDI skills
  rudi leverage frontend         Calculate frontend workflow leverage
  rudi list                      Show installed packages

PACKAGE TYPES
  stack:<name>         MCP server stack
  runtime:<name>       Node, Python, Deno, Bun
  binary:<name>        ffmpeg, ripgrep, etc.
  agent:<name>         Claude, Codex, Gemini CLIs
  skill:<name>         Skill (prompt with optional stack requirements)
  workflow:<name>      Repeatable workflow definition
`);
}

function printCommandHelp(command) {
  const help = {
    search: `
rudi search - Search the registry

USAGE
  rudi search <query> [options]

OPTIONS
  --stacks         Filter to stacks only
  --skills         Filter to skills only (alias: --prompts)
  --workflows      Filter to workflows only
  --runtimes       Filter to runtimes only
  --binaries       Filter to binaries only
  --agents         Filter to agents only
  --all            List all packages (no query needed)
  --fresh          Refresh registry cache before searching
  --no-cache       Alias for --fresh
  --json           Output as JSON

EXAMPLES
  rudi search pdf
  rudi search deploy --stacks
  rudi search ffmpeg --binaries
  rudi search --all --agents
`,
    install: `
rudi install - Install a package

USAGE
  rudi install <package> [options]

OPTIONS
  --force          Force reinstall
  --json           Output as JSON

EXAMPLES
  rudi install pdf-creator
  rudi install stack:youtube-extractor
  rudi install runtime:python
  rudi install binary:ffmpeg
  rudi install agent:claude
  rudi install workflow:daily-brief
`,
    run: `
rudi run - Execute a stack

USAGE
  rudi run <stack> [options]

OPTIONS
  --input <json>   Input parameters as JSON
  --cwd <path>     Working directory
  --verbose        Show detailed output

EXAMPLES
  rudi run pdf-creator
  rudi run pdf-creator --input '{"file": "doc.html"}'
`,
    parallel: `
rudi parallel - Launch grouped parallel agent sessions

LEGACY COMPATIBILITY
  This command is retained for older RUDI sidecar/run-group workflows.
  Prefer native Claude/Codex/Gemini orchestration for new agent work.

USAGE
  rudi parallel "<task1>" "<task2>" [more tasks] [options]
  rudi parallel --template <name> [options]

OPTIONS
  --name <name>               Group display name
  --provider <provider>       Agent provider (default: claude)
  --model <model>             Model override
  --base-branch <branch>      Base branch for worktrees (default: current branch)
  --cwd <path>                Working directory (default: current dir)
  --permission-mode <mode>    Permission mode passed to provider
  --system-prompt <prompt>    Additional system prompt
  --coordination-mode <mode>  flat, phased, or dependency
  --template <name>           Load a tracked run-group template
  --list-templates            Show available run-group templates
  --allow-validation-commands Allow non-default validator commands
  --no-worktree               Run in shared cwd instead of isolated worktrees

EXAMPLES
  rudi parallel "implement auth" "write tests" "update docs"
  rudi parallel "fix bug A" "fix bug B" --name "Bug batch"
  rudi parallel "task1" "task2" --provider claude --model sonnet
  rudi parallel --list-templates
  rudi parallel --template code-review-3task --coordination-mode dependency
`,
    'run-group': `
rudi run-group - Inspect and manage parallel agent run groups

LEGACY COMPATIBILITY
  This command is retained for older RUDI sidecar/run-group workflows.
  Prefer native agent-host orchestration for new parallel agent work.

USAGE
  rudi run-group <command> [args] [options]

COMMANDS
  list                          List run groups
  show <group-id>               Show run-group details and sessions
  stop <group-id>               Stop active sessions in a run group
  merge <group-id>              Merge successful run-group branches
  cleanup <group-id>            Remove worktrees for a run group

OPTIONS
  --json                        Output raw JSON
  --status <status>             Filter list results
  --project-path <path>         Filter list by project path
  --limit <n>                   Limit list results
  --offset <n>                  Offset list results
  --to <branch>                 Merge target branch
  --session-ids <a,b,c>         Explicit session IDs to merge
  --delete-branches             Delete branches during cleanup

EXAMPLES
  rudi run-group list --status running
  rudi run-group show group-123
  rudi run-group merge group-123 --to dev
  rudi run-group cleanup group-123 --delete-branches
`,
    lanes: `
rudi lanes - Manage the local main/dev lane layout for solo-dev parallel work

USAGE
  rudi lanes <command> [options]

COMMANDS
  init                          Create or discover the dev worktree
  sync                          Fast-forward main and dev from upstreams

OPTIONS
  --cwd <path>                  Repository path
  --main <branch>               Main lane branch (default: main)
  --dev <branch>                Dev lane branch (default: dev)
  --dev-path <path>             Override sibling dev worktree path
  --json                        Output raw JSON

EXAMPLES
  rudi lanes init
  rudi lanes init --cwd /path/to/repo
  rudi lanes sync
`,
    leverage: `
rudi leverage - Calculate agent workflow leverage

USAGE
  rudi leverage [preset] [options]

PRESETS
  frontend                 8h design/engineer/QA workflow baseline

OPTIONS
  --solo <min>             Solo workflow minutes
  --budget <min>           Human attention budget (default: solo minutes)
  --spec <min>             Human spec/direction minutes
  --review <min>           Human final review/fix minutes
  --agents <n>             Number of agent roles/workstreams
  --agent-minutes <min>    Agent minutes per role
  --serial                 Agents run serially instead of in parallel
  --json                   Output JSON

EXAMPLES
  rudi leverage frontend
  rudi leverage --solo 480 --spec 60 --review 30 --agents 3 --agent-minutes 20
  rudi leverage --solo 480 --spec 60 --review 30 --agents 3 --agent-minutes 20 --serial
`,
    'local-llm': `
rudi local-llm - Inspect local OpenAI-compatible LLM runtimes

USAGE
  rudi local-llm status [runtime] [options]
  rudi local-llm models [runtime] [options]
  rudi local-llm env [consumer] [options]

OPTIONS
  --runtime <name>              Runtime name (default: ollama)
  --target <name>               Runtime target (default: mac_host)
  --consumer <name>             Consumer app for status resolution
  --consumer-context <name>     host_process or docker_container
  --model <tag>                 Model tag for env rendering
  --base-url <url>              Override resolved base URL
  --timeout <ms>                Health/model request timeout
  --json                        Output raw JSON

EXAMPLES
  rudi local-llm status
  rudi local-llm models
  rudi local-llm env content-engine --model llama3.2:3b
`,
    runtime: `
rudi runtime - Inspect runtime registry entries

USAGE
  rudi runtime list
  rudi runtime status <runtime>

OPTIONS
  --json                        Output raw JSON

EXAMPLES
  rudi runtime list
  rudi runtime status ollama
`,
    daemon: `
rudi daemon - Manage the local RUDI daemon

USAGE
  rudi daemon status [--json]
  rudi daemon start [--port <port>] [--json]
  rudi daemon stop [--json]
  rudi daemon restart [--port <port>] [--json]
  rudi daemon install [--port <port>] [--dry-run] [--json]
  rudi daemon uninstall [--dry-run] [--json]

NOTES
  Without a LaunchAgent, start/stop/restart control a detached local
  \`rudi serve\` process. After install, lifecycle uses the per-user macOS
  LaunchAgent at ~/Library/LaunchAgents/com.learnrudi.daemon.plist.

EXAMPLES
  rudi daemon status
  rudi daemon start
  rudi daemon install --dry-run
  rudi daemon install
  rudi daemon restart --port 8100
  rudi daemon uninstall
  rudi daemon stop
`,
    list: `
rudi list - List installed packages

USAGE
  rudi list [kind]

ARGUMENTS
  kind             Filter: stacks, skills, workflows, runtimes, binaries, agents

OPTIONS
  --json           Output as JSON
  --detected       Show MCP servers from agent configs (stacks only)
  --category=X     Filter skills by category

EXAMPLES
  rudi list
  rudi list stacks
  rudi list stacks --detected     Show MCP servers in Claude/Gemini/Codex
  rudi list binaries
  rudi list workflows
  rudi skills
  rudi list skills --category=coding
`,
    skills: `
rudi skills - List or sync installed RUDI skills

USAGE
  rudi skills
  rudi skills sync <codex|claude> [--force] [--dry-run] [--json]

COMMANDS
  sync codex       Create native ~/.codex/skills wrappers for installed RUDI skills
  sync claude      Create native ~/.claude/skills wrappers for installed RUDI skills

OPTIONS
  --force          Overwrite existing native skill wrappers
  --dry-run        Preview sync results without writing files
  --json           Output JSON

EXAMPLES
  rudi skills
  rudi skills sync codex
  rudi skills sync claude
  rudi skills sync codex --force
`,
    secrets: `
rudi secrets - Manage secrets

USAGE
  rudi secrets <command> [args]

COMMANDS
  set <name>       Set a secret (prompts for value)
  get <name>       Get a secret value (prints raw value; use only in scripts)
  list             List configured secrets (values masked)
  remove <name>    Remove a secret

EXAMPLES
  rudi secrets set VERCEL_TOKEN
  API_TOKEN="$(rudi secrets get API_TOKEN)" command-that-needs-token
  rudi secrets list
  rudi secrets remove GITHUB_TOKEN

SECURITY
  get prints the raw secret value to stdout. Do not run it by itself in logs or
  paste the result into chats. Prefer non-echoing command substitution.
`,
    db: `
rudi db - Legacy session database operations

LEGACY COMPATIBILITY
  Core RUDI no longer initializes or requires rudi.db. These commands are
  retained for existing session/history/database workflows.

USAGE
  rudi db <command> [args]

COMMANDS
  stats            Show usage statistics
  search <query>   Search conversation history
  init             Initialize or migrate database
  path             Show database file path
  reset            Delete all data (requires --force)
  vacuum           Compact database and reclaim space
  backup [file]    Create database backup
  prune [days]     Delete sessions older than N days (default: 90)
  tables           Show table row counts

OPTIONS
  --force          Required for destructive operations
  --dry-run        Preview without making changes
  --json           Output as JSON

EXAMPLES
  rudi db stats
  rudi db search "authentication bug"
  rudi db reset --force
  rudi db vacuum
  rudi db backup ~/backups/rudi.db
  rudi db prune 30 --dry-run
  rudi db tables
`,
    session: `
rudi session - Legacy session history operations

LEGACY COMPATIBILITY
  Core RUDI no longer owns normal agent execution or session history.
  These commands are retained for existing imported-session workflows.

USAGE
  rudi session <command> [args]

COMMANDS
  list [options]         List sessions with filters
  show <id>              Show session details
  rename <id> <title>    Rename a session
  delete <id> [--force]  Delete a session
  tag <id> <tags>        Add tags
  move <id> --project    Move session to project
  export <id> [-o file]  Export session to JSON
  search <query>         Search session content
  index [--embeddings]   Index sessions for semantic search
  similar <id>           Find similar sessions

EXAMPLES
  rudi session list --days 7
  rudi session search "authentication bugs"
  rudi session export 7bfa7be7 -o session.json
`,
    import: `
rudi import - Import sessions from AI providers

USAGE
  rudi import <command> [options]

COMMANDS
  sessions [provider]  Import sessions from provider (claude, codex, gemini, or all)
  status               Show import status for all providers

OPTIONS
  --dry-run            Show what would be imported without making changes
  --max-age=DAYS       Only import sessions newer than N days
  --verbose            Show detailed progress

EXAMPLES
  rudi import sessions              Import from all providers
  rudi import sessions claude       Import only Claude sessions
  rudi import sessions --dry-run    Preview without importing
  rudi import status                Check what's available to import
`,
    init: `
rudi init - Bootstrap RUDI environment

USAGE
  rudi init [options]

OPTIONS
  --force            Reinitialize even if already set up
  --skip-downloads   Skip downloading runtimes/binaries
  --with-shims       Create shims in ~/.rudi/bins/ (opt-in)
  --no-agent-instructions
                     Skip installing the Codex AGENTS.md RUDI block
  --quiet            Minimal output (for programmatic use)

WHAT IT DOES
  1. Creates ~/.rudi directory structure (if missing)
  2. Downloads bundled runtimes (Node.js, Python) if not installed
  3. Downloads essential binaries (sqlite3, ripgrep) if not installed
  4. Optionally creates shims in ~/.rudi/bins/ (use --with-shims)
  5. Creates settings.json (if missing)
  6. Installs/refreshes the managed Codex AGENTS.md RUDI block

NOTE: Legacy session/database commands initialize rudi.db only when invoked.

NOTE: Safe to run multiple times - only creates what's missing.

EXAMPLES
  rudi init
  rudi init --force
  rudi init --with-shims
  rudi init --skip-downloads
  rudi init --no-agent-instructions
  rudi init --quiet
`,
    home: `
rudi home - Show ~/.rudi structure and status

USAGE
  rudi home [options]

OPTIONS
  --verbose        Show package details
  --json           Output as JSON

SHOWS
  - Directory structure with sizes
  - Installed package counts
  - Legacy session database status
  - Quick commands reference

EXAMPLES
  rudi home
  rudi home --verbose
  rudi home --json
`,
    doctor: `
rudi doctor - System health check

USAGE
  rudi doctor [options]

OPTIONS
  --fix            Attempt to fix issues
  --all            Show all available runtimes/binaries from registry

CHECKS
  - Directory structure
  - Installed packages
  - Available runtimes (node, python, deno, bun)
  - Available binaries (ffmpeg, ripgrep, etc.)
  - Secrets configuration

EXAMPLES
  rudi doctor
  rudi doctor --fix
  rudi doctor --all
`,
    integrate: `
rudi integrate - Wire RUDI router into agent configs

USAGE
  rudi integrate <agent>     Integrate with specific agent
  rudi integrate all         Integrate with all detected agents
  rudi integrate --list      Show detected agents

AGENTS
  claude       Claude Desktop + Claude Code
  cursor       Cursor IDE
  windsurf     Windsurf IDE
  vscode       VS Code / GitHub Copilot
  gemini       Gemini CLI
  codex        OpenAI Codex CLI
  zed          Zed Editor

OPTIONS
  --verbose    Show detailed output
  --dry-run    Show what would be done without making changes

WHAT IT DOES
  1. Detects agent config files
  2. Creates backup before modifying
  3. Adds RUDI router entry (single MCP server for all stacks)
  4. Cleans up old direct stack entries

EXAMPLES
  rudi integrate claude
  rudi integrate all
  rudi integrate --list
`,
    instructions: `
rudi instructions - Print or install RUDI agent instructions

USAGE
  rudi instructions [agent]
  rudi instructions <agent> --install [--global|--project|--path <file>]
  rudi instructions <agent> --remove [--global|--project|--path <file>]

AGENTS
  claude       CLAUDE.md instructions
  codex        AGENTS.md instructions
  generic      Print a pasteable generic block

OPTIONS
  --install    Write or update a managed RUDI block
  --remove     Remove the managed RUDI block
  --project    Target ./CLAUDE.md or ./AGENTS.md in the current directory
  --global     Target the agent global instruction file (default)
  --path       Target an explicit instruction file
  --dry-run    Preview changes without writing
  --json       Output JSON

EXAMPLES
  rudi instructions claude
  rudi instructions codex --install
  rudi instructions claude --project --install
  rudi instructions codex --remove
`,
    logs: `
rudi logs - Query agent visibility logs

USAGE
  rudi logs [options]

FILTERS
  --limit <n>           Number of logs to show (default: 50)
  --last <time>         Show logs from last N time (5m, 1h, 30s, 2d)
  --since <timestamp>   Show logs since timestamp (ISO or epoch ms)
  --until <timestamp>   Show logs until timestamp (ISO or epoch ms)
  --filter <text>       Search for text in log messages (repeatable)
  --source <source>     Filter by source (e.g., ipc, console, agent-codex)
  --level <level>       Filter by level (debug, info, warn, error)
  --type <type>         Filter by event type (ipc, window, navigation, error, custom)
  --provider <provider> Filter by provider (claude, codex, gemini)
  --session-id <id>     Filter by session ID
  --terminal-id <id>    Filter by terminal ID

PERFORMANCE
  --slow-only           Show only slow operations
  --slow-threshold <ms> Minimum duration for slow operations (default: 1000)

SPECIAL MODES
  --before-crash        Show last 30 seconds before crash
  --stats               Show statistics summary

EXPORT
  --export <file>       Export logs to file
  --format <format>     Export format: json, ndjson, csv (default: json)

OUTPUT
  --verbose             Show detailed event information
  --json                Output events as JSON lines

EXAMPLES
  rudi logs --last 5m
  rudi logs --level error --last 1h
  rudi logs --filter "authentication" --provider claude
  rudi logs --slow-only --slow-threshold 2000
  rudi logs --stats --last 24h
  rudi logs --export debug.json --format ndjson --last 30m
  rudi logs --before-crash
`
  };

  if (help[command]) {
    console.log(help[command]);
  } else {
    console.log(`No help available for '${command}'`);
    console.log(`Run 'rudi help' for available commands`);
  }
}
