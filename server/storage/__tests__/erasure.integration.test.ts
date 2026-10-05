import { foodFavorites, foodLogEntries, foods, foodServings, recipeIngredients, recipes, users } from "@shared/schema";
import { eq, sql } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it } from "vitest";

import { db } from "../../db";
import { ERASED_CUSTOM_FOOD_NAME } from "../erasedAccountFoods";
import { storage } from "../index";
import { resetIntegrationDb, seedCustomFood, seedFoodLogEntry, seedUser } from "./integrationDb";

/** The restore drill's 0081 probe (script/restore-drill.ts): ownerless private custom foods. */
async function ownerlessPrivateCustomFoods(): Promise<number> {
  const { rows } = await db.execute<{ n: number }>(
    sql`SELECT count(*)::int AS n FROM foods WHERE source = 'custom' AND created_by_user_id IS NULL AND NOT is_public`,
  );
  return rows.at(0)?.n ?? -1;
}

/**
 * GDPR account erasure against the REAL schema. deleteUserAndPrivateCustomFoods
 * is the transaction production's DELETE /api/v1/account calls directly, and
 * until this suite it had zero executed coverage: users.test.ts never tests it,
 * account.test.ts mocks the method, and tables.cascade.test.ts is a static
 * schema assertion. A wrong predicate here would either leak a deleted
 * athlete's food names or abort the erasure AFTER their Clerk identity is gone.
 */
describe("UserStorage.deleteUserAndPrivateCustomFoods (real Postgres)", () => {
  const ALICE = "erasure-alice";
  const BOB = "erasure-bob";

  beforeEach(async () => {
    await resetIntegrationDb();
    await seedUser(ALICE);
    await seedUser(BOB);
  });

  afterAll(async () => {
    await resetIntegrationDb();
  });

  it("erases the user and their unreferenced private custom foods, returning exactly those ids", async () => {
    const privateUnreferenced = await seedCustomFood(ALICE, "Alice's secret oat bar");
    // Alice's own log entry on it must not block the delete — the user cascade
    // removes her rows before the reference-guarded food delete runs.
    await seedFoodLogEntry(ALICE, privateUnreferenced.id, "2026-08-01");

    const result = await storage.users.deleteUserAndPrivateCustomFoods(ALICE);

    expect(result).toEqual({ deleted: true, deletedFoodIds: [privateUnreferenced.id] });
    expect(await db.select().from(users).where(eq(users.id, ALICE))).toHaveLength(0);
    expect(await db.select().from(foods).where(eq(foods.id, privateUnreferenced.id))).toHaveLength(0);
    expect(await db.select().from(foodLogEntries).where(eq(foodLogEntries.userId, ALICE))).toHaveLength(0);
  });

  // D53 (CODEBASE_ANALYSIS_2026-10-03): such a food used to survive ownerless
  // and private with its name intact, tripping the restore drill's 0081 probe.
  it("hands a private food another athlete logged to them as their own copy, under a neutral name", async () => {
    // Bob logged Alice's food while it was public; Alice later re-privatised it.
    // A bare DELETE would hit the RESTRICT FK from Bob's entry and abort the
    // whole transaction — after the Clerk identity is already gone.
    const sharedThenPrivate = await seedCustomFood(ALICE, "Once-shared granola", { brand: "Alice's kitchen" });
    const bobsEntry = await seedFoodLogEntry(BOB, sharedThenPrivate.id, "2026-08-02");

    const result = await storage.users.deleteUserAndPrivateCustomFoods(ALICE);

    expect(result).toEqual({ deleted: true, deletedFoodIds: [sharedThenPrivate.id] });
    expect(await db.select().from(foods).where(eq(foods.id, sharedThenPrivate.id))).toHaveLength(0);
    // Bob's history keeps every number, on a food that is now his own.
    const [entry] = await db.select().from(foodLogEntries).where(eq(foodLogEntries.id, bobsEntry.id));
    expect(entry).toMatchObject({ userId: BOB, quantityG: 100 });
    const [copy] = await db.select().from(foods).where(eq(foods.id, entry.foodId));
    expect(copy).toMatchObject({
      source: "custom",
      createdByUserId: BOB,
      isPublic: false,
      name: ERASED_CUSTOM_FOOD_NAME,
      brand: null,
      caloriesPer100g: 100,
      proteinPer100g: 10,
      carbPer100g: 10,
      fatPer100g: 2,
    });
    expect(await ownerlessPrivateCustomFoods()).toBe(0);
  });

  it("hands a food over the same way when it sits in another athlete's recipe", async () => {
    const inBobsRecipe = await seedCustomFood(ALICE, "Alice's protein base");
    const bobsRecipeFood = await seedCustomFood(BOB, "Bob's smoothie");
    const [recipe] = await db
      .insert(recipes)
      .values({ userId: BOB, foodId: bobsRecipeFood.id, name: "Bob's smoothie", servings: 2 })
      .returning();
    const [ingredient] = await db
      .insert(recipeIngredients)
      .values({ recipeId: recipe.id, foodId: inBobsRecipe.id, quantityG: 50 })
      .returning();

    const result = await storage.users.deleteUserAndPrivateCustomFoods(ALICE);

    expect(result.deletedFoodIds).toEqual([inBobsRecipe.id]);
    expect(await db.select().from(foods).where(eq(foods.id, inBobsRecipe.id))).toHaveLength(0);
    const [line] = await db.select().from(recipeIngredients).where(eq(recipeIngredients.id, ingredient.id));
    const [copy] = await db.select().from(foods).where(eq(foods.id, line.foodId));
    expect(copy).toMatchObject({ createdByUserId: BOB, name: ERASED_CUSTOM_FOOD_NAME, isPublic: false });
    expect(line.quantityG).toBe(50);
    expect(await ownerlessPrivateCustomFoods()).toBe(0);
  });

  it("gives each referencing athlete a copy of their own, and moves their portions and favourite onto it", async () => {
    const CAROL = "erasure-carol";
    await seedUser(CAROL);
    const food = await seedCustomFood(ALICE, "Alice's flapjack");
    await seedFoodLogEntry(BOB, food.id, "2026-08-04");
    await seedFoodLogEntry(BOB, food.id, "2026-08-05");
    const carolsEntry = await seedFoodLogEntry(CAROL, food.id, "2026-08-04");
    await db.insert(foodServings).values({ foodId: food.id, label: "Bob's slice", grams: 60, createdByUserId: BOB });
    await db.insert(foodFavorites).values({ userId: BOB, foodId: food.id });

    await storage.users.deleteUserAndPrivateCustomFoods(ALICE);

    const bobsFoodIds = new Set(
      (await db.select().from(foodLogEntries).where(eq(foodLogEntries.userId, BOB))).map((entry) => entry.foodId),
    );
    const [carolsNow] = await db.select().from(foodLogEntries).where(eq(foodLogEntries.id, carolsEntry.id));
    // Both of Bob's entries share one copy; Carol has her own.
    expect(bobsFoodIds.size).toBe(1);
    const [bobsCopyId] = bobsFoodIds;
    expect(carolsNow.foodId).not.toBe(bobsCopyId);
    const [carolsCopy] = await db.select().from(foods).where(eq(foods.id, carolsNow.foodId));
    expect(carolsCopy.createdByUserId).toBe(CAROL);
    const [serving] = await db.select().from(foodServings).where(eq(foodServings.createdByUserId, BOB));
    expect(serving?.foodId).toBe(bobsCopyId);
    const [favourite] = await db.select().from(foodFavorites).where(eq(foodFavorites.userId, BOB));
    expect(favourite?.foodId).toBe(bobsCopyId);
    expect(await ownerlessPrivateCustomFoods()).toBe(0);
  });

  it("leaves PUBLIC custom foods in place (sharing was an explicit opt-in), owner set to null", async () => {
    const shared = await seedCustomFood(ALICE, "Alice's public oat bar", { isPublic: true });

    const result = await storage.users.deleteUserAndPrivateCustomFoods(ALICE);

    expect(result.deletedFoodIds).toEqual([]);
    const [row] = await db.select().from(foods).where(eq(foods.id, shared.id));
    expect(row).toMatchObject({ isPublic: true, createdByUserId: null });
  });

  it("never touches another athlete's foods or rows", async () => {
    const bobsPrivate = await seedCustomFood(BOB, "Bob's private food");
    await seedFoodLogEntry(BOB, bobsPrivate.id, "2026-08-03");
    await seedCustomFood(ALICE, "Alice's private food");

    await storage.users.deleteUserAndPrivateCustomFoods(ALICE);

    expect(await db.select().from(users).where(eq(users.id, BOB))).toHaveLength(1);
    const [food] = await db.select().from(foods).where(eq(foods.id, bobsPrivate.id));
    expect(food?.createdByUserId).toBe(BOB);
    expect(await db.select().from(foodLogEntries).where(eq(foodLogEntries.userId, BOB))).toHaveLength(1);
  });

  it("reports deleted:false for an unknown user and deletes nothing", async () => {
    const alicesFood = await seedCustomFood(ALICE, "Untouched");

    const result = await storage.users.deleteUserAndPrivateCustomFoods("nobody-here");

    expect(result).toEqual({ deleted: false, deletedFoodIds: [] });
    expect(await db.select().from(foods).where(eq(foods.id, alicesFood.id))).toHaveLength(1);
    expect(await db.select().from(users)).toHaveLength(2);
  });
});

