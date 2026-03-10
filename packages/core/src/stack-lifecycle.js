import fs from 'node:fs';
import path from 'node:path';
import { getSecret } from '@learnrudi/secrets';
import { discoverStackTools, TOOL_INDEX_PATH } from './tool-index.js';

/**
 * Check if stack is installed on disk
 * @param {string} stackId - Stack identifier
 * @param {Object} stackConfig - Stack config from rudi.json
 * @returns {{ passed: boolean, state: string, error: string|null, details: object }}
 */
export function checkInstalled(stackId, stackConfig) {
  try {
    // Check installed flag
    if (stackConfig.installed !== true) {
      return {
        passed: false,
        state: 'installed',
        error: 'Stack not marked as installed in config',
        details: { path: stackConfig.path }
      };
    }

    // Check stack directory exists
    if (!fs.existsSync(stackConfig.path)) {
      return {
        passed: false,
        state: 'installed',
        error: `Stack directory not found: ${stackConfig.path}`,
        details: { path: stackConfig.path }
      };
    }

    // Check manifest.json exists
    const manifestPath = path.join(stackConfig.path, 'manifest.json');
    if (!fs.existsSync(manifestPath)) {
      return {
        passed: false,
        state: 'installed',
        error: 'manifest.json not found in stack directory',
        details: { path: stackConfig.path }
      };
    }

    return {
      passed: true,
      state: 'installed',
      error: null,
      details: { path: stackConfig.path }
    };
  } catch (err) {
    return {
      passed: false,
      state: 'installed',
      error: err.message,
      details: { path: stackConfig.path }
    };
  }
}

/**
 * Check if stack is launchable (runtime and launch config valid)
 * @param {string} stackId - Stack identifier
 * @param {Object} stackConfig - Stack config from rudi.json
 * @returns {{ passed: boolean, state: string, error: string|null, details: object }}
 */
export function checkLaunchable(stackId, stackConfig) {
  try {
    const launch = stackConfig.launch;

    // Check launch config exists
    if (!launch) {
      return {
        passed: false,
        state: 'launchable',
        error: 'No launch configuration found',
        details: { bin: null, cwd: null }
      };
    }

    // Check bin exists
    if (!launch.bin) {
      return {
        passed: false,
        state: 'launchable',
        error: 'No launch bin specified',
        details: { bin: null, cwd: launch.cwd || stackConfig.path }
      };
    }

    if (!fs.existsSync(launch.bin)) {
      return {
        passed: false,
        state: 'launchable',
        error: `Launch bin not found: ${launch.bin}`,
        details: { bin: launch.bin, cwd: launch.cwd || stackConfig.path }
      };
    }

    // Check bin is executable
    try {
      fs.accessSync(launch.bin, fs.constants.X_OK);
    } catch (err) {
      return {
        passed: false,
        state: 'launchable',
        error: `Launch bin is not executable: ${launch.bin}`,
        details: { bin: launch.bin, cwd: launch.cwd || stackConfig.path }
      };
    }

    // Check cwd directory exists
    const cwd = launch.cwd || stackConfig.path;
    if (!fs.existsSync(cwd)) {
      return {
        passed: false,
        state: 'launchable',
        error: `Launch cwd directory not found: ${cwd}`,
        details: { bin: launch.bin, cwd }
      };
    }

    return {
      passed: true,
      state: 'launchable',
      error: null,
      details: { bin: launch.bin, cwd }
    };
  } catch (err) {
    return {
      passed: false,
      state: 'launchable',
      error: err.message,
      details: { bin: stackConfig.launch?.bin || null, cwd: stackConfig.launch?.cwd || stackConfig.path }
    };
  }
}

/**
 * Check if required secrets are available
 * @param {string} stackId - Stack identifier
 * @param {Object} stackConfig - Stack config from rudi.json
 * @returns {Promise<{ passed: boolean, state: string, error: string|null, details: object }>}
 */
export async function checkSecretsReady(stackId, stackConfig) {
  try {
    const secrets = stackConfig.secrets;

    // If no secrets or empty array, pass trivially
    if (!secrets || secrets.length === 0) {
      return {
        passed: true,
        state: 'secrets_ready',
        error: null,
        details: { missing: [], checked: 0 }
      };
    }

    const missing = [];
    let checked = 0;

    for (const entry of secrets) {
      // Normalize entry to { name, required }
      const secretName = typeof entry === 'string' ? entry : entry.name;
      const required = typeof entry === 'string' ? true : entry.required !== false;

      if (!required) {
        continue; // Skip optional secrets
      }

      checked++;
      const value = await getSecret(secretName);

      if (!value || value.trim() === '') {
        missing.push(secretName);
      }
    }

    if (missing.length > 0) {
      return {
        passed: false,
        state: 'secrets_ready',
        error: `Missing required secrets: ${missing.join(', ')}`,
        details: { missing, checked }
      };
    }

    return {
      passed: true,
      state: 'secrets_ready',
      error: null,
      details: { missing: [], checked }
    };
  } catch (err) {
    return {
      passed: false,
      state: 'secrets_ready',
      error: err.message,
      details: { missing: [], checked: 0 }
    };
  }
}

/**
 * Check if stack can complete MCP handshake and return tools
 * @param {string} stackId - Stack identifier
 * @param {Object} stackConfig - Stack config from rudi.json
 * @param {Object} [opts]
 * @param {number} [opts.timeout] - Timeout in ms
 * @param {(msg: string) => void} [opts.log] - Log function
 * @returns {Promise<{ passed: boolean, state: string, error: string|null, details: object }>}
 */
