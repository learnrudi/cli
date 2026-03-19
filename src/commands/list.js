/**
 * List command - list installed packages
 *
 * Usage:
 *   rudi list [kind]              List all or filter by kind
 *   rudi list skills              List skills
 *   rudi list skills --category=coding   Filter by category
 *   rudi list stacks --detected   Show MCP servers from agent configs
 *   rudi list --json              Output as JSON
 */

import { listInstalled } from '@learnrudi/core';
import { detectAllMcpServers, getInstalledAgents, getMcpServerSummary, AGENT_CONFIGS } from '@learnrudi/mcp';

function pluralizeKind(kind) {
  if (!kind) return 'packages';
  if (kind === 'binary') return 'binaries';
  if (kind === 'skill') return 'skills';
  return `${kind}s`;
}

function headingForKind(kind) {
  if (kind === 'binary') return 'BINARIES';
  if (kind === 'skill') return 'SKILLS';
  return `${kind.toUpperCase()}S`;
}

export async function cmdList(args, flags) {
  let kind = args[0];

  // Normalize kind
  if (kind) {
    // Handle plural forms
    if (kind === 'stacks') kind = 'stack';
    if (kind === 'skills') kind = 'skill';
    if (kind === 'prompts') kind = 'prompt';
    if (kind === 'runtimes') kind = 'runtime';
    if (kind === 'binaries') kind = 'binary';
    if (kind === 'tools') kind = 'binary';
    if (kind === 'agents') kind = 'agent';

    // Handle deprecated 'prompt' → 'skill' rename
    if (kind === 'prompt') {
      console.error('Note: "prompt" has been renamed to "skill". Use "rudi list skills" instead.');
      kind = 'skill';
    }

    if (!['stack', 'skill', 'runtime', 'binary', 'agent'].includes(kind)) {
      console.error(`Invalid kind: ${kind}`);
      console.error(`Valid kinds: stack, skill, runtime, binary, agent`);
      process.exit(1);
    }
  }

  // Handle --detected flag for agents (show which agents are installed)
  if (flags.detected && kind === 'agent') {
    const installedAgents = getInstalledAgents();
    const summary = getMcpServerSummary();

    if (flags.json) {
      console.log(JSON.stringify({ installedAgents, summary }, null, 2));
      return;
    }

    console.log(`\nDETECTED AI AGENTS (${installedAgents.length}/${AGENT_CONFIGS.length}):`);
    console.log('─'.repeat(50));

    for (const agent of AGENT_CONFIGS) {
      const installed = installedAgents.find(a => a.id === agent.id);
      const serverCount = summary[agent.id]?.serverCount || 0;

      if (installed) {
        console.log(`  ✓ ${agent.name}`);
        console.log(`    ${serverCount} MCP server(s)`);
        console.log(`    ${installed.configFile}`);
      } else {
        console.log(`  ○ ${agent.name} (not installed)`);
      }
    }

    console.log(`\nInstalled: ${installedAgents.length} of ${AGENT_CONFIGS.length} agents`);
    return;
  }

  // Handle --detected flag for stacks (show MCP servers from agent configs)
  if (flags.detected && kind === 'stack') {
    const servers = detectAllMcpServers();

    if (flags.json) {
      console.log(JSON.stringify(servers, null, 2));
      return;
    }

    if (servers.length === 0) {
      console.log('No MCP servers detected in agent configs.');
      console.log('\nChecked these agents:');
      for (const agent of AGENT_CONFIGS) {
        console.log(`  - ${agent.name}`);
      }
      return;
    }

    // Group by agent
    const byAgent = {};
    for (const server of servers) {
      if (!byAgent[server.agent]) byAgent[server.agent] = [];
      byAgent[server.agent].push(server);
    }

    console.log(`\nDETECTED MCP SERVERS (${servers.length}):`);
    console.log('─'.repeat(50));

    for (const [agentId, agentServers] of Object.entries(byAgent)) {
      const agentName = agentServers[0]?.agentName || agentId;
      console.log(`\n  ${agentName.toUpperCase()} (${agentServers.length}):`);
      for (const server of agentServers) {
        console.log(`    📦 ${server.name}`);
        console.log(`       ${server.command} ${server.cwd ? `(${server.cwd})` : ''}`);
      }
    }

    console.log(`\nTotal: ${servers.length} MCP server(s) configured`);
    return;
  }

  try {
    let packages = await listInstalled(kind);

    // Filter by category (only for prompts)
    const categoryFilter = flags.category;
    if (categoryFilter) {
      packages = packages.filter(p => p.category === categoryFilter);
    }

    if (flags.json) {
      console.log(JSON.stringify(packages, null, 2));
      return;
    }

    if (packages.length === 0) {
      if (categoryFilter) {
        console.log(`No ${pluralizeKind(kind)} found in category: ${categoryFilter}`);
      } else if (kind) {
        console.log(`No ${pluralizeKind(kind)} installed.`);
      } else {
        console.log('No packages installed.');
      }
      console.log(`\nInstall with: rudi install <package>`);
      return;
    }

    // For skills, group by category if showing all skills
    if (kind === 'skill' && !categoryFilter) {
      const byCategory = {};
      for (const pkg of packages) {
        const cat = pkg.category || 'general';
        if (!byCategory[cat]) byCategory[cat] = [];
        byCategory[cat].push(pkg);
      }

      console.log(`\nSKILLS (${packages.length}):`);
      console.log('─'.repeat(50));

      for (const [category, skills] of Object.entries(byCategory).sort()) {
        console.log(`\n  ${category.toUpperCase()} (${skills.length}):`);
        for (const pkg of skills) {
          const icon = pkg.icon ? `${pkg.icon} ` : '';
          console.log(`    ${icon}${pkg.id || `skill:${pkg.name}`}`);
          if (pkg.description) {
            console.log(`      ${pkg.description}`);
          }
          if (pkg.requires && pkg.requires.stacks && pkg.requires.stacks.length > 0) {
            console.log(`      Requires: ${pkg.requires.stacks.join(', ')}`);
          }
          if (pkg.tags && pkg.tags.length > 0) {
            console.log(`      Tags: ${pkg.tags.join(', ')}`);
          }
        }
      }

      console.log(`\nTotal: ${packages.length} skill(s)`);
      console.log(`\nFilter by category: rudi list skills --category=coding`);
      return;
    }

    // Group by kind (standard display)
    const grouped = {
      stack: packages.filter(p => p.kind === 'stack'),
      skill: packages.filter(p => p.kind === 'skill'),
      runtime: packages.filter(p => p.kind === 'runtime'),
      binary: packages.filter(p => p.kind === 'binary'),
      agent: packages.filter(p => p.kind === 'agent')
    };

    let total = 0;

    for (const [pkgKind, pkgs] of Object.entries(grouped)) {
      if (pkgs.length === 0) continue;
      if (kind && kind !== pkgKind) continue;

      console.log(`\n${headingForKind(pkgKind)} (${pkgs.length}):`);
      console.log('─'.repeat(50));

      for (const pkg of pkgs) {
        const icon = pkg.icon ? `${pkg.icon} ` : '';
        console.log(`  ${icon}${pkg.id || `${pkgKind}:${pkg.name}`}`);
        console.log(`    Version: ${pkg.version || 'unknown'}`);
        if (pkg.description) {
          console.log(`    ${pkg.description}`);
        }
        if (pkg.category) {
          console.log(`    Category: ${pkg.category}`);
        }
        if (pkg.tags && pkg.tags.length > 0) {
          console.log(`    Tags: ${pkg.tags.join(', ')}`);
        }
        if (pkg.installedAt) {
          console.log(`    Installed: ${new Date(pkg.installedAt).toLocaleDateString()}`);
        }
        total++;
      }
    }

    console.log(`\nTotal: ${total} package(s)`);

  } catch (error) {
    console.error(`Failed to list packages: ${error.message}`);
    process.exit(1);
  }
}
