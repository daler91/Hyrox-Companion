import { vi } from "vitest";

/**
 * Program-order query-builder mock (mirrors recycleBinCapture.test.ts'
 * `makeTx`): every chain method returns the mock itself, which is a
 * thenable resolving the next queued result, so a query can end on `where`,
 * `orderBy`, `limit` or `onConflictDoUpdate` alike. Queue results in the
 * order the code awaits them.
 */
export function makeQueryBuilderMock(methods: readonly string[]) {
  const results: unknown[] = [];
  const chainMethods = Object.fromEntries(methods.map((method) => [method, vi.fn()]));
  const mock: Record<string, ReturnType<typeof vi.fn>> & { queue: (...next: unknown[]) => void } = {
    ...chainMethods,
    queue: (...next: unknown[]) => {
      results.push(...next);
    },
  } as never; // NOSONAR partial Drizzle query-builder mock
  for (const fn of Object.values(chainMethods)) {
    fn.mockReturnValue(mock);
  }
  mock.then = vi.fn((resolve: (value: unknown) => unknown) =>
    Promise.resolve(results.shift()).then(resolve),
  );
  return mock;
}
