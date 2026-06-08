/**
 * Agent Configuration Detection
 *
 * Detects MCP servers configured across various AI agents:
 * - Claude Desktop, Claude Code
 * - Cursor, Windsurf, Cline
 * - Zed, VS Code/Copilot
 * - Gemini, Codex
 *
 * Each agent stores MCP configs in different locations with slightly
 * different JSON structures. This module normalizes the detection.
 */

import fs from 'fs';
import path from 'path';
import os from 'os';

/**
 * Known agent configurations
 * Each entry defines where an agent stores its MCP server config
 */
export const AGENT_CONFIGS = [
  // Claude Desktop (Anthropic)
  {
    id: 'claude-desktop',
    name: 'Claude Desktop',
    key: 'mcpServers',
    paths: {
      darwin: ['Library/Application Support/Claude/claude_desktop_config.json'],
      win32: ['AppData/Roaming/Claude/claude_desktop_config.json'],
      linux: ['.config/claude/claude_desktop_config.json'],
    }
  },
  // Claude Code CLI (Anthropic)
  {
    id: 'claude-code',
    name: 'Claude Code',
    key: 'mcpServers',
    paths: {
      darwin: ['.claude.json'],
      win32: ['.claude.json'],
      linux: ['.claude.json'],
    }
  },
  // Cursor (Anysphere)
  {
    id: 'cursor',
    name: 'Cursor',
    key: 'mcpServers',
    paths: {
      darwin: ['.cursor/mcp.json'],
      win32: ['.cursor/mcp.json'],
      linux: ['.cursor/mcp.json'],
    }
  },
  // Windsurf (Codeium)
  {
    id: 'windsurf',
    name: 'Windsurf',
    key: 'mcpServers',
    paths: {
      darwin: ['.codeium/windsurf/mcp_config.json'],
      win32: ['.codeium/windsurf/mcp_config.json'],
      linux: ['.codeium/windsurf/mcp_config.json'],
    }
  },
  // Cline (VS Code extension)
  {
    id: 'cline',
    name: 'Cline',
    key: 'mcpServers',
    paths: {
      darwin: ['Documents/Cline/cline_mcp_settings.json'],
      win32: ['Documents/Cline/cline_mcp_settings.json'],
      linux: ['Documents/Cline/cline_mcp_settings.json'],
    }
  },
  // Zed Editor
  {
    id: 'zed',
    name: 'Zed',
    key: 'context_servers',
    paths: {
      darwin: ['.zed/settings.json'],
      win32: ['.config/zed/settings.json'],
      linux: ['.config/zed/settings.json'],
    }
  },
  // VS Code / GitHub Copilot
  {
    id: 'vscode',
    name: 'VS Code',
    key: 'servers',
    paths: {
      darwin: ['Library/Application Support/Code/User/mcp.json'],
      win32: ['AppData/Roaming/Code/User/mcp.json'],
      linux: ['.config/Code/User/mcp.json'],
    }
  },
  // Gemini CLI (Google)
  {
    id: 'gemini',
    name: 'Gemini',
    key: 'mcpServers',
    paths: {
      darwin: ['.gemini/settings.json'],
      win32: ['.gemini/settings.json'],
      linux: ['.gemini/settings.json'],
    }
  },
  // Codex CLI (OpenAI)
  {
    id: 'codex',
    name: 'Codex',
    key: 'mcp_servers',
    paths: {
      darwin: ['.codex/config.toml', '.codex/config.json', '.codex/settings.json'],
      win32: ['.codex/config.toml', '.codex/config.json', '.codex/settings.json'],
      linux: ['.codex/config.toml', '.codex/config.json', '.codex/settings.json'],
    }
  },
];

/**
 * Get the config file paths for current platform
 */
export function getAgentConfigPaths(agentConfig) {
  const home = os.homedir();
  const platform = process.platform;
  const relativePaths = agentConfig.paths[platform] || agentConfig.paths.linux || [];
  return relativePaths.map(p => path.join(home, p));
}

/**
 * Find the config file for an agent (first one that exists)
 */
export function findAgentConfig(agentConfig) {
  const paths = getAgentConfigPaths(agentConfig);
  for (const configPath of paths) {
    if (fs.existsSync(configPath)) {
      return configPath;
    }
  }
  return null;
}

function parseTomlScalar(value) {
  const trimmed = value.trim();
  if ((trimmed.startsWith('"') && trimmed.endsWith('"')) ||
      (trimmed.startsWith("'") && trimmed.endsWith("'"))) {
    return trimmed.slice(1, -1);
  }
  if (trimmed.startsWith('[') && trimmed.endsWith(']')) {
    return trimmed
      .slice(1, -1)
      .split(',')
      .map((item) => parseTomlScalar(item))
      .filter((item) => item !== '');
  }
  return trimmed;
}

