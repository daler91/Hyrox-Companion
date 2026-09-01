import { foodLogEntries, foods, recipeIngredients, recipes, users } from "@shared/schema";
import { eq } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it } from "vitest";

import { db } from "../../db";
import { storage } from "../index";
import { resetIntegrationDb, seedCustomFood, seedFoodLogEntry, seedUser } from "./integrationDb";

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

  it("keeps a private food another athlete's history references, ownerless, instead of aborting the erasure", async () => {
    // Bob logged Alice's food while it was public; Alice later re-privatised it.
    // A bare DELETE would hit the RESTRICT FK from Bob's entry and abort the
    // whole transaction — after the Clerk identity is already gone.
    const sharedThenPrivate = await seedCustomFood(ALICE, "Once-shared granola");
    const bobsEntry = await seedFoodLogEntry(BOB, sharedThenPrivate.id, "2026-08-02");

    const result = await storage.users.deleteUserAndPrivateCustomFoods(ALICE);

    expect(result.deleted).toBe(true);
    expect(result.deletedFoodIds).toEqual([]);
    const [survivor] = await db.select().from(foods).where(eq(foods.id, sharedThenPrivate.id));
    expect(survivor).toBeDefined();
    expect(survivor.createdByUserId).toBeNull(); // FK set-null did its job
    expect(survivor.isPublic).toBe(false); // …and it stays hidden from search (visibleTo)
    // Bob's history keeps rendering: his entry still joins to the food.
    const [entry] = await db.select().from(foodLogEntries).where(eq(foodLogEntries.id, bobsEntry.id));
    expect(entry?.foodId).toBe(sharedThenPrivate.id);
  });

  it("guards on recipe references the same way as log entries", async () => {
    const inBobsRecipe = await seedCustomFood(ALICE, "Alice's protein base");
    const bobsRecipeFood = await seedCustomFood(BOB, "Bob's smoothie");
    const [recipe] = await db
      .insert(recipes)
      .values({ userId: BOB, foodId: bobsRecipeFood.id, name: "Bob's smoothie", servings: 2 })
      .returning();
    await db.insert(recipeIngredients).values({ recipeId: recipe.id, foodId: inBobsRecipe.id, quantityG: 50 });

    const result = await storage.users.deleteUserAndPrivateCustomFoods(ALICE);

    expect(result.deletedFoodIds).toEqual([]);
    expect(await db.select().from(foods).where(eq(foods.id, inBobsRecipe.id))).toHaveLength(1);
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
