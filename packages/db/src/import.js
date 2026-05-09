/**
 * Import module for RUDI
 * Handles migration from sessions.json and importing from native provider directories
 */

import fs from 'fs';
import path from 'path';
import os from 'os';
import fsp from 'node:fs/promises';
import crypto from 'node:crypto';
import { v4 as uuidv4 } from 'uuid';
import { PATHS } from '@learnrudi/env';
import { getDb } from './index.js';
import { calculateCostFromPricing } from './schema.js';
import { findSessionIdentityRow, resolveSessionRowIdentity } from './session-identity.js';

const RUDI_HOME = PATHS.home;

/**
 * Calculate cost using the model_pricing table
 * Falls back to hardcoded defaults if table not available
 * @param {string} provider - Provider name (claude, codex, gemini)
 * @param {string} model - Model name
 * @param {{ input_tokens?: number, output_tokens?: number, cache_read_tokens?: number }} usage
 * @returns {number} Cost in USD
 */
function calculateCost(provider, model, usage) {
  if (!usage) return 0;

  try {
    return calculateCostFromPricing(provider, model, usage);
  } catch (err) {
    // Fallback to default pricing (Sonnet-like: $3/$15/MTok input/output, $0.30/MTok cache)
    // Prices are per million tokens
    const inputCost = (usage.input_tokens || 0) * 3 / 1_000_000;
    const outputCost = (usage.output_tokens || 0) * 15 / 1_000_000;
    const cacheReadCost = (usage.cache_read_tokens || 0) * 0.3 / 1_000_000;
    return inputCost + outputCost + cacheReadCost;
  }
}

/**
 * Migrate from existing sessions.json file
 * @returns {Object} Migration results
 */
function migrateFromJson() {
  const jsonPath = path.join(RUDI_HOME, 'sessions.json');
  const results = { sessions: 0, projects: 0, skipped: 0 };

  if (!fs.existsSync(jsonPath)) {
    console.log('No sessions.json found, skipping JSON migration');
    return results;
  }

  const data = JSON.parse(fs.readFileSync(jsonPath, 'utf-8'));
  const db = getDb();

  // Migrate projects first
  const insertProject = db.prepare(`
    INSERT OR IGNORE INTO projects (id, provider, name, color, created_at)
    VALUES (?, ?, ?, ?, ?)
  `);

  if (data.projects) {
    for (const [id, project] of Object.entries(data.projects)) {
      try {
        const info = insertProject.run(
          id,
          project.provider || 'claude',
          project.name || 'Unnamed',
          project.color || '#6366f1',
          project.createdAt || new Date().toISOString()
        );
        if (info.changes > 0) results.projects++;
      } catch (err) {
        // Project already exists
      }
    }
  }

  // Migrate sessions
  const insertSession = db.prepare(`
    INSERT OR IGNORE INTO sessions (
      id, provider, provider_session_id, project_id,
      origin, origin_imported_at, origin_native_file,
      title, snippet, status, model, cwd, git_branch,
      native_storage_path, created_at, last_active_at, deleted_at,
      turn_count, total_cost, total_duration_ms
    ) VALUES (
      ?, ?, ?, ?,
      ?, ?, ?,
      ?, ?, ?, ?, ?, ?,
      ?, ?, ?, ?,
      ?, ?, ?
    )
  `);

  if (data.sessions) {
    for (const [id, s] of Object.entries(data.sessions)) {
      try {
        const info = insertSession.run(
          id,
          s.provider || 'claude',
          s.providerSessionId || null,
          s.projectId || null,
          s.origin || 'rudi',
          s.originDetail?.importedAt || null,
          s.originDetail?.nativeFile || null,
          s.title || null,
          s.snippet || null,
          s.status || 'active',
          s.model || null,
          s.cwd || null,
          s.gitBranch || null,
          s.nativeStoragePath || null,
          s.createdAt || new Date().toISOString(),
          s.lastActiveAt || s.createdAt || new Date().toISOString(),
          s.deletedAt || null,
          s.turns || 0,
          typeof s.totalCost === 'number' ? s.totalCost : s.totalCost?.totalUsd || 0,
          s.totalDurationMs || 0
        );
        if (info.changes > 0) results.sessions++;
        else results.skipped++;
      } catch (err) {
        results.skipped++;
      }
    }
  }

  return results;
}