export function readCodexTomlMcpServers(content, configPath) {
  const servers = [];
  let current = null;

  for (const line of content.split('\n')) {
    const tableMatch = line.match(/^\s*\[mcp_servers\.([^\].]+)]\s*(?:#.*)?$/);
    if (tableMatch) {
      current = {
        name: tableMatch[1].replace(/^"(.*)"$/, '$1'),
        command: null,
        args: undefined,
        cwd: undefined,
        url: undefined,
      };
      servers.push(current);
      continue;
    }

    if (!current) continue;
    const kvMatch = line.match(/^\s*([A-Za-z0-9_-]+)\s*=\s*(.+?)\s*(?:#.*)?$/);
    if (!kvMatch) continue;

    const [, key, value] = kvMatch;
    if (key === 'command' || key === 'cwd' || key === 'url') {
      current[key] = parseTomlScalar(value);
    } else if (key === 'args') {
      current.args = parseTomlScalar(value);
    }
  }

  return servers.map((server) => ({
    name: server.name,
    agent: 'codex',
    agentName: 'Codex',
    command: server.command || server.url || 'unknown',
    args: server.args,
    cwd: server.cwd,
    env: [],
    configFile: configPath,
  }));
}

/**
 * Read MCP servers from an agent's config file
 */
export function readAgentMcpServers(agentConfig) {
  const configPath = findAgentConfig(agentConfig);
  if (!configPath) return [];

  try {
    if (agentConfig.id === 'codex' && configPath.endsWith('.toml')) {
      return readCodexTomlMcpServers(fs.readFileSync(configPath, 'utf-8'), configPath);
    }

    const content = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
    const mcpServers = content[agentConfig.key] || {};

    return Object.entries(mcpServers).map(([name, config]) => {
      const command = config.command || config.path || config.command?.path;
      return {
        name,
        agent: agentConfig.id,
        agentName: agentConfig.name,
        command: command || 'unknown',
        args: config.args,
        cwd: config.cwd,
        env: config.env ? Object.keys(config.env) : [],
        configFile: configPath,
      };
    });
  } catch (e) {
    return [];
  }
}

/**
 * Detect all MCP servers configured across all known agents
 */
export function detectAllMcpServers() {
  const servers = [];

  for (const agentConfig of AGENT_CONFIGS) {
    const agentServers = readAgentMcpServers(agentConfig);
    servers.push(...agentServers);
  }

  return servers;
}

/**
 * Get unique MCP server names across all agents
 */
export function getUniqueMcpServers() {
  const servers = detectAllMcpServers();
  const unique = new Map();

  for (const server of servers) {
    if (!unique.has(server.name)) {
      unique.set(server.name, {
        name: server.name,
        agents: [server.agent],
        command: server.command,
      });
    } else {
      const existing = unique.get(server.name);
      if (!existing.agents.includes(server.agent)) {
        existing.agents.push(server.agent);
      }
    }
  }

  return Array.from(unique.values());
}

/**
 * Check which agents are installed (have config files)
 */
export function getInstalledAgents() {
  return AGENT_CONFIGS
    .filter(agent => findAgentConfig(agent) !== null)
    .map(agent => ({
      id: agent.id,
      name: agent.name,
      configFile: findAgentConfig(agent),
    }));
}

/**
 * Get summary of MCP servers by agent
 */
export function getMcpServerSummary() {
  const summary = {};

  for (const agentConfig of AGENT_CONFIGS) {
    const configPath = findAgentConfig(agentConfig);
    if (configPath) {
      const servers = readAgentMcpServers(agentConfig);
      summary[agentConfig.id] = {
        name: agentConfig.name,
        configFile: configPath,
        serverCount: servers.length,
        servers: servers.map(s => s.name),
      };
    }
  }

  return summary;
}

// =============================================================================
// Agent Configuration Management
// =============================================================================

/**
 * Check which agents have a specific MCP server configured
 * @param {string} serverName - Server name to check
 */
export function getAgentsWithServer(serverName) {
  const agents = [];

  for (const agentConfig of AGENT_CONFIGS) {
    const servers = readAgentMcpServers(agentConfig);
    if (servers.some(s => s.name === serverName)) {
      agents.push({
        id: agentConfig.id,
        name: agentConfig.name,
        configFile: findAgentConfig(agentConfig),
      });
    }
  }

  return agents;
}
