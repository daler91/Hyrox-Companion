import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../db", () => ({ db: {} }));

import { db } from "../db";
import { AiUsageStorage } from "./aiUsage";

/**
 * Whether a drizzle SQL fragment's tree of query chunks contains a leaf value
 * matching `predicate`. Walks with a `seen` set because a real
 * PgTable/PgColumn has a circular `column.table === table` back-reference,
 * which a plain JSON.stringify cannot survive.
 */
function sqlContains(node: unknown, predicate: (value: unknown) => boolean, seen = new Set<unknown>()): boolean {
  if (predicate(node)) return true;
  if (typeof node !== "object" || node === null || seen.has(node)) return false;
  seen.add(node);
  const values = Array.isArray(node) ? node : Object.values(node as Record<string, unknown>);
  return values.some((value) => sqlContains(value, predicate, seen));
}

/** Program-order query-builder mock (mirrors recycleBinCapture.test.ts). */
function makeDb() {
  const results: unknown[] = [];
  const mock: Record<string, ReturnType<typeof vi.fn>> & { queue: (...next: unknown[]) => void } = {
    queue: (...next: unknown[]) => {
      results.push(...next);
    },
  } as never;
  for (const method of ["select", "from", "where"]) {
    mock[method] = vi.fn().mockReturnValue(mock);
  }
  mock.then = vi.fn((resolve: (value: unknown) => unknown) =>
    Promise.resolve(results.shift()).then(resolve),
  );
  return mock;
}

describe("AiUsageStorage daily totals", () => {
  const storage = new AiUsageStorage();

  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-20T12:00:00.000Z"));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("getDailyTotalCents scopes the 24h cutoff to one userId, and defaults a null sum to 0", async () => {
    const mock = makeDb();
    mock.queue([{ total: null }]);
    Object.assign(db, mock);

    const total = await storage.getDailyTotalCents("u1");

    expect(total).toBe(0);
    const whereArg = mock.where.mock.calls[0][0];
    // The WHERE clause must embed the userId argument — otherwise a
    // per-user total would leak everyone's spend.
    expect(sqlContains(whereArg, (v) => v === "u1")).toBe(true);
    // ...and the cutoff really is 24h back from now, not some other window.
    const expectedCutoffMs = new Date("2026-09-19T12:00:00.000Z").getTime();
    expect(sqlContains(whereArg, (v) => v instanceof Date && v.getTime() === expectedCutoffMs)).toBe(true);
  });

  it("getDailyTotalCents sums a user's cost over the last 24h", async () => {
    const mock = makeDb();
    mock.queue([{ total: 137 }]);
    Object.assign(db, mock);

    expect(await storage.getDailyTotalCents("u1")).toBe(137);
  });

  it("getGlobalDailyTotalCents sums across every user with the same 24h cutoff, and defaults a null sum to 0", async () => {
    const mock = makeDb();
    mock.queue([{ total: null }]);
    Object.assign(db, mock);

    const total = await storage.getGlobalDailyTotalCents();

    expect(total).toBe(0);
    const whereArg = mock.where.mock.calls[0][0];
    const expectedCutoffMs = new Date("2026-09-19T12:00:00.000Z").getTime();
    expect(sqlContains(whereArg, (v) => v instanceof Date && v.getTime() === expectedCutoffMs)).toBe(true);
  });

  it("getGlobalDailyTotalCents sums every user's cost, not one user's", async () => {
    const mock = makeDb();
    mock.queue([{ total: 5000 }]);
    Object.assign(db, mock);

    expect(await storage.getGlobalDailyTotalCents()).toBe(5000);
    // Called with no userId at all: nothing to scope the WHERE clause to.
    expect(mock.where).toHaveBeenCalledTimes(1);
  });
});
