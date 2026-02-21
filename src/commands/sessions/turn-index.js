/**
 * Turn index for JSONL session files.
 *
 * Scans line-by-line (using pre-built byte offsets) and groups JSONL entries
 * into "turns" — a user turn followed by the assistant reply (including tool
 * results that fold into it).  The resulting index maps turn number → byte
 * range so paginated reads can fetch exactly N turns in one read.
 *
 * Incremental: pass `fromLine` + `existingTurns` to extend an existing index
 * when the file grows (append-only).
 */

import fsp from 'fs/promises';
import { classifyEntry } from './providers/common.js';

/**
 * Read a byte range from a file and return a UTF-8 string.
 */
export async function readByteRange(filePath, startByte, endByte) {
  const len = endByte - startByte;
  if (len <= 0) return '';
  const fd = await fsp.open(filePath, 'r');
  try {
    const buf = Buffer.alloc(len);
    await fd.read(buf, 0, len, startByte);
    return buf.toString('utf-8');
  } finally {
    await fd.close();
  }
}

/**
 * Build a turn index from a JSONL session file.
 *
 * @param {string} filePath     Path to the JSONL file
 * @param {string} provider     'claude' or 'codex'
 * @param {number[]} lineOffsets Array of byte offsets for each line start
 * @param {number} fileSize     Total file size in bytes
 * @param {number} [fromLine=0] Line to start scanning from (for incremental)
 * @param {Array<{startLine:number,endLine:number,startByte:number,endByte:number}>} [existingTurns=[]]
 * @returns {Promise<{turns: Array<{startLine:number,endLine:number,startByte:number,endByte:number}>, totalTurns:number, coveredLines:number}>}
 */
export async function buildTurnIndex(filePath, provider, lineOffsets, fileSize, fromLine = 0, existingTurns = []) {
  const turns = [...existingTurns];

  if (lineOffsets.length === 0) {
    return { turns, totalTurns: turns.length, coveredLines: 0 };
  }

  // Pending assistant turn accumulator
  let pendingAssistantStartLine = null;

  // If extending an existing index, check if the last turn was an unflushed
  // assistant that we need to continue extending.
  if (existingTurns.length > 0 && fromLine > 0) {
    const lastTurn = existingTurns[existingTurns.length - 1];
    // The last turn's endLine should equal fromLine - 1 if it was flushed at EOF.
    // If it wasn't fully flushed (i.e. we're resuming mid-assistant), re-open it.
    // But since we flush at EOF, the previous build always flushed. So no adjustment needed.
  }

  // Read lines in chunks for efficiency (64KB worth of lines at a time)
  const CHUNK_LINES = 256;
  const fd = await fsp.open(filePath, 'r');
  try {
    for (let chunkStart = fromLine; chunkStart < lineOffsets.length; chunkStart += CHUNK_LINES) {
      const chunkEnd = Math.min(chunkStart + CHUNK_LINES, lineOffsets.length);
      const startByte = lineOffsets[chunkStart];
      const endByte = chunkEnd < lineOffsets.length ? lineOffsets[chunkEnd] : fileSize;
      const chunkLen = endByte - startByte;
      if (chunkLen <= 0) continue;

      const buf = Buffer.alloc(chunkLen);
      await fd.read(buf, 0, chunkLen, startByte);
      const chunkText = buf.toString('utf-8');
      const chunkLines = chunkText.split('\n');

      for (let i = 0; i < chunkEnd - chunkStart; i++) {
        const lineIdx = chunkStart + i;
        const line = chunkLines[i];
        if (!line) continue;

        let entry;
        try {
          entry = JSON.parse(line);
        } catch {
          continue;
        }

        const cls = classifyEntry(entry, provider);
        if (!cls) continue;

        if (cls === 'user-turn') {
          // Flush pending assistant turn
          if (pendingAssistantStartLine !== null) {
            const prevLine = lineIdx - 1;
            const aStartByte = lineOffsets[pendingAssistantStartLine];
            const aEndByte = prevLine + 1 < lineOffsets.length ? lineOffsets[prevLine + 1] : fileSize;
            turns.push({
              startLine: pendingAssistantStartLine,
              endLine: prevLine,
              startByte: aStartByte,
              endByte: aEndByte,
            });
            pendingAssistantStartLine = null;
          }

          // Emit user turn (single line)
          const uStartByte = lineOffsets[lineIdx];
          const uEndByte = lineIdx + 1 < lineOffsets.length ? lineOffsets[lineIdx + 1] : fileSize;
          turns.push({
            startLine: lineIdx,
            endLine: lineIdx,
            startByte: uStartByte,
            endByte: uEndByte,
          });
        } else if (cls === 'assistant') {
          if (pendingAssistantStartLine === null) {
            pendingAssistantStartLine = lineIdx;
          }
          // Otherwise continues the current assistant turn
        } else if (cls === 'tool-result') {
          // Extends current assistant turn (tool results fold into the
          // preceding assistant). If there's no pending assistant, skip.
          if (pendingAssistantStartLine === null) {
            pendingAssistantStartLine = lineIdx;
          }
        }
      }
    }
  } finally {
    await fd.close();
  }

  // Flush any remaining assistant turn at EOF
  if (pendingAssistantStartLine !== null) {
    const lastLine = lineOffsets.length - 1;
    const aStartByte = lineOffsets[pendingAssistantStartLine];
    const aEndByte = fileSize;
    turns.push({
      startLine: pendingAssistantStartLine,
      endLine: lastLine,
      startByte: aStartByte,
      endByte: aEndByte,
    });
  }

  return {
    turns,
    totalTurns: turns.length,
    coveredLines: lineOffsets.length,
  };
}
