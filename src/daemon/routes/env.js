import os from 'node:os';

export function buildEnvRoutes(ctx) {
  const { json } = ctx;

  return {
    handle(_req, res, url) {
      if (url.pathname !== '/env') return false;
      json(res, { home: os.homedir(), platform: os.platform() });
      return true;
    },
  };
}
