import { runTaskWatchdog } from './task-custody.js';

runTaskWatchdog(process.argv[2]).catch(() => process.exit(1));
