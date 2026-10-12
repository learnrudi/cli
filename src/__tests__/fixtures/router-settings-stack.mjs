import readline from 'node:readline';

let calls = 0;
const lines = readline.createInterface({ input: process.stdin });
lines.on('line', (line) => {
  const request = JSON.parse(line);
  if (request.id == null) return;
  const result = request.method === 'initialize'
    ? { protocolVersion: '2024-11-05', capabilities: {}, serverInfo: { name: 'fixture', version: '1' } }
    : { content: [{ type: 'text', text: JSON.stringify({
      model: process.env.AUDIO_TOOLS_WHISPER_MODEL ?? null,
      token: process.env.FIXTURE_TOKEN ?? null,
      calls: ++calls,
    }) }] };
  const delay = request.method === 'tools/call' ? request.params.arguments?.delayMs ?? 0 : 0;
  setTimeout(() => {
    process.stdout.write(`${JSON.stringify({ jsonrpc: '2.0', id: request.id, result })}\n`);
  }, delay);
});
