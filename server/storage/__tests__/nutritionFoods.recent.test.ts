import { beforeEach, describe, expect, it, vi } from "vitest";

const { selectMock, selectDistinctOnMock } = vi.hoisted(() => ({
  selectMock: vi.fn(),
  selectDistinctOnMock: vi.fn(),
}));

vi.mock("../../db", () => ({
  db: { select: selectMock, selectDistinctOn: selectDistinctOnMock },
}));

import { getRecentFoods } from "../nutritionFoods";

/**
 * getRecentFoods ranks the user's logged foods in SQL, then re-hydrates them
 * from the foods table. The hydration step has to keep the SQL ranking (the
 * foods query returns rows in arbitrary order) and silently drop ids the user
 * can no longer see (e.g. another user's custom food that was un-shared).
 */

/** `select(...).from(...).where(...).groupBy(...).orderBy(...).limit(...)` — the ranking query. */
function rankingChain(rows: unknown[]) {
  const limit = vi.fn().mockResolvedValue(rows);
  const orderBy = vi.fn().mockReturnValue({ limit });
  const groupBy = vi.fn().mockReturnValue({ orderBy });
  const where = vi.fn().mockReturnValue({ groupBy });
  const from = vi.fn().mockReturnValue({ where });
  selectMock.mockReturnValueOnce({ from });
  return { limit };
}

/** `select().from().where()` resolving directly — the visible-foods hydration query. */
function foodsChain(rows: unknown[]) {
  const where = vi.fn().mockResolvedValue(rows);
  const from = vi.fn().mockReturnValue({ where });
  selectMock.mockReturnValueOnce({ from });
}

/** `selectDistinctOn(...).from().where().orderBy()` — the last-portion lookup. */
function portionsChain(rows: unknown[]) {
  const orderBy = vi.fn().mockResolvedValue(rows);
  const where = vi.fn().mockReturnValue({ orderBy });
  const from = vi.fn().mockReturnValue({ where });
  selectDistinctOnMock.mockReturnValueOnce({ from });
}

const food = (id: string) => ({ id, name: `Food ${id}` });

describe("getRecentFoods", () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it("returns [] without hydrating foods or portions when the user has logged nothing", async () => {
    rankingChain([]);

    await expect(getRecentFoods("u1")).resolves.toEqual([]);
    expect(selectMock).toHaveBeenCalledTimes(1);
    expect(selectDistinctOnMock).not.toHaveBeenCalled();
  });

  it("passes the limit through to the ranking query", async () => {
    const { limit } = rankingChain([]);

    await getRecentFoods("u1", 5);

    expect(limit).toHaveBeenCalledWith(5);
  });

  it("keeps the ranking order even when the foods query returns rows in a different order", async () => {
    rankingChain([{ foodId: "b" }, { foodId: "c" }, { foodId: "a" }]);
    foodsChain([food("a"), food("b"), food("c")]);
    portionsChain([]);

    const result = await getRecentFoods("u1");

    expect(result.map((f) => f.id)).toEqual(["b", "c", "a"]);
  });

  it("drops ranked foods the user can no longer see", async () => {
    rankingChain([{ foodId: "a" }, { foodId: "gone" }, { foodId: "c" }]);
    foodsChain([food("a"), food("c")]);
    portionsChain([]);

    const result = await getRecentFoods("u1");

    expect(result.map((f) => f.id)).toEqual(["a", "c"]);
  });

  it("attaches the last portion to foods that have one and nulls to those that don't", async () => {
    rankingChain([{ foodId: "a" }, { foodId: "b" }]);
    foodsChain([food("a"), food("b")]);
    portionsChain([{ foodId: "b", quantityG: 150, mealType: "lunch" }]);

    const result = await getRecentFoods("u1");

    expect(result).toEqual([
      { ...food("a"), lastQuantityG: null, lastMealType: null },
      { ...food("b"), lastQuantityG: 150, lastMealType: "lunch" },
    ]);
  });
});