export async function checkMcpReady(stackId, stackConfig, opts = {}) {
  try {
    const result = await discoverStackTools(stackId, stackConfig, {
      timeout: opts.timeout || 15000,
      log: opts.log
    });

    // Check for discovery error
    if (result.error) {
      return {
        passed: false,
        state: 'mcp_ready',
        error: result.error,
        details: { toolCount: 0, tools: [] }
      };
    }

    // Check tools were returned
    if (!result.tools || result.tools.length === 0) {
      return {
        passed: false,
        state: 'mcp_ready',
        error: 'MCP handshake succeeded but no tools returned',
        details: { toolCount: 0, tools: [] }
      };
    }

    return {
      passed: true,
      state: 'mcp_ready',
      error: null,
      details: {
        toolCount: result.tools.length,
        tools: result.tools.map(t => t.name || t.qualifiedName)
      }
    };
  } catch (err) {
    return {
      passed: false,
      state: 'mcp_ready',
      error: err.message,
      details: { toolCount: 0, tools: [] }
    };
  }
}

/**
 * Check if stack tools are indexed in tool-index.json
 * @param {string} stackId - Stack identifier
 * @param {Object} stackConfig - Stack config from rudi.json
 * @returns {{ passed: boolean, state: string, error: string|null, details: object }}
 */
export function checkIndexed(stackId, stackConfig) {
  try {
    // Check if index file exists
    if (!fs.existsSync(TOOL_INDEX_PATH)) {
      return {
        passed: false,
        state: 'indexed',
        error: 'Tool index file not found',
        details: { toolCount: 0, indexPath: TOOL_INDEX_PATH }
      };
    }

    // Read and parse index
    const indexContent = fs.readFileSync(TOOL_INDEX_PATH, 'utf8');
    const index = JSON.parse(indexContent);

    // Look for entry under byStack with both possible key formats
    const byStack = index.byStack || index;
    const entry = byStack[stackId] || byStack[`stack:${stackId}`];

    if (!entry) {
      return {
        passed: false,
        state: 'indexed',
        error: `Stack not found in tool index`,
        details: { toolCount: 0, indexPath: TOOL_INDEX_PATH }
      };
    }

    // Check entry has no error
    if (entry.error) {
      return {
        passed: false,
        state: 'indexed',
        error: `Stack indexed with error: ${entry.error}`,
        details: { toolCount: entry.tools?.length || 0, indexPath: TOOL_INDEX_PATH }
      };
    }

    // Check entry has tools
    if (!entry.tools || entry.tools.length === 0) {
      return {
        passed: false,
        state: 'indexed',
        error: 'Stack indexed but has no tools',
        details: { toolCount: 0, indexPath: TOOL_INDEX_PATH }
      };
    }

    return {
      passed: true,
      state: 'indexed',
      error: null,
      details: { toolCount: entry.tools.length, indexPath: TOOL_INDEX_PATH }
    };
  } catch (err) {
    return {
      passed: false,
      state: 'indexed',
      error: err.message,
      details: { toolCount: 0, indexPath: TOOL_INDEX_PATH }
    };
  }
}

/**
 * Determine fix command based on failed state
 * @param {string|null} failedState
 * @param {string} stackId
 * @param {object} checkDetails - Details from the failed check
 * @returns {string|null}
 */
function determineFix(failedState, stackId, checkDetails) {
  if (!failedState) return null;

  switch (failedState) {
    case 'installed':
      return `rudi install stack:${stackId}`;
    case 'launchable':
      return 'Check stack runtime and launch configuration';
    case 'secrets_ready':
      // Use first missing secret if available
      const missing = checkDetails?.missing?.[0];
      return missing ? `rudi secrets set ${missing}` : 'rudi secrets set <SECRET_NAME>';
    case 'mcp_ready':
      return 'Check stack logs — launch may be failing';
    case 'indexed':
      return 'rudi index';
    default:
      return null;
  }
}

/**
 * Run all lifecycle checks in sequence
 * @param {string} stackId - Stack identifier
 * @param {Object} stackConfig - Stack config from rudi.json
 * @param {Object} [opts]
 * @param {number} [opts.timeout] - Timeout for MCP check
 * @param {(msg: string) => void} [opts.log] - Log function
 * @returns {Promise<{ stackId: string, finalState: string|null, healthy: boolean, checks: object[], failedAt: string|null, fixCommand: string|null }>}
 */
export async function checkStackLifecycle(stackId, stackConfig, opts = {}) {
  const checks = [];
  let finalState = null;
  let failedAt = null;
  let failedCheckDetails = null;

  // Run checks in order
  const checkSequence = [
    { name: 'installed', fn: () => checkInstalled(stackId, stackConfig) },
    { name: 'launchable', fn: () => checkLaunchable(stackId, stackConfig) },
    { name: 'secrets_ready', fn: () => checkSecretsReady(stackId, stackConfig) },
    { name: 'mcp_ready', fn: () => checkMcpReady(stackId, stackConfig, opts) },
    { name: 'indexed', fn: () => checkIndexed(stackId, stackConfig) }
  ];

  for (const check of checkSequence) {
    const result = await check.fn();
    checks.push(result);

    if (result.passed) {
      finalState = result.state;
    } else {
      failedAt = result.state;
      failedCheckDetails = result.details;
      break;
    }
  }

  const healthy = checks.every(c => c.passed);
  const fixCommand = determineFix(failedAt, stackId, failedCheckDetails);

  return {
    stackId,
    finalState,
    healthy,
    checks,
    failedAt,
    fixCommand
  };
}
