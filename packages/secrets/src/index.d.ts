/**
 * Secrets Store - Simple file-based secret storage
 */

/**
 * Get the absolute path to the active secrets file
 */
export function getSecretsFilePath(): string;

/**
 * Load all secrets from storage
 */
export function loadSecrets(): Record<string, unknown>;

/**
 * Save all secrets to storage
 */
export function saveSecrets(secrets: Record<string, unknown>): void;

/**
 * Get a secret value
 */
export function getSecret(name: string): Promise<string | null>;

/**
 * Set a secret value
 */
export function setSecret(name: string, value: string): Promise<boolean>;

/**
 * Remove a secret
 */
export function removeSecret(name: string): Promise<boolean>;

/**
 * List all secret names
 */
export function listSecrets(): Promise<string[]>;

/**
 * Check if a secret exists
 */
export function hasSecret(name: string): Promise<boolean>;

/**
 * Get masked version of secrets (for display)
 */
export function getMaskedSecrets(): Promise<Record<string, string>>;

/**
 * Get storage backend info
 */
export function getStorageInfo(): {
  backend: string;
  file: string;
  permissions: string;
};

/**
 * Get all secrets (for internal use)
 */
export function getAllSecrets(): Record<string, unknown>;
