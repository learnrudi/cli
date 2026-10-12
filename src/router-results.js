import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';

/** A local recovery receipt, never a replay queue. Inputs and environment are omitted. */
export function createResultReceipt(rudiHome, metadata) {
  const directory = path.join(rudiHome, 'outputs', 'router-results');
  const file = path.join(directory, `${randomUUID()}.json`);
  const record = { schemaVersion: 1, routerPid: process.pid, ...metadata };
  return {
    file,
    write(state) {
      const temporary = `${file}.${randomUUID()}.tmp`;
      try {
        fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
        // Do not follow a substituted result directory or expose private tool results.
        if (!fs.lstatSync(directory).isDirectory()) return false;
        fs.chmodSync(directory, 0o700);
        fs.writeFileSync(temporary, JSON.stringify({
          ...record, ...state, updatedAt: new Date().toISOString(),
        }) + '\n', { flag: 'wx', mode: 0o600 });
        fs.renameSync(temporary, file);
        return true;
      } catch {
        // Callers report persistence failure without printing sensitive result data.
        return false;
      } finally {
        try { fs.unlinkSync(temporary); } catch { /* It may already be renamed. */ }
      }
    },
  };
}
