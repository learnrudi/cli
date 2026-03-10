/**
 * Split array into chunks of specified size
 * @param arr - Array to chunk
 * @param size - Size of each chunk
 * @returns Array of chunks
 */
export function chunk<T>(arr: T[], size: number): T[][] {
  if (size <= 0) {
    throw new Error('Chunk size must be greater than 0');
  }

  const chunks: T[][] = [];
  for (let i = 0; i < arr.length; i += size) {
    chunks.push(arr.slice(i, i + size));
  }
  return chunks;
}

/**
 * Get unique elements from array
 * @param arr - Array to deduplicate
 * @returns Array with unique elements (preserves order)
 */
export function unique<T>(arr: T[]): T[] {
  return Array.from(new Set(arr));
}

/**
 * Group array elements by a key
 * @param arr - Array to group
 * @param key - Property name or function that returns the grouping key
 * @returns Object with keys mapping to arrays of grouped items
 */
export function groupBy<T>(
  arr: T[],
  key: string | ((item: T) => string)
): Record<string, T[]> {
  const result: Record<string, T[]> = {};

  const getKey = typeof key === 'function' ? key : (item: T) => String((item as Record<string, any>)[key as string]);

  for (const item of arr) {
    const groupKey = getKey(item);
    if (!result[groupKey]) {
      result[groupKey] = [];
    }
    result[groupKey].push(item);
  }

  return result;
}

/**
 * Sort array by a key
 * @param arr - Array to sort
 * @param key - Property name or function that returns the sort value
 * @returns New sorted array (does not mutate original)
 */
export function sortBy<T>(
  arr: T[],
  key: string | ((item: T) => any)
): T[] {
  const getSortValue = typeof key === 'function' ? key : (item: T) => (item as Record<string, any>)[key as string];

  return [...arr].sort((a, b) => {
    const aVal = getSortValue(a);
    const bVal = getSortValue(b);

    if (aVal < bVal) return -1;
    if (aVal > bVal) return 1;
    return 0;
  });
}
