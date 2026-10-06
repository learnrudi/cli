import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

async function readResponse(child, id, timeoutMs = 5000) {
  return new Promise((resolve, reject) => {
    let buffered = '';
    const timer = setTimeout(() => {
      cleanup();
      reject(new Error(`Timed out waiting for response ${id}`));
    }, timeoutMs);
    function cleanup() {
      clearTimeout(timer);
      child.stdout.off('data', onData);
      child.off('exit', onExit);
    }
    function onExit(code) {
      cleanup();
      reject(new Error(`Router exited before response ${id}: ${code}`));
    }
    function onData(chunk) {
      buffered += chunk.toString('utf8');
      const lines = buffered.split(/\r?\n/);
      buffered = lines.pop() ?? '';
      for (const line of lines) {
        if (!line.trim()) continue;
        const message = JSON.parse(line);
        if (message.id !== id) continue;
        cleanup();
        resolve(message);
        return;
      }
    }
    child.stdout.on('data', onData);
    child.on('exit', onExit);
  });
}

function send(child, request) {
  child.stdin.write(`${JSON.stringify(request)}\n`);
}

test('stdio router preserves cached discovery and exact stack call behavior', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'rudi-router-characterization-'));
  const fixture = path.join(root, 'fixture-stack.mjs');
  const router = fileURLToPath(new URL('../../router-mcp.js', import.meta.url));
  try {
    await fs.mkdir(path.join(root, 'cache'), { recursive: true });
    await fs.writeFile(fixture, [
      "import readline from 'node:readline';",
      "const rl = readline.createInterface({ input: process.stdin });",
      "rl.on('line', (line) => {",
      "  const request = JSON.parse(line);",
      "  if (request.id == null) return;",
      "  if (request.method === 'tools/call' && request.params?.arguments?.fail === true) {",
      "    process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: request.id, error: { code: -32042, message: 'fixture downstream rejected' } }) + '\\n');",
      "    return;",
      "  }",
      "  const result = request.method === 'initialize'",
      "    ? { protocolVersion: '2024-11-05', capabilities: {}, serverInfo: { name: 'fixture', version: '1' } }",
      "    : { content: [{ type: 'text', text: JSON.stringify(request.params) }] };",
      "  process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: request.id, result }) + '\\n');",
      "});",
    ].join('\n'));
    await fs.writeFile(path.join(root, 'rudi.json'), JSON.stringify({
      stacks: {
        fixture: {
          installed: true,
          path: root,
          tools: [{ name: 'inline_tool', description: 'Must lose to cache' }],
          launch: { bin: process.execPath, args: [fixture], cwd: root },
        },
        live_disabled: {
          installed: true,
          path: root,
          launch: { bin: '/path/that/must/not/run', args: [], cwd: root },
        },
      },
    }));
    await fs.writeFile(path.join(root, 'cache', 'tool-index.json'), JSON.stringify({
      byStack: {
        fixture: {
          tools: [{
            name: 'echo',
            description: 'Echo input',
            inputSchema: { type: 'object', properties: { value: { type: 'string' } } },
          }],
        },
      },
    }));

    const child = spawn(process.execPath, [router], {
      env: { ...process.env, RUDI_HOME: root },
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    send(child, { jsonrpc: '2.0', id: 1, method: 'tools/list' });
    const listed = await readResponse(child, 1);
    assert.deepEqual(listed.result.tools, [{
      name: 'fixture.echo',
      description: '[fixture] Echo input',
      inputSchema: { type: 'object', properties: { value: { type: 'string' } } },
    }]);

    send(child, {
      jsonrpc: '2.0',
      id: 2,
      method: 'tools/call',
      params: { name: 'fixture.echo', arguments: { value: 'hello' } },
    });
    const called = await readResponse(child, 2);
    assert.equal(called.error, undefined);
    assert.deepEqual(
      JSON.parse(called.result.content[0].text),
      { name: 'echo', arguments: { value: 'hello' } }
    );

    send(child, {
      jsonrpc: '2.0',
      id: 3,
      method: 'tools/call',
      params: { name: 'fixture.echo', arguments: { fail: true } },
    });
    const downstreamFailure = await readResponse(child, 3);
    assert.equal(downstreamFailure.error.code, -32603);
    assert.equal(downstreamFailure.error.message, 'Tool error: fixture downstream rejected');

    send(child, { jsonrpc: '2.0', method: 'notifications/initialized' });
    send(child, { jsonrpc: '2.0', id: 4, method: 'unknown/request' });
    const unknown = await readResponse(child, 4);
    assert.equal(unknown.error.code, -32601);

    send(child, { jsonrpc: '2.0', id: 5, method: 'ping' });
    assert.deepEqual((await readResponse(child, 5)).result, {});
    child.stdin.end();
    await new Promise((resolve) => child.once('exit', resolve));

    const portable = spawn(process.execPath, [router], {
      env: {
        ...process.env,
        RUDI_HOME: root,
        RUDI_ROUTER_TOOL_NAMES: 'portable',
      },
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    send(portable, { jsonrpc: '2.0', id: 6, method: 'tools/list' });
    const portableList = await readResponse(portable, 6);
    assert.equal(portableList.result.tools.length, 1);
    assert.match(portableList.result.tools[0].name, /^[a-zA-Z0-9_-]{1,54}$/);
    send(portable, {
      jsonrpc: '2.0',
      id: 7,
      method: 'tools/call',
      params: { name: portableList.result.tools[0].name, arguments: { value: 'portable' } },
    });
    const portableCall = await readResponse(portable, 7);
    assert.deepEqual(
      JSON.parse(portableCall.result.content[0].text),
      { name: 'echo', arguments: { value: 'portable' } },
    );
    portable.stdin.end();
    await new Promise((resolve) => portable.once('exit', resolve));
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test('stdio live discovery isolates malformed dependencies and honors inline precedence', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'rudi-router-live-characterization-'));
  const fixture = path.join(root, 'live-stack.mjs');
  const router = fileURLToPath(new URL('../../router-mcp.js', import.meta.url));
  try {
    await fs.writeFile(fixture, [
      "import readline from 'node:readline';",
      "const mode = process.argv[2];",
      "const rl = readline.createInterface({ input: process.stdin });",
      "rl.on('line', (line) => {",
      "  const request = JSON.parse(line);",
      "  if (request.id == null) return;",
      "  let result;",
      "  if (request.method === 'initialize') {",
      "    result = { protocolVersion: '2024-11-05', capabilities: {}, serverInfo: { name: mode, version: '1' } };",
      "  } else if (request.method === 'tools/list') {",
      "    result = mode === 'malformed' ? { tools: { invalid: true } } : { tools: [{ name: 'live_tool', description: 'Live tool' }] };",
      "  } else {",
      "    result = { content: [{ type: 'text', text: mode }] };",
      "  }",
      "  process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: request.id, result }) + '\\n');",
      "});",
    ].join('\n'));
    await fs.writeFile(path.join(root, 'rudi.json'), JSON.stringify({
      stacks: {
        healthy: {
          installed: true,
          path: root,
          launch: { bin: process.execPath, args: [fixture, 'healthy'], cwd: root },
        },
        malformed: {
          installed: true,
          path: root,
          launch: { bin: process.execPath, args: [fixture, 'malformed'], cwd: root },
        },
        inline: {
          installed: true,
          path: root,
          tools: [{ name: 'inline_tool', description: 'Inline tool' }],
          launch: { bin: '/path/that/must/not/run', args: [], cwd: root },
        },
      },
    }));
    const child = spawn(process.execPath, [router], {
      env: { ...process.env, RUDI_HOME: root, RUDI_ROUTER_LIVE_TOOL_LIST: '1' },
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    send(child, { jsonrpc: '2.0', id: 7, method: 'tools/list' });
    const listed = await readResponse(child, 7);
    assert.deepEqual(listed.result.tools.map((tool) => tool.name), [
      'healthy.live_tool',
      'inline.inline_tool',
    ]);
    child.stdin.end();
    await new Promise((resolve) => child.once('exit', resolve));
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});
