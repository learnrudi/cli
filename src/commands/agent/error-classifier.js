export const ERROR_CATEGORIES = {
  TRANSIENT: 'transient',
  PERMANENT: 'permanent'
};

export const ERROR_CODES = {
  API_RATE_LIMIT: 'API_RATE_LIMIT',
  API_CONCURRENCY: 'API_CONCURRENCY',
  API_OVERLOADED: 'API_OVERLOADED',
  NETWORK_TIMEOUT: 'NETWORK_TIMEOUT',
  NETWORK_RESET: 'NETWORK_RESET',
  AUTH_FAILURE: 'AUTH_FAILURE',
  INVALID_MODEL: 'INVALID_MODEL',
  SPAWN_FAILURE: 'SPAWN_FAILURE',
  SIGKILL: 'SIGKILL',
  SIGNAL_N: 'SIGNAL_N',
  UNKNOWN: 'UNKNOWN'
};

const TRANSIENT_PATTERNS = [
  { pattern: /429|rate\.?limit/i, code: ERROR_CODES.API_RATE_LIMIT },
  { pattern: /tool\.use\.concurrency|concurrent tool/i, code: ERROR_CODES.API_CONCURRENCY },
  { pattern: /529|overloaded/i, code: ERROR_CODES.API_OVERLOADED },
  { pattern: /ETIMEDOUT|ESOCKETTIMEDOUT/i, code: ERROR_CODES.NETWORK_TIMEOUT },
  { pattern: /ECONNRESET|ECONNREFUSED/i, code: ERROR_CODES.NETWORK_RESET }
];

const PERMANENT_PATTERNS = [
  { pattern: /401|unauthorized|403|forbidden|authentication_failed/i, code: ERROR_CODES.AUTH_FAILURE },
  { pattern: /invalid.*model|model.*not found/i, code: ERROR_CODES.INVALID_MODEL },
  { pattern: /ENOENT.*spawn/i, code: ERROR_CODES.SPAWN_FAILURE }
];

export function classifyError(text, exitCode) {
  // Check exit code patterns first
  if (exitCode === 137) {
    return {
      category: ERROR_CATEGORIES.PERMANENT,
      code: ERROR_CODES.SIGKILL,
      retryable: false
    };
  }

  if (exitCode > 128) {
    return {
      category: ERROR_CATEGORIES.PERMANENT,
      code: ERROR_CODES.SIGNAL_N,
      retryable: false
    };
  }

  // Handle null/undefined text gracefully
  const errorText = text || '';

  // Check transient patterns first
  for (const { pattern, code } of TRANSIENT_PATTERNS) {
    if (pattern.test(errorText)) {
      return {
        category: ERROR_CATEGORIES.TRANSIENT,
        code,
        retryable: true
      };
    }
  }

  // Check permanent patterns
  for (const { pattern, code } of PERMANENT_PATTERNS) {
    if (pattern.test(errorText)) {
      return {
        category: ERROR_CATEGORIES.PERMANENT,
        code,
        retryable: false
      };
    }
  }

  // Default to permanent (fail-safe)
  return {
    category: ERROR_CATEGORIES.PERMANENT,
    code: ERROR_CODES.UNKNOWN,
    retryable: false
  };
}

export function isRetryable(classification) {
  return classification.retryable === true;
}
