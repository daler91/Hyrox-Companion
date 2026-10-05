import { beforeEach, describe, expect, it, vi } from "vitest";

const { selectMock, insertMock, deleteMock, transactionMock } = vi.hoisted(() => ({
  selectMock: vi.fn(),
  insertMock: vi.fn(),
  deleteMock: vi.fn(),
  transactionMock: vi.fn(),
}));

vi.mock("../../db", () => ({
  db: { select: selectMock, insert: insertMock, delete: deleteMock, transaction: transactionMock },
}));

import type { Food, UpdateCustomFoodInput } from "@shared/schema";

import { AppError, ErrorCode } from "../../errors";
import {
  createServing,
  deleteCustomFood,
  deleteServing,
  RECIPE_FOOD_DELETE_CONFLICT,
  SHARED_FOOD_EDIT_CONFLICT,
  updateCustomFood,
} from "../nutritionFoods";

/**
 * server/storage/nutritionFoods.ts moved out of the monolithic
 * NutritionStorage class (A8) with only a route-registration/method-name
 * partition test (nutritionStorage.partition.test.ts) behind it — nothing
 * exercises the actual query results. These pin deleteCustomFood's 409
 * conflict (a food referenced by a log entry or recipe can't be deleted),
 * and the ownership/idempotency branches of createServing and deleteServing.
 */

/** `select(...).from(...).where(...)`, resolving directly (no orderBy/limit). */
function selectWhereChain(rows: unknown[]) {
  const where = vi.fn().mockResolvedValue(rows);
  const from = vi.fn().mockReturnValue({ where });
  selectMock.mockReturnValueOnce({ from });
  return { from, where };
}

describe("deleteCustomFood", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns false without querying further when the food isn't the user's own custom food", async () => {
    selectWhereChain([]); // food lookup: no match

    await expect(deleteCustomFood("u1", "food-1")).resolves.toBe(false);
    expect(selectMock).toHaveBeenCalledTimes(1);
    expect(deleteMock).not.toHaveBeenCalled();
  });

  it("throws a 409 CONFLICT and does not delete when the food is referenced by a log entry", async () => {
    selectWhereChain([{ id: "food-1" }]); // food lookup: found
    selectWhereChain([]); // not a recipe's backing food
    selectWhereChain([{ logs: 1 }]); // log-entry count
    selectWhereChain([{ ings: 0 }]); // recipe-ingredient count

    const error = await deleteCustomFood("u1", "food-1").catch((e) => e);

    expect(error).toBeInstanceOf(AppError);
    expect(error.code).toBe(ErrorCode.CONFLICT);
    expect(error.status).toBe(409);
    expect(deleteMock).not.toHaveBeenCalled();
  });

  it("throws a 409 CONFLICT when the food is referenced by a recipe ingredient", async () => {
    selectWhereChain([{ id: "food-1" }]);
    selectWhereChain([]);
    selectWhereChain([{ logs: 0 }]);
    selectWhereChain([{ ings: 1 }]);

    await expect(deleteCustomFood("u1", "food-1")).rejects.toMatchObject({
      code: ErrorCode.CONFLICT,
      status: 409,
    });
    expect(deleteMock).not.toHaveBeenCalled();
  });

  // C39 (CODEBASE_ANALYSIS_2026-10-03): recipes.food_id is ON DELETE RESTRICT,
  // so deleting a recipe's backing food here was a generic 500 every time.
  it("throws a 409 pointing at the recipe when the food backs a recipe", async () => {
    selectWhereChain([{ id: "food-1" }]); // food lookup: found
    selectWhereChain([{ id: "recipe-1" }]); // the recipe it backs

    await expect(deleteCustomFood("u1", "food-1")).rejects.toMatchObject({
      code: ErrorCode.CONFLICT,
      status: 409,
      message: RECIPE_FOOD_DELETE_CONFLICT,
    });
    // Decided before the reference counts are even read.
    expect(selectMock).toHaveBeenCalledTimes(2);
    expect(deleteMock).not.toHaveBeenCalled();
  });

  it("deletes and returns true when the food is unreferenced", async () => {
    selectWhereChain([{ id: "food-1" }]);
    selectWhereChain([]);
    selectWhereChain([{ logs: 0 }]);
    selectWhereChain([{ ings: 0 }]);
    const where = vi.fn().mockResolvedValue(undefined);
    deleteMock.mockReturnValue({ where });

    await expect(deleteCustomFood("u1", "food-1")).resolves.toBe(true);
    expect(deleteMock).toHaveBeenCalledTimes(1);
  });
});

