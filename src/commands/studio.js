/**
 * RUDI Studio management commands
 *
 * Usage:
 *   rudi studio              Open RUDI Studio website
 *   rudi studio version      Show installed Studio version
 *   rudi studio uninstall    Uninstall RUDI Studio
 */

import fs from 'fs';
import path from 'path';
import os from 'os';
import { spawn } from 'child_process';
import { runCommand } from '../utils/subprocess.js';

const STUDIO_WEBSITE = 'https://learnrudi.com';

// Possible Studio app locations (checked first before mdfind)
const STUDIO_PATHS = {
  darwin: [
    '/Applications/RUDI Studio.app',
    path.join(os.homedir(), 'Applications/RUDI Studio.app')
  ],
  win32: [
    path.join(os.homedir(), 'AppData/Local/Programs/RUDI Studio'),
    'C:/Program Files/RUDI Studio'
  ],
  linux: [
    '/opt/RUDI Studio',
    path.join(os.homedir(), '.local/share/applications/rudi-studio')
  ]
};

// Application Support / data directories
const APP_DATA_PATHS = {
  darwin: [
    path.join(os.homedir(), 'Library/Application Support/RUDI Studio'),
    path.join(os.homedir(), 'Library/Application Support/rudi-studio'),
    path.join(os.homedir(), 'Library/Caches/RUDI Studio'),
    path.join(os.homedir(), 'Library/Caches/rudi-studio'),
    path.join(os.homedir(), 'Library/Preferences/com.rudi.studio.plist'),
    path.join(os.homedir(), 'Library/Saved Application State/com.rudi.studio.savedState')
  ],
  win32: [
    path.join(os.homedir(), 'AppData/Roaming/RUDI Studio'),
    path.join(os.homedir(), 'AppData/Local/RUDI Studio')
  ],
  linux: [
    path.join(os.homedir(), '.config/RUDI Studio'),
    path.join(os.homedir(), '.config/rudi-studio')
  ]
};

/**
 * Find installed Studio app path
 */
function findStudioPath() {
  const platform = process.platform;
  const paths = STUDIO_PATHS[platform] || [];

  // Check standard locations first
  for (const p of paths) {
    if (fs.existsSync(p)) {
      return p;
    }
  }

  // On macOS, use Spotlight to find the app anywhere
  if (platform === 'darwin') {
    try {
      const result = runCommand('mdfind', ["kMDItemCFBundleIdentifier == 'com.rudi.studio'"], {
        encoding: 'utf-8',
        timeout: 5000,
        stdio: ['pipe', 'pipe', 'ignore'],
      }).trim();

      if (result) {
        // mdfind returns paths separated by newlines, take the first one
        const foundPath = result.split('\n')[0];
        if (fs.existsSync(foundPath)) {
          return foundPath;
        }
      }

      // Fallback: search by name
      const nameResult = runCommand('mdfind', ["kMDItemDisplayName == 'RUDI Studio' && kMDItemContentType == 'com.apple.application-bundle'"], {
        encoding: 'utf-8',
        timeout: 5000,
        stdio: ['pipe', 'pipe', 'ignore'],
      }).trim();

      if (nameResult) {
        const foundPath = nameResult.split('\n')[0];
        if (fs.existsSync(foundPath)) {
          return foundPath;
        }
      }
    } catch {
      // mdfind failed, continue to return null
    }
  }

  return null;
}

/**
 * Get Studio version from Info.plist (macOS) or package.json
 */
function getStudioVersion(studioPath) {
  if (process.platform === 'darwin') {
    // macOS: read from Info.plist
    const plistPath = path.join(studioPath, 'Contents/Info.plist');
    if (fs.existsSync(plistPath)) {
      const content = fs.readFileSync(plistPath, 'utf-8');
      // Simple regex to extract CFBundleShortVersionString
      const match = content.match(/<key>CFBundleShortVersionString<\/key>\s*<string>([^<]+)<\/string>/);
      if (match) {
        return match[1];
      }
    }
  } else {
    // Windows/Linux: try package.json in resources
    const pkgPath = path.join(studioPath, 'resources/app/package.json');
    if (fs.existsSync(pkgPath)) {
      try {
        const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8'));
        return pkg.version;
      } catch {
        // Ignore parse errors
      }
    }
  }
  return null;
}

/**
 * Open URL in default browser
 */
