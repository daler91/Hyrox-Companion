import { beforeEach, describe, expect, it, vi } from "vitest";

const { selectMock, insertMock, deleteMock, getLastPortionsMock } = vi.hoisted(() => ({
  selectMock: vi.fn(),
  insertMock: vi.fn(),
  deleteMock: vi.fn(),
  getLastPortionsMock: vi.fn(),
}));

vi.mock("../../db", () => ({
  db: { select: selectMock, insert: insertMock, delete: deleteMock },
}));

// Isolate nutritionFavorites.ts from its collaborator: getLastPortions has its
// own db round-trip (a separate DISTINCT ON query) that the sort-order and
// concurrency tests elsewhere don't touch — real withPortionMemory is kept so
// the merge itself still runs.
vi.mock("../nutritionShared", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../nutritionShared")>()),
  getLastPortions: getLastPortionsMock,
}));

import { addFavorite, listFavorites, removeFavorite } from "../nutritionFavorites";

/**
 * server/storage/nutritionFavorites.ts moved out of the monolithic
 * NutritionStorage class (A8) with only a route-registration/method-name
 * partition test behind it (nutritionStorage.partition.test.ts) — nothing
 * exercises the actual query results. These pin the observable outcomes:
 * the portion-memory merge, the silent no-op on a duplicate favorite, and
 * the "was anything actually deleted" signal removeFavorite reports back.
 */

/** `select().from().innerJoin().where().orderBy()`. */
function favoritesSelectChain(rows: unknown[]) {
  const orderBy = vi.fn().mockResolvedValue(rows);
  const where = vi.fn().mockReturnValue({ orderBy });
  const innerJoin = vi.fn().mockReturnValue({ where });
  const from = vi.fn().mockReturnValue({ innerJoin });
  selectMock.mockReturnValueOnce({ from });
}

describe("listFavorites", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns an empty list when there are no favorites", async () => {
    favoritesSelectChain([]);
    getLastPortionsMock.mockResolvedValue(new Map());

    const result = await listFavorites("u1");

    expect(result).toEqual([]);
    expect(getLastPortionsMock).toHaveBeenCalledWith("u1", []);
  });

  it("attaches each favorite's last-used portion, and nulls for one never logged", async () => {
    const bar = { id: "food-bar", name: "Protein bar" };
    const apple = { id: "food-apple", name: "Apple" };
    favoritesSelectChain([{ food: bar }, { food: apple }]);
    getLastPortionsMock.mockResolvedValue(
      new Map([["food-bar", { quantityG: 45, mealType: "snack" }]]),
    );

    const result = await listFavorites("u1");

    expect(getLastPortionsMock).toHaveBeenCalledWith("u1", ["food-bar", "food-apple"]);
    expect(result).toEqual([
      { ...bar, lastQuantityG: 45, lastMealType: "snack" },
      { ...apple, lastQuantityG: null, lastMealType: null },
    ]);
  });
});

describe("addFavorite", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns the created row when the favorite is new", async () => {
    const row = { id: "fav-1", userId: "u1", foodId: "food-1" };
    const returning = vi.fn().mockResolvedValue([row]);
    const onConflictDoNothing = vi.fn().mockReturnValue({ returning });
    const values = vi.fn().mockReturnValue({ onConflictDoNothing });
    insertMock.mockReturnValue({ values });

    await expect(addFavorite("u1", "food-1")).resolves.toBe(row);
  });

  it("returns undefined without error when the food is already a favorite", async () => {
    // onConflictDoNothing means the INSERT affects zero rows on a duplicate;
    // RETURNING then yields nothing rather than throwing.
    const returning = vi.fn().mockResolvedValue([]);
    const onConflictDoNothing = vi.fn().mockReturnValue({ returning });
    const values = vi.fn().mockReturnValue({ onConflictDoNothing });
    insertMock.mockReturnValue({ values });

    await expect(addFavorite("u1", "food-1")).resolves.toBeUndefined();
  });
});

describe("removeFavorite", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns true when a favorite row was actually deleted", async () => {
    const where = vi.fn().mockReturnValue({ returning: vi.fn().mockResolvedValue([{ id: "fav-1" }]) });
    deleteMock.mockReturnValue({ where });

    await expect(removeFavorite("u1", "food-1")).resolves.toBe(true);
  });

  it("returns false when there was nothing to delete", async () => {
    const where = vi.fn().mockReturnValue({ returning: vi.fn().mockResolvedValue([]) });
    deleteMock.mockReturnValue({ where });

    await expect(removeFavorite("u1", "food-1")).resolves.toBe(false);
  });
});
