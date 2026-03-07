import { readdirSync, readFileSync, statSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';

export function buildPlansRoutes(ctx) {
  const { json, error } = ctx;
  const plansDir = join(homedir(), '.claude', 'plans');

  function extractTitle(content) {
    const match = content.match(/^#\s+(.+)$/m);
    return match ? match[1].trim() : null;
  }

  function handle(req, res, url) {
    if (req.method !== 'GET') return false;

    // GET /plans - list all plans
    if (url.pathname === '/plans') {
      if (!existsSync(plansDir)) {
        json(res, { plans: [] });
        return true;
      }

      try {
        const files = readdirSync(plansDir).filter(f => f.endsWith('.md'));
        const plans = files.map(f => {
          const filePath = join(plansDir, f);
          const stat = statSync(filePath);
          const id = f.replace(/\.md$/, '');
          let title = id;
          try {
            const content = readFileSync(filePath, 'utf-8');
            const extracted = extractTitle(content);
            if (extracted) title = extracted;
          } catch {}
          return {
            id,
            title,
            createdAt: stat.mtime.toISOString(),
            sizeBytes: stat.size,
          };
        });

        plans.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
        json(res, { plans });
      } catch (e) {
        error(res, 'Failed to read plans directory', 500);
      }
      return true;
    }

    // GET /plans/:id - get single plan
    if (url.pathname.startsWith('/plans/')) {
      const id = url.pathname.slice('/plans/'.length);

      // Security: validate ID
      if (!id || !/^[a-z0-9-]+$/.test(id)) {
        error(res, 'Invalid plan ID', 400);
        return true;
      }

      const filePath = join(plansDir, `${id}.md`);
      if (!existsSync(filePath)) {
        error(res, 'Plan not found', 404);
        return true;
      }

      try {
        const content = readFileSync(filePath, 'utf-8');
        const stat = statSync(filePath);
        const title = extractTitle(content) || id;
        json(res, {
          id,
          title,
          content,
          createdAt: stat.mtime.toISOString(),
          sizeBytes: stat.size,
        });
      } catch (e) {
        error(res, 'Failed to read plan', 500);
      }
      return true;
    }

    return false;
  }

  return { handle };
}