function openUrl(url) {
  const platform = process.platform;
  let cmd, args;

  if (platform === 'darwin') {
    cmd = 'open';
    args = [url];
  } else if (platform === 'win32') {
    cmd = 'cmd';
    args = ['/c', 'start', '', url];
  } else {
    cmd = 'xdg-open';
    args = [url];
  }

  spawn(cmd, args, { detached: true, stdio: 'ignore' }).unref();
}

/**
 * Open Studio website
 */
async function studioOpen() {
  console.log(`Opening ${STUDIO_WEBSITE}...`);
  openUrl(STUDIO_WEBSITE);
}

/**
 * Show installed Studio version
 */
async function studioVersion(flags) {
  const studioPath = findStudioPath();

  if (!studioPath) {
    console.log('RUDI Studio is not installed');
    console.log(`\nGet it at: ${STUDIO_WEBSITE}`);
    process.exit(1);
  }

  const version = getStudioVersion(studioPath);

  if (version) {
    console.log(`RUDI Studio v${version}`);
  } else {
    console.log('RUDI Studio installed');
    console.log(`  Location: ${studioPath}`);
    console.log('  Version: unknown');
  }

  if (flags.verbose) {
    console.log(`\n  Path: ${studioPath}`);
  }
}

/**
 * Uninstall RUDI Studio
 */
async function studioUninstall(flags) {
  const studioPath = findStudioPath();
  const platform = process.platform;
  const dataPaths = APP_DATA_PATHS[platform] || [];

  // Check what exists
  const existingDataPaths = dataPaths.filter(p => fs.existsSync(p));

  if (!studioPath && existingDataPaths.length === 0) {
    console.log('RUDI Studio is not installed');
    process.exit(0);
  }

  // Show what will be removed
  console.log('The following will be removed:');
  if (studioPath) {
    console.log(`  App: ${studioPath}`);
  }
  for (const p of existingDataPaths) {
    console.log(`  Data: ${p}`);
  }
  console.log('');
  console.log('Note: ~/.rudi/ will NOT be removed (managed by RUDI CLI)');
  console.log('');

  // Confirm unless --force or -y
  if (!flags.force && !flags.y) {
    console.log('Run with --force or -y to confirm uninstall');
    process.exit(0);
  }

  // Perform uninstall
  let errors = [];

  if (studioPath) {
    try {
      fs.rmSync(studioPath, { recursive: true, force: true });
      console.log(`Removed: ${studioPath}`);
    } catch (err) {
      errors.push(`Failed to remove ${studioPath}: ${err.message}`);
    }
  }

  for (const p of existingDataPaths) {
    try {
      fs.rmSync(p, { recursive: true, force: true });
      console.log(`Removed: ${p}`);
    } catch (err) {
      errors.push(`Failed to remove ${p}: ${err.message}`);
    }
  }

  if (errors.length > 0) {
    console.log('');
    console.log('Some items could not be removed:');
    for (const err of errors) {
      console.log(`  ${err}`);
    }
    console.log('');
    console.log('You may need to remove them manually or use sudo.');
    process.exit(1);
  }

  console.log('');
  console.log('RUDI Studio uninstalled successfully');
}

/**
 * Show help for studio command
 */
function showHelp() {
  console.log(`rudi studio - Manage RUDI Studio

Usage:
  rudi studio              Open RUDI website
  rudi studio version      Show installed Studio version
  rudi studio uninstall    Uninstall RUDI Studio

Options:
  --force, -y              Skip confirmation for uninstall
  --verbose                Show additional details

Examples:
  rudi studio              # Open learnrudi.com in browser
  rudi studio version      # Check installed version
  rudi studio uninstall -y # Remove Studio and app data
`);
}

/**
 * Main command handler
 */
export async function cmdStudio(args, flags) {
  const subcommand = args[0];

  switch (subcommand) {
    case 'version':
    case 'v':
      await studioVersion(flags);
      break;

    case 'uninstall':
    case 'remove':
    case 'rm':
      await studioUninstall(flags);
      break;

    case 'help':
    case '-h':
    case '--help':
      showHelp();
      break;

    case 'open':
    case undefined:
      await studioOpen();
      break;

    default:
      console.error(`Unknown subcommand: ${subcommand}`);
      console.error(`Run 'rudi studio help' for usage`);
      process.exit(1);
  }
}