/**
 * Import sessions from native provider directories
 * @param {Object} options - Import options
 * @returns {Object} Import results by provider
 */
function importFromProviders(options = {}) {
  const {
    skipExisting = true,
    skipDead = true,
    provider,
    inferTitles = true
  } = options;
  const results = {
    claude: { discovered: 0, imported: 0, skipped: 0, turns: 0 },
    codex: { discovered: 0, imported: 0, skipped: 0, turns: 0 },
    gemini: { discovered: 0, imported: 0, skipped: 0, turns: 0 },
    errors: []
  };

  // Import from each provider
  if (!provider || provider === 'claude') {
    importClaudeSessions(results.claude, results.errors, { skipExisting, skipDead, inferTitles });
  }

  if (!provider || provider === 'codex') {
    importCodexSessions(results.codex, results.errors, { skipExisting, skipDead, inferTitles });
  }

  if (!provider || provider === 'gemini') {
    importGeminiSessions(results.gemini, results.errors, { skipExisting, skipDead, inferTitles });
  }

  return results;
}

/**
 * Import Claude sessions from ~/.claude/projects/
 */
function importClaudeSessions(results, errors, options) {
  const baseDir = path.join(os.homedir(), '.claude', 'projects');
  if (!fs.existsSync(baseDir)) return;

  const db = getDb();
  const inferTitles = options?.inferTitles !== false;

  // Find all project directories
  const projectDirs = fs.readdirSync(baseDir, { withFileTypes: true })
    .filter(d => d.isDirectory())
    .map(d => d.name);

  for (const projectDir of projectDirs) {
    const projectPath = path.join(baseDir, projectDir);
    const sessionFiles = fs.readdirSync(projectPath)
      .filter(f => f.endsWith('.jsonl'));

    for (const sessionFile of sessionFiles) {
      const sessionPath = path.join(projectPath, sessionFile);
      results.discovered++;

      try {
        const sessionId = sessionFile.replace('.jsonl', '');

        // Check if already exists
        if (options.skipExisting) {
          const existing = findSessionIdentityRow(db, {
            provider: 'claude',
            sessionId,
          });
          if (existing) {
            results.skipped++;
            continue;
          }
        }

        // Parse the session file
        const { session, turns } = parseClaudeSession(sessionPath, sessionId, { inferTitles });

        // Skip dead sessions
        if (options.skipDead && (!turns || turns.length === 0)) {
          results.skipped++;
          continue;
        }

        // Derive CWD from project directory name
        const cwd = projectDir.replace(/-/g, '/');

        // Insert session
        const { rowId: psId } = resolveSessionRowIdentity(db, 'claude', sessionId);
        db.prepare(`
          INSERT OR REPLACE INTO sessions (
            id, provider, provider_session_id,
            origin, origin_imported_at, origin_native_file,
            title, status, model, cwd, git_branch,
            native_storage_path, created_at, last_active_at,
            turn_count, total_cost, total_input_tokens, total_output_tokens
          ) VALUES (?, 'claude', ?, 'provider-import', ?, ?, ?, 'active', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(
          psId,
          sessionId,
          new Date().toISOString(),
          sessionPath,
          session.title,
          session.model,
          cwd,
          session.gitBranch || null,
          sessionPath,
          session.createdAt,
          session.lastActiveAt,
          turns.length,
          session.totalCost,
          session.totalInputTokens,
          session.totalOutputTokens
        );

        // Insert turns
        const insertTurn = db.prepare(`
          INSERT INTO turns (
            id, session_id, provider, provider_session_id, turn_number,
            user_message, assistant_response, thinking,
            model, cost, input_tokens, output_tokens,
            cache_read_tokens, tools_used, ts
          ) VALUES (?, ?, 'claude', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `);

        for (const turn of turns) {
          insertTurn.run(
            uuidv4(),
            psId,
            sessionId,
            turn.turnNumber,
            turn.userMessage,
            turn.assistantResponse,
            turn.thinking,
            turn.model,
            turn.cost,
            turn.inputTokens,
            turn.outputTokens,
            turn.cacheReadTokens,
            turn.toolsUsed ? JSON.stringify(turn.toolsUsed) : null,
            turn.ts
          );
          results.turns++;
        }

        results.imported++;
      } catch (err) {
        errors.push(`Claude ${sessionFile}: ${err.message}`);
      }
    }
  }
}

/**
 * Parse a Claude session JSONL file
 */
function parseClaudeSession(filePath, sessionId, options = {}) {
  const content = fs.readFileSync(filePath, 'utf-8');
  const lines = content.trim().split('\n').filter(Boolean);
  const inferTitles = options.inferTitles !== false;

  const session = {
    title: null,
    model: null,
    gitBranch: null,
    createdAt: null,
    lastActiveAt: null,
    totalCost: 0,
    totalInputTokens: 0,
    totalOutputTokens: 0
  };

  const turns = [];
  let currentUserMessage = null;
  let turnNumber = 0;

  for (const line of lines) {
    try {
      const entry = JSON.parse(line);

      // Track timestamps
      if (entry.timestamp) {
        if (!session.createdAt) session.createdAt = entry.timestamp;
        session.lastActiveAt = entry.timestamp;
      }

      // Track git branch
      if (entry.gitBranch && !session.gitBranch) {
        session.gitBranch = entry.gitBranch;
      }

      // Handle user messages
      if (entry.type === 'user' && entry.message?.content) {
        const text = typeof entry.message.content === 'string'
          ? entry.message.content
          : entry.message.content.find?.(c => c.type === 'text')?.text ||
            entry.message.content[0]?.text || '';

        // Skip tool results
        if (text && !text.startsWith('tool_use_id') && entry.message.content?.type !== 'tool_result') {
          // Only count as new turn if it's not a tool result
          const isToolResult = Array.isArray(entry.message.content) &&
            entry.message.content.some(c => c.type === 'tool_result');

          if (!isToolResult) {
            turnNumber++;
            currentUserMessage = {
              text: text.substring(0, 10000), // Limit size
              ts: entry.timestamp,
              turnNumber
            };

            // Use first user message as title if not set
            if (inferTitles && !session.title && text) {
              session.title = text.substring(0, 100);
            }
          }
        }
      }

      // Handle assistant messages
      if (entry.type === 'assistant' && entry.message && currentUserMessage) {
        const content = entry.message.content || [];

        const textParts = content.filter(c => c.type === 'text').map(c => c.text);
        const response = textParts.join('\n').substring(0, 50000); // Limit size

        const thinkingParts = content.filter(c => c.type === 'thinking').map(c => c.thinking);
        const thinking = thinkingParts.length > 0 ? thinkingParts.join('\n').substring(0, 10000) : null;

        const tools = content.filter(c => c.type === 'tool_use').map(c => c.name);

        const usage = entry.message.usage || {};
        const model = entry.message.model;
        // Claude API uses cache_read_input_tokens, normalize to cache_read_tokens for pricing
        const normalizedUsage = {
          input_tokens: usage.input_tokens || 0,
          output_tokens: usage.output_tokens || 0,
          cache_read_tokens: usage.cache_read_input_tokens || 0
        };
        const cost = calculateCost('claude', model, normalizedUsage);

        // Track model
        if (model && !session.model) {
          session.model = model;
        }

        // Accumulate totals
        session.totalCost += cost;
        session.totalInputTokens += normalizedUsage.input_tokens;
        session.totalOutputTokens += normalizedUsage.output_tokens;

        turns.push({
          turnNumber: currentUserMessage.turnNumber,
          userMessage: currentUserMessage.text,
          assistantResponse: response || null,
          thinking,
          model,
          cost,
          inputTokens: normalizedUsage.input_tokens,
          outputTokens: normalizedUsage.output_tokens,
          cacheReadTokens: normalizedUsage.cache_read_tokens,
          toolsUsed: tools.length > 0 ? tools : null,
          ts: currentUserMessage.ts
        });

        currentUserMessage = null;
      }
    } catch (err) {
      // Skip malformed lines
    }
  }

  if (!session.createdAt) {
    session.createdAt = new Date().toISOString();
  }
  if (!session.lastActiveAt) {
    session.lastActiveAt = session.createdAt;
  }

  return { session, turns };
}

/**
 * Import Codex sessions from ~/.codex/sessions/
 */
function importCodexSessions(results, errors, options) {
  const baseDir = path.join(os.homedir(), '.codex', 'sessions');
  if (!fs.existsSync(baseDir)) return;

  const db = getDb();
  const inferTitles = options?.inferTitles !== false;

  // Walk year/month/day directories
  const years = fs.readdirSync(baseDir, { withFileTypes: true })
    .filter(d => d.isDirectory())
    .map(d => d.name);

  for (const year of years) {
    const yearPath = path.join(baseDir, year);
    const months = fs.readdirSync(yearPath, { withFileTypes: true })
      .filter(d => d.isDirectory())
      .map(d => d.name);

    for (const month of months) {
      const monthPath = path.join(yearPath, month);
      const days = fs.readdirSync(monthPath, { withFileTypes: true })
        .filter(d => d.isDirectory())
        .map(d => d.name);

      for (const day of days) {
        const dayPath = path.join(monthPath, day);
        const sessionFiles = fs.readdirSync(dayPath)
          .filter(f => f.endsWith('.jsonl'));

        for (const sessionFile of sessionFiles) {
          const sessionPath = path.join(dayPath, sessionFile);
          results.discovered++;

          try {
            // Extract session ID from filename
            const match = sessionFile.match(/([a-f0-9-]{36})\.jsonl$/);
            const sessionId = match ? match[1] : sessionFile.replace('.jsonl', '');

            // Check if already exists
            if (options.skipExisting) {
              const existing = findSessionIdentityRow(db, {
                provider: 'codex',
                sessionId,
              });
              if (existing) {
                results.skipped++;
                continue;
              }
            }

            // Parse the session file
            const { session, turns } = parseCodexSession(sessionPath, sessionId, { inferTitles });

            // Skip dead sessions
            if (options.skipDead && (!turns || turns.length === 0)) {
              results.skipped++;
              continue;
            }

            // Insert session
            const { rowId: psId } = resolveSessionRowIdentity(db, 'codex', sessionId);
            db.prepare(`
              INSERT OR REPLACE INTO sessions (
                id, provider, provider_session_id,
                origin, origin_imported_at, origin_native_file,
                title, status, model, cwd,
                native_storage_path, created_at, last_active_at,
                turn_count, total_cost, total_input_tokens, total_output_tokens
              ) VALUES (?, 'codex', ?, 'provider-import', ?, ?, ?, 'active', ?, ?, ?, ?, ?, ?, ?, ?, ?)
            `).run(
              psId,
              sessionId,
              new Date().toISOString(),
              sessionPath,
              session.title,
              session.model,
              session.cwd,
              sessionPath,
              session.createdAt,
              session.lastActiveAt,
              turns.length,
              session.totalCost,
              session.totalInputTokens,
              session.totalOutputTokens
            );

            // Insert turns
            const insertTurn = db.prepare(`
              INSERT INTO turns (
                id, session_id, provider, provider_session_id, turn_number,
                user_message, assistant_response,
                model, cost, input_tokens, output_tokens, tools_used, ts
              ) VALUES (?, ?, 'codex', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            `);

            for (const turn of turns) {
              insertTurn.run(
                uuidv4(),
                psId,
                sessionId,
                turn.turnNumber,
                turn.userMessage,
                turn.assistantResponse,
                turn.model,
                turn.cost,
                turn.inputTokens,
                turn.outputTokens,
                turn.toolsUsed ? JSON.stringify(turn.toolsUsed) : null,
                turn.ts
              );
              results.turns++;
            }

            results.imported++;
          } catch (err) {
            errors.push(`Codex ${sessionFile}: ${err.message}`);
          }
        }
      }
    }
  }
}

/**
 * Parse a Codex session JSONL file
 */
function parseCodexSession(filePath, sessionId, options = {}) {
  const content = fs.readFileSync(filePath, 'utf-8');
  const lines = content.trim().split('\n').filter(Boolean);
  const inferTitles = options.inferTitles !== false;

  const session = {
    title: null,
    model: null,
    cwd: null,
    createdAt: null,
    lastActiveAt: null,
    totalCost: 0,
    totalInputTokens: 0,
    totalOutputTokens: 0
  };

  const turns = [];
  let turnNumber = 0;
  let currentUserMessage = null;

  for (const line of lines) {
    try {
      const entry = JSON.parse(line);

      // Track timestamps
      if (entry.timestamp) {
        if (!session.createdAt) session.createdAt = entry.timestamp;
        session.lastActiveAt = entry.timestamp;
      }

      // Session metadata
      if (entry.type === 'session_meta' && entry.payload) {
        session.cwd = entry.payload.cwd;
        session.model = entry.payload.model_provider === 'openai' ? 'codex' : entry.payload.model_provider;
      }

      // Turn context has model info
      if (entry.type === 'turn_context' && entry.payload) {
        if (entry.payload.model) session.model = entry.payload.model;
        if (entry.payload.cwd) session.cwd = entry.payload.cwd;
      }

      // User messages
      if (entry.type === 'event_msg' && entry.payload?.type === 'user_message') {
        turnNumber++;
        currentUserMessage = {
          text: (entry.payload.message || '').substring(0, 10000),
          ts: entry.timestamp,
          turnNumber
        };

        if (inferTitles && !session.title && entry.payload.message) {
          session.title = entry.payload.message.substring(0, 100);
        }
      }

      // Token counts (usage info)
      // total_token_usage = running total, last_token_usage = incremental for this turn
      if (entry.type === 'event_msg' && entry.payload?.type === 'token_count' && entry.payload.info) {
        const totalUsage = entry.payload.info.total_token_usage;
        const lastUsage = entry.payload.info.last_token_usage;

        if (totalUsage) {
          // Store the latest total (will be overwritten each time, keeping final value)
          session.totalInputTokens = totalUsage.input_tokens || 0;
          session.totalOutputTokens = totalUsage.output_tokens || 0;
        }

        // Update the current turn with incremental token usage
        if (lastUsage && currentUserMessage) {
          const existingTurn = turns.find(t => t.turnNumber === currentUserMessage.turnNumber);
          if (existingTurn) {
            existingTurn.inputTokens = lastUsage.input_tokens || 0;
            existingTurn.outputTokens = lastUsage.output_tokens || 0;
            existingTurn.cost = calculateCost('codex', session.model, {
              input_tokens: lastUsage.input_tokens || 0,
              output_tokens: lastUsage.output_tokens || 0
            });
          }
        }
      }

      // Response items with text content
      if (entry.type === 'response_item' && entry.payload?.type === 'message' && entry.payload?.role === 'assistant') {
        // Assistant message
      }

      // Function calls (tools)
      if (entry.type === 'response_item' && entry.payload?.type === 'function_call' && currentUserMessage) {
        const existingTurn = turns.find(t => t.turnNumber === currentUserMessage.turnNumber);
        if (existingTurn) {
          if (!existingTurn.toolsUsed) existingTurn.toolsUsed = [];
          existingTurn.toolsUsed.push(entry.payload.name);
        } else {
          // Create turn with tool
          turns.push({
            turnNumber: currentUserMessage.turnNumber,
            userMessage: currentUserMessage.text,
            assistantResponse: null,
            model: session.model,
            cost: 0,
            inputTokens: 0,
            outputTokens: 0,
            toolsUsed: [entry.payload.name],
            ts: currentUserMessage.ts
          });
        }
      }

      // Text responses
      if (entry.type === 'response_item' && entry.payload?.type === 'message' &&
          entry.payload?.role === 'assistant' && entry.payload?.content) {
        const textContent = entry.payload.content
          .filter(c => c.type === 'output_text' || c.type === 'text')
          .map(c => c.text)
          .join('\n');

        if (textContent && currentUserMessage) {
          const existingTurn = turns.find(t => t.turnNumber === currentUserMessage.turnNumber);
          if (existingTurn) {
            existingTurn.assistantResponse = textContent.substring(0, 50000);
          } else {
            turns.push({
              turnNumber: currentUserMessage.turnNumber,
              userMessage: currentUserMessage.text,
              assistantResponse: textContent.substring(0, 50000),
              model: session.model,
              cost: 0,
              inputTokens: 0,
              outputTokens: 0,
              toolsUsed: null,
              ts: currentUserMessage.ts
            });
          }
        }
      }

    } catch (err) {
      // Skip malformed lines
    }
  }

  // Ensure we have at least the user message turns
  if (turns.length === 0 && turnNumber > 0) {
    // Reconstruct from currentUserMessage if we have any
  }

  if (!session.createdAt) {
    session.createdAt = new Date().toISOString();
  }
  if (!session.lastActiveAt) {
    session.lastActiveAt = session.createdAt;
  }

  // Calculate session totals from individual turns (not Codex's global running total)
  session.totalInputTokens = turns.reduce((sum, t) => sum + (t.inputTokens || 0), 0);
  session.totalOutputTokens = turns.reduce((sum, t) => sum + (t.outputTokens || 0), 0);
  session.totalCost = turns.reduce((sum, t) => sum + (t.cost || 0), 0);

  return { session, turns };
}

/**
 * Import Gemini sessions from ~/.gemini/
 * Note: Gemini stores sessions differently - in tmp/ directory
 */
function importGeminiSessions(results, errors, options) {
  const baseDir = path.join(os.homedir(), '.gemini', 'tmp');
  if (!fs.existsSync(baseDir)) return;

  const db = getDb();
  const inferTitles = options?.inferTitles !== false;

  // Each subdirectory is a session
  const sessionDirs = fs.readdirSync(baseDir, { withFileTypes: true })
    .filter(d => d.isDirectory())
    .map(d => d.name);

  for (const sessionDir of sessionDirs) {
    results.discovered++;

    try {
      const sessionPath = path.join(baseDir, sessionDir);

      // Check if already exists
      if (options.skipExisting) {
        const existing = findSessionIdentityRow(db, {
          provider: 'gemini',
          sessionId: sessionDir,
        });
        if (existing) {
          results.skipped++;
          continue;
        }
      }

      // Look for chat files or logs
      const logsFile = path.join(sessionPath, 'logs.json');
      if (!fs.existsSync(logsFile)) {
        results.skipped++;
        continue;
      }

      // Parse Gemini logs
      const { session, turns } = parseGeminiSession(logsFile, sessionDir, { inferTitles });

      // Skip dead sessions
      if (options.skipDead && (!turns || turns.length === 0)) {
        results.skipped++;
        continue;
      }

      // Insert session
      const { rowId: psId } = resolveSessionRowIdentity(db, 'gemini', sessionDir);
      db.prepare(`
        INSERT OR REPLACE INTO sessions (
          id, provider, provider_session_id,
          origin, origin_imported_at, origin_native_file,
          title, status, model, cwd,
          native_storage_path, created_at, last_active_at,
          turn_count, total_cost
        ) VALUES (?, 'gemini', ?, 'provider-import', ?, ?, ?, 'active', ?, ?, ?, ?, ?, ?, ?)
      `).run(
        psId,
        sessionDir,
        new Date().toISOString(),
        logsFile,
        session.title,
        session.model,
        session.cwd,
        sessionPath,
        session.createdAt,
        session.lastActiveAt,
        turns.length,
        session.totalCost
      );

      // Insert turns
      const insertTurn = db.prepare(`
        INSERT INTO turns (
          id, session_id, provider, provider_session_id, turn_number,
          user_message, assistant_response, model, ts
        ) VALUES (?, ?, 'gemini', ?, ?, ?, ?, ?, ?)
      `);

      for (const turn of turns) {
        insertTurn.run(
          uuidv4(),
          psId,
          sessionDir,
          turn.turnNumber,
          turn.userMessage,
          turn.assistantResponse,
          turn.model,
          turn.ts
        );
        results.turns++;
      }

      results.imported++;
    } catch (err) {
      errors.push(`Gemini ${sessionDir}: ${err.message}`);
    }
  }
}

/**
 * Parse a Gemini logs.json file
 */
function parseGeminiSession(filePath, sessionId, options = {}) {
  const content = fs.readFileSync(filePath, 'utf-8');
  let data;
  const inferTitles = options.inferTitles !== false;

  try {
    data = JSON.parse(content);
  } catch {
    return { session: { title: null, model: 'gemini', cwd: null, createdAt: new Date().toISOString(), lastActiveAt: new Date().toISOString(), totalCost: 0 }, turns: [] };
  }

  const session = {
    title: null,
    model: 'gemini',
    cwd: data.cwd || null,
    createdAt: null,
    lastActiveAt: null,
    totalCost: 0
  };

  const turns = [];

  // Gemini logs structure varies - handle different formats
  if (Array.isArray(data)) {
    // Array of log entries
    let turnNumber = 0;
    for (const entry of data) {
      if (entry.timestamp) {
        if (!session.createdAt) session.createdAt = entry.timestamp;
        session.lastActiveAt = entry.timestamp;
      }

      if (entry.type === 'user' || entry.role === 'user') {
        turnNumber++;
        const text = entry.content || entry.message || entry.text || '';
        if (inferTitles && !session.title && text) {
          session.title = text.substring(0, 100);
        }
        turns.push({
          turnNumber,
          userMessage: text.substring(0, 10000),
          assistantResponse: null,
          model: session.model,
          ts: entry.timestamp || new Date().toISOString()
        });
      }

      if ((entry.type === 'assistant' || entry.role === 'model') && turns.length > 0) {
        const lastTurn = turns[turns.length - 1];
        lastTurn.assistantResponse = (entry.content || entry.message || entry.text || '').substring(0, 50000);
      }
    }
  } else if (data.messages) {
    // Object with messages array
    let turnNumber = 0;
    for (const msg of data.messages) {
      if (msg.role === 'user') {
        turnNumber++;
        const text = msg.content || msg.parts?.[0]?.text || '';
        if (inferTitles && !session.title && text) {
          session.title = text.substring(0, 100);
        }
        turns.push({
          turnNumber,
          userMessage: text.substring(0, 10000),
          assistantResponse: null,
          model: session.model,
          ts: msg.timestamp || new Date().toISOString()
        });
      }
      if (msg.role === 'model' && turns.length > 0) {
        const lastTurn = turns[turns.length - 1];
        lastTurn.assistantResponse = (msg.content || msg.parts?.[0]?.text || '').substring(0, 50000);
      }
    }
  }

  if (!session.createdAt) {
    session.createdAt = new Date().toISOString();
  }
  if (!session.lastActiveAt) {
    session.lastActiveAt = session.createdAt;
  }

  return { session, turns };
}

// ===============================
// Verification exports (DB ↔ files)
// ===============================
function _sha1(s) {
  return crypto.createHash('sha1').update(s).digest('hex');
}

function _toMs(x) {
  if (!x) return null;
  if (typeof x === 'number' && Number.isFinite(x)) return x;
  const t = Date.parse(x);
  return Number.isFinite(t) ? t : null;
}

async function _walkFiles(rootDir, acceptFn) {
  const out = [];
  async function walk(dir) {
    let entries = [];
    try {
      entries = await fsp.readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) await walk(p);
      else if (acceptFn(p)) out.push(p);
    }
  }
  await walk(rootDir);
  return out;
}

function _extractProviderSessionId(provider, filePath, parsed) {
  const session =
    parsed?.session ??
    parsed?.meta ??
    parsed?.header ??
    parsed ??
    {};

  const fromParsed =
    session.provider_session_id ??
    session.providerSessionId ??
    session.session_id ??
    session.sessionId ??
    session.id ??
    null;

  if (fromParsed) return String(fromParsed);

  if (provider === 'gemini') {
    // ~/.gemini/tmp/<session>/logs.json
    return path.basename(path.dirname(filePath));
  }

  // .jsonl: <session>.jsonl
  return path.parse(filePath).name;
}

function _extractTurns(parsed) {
  return parsed?.turns ?? parsed?.messages ?? parsed?.items ?? parsed?.events ?? [];
}

function _normFromParsed(provider, filePath, parsed, opts = {}) {
  const turns = _extractTurns(parsed);
  const providerSessionId = _extractProviderSessionId(provider, filePath, parsed);

  let turnCount = Array.isArray(turns) ? turns.length : null;

  let inputTokens = 0;
  let outputTokens = 0;
  let cost = 0;

  let startedAtMs = null;
  let endedAtMs = null;

  const wantDeep = opts?.mode === 'deep';
  const turnHashes = wantDeep ? [] : null;

  for (let i = 0; i < (turns?.length ?? 0); i++) {
    const t = turns[i] || {};

    const inTok = Number(t.input_tokens ?? t.inputTokens ?? t.prompt_tokens ?? t.promptTokens ?? 0) || 0;
    const outTok = Number(t.output_tokens ?? t.outputTokens ?? t.completion_tokens ?? t.completionTokens ?? 0) || 0;
    const c = Number(t.cost ?? t.total_cost ?? t.totalCost ?? 0) || 0;

    inputTokens += inTok;
    outputTokens += outTok;
    cost += c;

    const ts =
      t.ts ?? t.timestamp ?? t.created_at ?? t.createdAt ?? t.time ?? null;
    const tsMs = _toMs(ts);
    if (tsMs != null) {
      if (startedAtMs == null || tsMs < startedAtMs) startedAtMs = tsMs;
      if (endedAtMs == null || tsMs > endedAtMs) endedAtMs = tsMs;
    }

    if (wantDeep) {
      const userText =
        t.user_message ?? t.user ?? t.prompt ?? t.input_text ?? t.input ?? '';
      const assistantText =
        t.assistant_message ?? t.assistant ?? t.completion ?? t.output_text ?? t.output ?? '';
      turnHashes.push(_sha1(JSON.stringify({ i, userText, assistantText })));
    }
  }

  return {
    provider,
    providerSessionId,
    filePath,
    turnCount,
    startedAtMs,
    endedAtMs,
    inputTokens,
    outputTokens,
    cost,
    turnHashes
  };
}

async function discover_claude(rootDir = path.join(os.homedir(), '.claude', 'projects')) {
  return _walkFiles(rootDir, (p) => p.toLowerCase().endsWith('.jsonl'));
}

async function discover_codex(rootDir = path.join(os.homedir(), '.codex', 'sessions')) {
  return _walkFiles(rootDir, (p) => p.toLowerCase().endsWith('.jsonl'));
}

async function discover_gemini(rootDir = path.join(os.homedir(), '.gemini', 'tmp')) {
  return _walkFiles(rootDir, (p) => path.basename(p).toLowerCase() === 'logs.json');
}

async function parse_claude(filePath, opts) {
  const parsed = parseClaudeSession(filePath);
  return _normFromParsed('claude', filePath, parsed, opts);
}

async function parse_codex(filePath, opts) {
  const parsed = parseCodexSession(filePath);
  return _normFromParsed('codex', filePath, parsed, opts);
}

async function parse_gemini(filePath, opts) {
  const parsed = parseGeminiSession(filePath);
  return _normFromParsed('gemini', filePath, parsed, opts);
}

export {
  migrateFromJson,
  importFromProviders,
  parseClaudeSession,
  parseCodexSession,
  parseGeminiSession,
  discover_claude,
  discover_codex,
  discover_gemini,
  parse_claude,
  parse_codex,
  parse_gemini
};
