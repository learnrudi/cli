import { spawn } from 'node:child_process';
import { consumeClaudeTaskEvent } from './providers/claude-task.js';
import { parseTaskJson } from '../task-profile.js';
import { processIdentity } from '../task-custody.js';

import {
  createAgentEventNormalizer,
  extractNativeSessionId,
  renderAgentEvent,
} from './normalize.js';
import {
  assertPrivateAutomationRawEvent,
  projectPrivateAutomationEventMetadata,
} from '../private-automation-profile.js';

function boundedAppend(current, value, maxLength = 4096) {
  const combined = `${current}${value}`;
  return combined.length <= maxLength ? combined : combined.slice(-maxLength);
}

function writeLine(stream, value) {
  stream.write(value.endsWith('\n') ? value : `${value}\n`);
}

function parsePrivateFinalOutput(value) {
  if (typeof value !== 'string') return value;
  const trimmed = value.trim();
  try {
    return JSON.parse(trimmed);
  } catch {
    const fenced = trimmed.match(/^```(?:json)?[ \t]*\r?\n([\s\S]*?)\r?\n```$/u);
    if (!fenced) throw new Error('invalid');
    try {
      return JSON.parse(fenced[1]);
    } catch {
      throw new Error('invalid');
    }
  }
}

export function executeForegroundLaunch({
  eventSink = null,
  jsonOutput = false,
  launchId,
  onSpawn = null,
  plan,
  spawnImpl = spawn,
  taskStop = null,
  stderr = process.stderr,
  stdout = process.stdout,
  store,
  timeoutMs = plan.timeouts.runtimeMs,
  signalEmitter = process,
}) {
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 24 * 60 * 60 * 1000) {
    throw new Error('timeoutMs must be an integer between 1 and 86400000');
  }

  return new Promise((resolve, reject) => {
    const privateAutomation = plan.privateAutomationProfile != null;
    const taskExecution = plan.taskProfile != null;
    const supervised = privateAutomation || taskExecution;
    let taskTerminal = false;
    let taskFailure = null;
    let taskFinalOutput = null;
    const claudeTask = { terminal: false, sessionId: null, finalOutput: null };
    let taskIdentity = null;
    const normalizer = createAgentEventNormalizer(plan.provider);
    let child;
    let finalized = false;
    let stdoutBuffer = '';
    let stderrTail = '';
    let sawAssistantText = false;
    let timedOut = false;
    let forceTimer = null;
    let requestedSignal = null;
    let sinkFailure = null;
    let privateFailure = null;
    let privateFinalOutput = null;
    // Codex's JSONL stream does not currently echo the selected model. Its
    // private plan is still exact: a canonical model is supplied with `-m`,
    // user config is ignored, and the CLI has no fallback-model input. Claude
    // does report modelUsage, so it remains provider-observed below.
    let privateObservedModel = privateAutomation && plan.provider === 'codex'
      ? plan.model
      : null;
    let privateRawOutputBytes = 0;
    let privateUsage = null;

    function terminateProvider(signal) {
      if(taskExecution && taskStop) {
        void taskStop().catch(()=>{taskFailure='task audit cleanup unresolved';});
        return true;
      }
      if (taskExecution) {
        try {
          if (!taskIdentity || JSON.stringify(processIdentity(child.pid)) !== JSON.stringify(taskIdentity)) {
            taskFailure = 'task process ownership unresolved';
            return false;
          }
          process.kill(-taskIdentity.pgid,signal);
          return true;
        } catch { taskFailure = 'task process termination unconfirmed'; return false; }
      }
      if (supervised && Number.isSafeInteger(child?.pid) && child.pid > 0) {
        try {
          process.kill(-child.pid, signal);
          return true;
        } catch {}
      }
      try {
        return child?.kill(signal) === true;
      } catch {
        return false;
      }
    }

    function privateProviderGroupAlive() {
      if (!supervised || !Number.isSafeInteger(child?.pid) || child.pid < 1) {
        return false;
      }
      try {
        process.kill(-child.pid, 0);
        return true;
      } catch {
        return false;
      }
    }

    function armForceTimer() {
      if (forceTimer || !supervised) return;
      forceTimer = setTimeout(() => terminateProvider('SIGKILL'), plan.timeouts.shutdownGraceMs || 5000);
    }

    function recordSinkFailure(kind, error) {
      if (sinkFailure) return;
      sinkFailure = `${kind} persistence failed: ${error.message}`;
      try { writeLine(stderr, sinkFailure); } catch {}
      if (!finalized) {
        terminateProvider('SIGTERM');
        armForceTimer();
      }
    }

    function publishEvent(payload, persistedPayload = payload) {
      try {
        eventSink?.(persistedPayload);
      } catch (error) {
        recordSinkFailure('Agent event', error);
      }
      return payload;
    }

    const onSigint = () => {
      requestedSignal = 'SIGINT';
      terminateProvider('SIGINT');
      armForceTimer();
    };
    const onSigterm = () => {
      requestedSignal = 'SIGTERM';
      terminateProvider('SIGTERM');
      armForceTimer();
    };

    function persistNativeSession(rawEvent, normalized) {
      if (privateAutomation) return;
      const nativeSessionId = extractNativeSessionId(rawEvent)
        || normalized?.providerSessionId
        || null;
      if (!nativeSessionId) return;
      const current = store.get(launchId);
      if (current?.nativeSessionId !== nativeSessionId) {
        store.setNativeSessionId(launchId, nativeSessionId);
      }
    }

    function emitEvent(normalized, rawEvent) {
      persistNativeSession(rawEvent, normalized);
      const isDelta = (
        rawEvent?.type === 'message' && rawEvent.delta === true
      ) || (
        rawEvent?.event === 'step_update' && rawEvent.step_update?.step_type === 'agent_response'
      );
      let persistedEvent = normalized;
      if (privateAutomation) {
        try {
          assertPrivateAutomationRawEvent(plan.provider, rawEvent, plan.model);
          persistedEvent = projectPrivateAutomationEventMetadata(normalized);
        } catch (error) {
          privateFailure = String(error?.message || '').includes('model usage')
            ? 'private_model_mismatch'
            : 'private_tool_event';
          terminateProvider('SIGTERM');
          return;
        }
        if (normalized.model) {
          if (normalized.model !== plan.model) {
            privateFailure = 'private_model_mismatch';
            terminateProvider('SIGTERM');
            return;
          }
          privateObservedModel = normalized.model;
        }
        if (normalized.usage) privateUsage = persistedEvent.usage || privateUsage;
        const structuredOutput = rawEvent?.structured_output ?? rawEvent?.structuredOutput;
        if (structuredOutput && typeof structuredOutput === 'object' && !Array.isArray(structuredOutput)) {
          privateFinalOutput = structuredOutput;
        } else if (normalized.type === 'assistant' && Array.isArray(normalized.content)) {
          const text = normalized.content
            .filter(block => block?.type === 'text' && typeof block.text === 'string')
            .map(block => block.text)
            .join('');
          if (text) privateFinalOutput = text;
        } else if (normalized.type === 'result' && typeof normalized.result === 'string') {
          privateFinalOutput = normalized.result;
        }
      }
      const persistedPayload = {
        delta: isDelta,
        event: persistedEvent,
        launchId,
        provider: plan.provider,
        type: 'agent.event',
      };
      const payload = privateAutomation
        ? publishEvent(persistedPayload)
        : publishEvent({
          event: normalized,
          launchId,
          provider: plan.provider,
          rawEvent,
          type: 'agent.event',
        }, persistedPayload);
      if (supervised) return;
      if (jsonOutput) {
        writeLine(stdout, JSON.stringify(payload));
        return;
      }

      const rendered = renderAgentEvent(normalized);
      if (normalized?.type === 'assistant' && rendered.length > 0) sawAssistantText = true;
      if (normalized?.type === 'result' && sawAssistantText) return;
      for (const text of rendered) {
        if (isDelta) stdout.write(text);
        else writeLine(stdout, text);
      }
      if (normalized?.type === 'error' && normalized.message) writeLine(stderr, normalized.message);
    }

    function consumeLine(line) {
      if (!line.trim()) return;
      try {
        const rawEvent = taskExecution ? parseTaskJson(line) : JSON.parse(line);
        if (taskExecution) {
          if (!rawEvent || typeof rawEvent !== 'object' || Array.isArray(rawEvent)) throw new Error('invalid event');
          if (plan.provider === 'claude') {
            consumeClaudeTaskEvent(claudeTask, rawEvent);
            taskTerminal = claudeTask.terminal;
            taskFinalOutput = claudeTask.finalOutput;
          } else {
            if (rawEvent.type === 'turn.completed') taskTerminal = true;
            if (rawEvent.type === 'turn.failed' || rawEvent.type === 'error') taskFailure = 'native terminal failure';
            if (rawEvent.type === 'item.completed' && rawEvent.item?.type === 'agent_message') {
              if (Buffer.byteLength(rawEvent.item.text || '') > 65536) throw new Error('final output overflow');
              taskFinalOutput = rawEvent.item.text;
            }
          }
        }
        for (const result of normalizer.normalize(rawEvent)) {
          if (result?.normalized) emitEvent(result.normalized, result.raw || rawEvent);
        }
      } catch {
        if (taskExecution) {
          taskFailure = 'malformed native output';
          terminateProvider('SIGTERM');
          armForceTimer();
          return;
        }
        if (privateAutomation) {
          privateFailure = 'private_output_malformed';
          terminateProvider('SIGTERM');
          return;
        }
        const payload = publishEvent({
          event: { message: line, subtype: 'provider_stdout', type: 'system' },
          launchId,
          provider: plan.provider,
          type: 'agent.event',
        });
        if (jsonOutput) {
          writeLine(stdout, JSON.stringify(payload));
        } else {
          writeLine(stdout, line);
        }
      }
    }

    function flushStdout() {
      if (stdoutBuffer.trim()) consumeLine(stdoutBuffer);
      stdoutBuffer = '';
      for (const result of normalizer.flush()) {
        if (result?.normalized) emitEvent(result.normalized, result.raw || {});
      }
    }

    function complete(status, exitCode, lastError = null) {
      try { finishLaunch(status, exitCode, lastError); }
      catch (error) {
        terminateProvider('SIGKILL');
        clearTimeout(runtimeTimer);
        if (forceTimer) clearTimeout(forceTimer);
        signalEmitter.removeListener('SIGINT', onSigint);
        signalEmitter.removeListener('SIGTERM', onSigterm);
        finalized = true;
        reject(error);
      }
    }

    function finishLaunch(status, exitCode, lastError) {
      if (finalized) return;
      flushStdout();
      clearTimeout(runtimeTimer);
      if (forceTimer) clearTimeout(forceTimer);
      signalEmitter.removeListener('SIGINT', onSigint);
      signalEmitter.removeListener('SIGTERM', onSigterm);
      finalized = true;

      if (sinkFailure) {
        status = 'failed';
        lastError = sinkFailure;
      }

      if (privateAutomation) {
        if (privateFailure) {
          status = 'failed';
          lastError = `Private automation failed: ${privateFailure}`;
        } else if (status === 'completed' && privateObservedModel === null) {
          status = 'failed';
          lastError = 'Private automation failed: private_model_unobserved';
        } else if (status === 'completed') {
          try {
            const parsed = parsePrivateFinalOutput(privateFinalOutput);
            if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
              throw new Error('not_object');
            }
            const serialized = JSON.stringify(parsed);
            if (Buffer.byteLength(serialized, 'utf8') > plan.maxFinalOutputBytes) {
              throw new Error('too_large');
            }
            if (!plan.privateAutomationProfile.outputSchema.validate(parsed)) {
              throw new Error('schema');
            }
            privateFinalOutput = parsed;
          } catch (error) {
            status = 'failed';
            const reason = error.message === 'too_large'
              ? 'private_final_output_overflow'
              : error.message === 'schema'
                ? 'private_final_output_schema_invalid'
                : 'private_final_output_invalid';
            lastError = `Private automation failed: ${reason}`;
          }
        } else {
          lastError = timedOut
            ? 'Private automation failed: private_timeout'
            : requestedSignal
              ? 'Private automation failed: private_stopped'
              : 'Private automation failed: private_provider_error';
        }
      }

      if (taskExecution && status === 'completed') {
        try {
          if (taskFailure || !taskTerminal || !store.get(launchId)?.nativeSessionId) throw new Error(taskFailure || 'missing native terminal/session evidence');
          taskFinalOutput = parseTaskJson(taskFinalOutput);
          if (!taskFinalOutput || !['complete', 'no_work', 'needs_evidence', 'partial', 'failed'].includes(taskFinalOutput.outcome)
              || !Array.isArray(taskFinalOutput.outputs) || taskFinalOutput.outputs.length > 64
              || Object.keys(taskFinalOutput).sort().join(',') !== 'outcome,outputs') throw new Error('invalid task final manifest');
          if (taskFinalOutput.outcome === 'failed') throw new Error('task reported failure');
        } catch (error) { status = 'failed'; lastError = error.message; }
      }
      const current = store.get(launchId);
      if (current?.status === 'starting' && status !== 'failed') {
        store.transition(launchId, 'running', { pid: child?.pid || 0 });
      }
      const updated = store.transition(launchId, status, {
        exitCode,
        lastError,
      });
      const terminalEvent = publishEvent({ launch: updated, type: `launch.${status}` });
      if (taskExecution && sinkFailure && status === 'completed') { reject(new Error(sinkFailure)); return; }
      if (privateAutomation && status === 'completed') {
        const privateResult = {
          model: privateObservedModel,
          output: privateFinalOutput,
          provider: plan.provider,
          type: 'private-automation.result',
          ...(privateUsage ? { usage: privateUsage } : {}),
        };
        writeLine(stdout, jsonOutput ? JSON.stringify(privateResult) : JSON.stringify(privateFinalOutput));
      }
      if (jsonOutput) {
        if (!privateAutomation) writeLine(stdout, JSON.stringify(terminalEvent));
      }
      resolve(taskExecution ? { ...updated, taskFinalOutput } : updated);
    }

    const runtimeTimer = setTimeout(() => {
      timedOut = true;
      terminateProvider('SIGTERM');
      forceTimer = setTimeout(
        () => terminateProvider('SIGKILL'),
        plan.timeouts.shutdownGraceMs || 5000,
      );
    }, timeoutMs);

    try {
      child = spawnImpl(plan.spawn.command, plan.args, {
        cwd: plan.spawn.cwd,
        detached: supervised,
        env: supervised ? plan.environment : { ...process.env, ...plan.environment },
        stdio: [supervised ? 'pipe' : 'ignore', 'pipe', 'pipe'],
      });
    } catch (error) {
      clearTimeout(runtimeTimer);
      reject(error);
      return;
    }

    if (supervised) {
      child.stdin.on('error', () => {
        if (taskExecution) taskFailure = 'task stdin error';
        privateFailure = 'private_stdin_error';
        terminateProvider('SIGTERM');
      });
      if (!taskExecution) child.stdin.end(plan.stdin);
    }

    child.once('spawn', async () => {
      try {
        if (taskExecution && Number.isSafeInteger(child.pid)) {
          taskIdentity = processIdentity(child.pid);
          if (!taskIdentity || taskIdentity.pgid !== child.pid) throw new Error('task process identity unavailable');
        }
        const current = store.get(launchId);
        if (current?.status === 'starting') {
          const running = store.transition(launchId, 'running', { pid: child.pid || 0 });
          await onSpawn?.(running);
        } else if (current) {
          await onSpawn?.(current);
        }
        // No task prompt reaches the provider until durable custody and its
        // independent parent-death watchdog acknowledge ownership.
        if (taskExecution && !finalized) child.stdin.end(plan.stdin);
      } catch (error) {
        recordSinkFailure('Launch startup', error);
      }
    });
    signalEmitter.once('SIGINT', onSigint);
    signalEmitter.once('SIGTERM', onSigterm);

    child.stdout.on('data', (chunk) => {
      if (supervised) {
        privateRawOutputBytes += Buffer.byteLength(chunk);
        if (privateRawOutputBytes > plan.maxRawOutputBytes) {
          if (taskExecution) taskFailure = 'task native output overflow';
          privateFailure = 'private_raw_output_overflow';
          armForceTimer();
          stdoutBuffer = '';
          terminateProvider('SIGTERM');
          return;
        }
      }
      stdoutBuffer += chunk.toString();
      const lines = stdoutBuffer.split('\n');
      stdoutBuffer = lines.pop() || '';
      for (const line of lines) consumeLine(line);
    });

    child.stderr.on('data', (chunk) => {
      if(taskExecution)stderrTail=boundedAppend(stderrTail,chunk.toString());
      if (supervised) return;
      const text = chunk.toString();
      stderrTail = boundedAppend(stderrTail, text);
      try {
        stderr.write(text);
      } catch (error) {
        recordSinkFailure('Provider stderr', error);
      }
    });

    child.once('error', (error) => {
      complete(
        'failed',
        null,
        privateAutomation ? 'Private automation failed: private_spawn_error' : `Provider process error: ${error.message}`,
      );
    });

    if(taskExecution && taskStop)child.once('exit',()=>terminateProvider('SIGKILL'));
    child.once('close', (exitCode, signal) => {
      if (!(taskExecution && taskStop) && privateProviderGroupAlive()) {
        terminateProvider('SIGKILL');
        if (taskExecution) taskFailure = 'task process group remained alive';
        privateFailure = 'private_termination_unconfirmed';
      }
      if (sinkFailure) {
        complete('failed', exitCode, sinkFailure);
        return;
      }
      if (timedOut) {
        complete('failed', exitCode, `Provider process timed out after ${timeoutMs}ms`);
        return;
      }
      if (requestedSignal) {
        complete('stopped', exitCode, `Provider process stopped by ${requestedSignal}`);
        return;
      }
      if (exitCode === 0) {
        complete('completed', 0);
        return;
      }
      const detail = stderrTail.trim() || `Provider process exited with code ${exitCode}${signal ? ` (${signal})` : ''}`;
      complete('failed', exitCode, detail);
    });
  });
}
