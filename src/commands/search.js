/**
 * Search command - search registry for packages
 */

import { fetchIndex, searchPackages, listPackages } from '@learnrudi/core';

function pluralizeKind(kind) {
  if (!kind) return 'packages';
  if (kind === 'binary') return 'binaries';
  if (kind === 'skill') return 'skills';
  if (kind === 'workflow') return 'workflows';
  return `${kind}s`;
}

function headingForKind(kind) {
  if (kind === 'binary') return 'BINARIES';
  if (kind === 'skill') return 'SKILLS';
  if (kind === 'workflow') return 'WORKFLOWS';
  return `${kind.toUpperCase()}S`;
}

export async function cmdSearch(args, flags) {
  const query = args[0];
  const refreshRegistry = flags.fresh || flags['no-cache'] || false;

  if (refreshRegistry) {
    await fetchIndex({ force: true });
  }

  // Handle --all flag to list everything
  if (flags.all || flags.a) {
    return listAllPackages(flags);
  }

  if (!query) {
    console.error('Usage: rudi search <query>');
    console.error('       rudi search --all            List all available packages');
    console.error('       rudi search --all -s   List all stacks');
    console.error('       rudi search --all --runtimes List all runtimes');
    console.error('       rudi search --all --binaries List all binaries');
    console.error('       rudi search --all --agents   List all agents');
    console.error('       rudi search --all --workflows List all workflows');
    console.error('Example: rudi search pdf');
    process.exit(1);
  }

  const binariesFlag = flags.binaries || flags.tools;
  const kind = flags.stacks
    ? 'stack'
    : (flags.skills || flags.prompts)
      ? 'skill'
      : flags.workflows
        ? 'workflow'
        : flags.runtimes
          ? 'runtime'
          : binariesFlag
            ? 'binary'
            : flags.agents
              ? 'agent'
              : null;

  // Show deprecation note for --prompts flag
  if (flags.prompts && !flags.skills) {
    console.log('Note: --prompts has been renamed to --skills. Use --skills instead.\n');
  }

  console.log(`Searching for "${query}"...`);

  try {
    const results = await searchPackages(query, { kind });

    if (results.length === 0) {
      console.log('No packages found matching your query.');
      return;
    }

    if (flags.json) {
      console.log(JSON.stringify(results, null, 2));
      return;
    }

    console.log(`\nFound ${results.length} package(s):\n`);

    // Group by kind
    const grouped = {
      stack: results.filter(r => r.kind === 'stack'),
      skill: results.filter(r => r.kind === 'skill'),
      prompt: results.filter(r => r.kind === 'prompt'),
      workflow: results.filter(r => r.kind === 'workflow'),
      runtime: results.filter(r => r.kind === 'runtime'),
      binary: results.filter(r => r.kind === 'binary'),
      agent: results.filter(r => r.kind === 'agent')
    };

    for (const [kind, packages] of Object.entries(grouped)) {
      if (packages.length === 0) continue;

      console.log(`${headingForKind(kind)}:`);
      for (const pkg of packages) {
        const id = pkg.id || `${kind}:${pkg.name}`;
        console.log(`  ${id}`);
        console.log(`    ${pkg.description || 'No description'}`);
        if (pkg.version) {
          console.log(`    v${pkg.version}`);
        }
        console.log();
      }
    }

    console.log(`Install with: rudi install <package-id>`);

  } catch (error) {
    console.error(`Search failed: ${error.message}`);
    process.exit(1);
  }
}

/**
 * List all available packages from registry
 */
async function listAllPackages(flags) {
  const binariesFlag = flags.binaries || flags.tools;
  const kind = flags.stacks
    ? 'stack'
    : (flags.skills || flags.prompts)
      ? 'skill'
      : flags.workflows
        ? 'workflow'
        : flags.runtimes
          ? 'runtime'
          : binariesFlag
            ? 'binary'
            : flags.agents
              ? 'agent'
              : null;

  // Show deprecation note for --prompts flag
  if (flags.prompts && !flags.skills) {
    console.log('Note: --prompts has been renamed to --skills. Use --skills instead.\n');
  }

  try {
    const kinds = kind ? [kind] : ['stack', 'skill', 'workflow', 'runtime', 'binary', 'agent'];
    const allPackages = {};
    let totalCount = 0;

    for (const k of kinds) {
      const packages = await listPackages(k);
      allPackages[k] = packages;
      totalCount += packages.length;
    }

    // JSON output mode
    if (flags.json) {
      console.log(JSON.stringify(allPackages, null, 2));
      return;
    }

    console.log(kind ? `Listing all ${pluralizeKind(kind)}...` : 'Listing all available packages...');

    for (const k of kinds) {
      const packages = allPackages[k];
      if (packages.length === 0) continue;

      console.log(`\n${headingForKind(k)} (${packages.length}):`);
      console.log('─'.repeat(50));

      for (const pkg of packages) {
        const id = pkg.id || `${k}:${pkg.name}`;
        const runtime = pkg.runtime ? ` [${pkg.runtime.replace('runtime:', '')}]` : '';
        console.log(`  ${id}${runtime}`);
        console.log(`    ${pkg.description || 'No description'}`);
      }
    }

    console.log(`\nTotal: ${totalCount} package(s) available`);
    console.log(`Install with: rudi install <package-id>`);

  } catch (error) {
    console.error(`Failed to list packages: ${error.message}`);
    process.exit(1);
  }
}
