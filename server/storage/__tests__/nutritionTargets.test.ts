import { beforeEach, describe, expect, it, vi } from "vitest";

import { db } from "../../db";
import { deleteMealTarget, getCurrentTarget, getMealTargetOverrides } from "../nutritionTargets";

vi.mock("../../db", () => {
  const db: Record<string, unknown> = { select: vi.fn(), delete: vi.fn() };
  return { db };
});

/**
 * server/storage/nutritionTargets.ts moved out of the monolithic
 * NutritionStorage class (A8) with only a route-registration/method-name
 * partition test (nutritionStorage.partition.test.ts) behind it — no test
 * exercises the actual query logic. These pin the two real behaviors:
 * getCurrentTarget's "no row" case and getMealTargetOverrides' per-meal
 * dedup (the rows arrive newest-effective-first; only the first row seen
 * for each meal type may win).
 */

/**
 * `select().from().where().orderBy()[.limit()]`. Real drizzle query builders
 * are themselves awaitable (a query resolves to its rows without `.limit()`
 * too), so `orderBy()` returns a resolved promise with `.limit()` attached —
 * one chain serves both getCurrentTarget (which calls `.limit(1)`) and
 * getMealTargetOverrides (which awaits the `orderBy()` result directly).
 */
function selectChain(rows: unknown[]) {
  const limit = vi.fn().mockResolvedValue(rows);
  const orderByResult = Object.assign(Promise.resolve(rows), { limit });
  const orderBy = vi.fn().mockReturnValue(orderByResult);
  const where = vi.fn().mockReturnValue({ orderBy });
  const from = vi.fn().mockReturnValue({ where });
  vi.mocked(db.select).mockReturnValueOnce({ from } as never);
  return { from, where, orderBy, limit };
}

describe("getCurrentTarget", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns the single row ordered newest-effective-first", async () => {
    const row = { userId: "u1", effectiveFrom: "2026-09-01", calories: 2500 };
    selectChain([row]);

    await expect(getCurrentTarget("u1", "2026-09-05")).resolves.toBe(row);
  });

  it("returns undefined when the user has no target effective by that date", async () => {
    selectChain([]);

    await expect(getCurrentTarget("u1", "2026-01-01")).resolves.toBeUndefined();
  });
});

describe("getMealTargetOverrides", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns an empty map when there are no overrides", async () => {
    selectChain([]);

    await expect(getMealTargetOverrides("u1", "2026-09-05")).resolves.toEqual(new Map());
  });

  it("keeps only the newest version of each meal, in a rows-ordered-desc world", async () => {
    // Rows arrive newest effectiveFrom first (per the query's orderBy); two
    // versions exist for breakfast, one for lunch.
    const breakfastNew = { mealType: "breakfast", effectiveFrom: "2026-09-03", carbG: 80 };
    const breakfastOld = { mealType: "breakfast", effectiveFrom: "2026-08-01", carbG: 60 };
    const lunch = { mealType: "lunch", effectiveFrom: "2026-08-15", carbG: 90 };
    selectChain([breakfastNew, breakfastOld, lunch]);

    const result = await getMealTargetOverrides("u1", "2026-09-05");

    expect(result.size).toBe(2);
    expect(result.get("breakfast")).toBe(breakfastNew);
    expect(result.get("lunch")).toBe(lunch);
  });
});

describe("deleteMealTarget", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("deletes only the given user's override for that meal", async () => {
    const where = vi.fn().mockResolvedValue(undefined);
    vi.mocked(db.delete).mockReturnValue({ where } as never);

    await deleteMealTarget("u1", "breakfast");

    expect(db.delete).toHaveBeenCalledTimes(1);
    expect(where).toHaveBeenCalledTimes(1);
  });
});
