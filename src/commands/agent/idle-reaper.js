/**
 * Idle reaper — kills agent processes that have been idle too long.
 */

export function createIdleReaper({
  agentProcesses,
  broadcast,
  log,
  idleTimeoutMs = 10 * 60 * 1000, // 10 min default
  maxConcurrent = 6,
}) {
  const interval = setInterval(() => {
    const now = Date.now();
    for (const [sessionId, entry] of agentProcesses.entries()) {
      if (!entry.proc || entry.proc.killed) continue;
      if (entry.turnActive) continue; // actively processing a turn
      const idle = now - (entry.lastActivityAt || entry.startedAt || now);
      if (idle > idleTimeoutMs) {
        log('agent', 'warn', `idle reaper: killing session ${sessionId.slice(0, 8)} (idle ${Math.round(idle / 1000)}s)`);
        entry._terminationReason = 'stopped';
        entry.proc.kill('SIGTERM');
        const killTimer = setTimeout(() => {
          try { entry.proc.kill('SIGKILL'); } catch {}
        }, 3000);
        entry.proc.on('close', () => clearTimeout(killTimer));
        broadcast('agent:stopped', { sessionId });
      }
    }
  }, 30_000);

  return () => clearInterval(interval);
}
