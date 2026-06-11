import {
  buildDaemonHealthRoutes,
  createHealthResponse,
} from './health.js';
import { buildEnvRoutes } from './env.js';
import { buildAdminRoutes } from './admin.js';
import { buildLocalLlmRoutes } from './local-llm.js';

import { buildAnalyticsRoutes } from '../../commands/serve/routes/analytics.js';
import { buildAuthRoutes } from '../../commands/serve/routes/auth.js';
import { buildFsRoutes } from '../../commands/serve/routes/fs.js';
import { buildLogsRoutes } from '../../commands/serve/routes/logs.js';
import { buildNotesRoutes } from '../../commands/serve/routes/notes.js';
import { buildPackageRoutes } from '../../commands/serve/routes/packages.js';
import { buildPlansRoutes } from '../../commands/serve/routes/plans.js';
import { buildProjectRoutes } from '../../commands/serve/routes/projects.js';
import { buildProviderRoutes } from '../../commands/serve/routes/providers.js';
import { buildShellRoutes } from '../../commands/serve/routes/shell.js';
import { buildSuggestRoutes } from '../../commands/serve/routes/suggest.js';
import { buildTerminalRoutes } from '../../commands/serve/routes/terminal.js';

export {
  buildAdminRoutes,
  buildAnalyticsRoutes,
  buildAuthRoutes,
  buildDaemonHealthRoutes,
  buildEnvRoutes,
  buildFsRoutes,
  buildLocalLlmRoutes,
  buildLogsRoutes,
  buildNotesRoutes,
  buildPackageRoutes,
  buildPlansRoutes,
  buildProjectRoutes,
  buildProviderRoutes,
  buildShellRoutes,
  buildSuggestRoutes,
  buildTerminalRoutes,
  createHealthResponse,
};