// P17 (CODEBASE_ANALYSIS_2026-10-03): a run that fails before the Clerk step
// withdraws its own stamp, and only its own.
describe("UserStorage erasure stamp (real Postgres)", () => {
  const ATHLETE = "erasure-stamp-athlete";

  beforeEach(async () => {
    await resetIntegrationDb();
    await seedUser(ATHLETE);
  });

  afterAll(async () => {
    await resetIntegrationDb();
  });

  async function stampOf(id: string): Promise<Date | null | undefined> {
    const [row] = await db.select({ at: users.erasureRequestedAt }).from(users).where(eq(users.id, id));
    return row?.at;
  }

  it("returns the stamp it wrote, and null when the account already carries one", async () => {
    const first = new Date("2026-09-06T11:00:00.123Z");

    expect(await storage.users.markErasureRequested(ATHLETE, first)).toEqual(first);
    expect(await storage.users.markErasureRequested(ATHLETE, new Date("2026-09-06T11:05:00Z"))).toBeNull();
    expect(await stampOf(ATHLETE)).toEqual(first);
    expect(await storage.users.markErasureRequested("nobody-here")).toBeNull();
  });

  it("withdraws only the stamp it is given", async () => {
    const stamp = new Date("2026-09-06T11:00:00.456Z");
    await storage.users.markErasureRequested(ATHLETE, stamp);

    await storage.users.clearErasureRequest(ATHLETE, new Date("2026-09-06T10:00:00Z"));
    expect(await stampOf(ATHLETE)).toEqual(stamp);

    await storage.users.clearErasureRequest(ATHLETE, stamp);
    expect(await stampOf(ATHLETE)).toBeNull();
  });
});