describe("updateCustomFood", () => {
  // D18 (CODEBASE_ANALYSIS_2026-10-03): other athletes' log entries join this
  // row live, so once they reference it its name and macros must not change.
  const STORED = {
    id: "food-1",
    name: "Banana",
    brand: null,
    caloriesPer100g: 89,
    proteinPer100g: 1.1,
    carbPer100g: 22.8,
    fatPer100g: 0.3,
    fiberPer100g: 2.6,
    servingSizeG: 118,
    isPublic: true,
  } as unknown as Food;
  // What the edit dialog sends: every field, whether or not it changed.
  const RESAVE = {
    name: "Banana",
    brand: null,
    caloriesPer100g: 89,
    proteinPer100g: 1.1,
    carbPer100g: 22.8,
    fatPer100g: 0.3,
    fiberPer100g: 2.6,
    servingSizeG: 118,
    isPublic: true,
  } satisfies UpdateCustomFoodInput;

  const tx = { select: vi.fn(), update: vi.fn() };
  const updateSet = vi.fn();

  /** The athlete's recipes that use the food, read after a macro change (C40). */
  const dependentsWhere = vi.fn();

  /** `current` is the locked row (null = not the user's custom food);
   *  `otherLogs` / `otherRecipes` are the other-user reference probes. */
  function mockTx({
    current = STORED,
    otherLogs = [],
    otherRecipes = [],
  }: { current?: Food | null; otherLogs?: unknown[]; otherRecipes?: unknown[] } = {}) {
    dependentsWhere.mockResolvedValue([]);
    tx.select
      // the row lock
      .mockReturnValueOnce({ from: () => ({ where: () => ({ for: vi.fn().mockResolvedValue(current ? [current] : []) }) }) })
      // another user's log entry
      .mockReturnValueOnce({ from: () => ({ where: () => ({ limit: vi.fn().mockResolvedValue(otherLogs) }) }) })
      // another user's recipe ingredient
      .mockReturnValueOnce({
        from: () => ({ innerJoin: () => ({ where: () => ({ limit: vi.fn().mockResolvedValue(otherRecipes) }) }) }),
      })
      // after the write: the athlete's recipes that use the food (none here)
      .mockReturnValueOnce({ from: () => ({ innerJoin: () => ({ where: dependentsWhere }) }) });
    updateSet.mockReturnValue({ where: () => ({ returning: vi.fn().mockResolvedValue([{ ...STORED, updated: true }]) }) });
    tx.update.mockReturnValue({ set: updateSet });
    transactionMock.mockImplementation((cb: (handle: typeof tx) => Promise<unknown>) => cb(tx));
  }

  beforeEach(() => {
    vi.clearAllMocks();
    tx.select.mockReset();
  });

  it("returns undefined (404) without writing when the food isn't the user's own custom food", async () => {
    mockTx({ current: null });

    await expect(updateCustomFood("u1", "food-1", { ...RESAVE, caloriesPer100g: 1000 })).resolves.toBeUndefined();
    expect(tx.update).not.toHaveBeenCalled();
  });

  it("throws a 409 and does not write when another user has logged the food and the macros change", async () => {
    mockTx({ otherLogs: [{ id: "entry-of-u2" }] });

    const error = await updateCustomFood("u1", "food-1", { ...RESAVE, caloriesPer100g: 1000 }).catch((e) => e);

    expect(error).toBeInstanceOf(AppError);
    expect(error).toMatchObject({ code: ErrorCode.CONFLICT, status: 409, message: SHARED_FOOD_EDIT_CONFLICT });
    expect(tx.update).not.toHaveBeenCalled();
  });

  it("throws a 409 on a rename when another user's recipe uses the food", async () => {
    mockTx({ otherRecipes: [{ id: "ingredient-of-u2" }] });

    await expect(updateCustomFood("u1", "food-1", { ...RESAVE, name: "Anything" })).rejects.toMatchObject({
      status: 409,
    });
    expect(tx.update).not.toHaveBeenCalled();
  });

  it("allows a resave of unchanged values plus a serving-size or sharing change without probing references", async () => {
    mockTx({ otherLogs: [{ id: "entry-of-u2" }] });

    const result = await updateCustomFood("u1", "food-1", { ...RESAVE, servingSizeG: 120, isPublic: false });

    expect(result).toMatchObject({ updated: true });
    expect(updateSet).toHaveBeenCalledWith(expect.objectContaining({ servingSizeG: 120, isPublic: false }));
    // Only the row lock ran: no change to logged history, so no reference
    // check, and no macro change, so no recipe refresh either.
    expect(tx.select).toHaveBeenCalledTimes(1);
    expect(dependentsWhere).not.toHaveBeenCalled();
  });

  it("treats a value equal at float4 precision as unchanged", async () => {
    // The column is `real`: 1.1 is stored as Math.fround(1.1) and may read
    // back as that float widened to a double.
    mockTx({ current: { ...STORED, proteinPer100g: Math.fround(1.1) }, otherLogs: [{ id: "entry-of-u2" }] });

    await expect(updateCustomFood("u1", "food-1", RESAVE)).resolves.toMatchObject({ updated: true });
  });

  it("edits macros freely while no other user references the food", async () => {
    mockTx();

    await expect(updateCustomFood("u1", "food-1", { ...RESAVE, caloriesPer100g: 95 })).resolves.toMatchObject({
      updated: true,
    });
    expect(updateSet).toHaveBeenCalledWith(expect.objectContaining({ caloriesPer100g: 95 }));
    // C40: a macro change looks for the athlete's recipes built on the food,
    // so their backing foods can be recomputed in the same transaction.
    expect(dependentsWhere).toHaveBeenCalledTimes(1);
  });
});

