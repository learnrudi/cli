/**
 * Small utility functions for agent route handlers.
 */

import os from 'os';
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';

/** Remove all resume-index mappings that point to a given session. */
export function dropResumeMappingsForSession(targetSessionId, resumeSessionIndex) {
  for (const [resumeId, mappedSessionId] of resumeSessionIndex.entries()) {
    if (mappedSessionId === targetSessionId) {
      resumeSessionIndex.delete(resumeId);
    }
  }
}

/**
 * Find an existing live process that matches a resume session ID.
 * Returns { sessionId, entry } or null.
 */
export function resolveReusableEntry(resumeSessionId, { agentProcesses, resumeSessionIndex }) {
  const mappedSessionId = resumeSessionIndex.get(resumeSessionId);
  if (mappedSessionId) {
    const mappedEntry = agentProcesses.get(mappedSessionId);
    if (mappedEntry?.proc && !mappedEntry.proc.killed) {
      return { sessionId: mappedSessionId, entry: mappedEntry };
    }
    resumeSessionIndex.delete(resumeSessionId);
  }

  for (const [existingId, entry] of agentProcesses.entries()) {
    const matchesProvider = entry.providerSessionId === resumeSessionId;
    const matchesResume = entry.resumeSessionId === resumeSessionId;
    if ((matchesProvider || matchesResume) && entry.proc && !entry.proc.killed) {
      resumeSessionIndex.set(resumeSessionId, existingId);
      if (entry.providerSessionId) {
        resumeSessionIndex.set(entry.providerSessionId, existingId);
      }
      return { sessionId: existingId, entry };
    }
  }

  return null;
}

/** Count alive (non-killed) processes. */
export function countAlive(agentProcesses) {
  let count = 0;
  for (const [, entry] of agentProcesses) {
    if (entry.proc && !entry.proc.killed) count++;
  }
  return count;
}

/** Broadcast current process count to all WS clients. */
export function broadcastProcessCount({ broadcast, agentProcesses, maxConcurrent }) {
  broadcast('agent:process-count', {
    count: countAlive(agentProcesses),
    maxConcurrent,
  });
}

/** Normalize an HTTP header value to a single string (Node may return string[]). */
export function normalizeHeader(val) {
  return Array.isArray(val) ? val[0] : val || '';
}

/** Save pasted images to .rudi/images/ and return augmented prompt text. */
export function buildUserContent(text, images, cwd, log) {
  if (!images || images.length === 0) return text;
  const imgDir = path.join(cwd || os.homedir(), '.rudi', 'images');
  fs.mkdirSync(imgDir, { recursive: true });
  const paths = [];
  for (const img of images) {
    const ext = img.mediaType === 'image/jpeg' ? '.jpg'
      : img.mediaType === 'image/gif' ? '.gif'
      : img.mediaType === 'image/webp' ? '.webp'
      : '.png';
    const filename = `paste-${Date.now()}-${crypto.randomUUID().slice(0, 8)}${ext}`;
    const filePath = path.join(imgDir, filename);
    fs.writeFileSync(filePath, Buffer.from(img.data, 'base64'));
    paths.push(filePath);
    log('agent', 'info', `saved pasted image to ${filePath}`, { size: img.data.length, mediaType: img.mediaType });
  }
  const imageRefs = paths.map((p) => `[Pasted image: ${p}]`).join('\n');
  return text ? `${imageRefs}\n\n${text}` : imageRefs;
}

/** Build a Claude stream-json user event. */
export function buildUserInputEvent(text, images, cwd, log) {
  return {
    type: 'user',
    message: {
      role: 'user',
      content: [
        {
          type: 'text',
          text: buildUserContent(text, images, cwd, log) || '',
        },
      ],
    },
  };
}
