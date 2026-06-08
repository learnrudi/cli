#!/usr/bin/env node
/**
 * RUDI CLI - RUDI Command Line Interface
 *
 * Commands:
 *   rudi home                Show ~/.rudi structure and status
 *   rudi search <query>      Search registry for packages
 *   rudi install <pkg>       Install a package
 *   rudi run <stack>         Run a stack
 *
 *   rudi stacks              List installed stacks
 *   rudi runtimes            List installed runtimes
 *   rudi binaries            List installed binaries
 *   rudi agents              List installed agents
 *   rudi prompts             List installed prompts
 *   rudi workflows           List installed workflows
 *   rudi list [kind]         List all installed packages
 *
 *   rudi db <cmd>            Database operations
 *   rudi import <cmd>        Import sessions from AI providers
 *   rudi secrets <cmd>       Manage secrets
 *   rudi doctor              Health check
 *
 *   rudi studio              Open RUDI website
 *   rudi studio version      Show installed Studio version
 *   rudi studio uninstall    Uninstall RUDI Studio
 */

import { parseArgs } from '@learnrudi/utils/args';
import { printHelp, printVersion } from '@learnrudi/utils/help';

// Commands
import { cmdSearch } from './commands/search.js';
import { cmdInstall } from './commands/install.js';
import { cmdRun } from './commands/run.js';
import { cmdList } from './commands/list.js';
import { cmdRemove } from './commands/remove.js';
import { cmdSecrets } from './commands/secrets.js';
import { cmdDb } from './commands/db.js';
import { cmdSession } from './commands/session.js';
import { cmdImport } from './commands/import.js';
import { cmdDoctor } from './commands/doctor.js';
import { cmdHome } from './commands/home.js';
import { cmdInit } from './commands/init.js';
import { cmdUpdate } from './commands/update.js';
import { cmdLogs } from './commands/logs.js';
import { cmdWhich } from './commands/which.js';
import { cmdAuth } from './commands/auth.js';
import { cmdMcp } from './commands/mcp.js';
import { cmdIntegrate } from './commands/integrate.js';
import { cmdIndex } from './commands/index-tools.js';
import { cmdStatus } from './commands/status.js';
import { cmdCheck } from './commands/check.js';
import { cmdShims } from './commands/shims.js';
import { cmdInfo } from './commands/info.js';
import { cmdApply } from './commands/apply.js';
import { cmdProject } from './commands/project.js';
import { cmdStudio } from './commands/studio.js';
import { cmdServe } from './commands/serve.js';
import { cmdParallel } from './commands/parallel.js';
import { cmdRunGroup } from './commands/run-group.js';
import { cmdLanes } from './commands/lanes.js';
import { cmdLocalLlm } from './commands/local-llm.js';
import { cmdRuntime } from './commands/runtime.js';
import { cmdDaemon } from './commands/daemon.js';
import { cmdInstructions } from './commands/instructions.js';
import { cmdLeverage } from './commands/leverage.js';

const VERSION = typeof __RUDI_CLI_VERSION__ === 'string'
  ? __RUDI_CLI_VERSION__
  : (process.env.npm_package_version || '0.0.0');

async function main() {
  const { command, args, flags } = parseArgs(process.argv.slice(2));

  // Global flags
  if (flags.version || flags.v) {
    printVersion(VERSION);
    process.exit(0);
  }

  if (flags.help || flags.h) {
    printHelp();
    process.exit(0);
  }

  try {
    switch (command) {
      case 'search':
        await cmdSearch(args, flags);
        break;

      case 'install':
      case 'i':
      case 'add':
        await cmdInstall(args, flags);
        break;

      case 'run':
      case 'exec':
        await cmdRun(args, flags);
        break;

      case 'list':
      case 'ls':
        await cmdList(args, flags);
        break;

      case 'remove':
      case 'rm':
      case 'uninstall':
        await cmdRemove(args, flags);
        break;

      case 'secrets':
      case 'secret':
        await cmdSecrets(args, flags);
        break;

      case 'db':
      case 'database':
        await cmdDb(args, flags);
        break;

      case 'session':
      case 'sessions':
        await cmdSession(args, flags);
        break;

      case 'import':
        await cmdImport(args, flags);
        break;

      case 'apply':
        await cmdApply(args, flags);
        break;

      case 'project':
      case 'projects':
        await cmdProject(args, flags);
        break;

      case 'doctor':
        await cmdDoctor(args, flags);
        break;

      case 'init':
      case 'bootstrap':
      case 'setup':
        await cmdInit(args, flags);
        break;

      case 'update':
      case 'upgrade':
        await cmdUpdate(args, flags);
        break;

      case 'logs':
        await cmdLogs(args, flags);
        break;

      case 'which':
      case 'info':
      case 'show':
        await cmdWhich(args, flags);
        break;

      case 'auth':
      case 'authenticate':
      case 'login':
        await cmdAuth(args, flags);
        break;

      case 'mcp':
        await cmdMcp(args, flags);
        break;

      case 'integrate':
        await cmdIntegrate(args, flags);
        break;

      case 'instructions':
        await cmdInstructions(args, flags);
        break;


      case 'index':
        await cmdIndex(args, flags);
        break;

      case 'home':
        await cmdHome(args, flags);
        break;

      case 'status':
        await cmdStatus(args, flags);
        break;

      case 'check':
        await cmdCheck(args, flags);
        break;

      case 'shims':
        await cmdShims(args, flags);
        break;

      case 'pkg':
      case 'package':
        await cmdInfo(args, flags);
        break;

      case 'studio':
        await cmdStudio(args, flags);
        break;

      case 'serve':
        await cmdServe(args, flags);
        break;

      case 'parallel':
      case 'par':
        await cmdParallel(args, flags);
        break;

      case 'run-group':
      case 'run-groups':
        await cmdRunGroup(args, flags);
        break;

      case 'lanes':
        await cmdLanes(args, flags);
        break;

      case 'local-llm':
        await cmdLocalLlm(args, flags);
        break;

      case 'runtime':
        await cmdRuntime(args, flags);
        break;

      case 'daemon':
        await cmdDaemon(args, flags);
        break;

      case 'leverage':
        await cmdLeverage(args, flags);
        break;

      // Shortcuts for listing specific package types
      case 'stacks':
        await cmdList(['stacks'], flags);
        break;

      case 'prompts':
        await cmdList(['prompts'], flags);
        break;

      case 'workflows':
        await cmdList(['workflows'], flags);
        break;

      case 'runtimes':
        await cmdList(['runtimes'], flags);
        break;

      case 'binaries':
      case 'bins':
      case 'tools':
        await cmdList(['binaries'], flags);
        break;

      case 'agents':
        await cmdList(['agents'], flags);
        break;

      case 'help':
        printHelp(args[0]);
        break;

      case 'version':
        printVersion(VERSION);
        break;

      default:
        if (!command) {
          // No command - show dashboard or help
          printHelp();
        } else {
          console.error(`Unknown command: ${command}`);
          console.error(`Run 'rudi help' for usage`);
          process.exit(1);
        }
    }
  } catch (error) {
    console.error(`Error: ${error.message}`);
    if (flags.verbose) {
      console.error(error.stack);
    }
    process.exit(1);
  }
}

main();
