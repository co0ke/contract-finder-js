/**
 * The LINQ operators the C# code leaned on, for arrays and iterables. Pure and domain-free; anything that
 * knows about jobs, sources or storage belongs next to its use instead.
 */

/**
 * The first item for each key, in order (LINQ DistinctBy).
 * @template T
 * @param {Iterable<T>} items
 * @param {(item: T) => unknown} keyOf
 * @returns {T[]}
 */
export function distinctBy(items, keyOf) {
  const seen = new Set();
  const distinct = [];
  for (const item of items) {
    const key = keyOf(item);
    if (!seen.has(key)) {
      seen.add(key);
      distinct.push(item);
    }
  }
  return distinct;
}

/**
 * Groups in first-appearance order (LINQ GroupBy).
 * @template T, K
 * @param {Iterable<T>} items
 * @param {(item: T) => K} keyOf
 * @returns {Map<K, T[]>}
 */
export function groupBy(items, keyOf) {
  const groups = new Map();
  for (const item of items) {
    const key = keyOf(item);
    const group = groups.get(key);
    if (group) {
      group.push(item);
    } else {
      groups.set(key, [item]);
    }
  }
  return groups;
}

/**
 * Consecutive slices of at most `size` (LINQ Chunk).
 * @template T
 * @param {ReadonlyArray<T>} items
 * @param {number} size
 * @returns {Generator<T[]>}
 */
export function* chunk(items, size) {
  if (!(Number.isInteger(size) && size > 0)) {
    throw new RangeError(`Chunk size must be a positive whole number, not ${size}.`);
  }
  for (let i = 0; i < items.length; i += size) {
    yield items.slice(i, i + size);
  }
}
