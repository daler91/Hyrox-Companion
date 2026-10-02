/**
 * Run `step` over `items` one at a time, in order, and collect what each
 * returns. For writes inside one transaction: they share a single database
 * client, and node-postgres deprecates overlapping queries on one client, so
 * Promise.all is not an option there. A step that rejects stops the rest, and
 * the returned promise rejects with its error.
 */
export function inSequence<T, R>(items: readonly T[], step: (item: T) => Promise<R>): Promise<R[]> {
  return items.reduce<Promise<R[]>>(async (done, item) => {
    const results = await done;
    results.push(await step(item));
    return results;
  }, Promise.resolve([]));
}