describe("createServing", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns undefined (404) when the food isn't visible to the user", async () => {
    selectWhereChain([]); // getVisibleFoodById: no match

    await expect(createServing("u1", "food-1", { label: "Bowl", grams: 200 })).resolves.toBeUndefined();
    expect(selectMock).toHaveBeenCalledTimes(1);
    expect(insertMock).not.toHaveBeenCalled();
  });

  it("returns the existing serving instead of inserting a duplicate (case-insensitive label match)", async () => {
    selectWhereChain([{ id: "food-1" }]); // getVisibleFoodById: found
    const existing = { id: "serving-1", foodId: "food-1", label: "Bowl", grams: 200, createdByUserId: "u1" };
    selectWhereChain([existing]); // existing-serving lookup: found

    await expect(createServing("u1", "food-1", { label: "bowl", grams: 200 })).resolves.toBe(existing);
    expect(insertMock).not.toHaveBeenCalled();
  });

  it("inserts and returns a new personal serving when none matches yet", async () => {
    selectWhereChain([{ id: "food-1" }]); // getVisibleFoodById: found
    selectWhereChain([]); // existing-serving lookup: none

    const created = { id: "serving-2", foodId: "food-1", label: "Bowl", grams: 200, createdByUserId: "u1" };
    const returning = vi.fn().mockResolvedValue([created]);
    const values = vi.fn().mockReturnValue({ returning });
    insertMock.mockReturnValue({ values });

    await expect(createServing("u1", "food-1", { label: "Bowl", grams: 200 })).resolves.toBe(created);
    expect(values).toHaveBeenCalledWith({
      foodId: "food-1",
      label: "Bowl",
      grams: 200,
      createdByUserId: "u1",
    });
  });
});

describe("deleteServing", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  /** `select(...).from(...).innerJoin(...).where(...)`, resolving directly. */
  function servingLookupChain(rows: unknown[]) {
    const where = vi.fn().mockResolvedValue(rows);
    const innerJoin = vi.fn().mockReturnValue({ where });
    const from = vi.fn().mockReturnValue({ innerJoin });
    selectMock.mockReturnValueOnce({ from });
  }

  it("returns false (404) when the serving matches neither the personal-portion nor the food owner", async () => {
    servingLookupChain([]);

    await expect(deleteServing("u1", "serving-1")).resolves.toBe(false);
    expect(deleteMock).not.toHaveBeenCalled();
  });

  it("deletes and returns true when the user owns the personal portion", async () => {
    servingLookupChain([{ id: "serving-1" }]);
    const where = vi.fn().mockResolvedValue(undefined);
    deleteMock.mockReturnValue({ where });

    await expect(deleteServing("u1", "serving-1")).resolves.toBe(true);
    expect(deleteMock).toHaveBeenCalledTimes(1);
  });

  it("deletes and returns true when the user owns the food the serving belongs to", async () => {
    // Same query shape — ownership is resolved entirely by the WHERE clause,
    // so a match via the food-owner branch looks identical to the caller.
    servingLookupChain([{ id: "serving-1" }]);
    const where = vi.fn().mockResolvedValue(undefined);
    deleteMock.mockReturnValue({ where });

    await expect(deleteServing("u2", "serving-1")).resolves.toBe(true);
  });
});
