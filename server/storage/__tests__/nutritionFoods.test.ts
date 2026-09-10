import { beforeEach, describe, expect, it, vi } from "vitest";

const { selectMock, insertMock, deleteMock } = vi.hoisted(() => ({
  selectMock: vi.fn(),
  insertMock: vi.fn(),
  deleteMock: vi.fn(),
}));

vi.mock("../../db", () => ({
  db: { select: selectMock, insert: insertMock, delete: deleteMock },
}));

import { AppError, ErrorCode } from "../../errors";
import { createServing, deleteCustomFood, deleteServing } from "../nutritionFoods";

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
    selectWhereChain([{ logs: 0 }]);
    selectWhereChain([{ ings: 1 }]);

    await expect(deleteCustomFood("u1", "food-1")).rejects.toMatchObject({
      code: ErrorCode.CONFLICT,
      status: 409,
    });
    expect(deleteMock).not.toHaveBeenCalled();
  });

  it("deletes and returns true when the food is unreferenced", async () => {
    selectWhereChain([{ id: "food-1" }]);
    selectWhereChain([{ logs: 0 }]);
    selectWhereChain([{ ings: 0 }]);
    const where = vi.fn().mockResolvedValue(undefined);
    deleteMock.mockReturnValue({ where });

    await expect(deleteCustomFood("u1", "food-1")).resolves.toBe(true);
    expect(deleteMock).toHaveBeenCalledTimes(1);
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
