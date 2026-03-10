/**
 * Capitalize the first letter of a string
 * @param str - The string to capitalize
 * @returns The capitalized string
 */
export function capitalize(str: string): string {
  if (!str) return str;
  return str.charAt(0).toUpperCase() + str.slice(1);
}

/**
 * Convert a string to kebab-case and lowercase
 * Handles camelCase, PascalCase, spaces, and underscores
 * @param str - The string to slugify
 * @returns The slugified string
 */
export function slugify(str: string): string {
  if (!str) return str;

  return str
    .replace(/([a-z])([A-Z])/g, '$1-$2') // camelCase to kebab-case
    .replace(/[\s_]+/g, '-') // Replace spaces and underscores with hyphens
    .toLowerCase()
    .replace(/[^\w-]/g, '') // Remove non-word characters except hyphens
    .replace(/-+/g, '-') // Replace multiple hyphens with single hyphen
    .replace(/^-+|-+$/g, ''); // Remove leading/trailing hyphens
}

/**
 * Truncate a string to a specified length with ellipsis
 * @param str - The string to truncate
 * @param length - The maximum length before truncation
 * @returns The truncated string with ellipsis if needed
 */
export function truncate(str: string, length: number): string {
  if (!str || length <= 0) return '';
  if (str.length <= length) return str;
  return str.slice(0, length - 3) + '...';
}

/**
 * Convert camelCase or PascalCase string to kebab-case
 * @param str - The string to convert
 * @returns The kebab-case string
 */
export function camelToKebab(str: string): string {
  if (!str) return str;

  return str
    .replace(/([a-z])([A-Z])/g, '$1-$2') // Insert hyphen before uppercase letters
    .toLowerCase();
}
