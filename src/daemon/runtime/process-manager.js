/**
 * In-memory process ownership for daemon-managed child processes.
 */

export function createDaemonProcessManager() {
  const agentProcesses = new Map();
  const resumeSessionIndex = new Map();

  function killAllAgentProcesses(signal) {
    let killed = 0;
    for (const [, entry] of agentProcesses) {
      const proc = entry?.proc;
      if (!proc || typeof proc.kill !== 'function') continue;
      try {
        proc.kill(signal);
        killed += 1;
      } catch {
        // Process may already be gone.
      }
    }
    agentProcesses.clear();
    return killed;
  }

  function cleanup() {
    const killed = killAllAgentProcesses();
    resumeSessionIndex.clear();
    return { killed };
  }

  return {
    agentProcesses,
    resumeSessionIndex,
    cleanup,
    getActiveAgentProcessCount: () => agentProcesses.size,
    killAllAgentProcesses,
  };
}
