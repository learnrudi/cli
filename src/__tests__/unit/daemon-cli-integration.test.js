import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import {
  formatDaemonDoctorState,
  shouldReportDaemonIssue,
} from '../../commands/doctor.js';
import { getDaemonOnlyStatus, getFullStatus } from '../../commands/status.js';

describe('daemon status CLI integration', () => {
  test('getFullStatus includes daemon readiness in JSON status shape', async () => {
    const daemon = {
      running: true,
      reachable: true,
      healthy: true,
      ready: true,
      reason: 'ok',
      port: 8123,
      version: '1.2.3',
      activeSessionCount: 2,
      activeJobCount: 1,
    };

    const status = await getFullStatus({
      daemonStatusProvider: async () => daemon,
    });

    assert.equal(status.daemon, daemon);
    assert.equal(status.summary.daemonRunning, true);
    assert.equal(status.summary.daemonReady, true);
  });

  test('getDaemonOnlyStatus avoids unrelated system inventory work', async () => {
    const daemon = {
      running: false,
      reachable: false,
      healthy: false,
      ready: false,
      reason: 'not_running',
    };

    const status = await getDaemonOnlyStatus({
      daemonStatusProvider: async () => daemon,
    });

    assert.equal(status.daemon, daemon);
    assert.equal(status.summary.daemonRunning, false);
    assert.equal(status.summary.daemonReady, false);
    assert.equal(status.agents, undefined);
    assert.equal(status.runtimes, undefined);
    assert.equal(status.binaries, undefined);
  });
});

describe('daemon doctor CLI integration', () => {
  test('offline daemon is informational, stale or unhealthy daemon is actionable', () => {
    const offline = { reason: 'not_running', reachable: false, ready: false };
    const stale = { reason: 'unreachable', reachable: false, ready: false };
    const degraded = { reason: 'not_ready', reachable: true, ready: false };
    const ready = { reason: 'ok', reachable: true, ready: true };

    assert.equal(formatDaemonDoctorState(offline), 'not running');
    assert.equal(formatDaemonDoctorState(stale), 'unreachable');
    assert.equal(formatDaemonDoctorState(degraded), 'not ready');
    assert.equal(formatDaemonDoctorState(ready), 'ready');

    assert.equal(shouldReportDaemonIssue(offline), false);
    assert.equal(shouldReportDaemonIssue(stale), true);
    assert.equal(shouldReportDaemonIssue(degraded), true);
    assert.equal(shouldReportDaemonIssue(ready), false);
  });
});
