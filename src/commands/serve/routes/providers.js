/**
 * Agent providers — GET /agent/providers
 */

import { listProviders, loadProviderConfig } from '../../agent/providers/index.js';

export function buildProviderRoutes(ctx) {
  const { json, error, log } = ctx;

  async function handle(req, res, url) {
    if (req.method !== 'GET' || url.pathname !== '/agent/providers') return false;
    try {
      const providerIds = listProviders();
      const providers = providerIds.map((id) => {
        const config = loadProviderConfig(id);
        return {
          id,
          name: config.name,
          models: (config.models.available || [])
            .filter((m) => !m.legacy)
            .map((m) => ({ id: m.id, name: m.name, default: !!m.default })),
          capabilities: {
            planMode: !!config.capabilities?.planMode,
            askPermission: !!config.capabilities?.permissionPromptTool,
          },
        };
      });
      json(res, { providers });
    } catch (err) {
      log('agent', 'error', `Failed to load providers: ${err.message}`);
      error(res, `Failed to load providers: ${err.message}`, 500);
    }
    return true;
  }

  return { handle };
}
