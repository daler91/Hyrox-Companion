/**
 * Run `step` over `items` one at a time, in order, and collect what each
 * returns. For writes inside one transaction: they share a single database
 * client, and node-postgres deprecates overlapping queries on one client, so
 * Promise.all is not an option there. Also for work that is kept to one item at
 * a time on purpose — calls to a rate-limited provider, a sweep that should not
 * flood the pool, requests that must replay in the order they were made. A step
 * that rejects stops the rest, and the returned promise rejects with its error.
 */
export function inSequence<T, R>(
  items: readonly T[],
  step: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  return items.reduce<Promise<R[]>>(async (done, item, index) => {
    const results = await done;
    results.push(await step(item, index));
    return results;
  }, Promise.resolve([]));
}

/**
 * `items` cut into consecutive runs of at most `size`, in order — the batches
 * for a query whose IN list or VALUES list would otherwise grow without bound.
 */
export function inChunks<T>(items: readonly T[], size: number): T[][] {
  if (!Number.isInteger(size) || size < 1) {
    throw new RangeError(`Chunk size must be a positive integer, got ${size}`);
  }
  const chunks: T[][] = [];
  for (let start = 0; start < items.length; start += size) {
    chunks.push(items.slice(start, start + size));
  }
  return chunks;
}
