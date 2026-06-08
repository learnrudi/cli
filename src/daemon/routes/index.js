export {
  buildDaemonHealthRoutes,
  createHealthResponse,
} from './health.js';
export { buildEnvRoutes } from './env.js';
export { buildAdminRoutes } from './admin.js';
export { buildLocalLlmRoutes } from './local-llm.js';

export { buildAnalyticsRoutes } from '../../commands/serve/routes/analytics.js';
export { buildAuthRoutes } from '../../commands/serve/routes/auth.js';
export { buildFsRoutes } from '../../commands/serve/routes/fs.js';
export { buildLogsRoutes } from '../../commands/serve/routes/logs.js';
export { buildNotesRoutes } from '../../commands/serve/routes/notes.js';
export { buildPackageRoutes } from '../../commands/serve/routes/packages.js';
export { buildPlansRoutes } from '../../commands/serve/routes/plans.js';
export { buildProjectRoutes } from '../../commands/serve/routes/projects.js';
export { buildProviderRoutes } from '../../commands/serve/routes/providers.js';
export { buildShellRoutes } from '../../commands/serve/routes/shell.js';
export { buildSuggestRoutes } from '../../commands/serve/routes/suggest.js';
export { buildTerminalRoutes } from '../../commands/serve/routes/terminal.js';
