/**
 * Update command - update installed packages
 */

import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';
import { PATHS, getPackagePath, parsePackageId } from '@learnrudi/env';
import { getPackage } from '@learnrudi/registry-client';

export async function cmdUpdate(args, flags) {
  const pkgId = args[0];

  if (!pkgId) {
    // Update all installed packages
    return updateAll(flags);
  }

  // Normalize package ID
  const fullId = pkgId.includes(':') ? pkgId : `runtime:${pkgId}`;

  try {
    const result = await updatePackage(fullId, flags);
    if (result.success) {
      console.log(`Updated ${fullId}${result.version ? ` to v${result.version}` : ''}`);
    } else {
      console.error(`Failed to update ${fullId}: ${result.error}`);
      process.exit(1);
    }
  } catch (error) {
    console.error(`Update failed: ${error.message}`);
    process.exit(1);
  }
}

/**
 * Update a single package
 */
async function updatePackage(pkgId, flags) {
  const [kind, name] = parsePackageId(pkgId);
  const installPath = getPackagePath(pkgId);

  // Check if installed
  if (!fs.existsSync(installPath)) {
    return { success: false, error: 'Package not installed' };
  }

  // Get package info from registry
  const pkg = await getPackage(pkgId);
  if (!pkg) {
    return { success: false, error: 'Package not found in registry' };
  }

  console.log(`Updating ${pkgId}...`);

  // Handle npm packages
  if (pkg.npmPackage) {
    try {
      execSync(`npm install ${pkg.npmPackage}@latest`, {
        cwd: installPath,
        stdio: flags.verbose ? 'inherit' : 'pipe'
      });

      // Get new version
      const version = getInstalledVersion(installPath, pkg.npmPackage);

      // Update runtime.json
      updateRuntimeMetadata(installPath, { version, updatedAt: new Date().toISOString() });

      return { success: true, version };
    } catch (error) {
      return { success: false, error: error.message };
    }
  }

  // Handle pip packages
  if (pkg.pipPackage) {
    try {
      const venvPip = path.join(installPath, 'venv', 'bin', 'pip');
      execSync(`"${venvPip}" install --upgrade ${pkg.pipPackage}`, {
        stdio: flags.verbose ? 'inherit' : 'pipe'
      });

      // Get new version
      const versionOutput = execSync(`"${venvPip}" show ${pkg.pipPackage} | grep Version`, {
        encoding: 'utf-8'
      });
      const version = versionOutput.split(':')[1]?.trim();

      // Update runtime.json
      updateRuntimeMetadata(installPath, { version, updatedAt: new Date().toISOString() });

      return { success: true, version };
    } catch (error) {
      return { success: false, error: error.message };
    }
  }

  // Handle tarball packages - re-download
  if (kind === 'runtime' && !pkg.npmPackage && !pkg.pipPackage) {
    try {
      const { downloadRuntime } = await import('@learnrudi/registry-client');

      // Remove old version
      fs.rmSync(installPath, { recursive: true, force: true });

      // Download new version
      await downloadRuntime(name, pkg.version || 'latest', installPath, {
        onProgress: (p) => {
          if (flags.verbose) console.log(`  ${p.phase}...`);
        }
      });

      return { success: true, version: pkg.version };
    } catch (error) {
      return { success: false, error: error.message };
    }
  }

  return { success: false, error: 'Unknown package type' };
}

/**
 * Update all installed packages
 */
async function updateAll(flags) {
  console.log('Checking for updates...');

  const kinds = ['runtime', 'stack', 'skill'];
  let updated = 0;
  let failed = 0;

  for (const kind of kinds) {
    const dir = kind === 'runtime' ? PATHS.runtimes :
                kind === 'stack' ? PATHS.stacks : PATHS.prompts;

    if (!fs.existsSync(dir)) continue;

    const entries = fs.readdirSync(dir, { withFileTypes: true });

    for (const entry of entries) {
      if (!entry.isDirectory() || entry.name.startsWith('.')) continue;

      const pkgId = `${kind}:${entry.name}`;
      const result = await updatePackage(pkgId, flags);

      if (result.success) {
        console.log(`  ✓ ${pkgId}${result.version ? ` → v${result.version}` : ''}`);
        updated++;
      } else if (result.error !== 'Package not found in registry') {
        console.log(`  ✗ ${pkgId}: ${result.error}`);
        failed++;
      }
    }
  }

  console.log(`\nUpdated ${updated} package(s)${failed > 0 ? `, ${failed} failed` : ''}`);
}

/**
 * Get installed version from package.json
 */
function getInstalledVersion(installPath, npmPackage) {
  try {
    const pkgJsonPath = path.join(installPath, 'node_modules', npmPackage.replace('@', '').split('/')[0], 'package.json');
    if (fs.existsSync(pkgJsonPath)) {
      const pkgJson = JSON.parse(fs.readFileSync(pkgJsonPath, 'utf-8'));
      return pkgJson.version;
    }

    // Try root package.json
    const rootPkgPath = path.join(installPath, 'package.json');
    if (fs.existsSync(rootPkgPath)) {
      const rootPkg = JSON.parse(fs.readFileSync(rootPkgPath, 'utf-8'));
      const dep = rootPkg.dependencies?.[npmPackage];
      if (dep) return dep.replace(/[\^~]/, '');
    }
  } catch {}
  return null;
}

/**
 * Update runtime.json metadata
 */
function updateRuntimeMetadata(installPath, updates) {
  const metaPath = path.join(installPath, 'runtime.json');
  try {
    let meta = {};
    if (fs.existsSync(metaPath)) {
      meta = JSON.parse(fs.readFileSync(metaPath, 'utf-8'));
    }
    meta = { ...meta, ...updates };
    fs.writeFileSync(metaPath, JSON.stringify(meta, null, 2));
  } catch {}
}
