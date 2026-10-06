import { foods, foodServings } from "@shared/schema";
import { asc, eq } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it } from "vitest";

import { db } from "../../db";
import { storage } from "../index";
import { RECIPE_FOOD_DELETE_CONFLICT, SHARED_FOOD_EDIT_CONFLICT } from "../nutritionFoods";
import { RECIPE_IN_RECIPE_CONFLICT, SHARED_RECIPE_EDIT_CONFLICT } from "../nutritionRecipes";
import { resetIntegrationDb, seedCustomFood, seedUser } from "./integrationDb";

/**
 * The nutrition storage layer against the REAL schema. Nutrition ships ON in
 * production, yet its 1,192-line storage class had only render-only SQL-shape
 * tests: no food-log row was ever written or read through Postgres in CI.
 * These cover the food-logging round trip, the visibility predicate that
 * once leaked deleted users' foods, ownership on entry writes, and the
 * one-version-per-day contract migration 0091 made the database enforce.
 */
describe("NutritionStorage (real Postgres)", () => {
  const ALICE = "nutri-alice";
  const BOB = "nutri-bob";
  const DAY = "2026-08-15";

  beforeEach(async () => {
    await resetIntegrationDb();
    await seedUser(ALICE);
    await seedUser(BOB);
  });

  afterAll(async () => {
    await resetIntegrationDb();
  });

  describe("visibility (visibleTo)", () => {
    it("shows an athlete their own private custom food, and nobody else's", async () => {
      const mine = await seedCustomFood(ALICE, "Alice's private oats");
      const theirs = await seedCustomFood(BOB, "Bob's private rice");

      expect(await storage.nutrition.getVisibleFoodById(ALICE, mine.id)).toMatchObject({ id: mine.id });
      expect(await storage.nutrition.getVisibleFoodById(ALICE, theirs.id)).toBeUndefined();
    });

    it("shows a PUBLIC custom food to everyone, including one whose owner is gone", async () => {
      const shared = await seedCustomFood(BOB, "Bob's shared granola", { isPublic: true });
      const orphanedPublic = await seedCustomFood(BOB, "Orphaned public", { isPublic: true, createdByUserId: null });
      const orphanedPrivate = await seedCustomFood(BOB, "Orphaned private", { createdByUserId: null });

      expect(await storage.nutrition.getVisibleFoodById(ALICE, shared.id)).toMatchObject({ id: shared.id });
      expect(await storage.nutrition.getVisibleFoodById(ALICE, orphanedPublic.id)).toMatchObject({ id: orphanedPublic.id });
      // The round-1 GDPR leak: a NULL owner must never read as "shared".
      expect(await storage.nutrition.getVisibleFoodById(ALICE, orphanedPrivate.id)).toBeUndefined();
    });
  });

  describe("food logging round trip", () => {
    it("writes an entry and reads it back joined to its food, scoped to the athlete", async () => {
      const oats = await seedCustomFood(ALICE, "Alice's oats");

      const entry = await storage.nutrition.createLogEntry(ALICE, {
        foodId: oats.id,
        quantityG: 80,
        mealType: "breakfast",
        loggedAt: new Date(`${DAY}T07:30:00Z`),
        logDate: DAY,
      });
      expect(entry).toMatchObject({ userId: ALICE, foodId: oats.id, quantityG: 80, entryMethod: "manual" });

      const alicesDay = await storage.nutrition.listEntriesWithFoodForDate(ALICE, DAY);
      expect(alicesDay).toHaveLength(1);
      expect(alicesDay[0]).toMatchObject({ id: entry.id, food: { id: oats.id, name: "Alice's oats" } });

      expect(await storage.nutrition.listEntriesWithFoodForDate(BOB, DAY)).toEqual([]);
      expect(await storage.nutrition.listEntriesWithFoodForDate(ALICE, "2026-08-16")).toEqual([]);
      expect(await storage.nutrition.hasEntriesOnDate(ALICE, DAY)).toBe(true);
      expect(await storage.nutrition.hasEntriesOnDate(BOB, DAY)).toBe(false);
    });

    it("only the owner can update or delete an entry", async () => {
      const oats = await seedCustomFood(ALICE, "Alice's oats");
      const entry = await storage.nutrition.createLogEntry(ALICE, {
        foodId: oats.id,
        quantityG: 80,
        mealType: "breakfast",
        loggedAt: new Date(`${DAY}T07:30:00Z`),
        logDate: DAY,
      });

      expect(await storage.nutrition.updateLogEntry(BOB, entry.id, { quantityG: 500 })).toBeUndefined();
      expect(await storage.nutrition.deleteLogEntry(BOB, entry.id)).toBe(false);
      expect(await storage.nutrition.listEntriesWithFoodForDate(ALICE, DAY)).toHaveLength(1);

      expect(await storage.nutrition.updateLogEntry(ALICE, entry.id, { quantityG: 120 })).toMatchObject({ quantityG: 120 });
      expect(await storage.nutrition.deleteLogEntry(ALICE, entry.id)).toBe(true);
      expect(await storage.nutrition.listEntriesWithFoodForDate(ALICE, DAY)).toEqual([]);
    });
  });

  describe("editing a shared custom food (D18, CODEBASE_ANALYSIS_2026-10-03)", () => {
    // Log entries store only foodId + quantityG and join `foods` live, so an
    // in-place edit of a food someone else logged rewrites THEIR history.
    // The edit dialog resends every field, so the payloads here do too.
    const BANANA = {
      name: "Banana",
      brand: null,
      caloriesPer100g: 89,
      proteinPer100g: 1.1,
      carbPer100g: 22.8,
      fatPer100g: 0.3,
      fiberPer100g: 2.6,
      servingSizeG: 118,
    };

    async function seedSharedBananaLoggedByAlice() {
      const banana = await seedCustomFood(BOB, BANANA.name, { ...BANANA, isPublic: true });
      await storage.nutrition.createLogEntry(ALICE, {
        foodId: banana.id,
        quantityG: 120,
        mealType: "breakfast",
        loggedAt: new Date(`${DAY}T07:30:00Z`),
        logDate: DAY,
      });
      return banana;
    }

    it("refuses to change the macros or name, and Alice's logged nutrition stays as she logged it", async () => {
      const banana = await seedSharedBananaLoggedByAlice();

      await expect(
        storage.nutrition.updateCustomFood(BOB, banana.id, { ...BANANA, isPublic: true, caloriesPer100g: 1000, proteinPer100g: 0 }),
      ).rejects.toMatchObject({ status: 409, message: SHARED_FOOD_EDIT_CONFLICT });
      await expect(
        storage.nutrition.updateCustomFood(BOB, banana.id, { ...BANANA, isPublic: true, name: "Anything at all" }),
      ).rejects.toMatchObject({ status: 409 });
      // Unsharing first doesn't unlock it: Alice's entry still points at the row.
      await storage.nutrition.updateCustomFood(BOB, banana.id, { ...BANANA, isPublic: false });
      await expect(
        storage.nutrition.updateCustomFood(BOB, banana.id, { ...BANANA, isPublic: false, caloriesPer100g: 1000 }),
      ).rejects.toMatchObject({ status: 409 });

      const [entry] = await storage.nutrition.listEntriesWithFoodForDate(ALICE, DAY);
      expect(entry.food).toMatchObject({ name: "Banana", caloriesPer100g: 89, proteinPer100g: 1.1, carbPer100g: 22.8 });
    });

    it("still lets the owner resave unchanged values, change the serving size and toggle sharing", async () => {
      const banana = await seedSharedBananaLoggedByAlice();

      const updated = await storage.nutrition.updateCustomFood(BOB, banana.id, {
        ...BANANA,
        servingSizeG: 120,
        isPublic: false,
      });

      expect(updated).toMatchObject({ servingSizeG: 120, isPublic: false, caloriesPer100g: 89 });
    });

    it("refuses when another athlete's recipe uses the food", async () => {
      const banana = await seedCustomFood(BOB, BANANA.name, { ...BANANA, isPublic: true });
      await storage.nutrition.createRecipe(ALICE, {
        name: "Smoothie",
        servings: 1,
        ingredients: [{ foodId: banana.id, quantityG: 120 }],
      });

      await expect(
        storage.nutrition.updateCustomFood(BOB, banana.id, { ...BANANA, carbPer100g: 50 }),
      ).rejects.toMatchObject({ status: 409 });
    });

    it("lets the owner edit freely while only their own entries reference it", async () => {
      const banana = await seedCustomFood(BOB, BANANA.name, { ...BANANA, isPublic: true });
      await storage.nutrition.createLogEntry(BOB, {
        foodId: banana.id,
        quantityG: 120,
        mealType: "breakfast",
        loggedAt: new Date(`${DAY}T07:30:00Z`),
        logDate: DAY,
      });

      expect(
        await storage.nutrition.updateCustomFood(BOB, banana.id, { ...BANANA, caloriesPer100g: 95, name: "Ripe banana" }),
      ).toMatchObject({ caloriesPer100g: 95, name: "Ripe banana" });
    });

    it("is still a 404 (undefined) for someone else's food", async () => {
      const banana = await seedSharedBananaLoggedByAlice();

      expect(await storage.nutrition.updateCustomFood(ALICE, banana.id, { ...BANANA, caloriesPer100g: 1000 })).toBeUndefined();
    });

    it("won't share or edit a recipe's backing food directly (it changes only through its recipe)", async () => {
      const banana = await seedCustomFood(BOB, BANANA.name, BANANA);
      const recipe = await storage.nutrition.createRecipe(BOB, {
        name: "Smoothie",
        servings: 1,
        ingredients: [{ foodId: banana.id, quantityG: 120 }],
      });

      expect(await storage.nutrition.updateCustomFood(BOB, recipe.foodId, { isPublic: true })).toBeUndefined();
      const [backing] = await db.select().from(foods).where(eq(foods.id, recipe.foodId));
      expect(backing.isPublic).toBe(false);
    });

    it("refuses a recipe edit that would rewrite another athlete's log of its backing food", async () => {
      const banana = await seedCustomFood(BOB, BANANA.name, BANANA);
      const oats = await seedCustomFood(BOB, "Oats", { ...BANANA, name: "Oats", caloriesPer100g: 389 });
      const recipe = await storage.nutrition.createRecipe(BOB, {
        name: "Smoothie",
        servings: 1,
        ingredients: [{ foodId: banana.id, quantityG: 120 }],
      });
      // Shared before the direct PATCH stopped matching recipe foods.
      await db.update(foods).set({ isPublic: true }).where(eq(foods.id, recipe.foodId));
      await storage.nutrition.createLogEntry(ALICE, {
        foodId: recipe.foodId,
        quantityG: 120,
        mealType: "breakfast",
        loggedAt: new Date(`${DAY}T07:30:00Z`),
        logDate: DAY,
      });
      const [before] = await storage.nutrition.listEntriesWithFoodForDate(ALICE, DAY);

      await expect(
        storage.nutrition.updateRecipe(BOB, recipe.id, {
          name: "Oat smoothie",
          servings: 1,
          ingredients: [{ foodId: oats.id, quantityG: 120 }],
        }),
      ).rejects.toMatchObject({ status: 409, message: SHARED_RECIPE_EDIT_CONFLICT });

      const [after] = await storage.nutrition.listEntriesWithFoodForDate(ALICE, DAY);
      expect(after.food).toMatchObject({ name: "Smoothie", caloriesPer100g: before.food.caloriesPer100g });
    });

    it("still lets the owner edit a recipe nobody else has logged", async () => {
      const banana = await seedCustomFood(BOB, BANANA.name, BANANA);
      const recipe = await storage.nutrition.createRecipe(BOB, {
        name: "Smoothie",
        servings: 1,
        ingredients: [{ foodId: banana.id, quantityG: 120 }],
      });

      expect(
        await storage.nutrition.updateRecipe(BOB, recipe.id, {
          name: "Big smoothie",
          servings: 2,
          ingredients: [{ foodId: banana.id, quantityG: 240 }],
        }),
      ).toMatchObject({ name: "Big smoothie", servings: 2 });
    });
  });

  describe("deleting recipes and their backing foods (C39, CODEBASE_ANALYSIS_2026-10-03)", () => {
    // Both deletes used to hit an ON DELETE RESTRICT foreign key and answer a
    // generic 500 every time, so the item could never be deleted.
    async function seedGranola(owner: string) {
      const oats = await seedCustomFood(owner, "Oats");
      return storage.nutrition.createRecipe(owner, {
        name: "Granola",
        servings: 4,
        ingredients: [{ foodId: oats.id, quantityG: 200 }],
      });
    }

    function seedBowl(owner: string, foodId: string) {
      return storage.nutrition.createRecipe(owner, {
        name: "Breakfast bowl",
        servings: 1,
        ingredients: [{ foodId, quantityG: 60 }],
      });
    }

    it("refuses with a 409 while another of the athlete's recipes uses it, then deletes once it is removed", async () => {
      const granola = await seedGranola(BOB);
      const bowl = await seedBowl(BOB, granola.foodId);

      await expect(storage.nutrition.deleteRecipe(BOB, granola.id)).rejects.toMatchObject({
        status: 409,
        message: RECIPE_IN_RECIPE_CONFLICT,
      });
      expect(await storage.nutrition.getRecipeWithIngredients(BOB, granola.id)).not.toBeNull();
      expect(await storage.nutrition.getRecipeWithIngredients(BOB, bowl.id)).toMatchObject({
        ingredients: [expect.objectContaining({ foodId: granola.foodId })],
      });

      const yoghurt = await seedCustomFood(BOB, "Yoghurt");
      await storage.nutrition.updateRecipe(BOB, bowl.id, {
        name: "Breakfast bowl",
        servings: 1,
        ingredients: [{ foodId: yoghurt.id, quantityG: 150 }],
      });

      expect(await storage.nutrition.deleteRecipe(BOB, granola.id)).toBe(true);
      expect(await db.select().from(foods).where(eq(foods.id, granola.foodId))).toEqual([]);
    });

    it("deletes the recipe but keeps its food while another athlete's recipe uses it", async () => {
      const granola = await seedGranola(BOB);
      // Shared before D18 stopped recipe foods being shared.
      await db.update(foods).set({ isPublic: true }).where(eq(foods.id, granola.foodId));
      const alicesBowl = await seedBowl(ALICE, granola.foodId);

      expect(await storage.nutrition.deleteRecipe(BOB, granola.id)).toBe(true);

      expect(await storage.nutrition.getRecipeWithIngredients(BOB, granola.id)).toBeNull();
      expect(await db.select().from(foods).where(eq(foods.id, granola.foodId))).toHaveLength(1);
      expect(await storage.nutrition.getRecipeWithIngredients(ALICE, alicesBowl.id)).toMatchObject({
        ingredients: [expect.objectContaining({ foodId: granola.foodId })],
      });
    });

    it("refuses to delete a recipe's backing food as a custom food, and points at the recipe", async () => {
      const granola = await seedGranola(BOB);

      await expect(storage.nutrition.deleteCustomFood(BOB, granola.foodId)).rejects.toMatchObject({
        status: 409,
        message: RECIPE_FOOD_DELETE_CONFLICT,
      });
      expect(await storage.nutrition.getRecipeWithIngredients(BOB, granola.id)).not.toBeNull();
      // The recipe delete is the way out, and it takes the unlogged food with it.
      expect(await storage.nutrition.deleteRecipe(BOB, granola.id)).toBe(true);
      expect(await db.select().from(foods).where(eq(foods.id, granola.foodId))).toEqual([]);
    });
  });

  describe("recipes follow their ingredients' corrected macros (C40, CODEBASE_ANALYSIS_2026-10-03)", () => {
    // A recipe logs through its backing food, which was computed once at save;
    // the recipe views recompute from the ingredients live, so after an
    // ingredient was corrected the two disagreed until the recipe was re-saved.
    const OATS = { caloriesPer100g: 100, proteinPer100g: 10, carbPer100g: 60, fatPer100g: 5, fiberPer100g: 10 };

    async function backingFood(foodId: string) {
      const [row] = await db.select().from(foods).where(eq(foods.id, foodId));
      return row;
    }

    it("recomputes the backing food, so logging matches the recipe view", async () => {
      const oats = await seedCustomFood(BOB, "Oats", OATS);
      const porridge = await storage.nutrition.createRecipe(BOB, {
        name: "Porridge",
        servings: 2,
        ingredients: [{ foodId: oats.id, quantityG: 200 }],
      });
      await storage.nutrition.createLogEntry(BOB, {
        foodId: porridge.foodId,
        quantityG: 100,
        mealType: "breakfast",
        loggedAt: new Date(`${DAY}T07:30:00Z`),
        logDate: DAY,
      });

      await storage.nutrition.updateCustomFood(BOB, oats.id, { ...OATS, name: "Oats", caloriesPer100g: 150 });

      expect(await backingFood(porridge.foodId)).toMatchObject({ caloriesPer100g: 150, carbPer100g: 60 });
      const view = await storage.nutrition.getRecipeWithIngredients(BOB, porridge.id);
      expect(view?.perServing.calories).toBe(150); // 200 g × 150 / 100 ÷ 2 servings
      // The athlete's own log reads the food live, like a log of the oats themselves.
      const [entry] = await storage.nutrition.listEntriesWithFoodForDate(BOB, DAY);
      expect(entry.food.caloriesPer100g).toBe(150);
    });

    it("carries the correction through a recipe used inside another recipe", async () => {
      const oats = await seedCustomFood(BOB, "Oats", OATS);
      const milk = await seedCustomFood(BOB, "Milk", { ...OATS, caloriesPer100g: 50 });
      const porridge = await storage.nutrition.createRecipe(BOB, {
        name: "Porridge",
        servings: 1,
        ingredients: [{ foodId: oats.id, quantityG: 100 }],
      });
      const bowl = await storage.nutrition.createRecipe(BOB, {
        name: "Porridge bowl",
        servings: 1,
        ingredients: [
          { foodId: porridge.foodId, quantityG: 100 },
          { foodId: milk.id, quantityG: 100 },
        ],
      });
      expect(await backingFood(bowl.foodId)).toMatchObject({ caloriesPer100g: 75 });

      await storage.nutrition.updateCustomFood(BOB, oats.id, { ...OATS, caloriesPer100g: 200 });

      expect(await backingFood(porridge.foodId)).toMatchObject({ caloriesPer100g: 200 });
      expect(await backingFood(bowl.foodId)).toMatchObject({ caloriesPer100g: 125 }); // (200 + 50) / 2
    });

    function seedRecipe(name: string, ingredients: { foodId: string; quantityG: number }[]) {
      return storage.nutrition.createRecipe(BOB, { name, servings: 1, ingredients });
    }

    it("refreshes a recipe only after every recipe it uses, when it reaches the food two ways", async () => {
      const oats = await seedCustomFood(BOB, "Oats", OATS);
      const porridge = await seedRecipe("Porridge", [{ foodId: oats.id, quantityG: 100 }]);
      const bowl = await seedRecipe("Porridge bowl", [{ foodId: porridge.foodId, quantityG: 100 }]);
      // Uses the oats directly and, through the bowl, two recipes deep.
      const brunch = await seedRecipe("Brunch", [
        { foodId: bowl.foodId, quantityG: 100 },
        { foodId: oats.id, quantityG: 100 },
      ]);

      await storage.nutrition.updateCustomFood(BOB, oats.id, { ...OATS, caloriesPer100g: 300 });

      expect(await backingFood(porridge.foodId)).toMatchObject({ caloriesPer100g: 300 });
      expect(await backingFood(bowl.foodId)).toMatchObject({ caloriesPer100g: 300 });
      // Was 200: recomputed from the bowl before the bowl itself was refreshed.
      expect(await backingFood(brunch.foodId)).toMatchObject({ caloriesPer100g: 300 });
      const view = await storage.nutrition.getRecipeWithIngredients(BOB, brunch.id);
      expect(view?.perServing.calories).toBe(600); // 200 g at 300 kcal/100 g
    });

    it("carries a recipe edit through to the recipes that use it", async () => {
      const oats = await seedCustomFood(BOB, "Oats", OATS);
      const granola = await seedCustomFood(BOB, "Granola", { ...OATS, caloriesPer100g: 300 });
      const porridge = await seedRecipe("Porridge", [{ foodId: oats.id, quantityG: 100 }]);
      const bowl = await seedRecipe("Porridge bowl", [{ foodId: porridge.foodId, quantityG: 100 }]);

      await storage.nutrition.updateRecipe(BOB, porridge.id, {
        name: "Porridge",
        servings: 1,
        ingredients: [{ foodId: granola.id, quantityG: 100 }],
      });

      expect(await backingFood(porridge.foodId)).toMatchObject({ caloriesPer100g: 300 });
      expect(await backingFood(bowl.foodId)).toMatchObject({ caloriesPer100g: 300 });
      const view = await storage.nutrition.getRecipeWithIngredients(BOB, bowl.id);
      expect(view?.perServing.calories).toBe(300);
    });

    it("refreshes each recipe in a cycle once, and finishes", async () => {
      const oats = await seedCustomFood(BOB, "Oats", OATS);
      const porridge = await seedRecipe("Porridge", [{ foodId: oats.id, quantityG: 100 }]);
      const bowl = await seedRecipe("Porridge bowl", [{ foodId: porridge.foodId, quantityG: 100 }]);
      // Only a recipe including itself directly is refused, so this saves.
      await storage.nutrition.updateRecipe(BOB, porridge.id, {
        name: "Porridge",
        servings: 1,
        ingredients: [
          { foodId: oats.id, quantityG: 100 },
          { foodId: bowl.foodId, quantityG: 100 },
        ],
      });

      await storage.nutrition.updateCustomFood(BOB, oats.id, { ...OATS, caloriesPer100g: 300 });

      // The porridge was found first: (300 + the bowl's 100) / 2, then the bowl from it.
      expect(await backingFood(porridge.foodId)).toMatchObject({ caloriesPer100g: 200 });
      expect(await backingFood(bowl.foodId)).toMatchObject({ caloriesPer100g: 200 });
    });

    it("leaves a backing food another athlete has logged as it was (D18)", async () => {
      const oats = await seedCustomFood(BOB, "Oats", OATS);
      const porridge = await storage.nutrition.createRecipe(BOB, {
        name: "Porridge",
        servings: 1,
        ingredients: [{ foodId: oats.id, quantityG: 100 }],
      });
      // Shared before D18 stopped recipe foods being shared.
      await db.update(foods).set({ isPublic: true }).where(eq(foods.id, porridge.foodId));
      await storage.nutrition.createLogEntry(ALICE, {
        foodId: porridge.foodId,
        quantityG: 100,
        mealType: "breakfast",
        loggedAt: new Date(`${DAY}T07:30:00Z`),
        logDate: DAY,
      });

      await storage.nutrition.updateCustomFood(BOB, oats.id, { ...OATS, caloriesPer100g: 200 });

      expect(await backingFood(oats.id)).toMatchObject({ caloriesPer100g: 200 });
      const [alicesEntry] = await storage.nutrition.listEntriesWithFoodForDate(ALICE, DAY);
      expect(alicesEntry.food.caloriesPer100g).toBe(100);
    });
  });

  describe("versioned targets (one row per user+day, enforced by migration 0091)", () => {
    it("re-saving the same day replaces that version rather than stacking a duplicate", async () => {
      await storage.nutrition.createTarget(ALICE, { effectiveFrom: DAY, calories: 2000, proteinG: 150 });
      await storage.nutrition.createTarget(ALICE, { effectiveFrom: DAY, calories: 2100, proteinG: 160 });

      const versions = await storage.nutrition.listTargets(ALICE);
      expect(versions).toHaveLength(1);
      expect(versions[0]).toMatchObject({ effectiveFrom: DAY, calories: 2100, proteinG: 160 });
      expect(await storage.nutrition.getCurrentTarget(ALICE, DAY)).toMatchObject({ calories: 2100 });
    });

    it("keeps history across distinct effective dates and resolves the latest one on or before a date", async () => {
      await storage.nutrition.createTarget(ALICE, { effectiveFrom: "2026-08-01", calories: 1900 });
      await storage.nutrition.createTarget(ALICE, { effectiveFrom: "2026-08-20", calories: 2300 });

      expect(await storage.nutrition.getCurrentTarget(ALICE, "2026-08-15")).toMatchObject({ calories: 1900 });
      expect(await storage.nutrition.getCurrentTarget(ALICE, "2026-08-25")).toMatchObject({ calories: 2300 });
      expect(await storage.nutrition.getCurrentTarget(ALICE, "2026-07-31")).toBeUndefined();
      expect(await storage.nutrition.getCurrentTarget(BOB, "2026-08-25")).toBeUndefined();
    });
  });

  // PF11 (CODEBASE_ANALYSIS_2026-10-03): two first opens of a USDA food at once
  // both cached its portions, so it listed each one twice.
  describe("shared servings are stored once", () => {
    const PORTIONS = [
      { label: "1 bar", grams: 40 },
      { label: "2 bars", grams: 80 },
    ];

    async function servingRows(foodId: string) {
      return await db
        .select({ label: foodServings.label, grams: foodServings.grams, owner: foodServings.createdByUserId })
        .from(foodServings)
        .where(eq(foodServings.foodId, foodId))
        .orderBy(asc(foodServings.grams));
    }

    it("keeps one copy when two opens cache the same portions at once", async () => {
      const bar = await seedCustomFood(BOB, "Granola bar", { createdByUserId: null, isPublic: true });

      const [first, second] = await Promise.all([
        storage.nutrition.cacheServings(bar.id, PORTIONS),
        storage.nutrition.cacheServings(bar.id, PORTIONS),
      ]);

      expect(await servingRows(bar.id)).toEqual(PORTIONS.map((portion) => ({ ...portion, owner: null })));
      // Each open still gets the food's whole list, whichever one inserted it.
      expect(first.map((row) => row.label).sort((left, right) => left.localeCompare(right))).toEqual(["1 bar", "2 bars"]);
      expect(second.map((row) => row.label).sort((left, right) => left.localeCompare(right))).toEqual(["1 bar", "2 bars"]);
    });

    it("stores a custom food's seed portion once when the form lists it twice", async () => {
      const food = await storage.nutrition.createCustomFood(BOB, {
        name: "Bob's flapjack",
        caloriesPer100g: 450,
        servings: [PORTIONS[0], PORTIONS[0], PORTIONS[1]],
      });

      expect(await servingRows(food.id)).toEqual(PORTIONS.map((portion) => ({ ...portion, owner: null })));
    });

    it("lets an athlete's own portion match a shared one", async () => {
      const bar = await seedCustomFood(BOB, "Granola bar", { createdByUserId: null, isPublic: true });
      await storage.nutrition.cacheServings(bar.id, [PORTIONS[0]]);

      const own = await storage.nutrition.createServing(ALICE, bar.id, PORTIONS[0]);

      expect(own).toMatchObject({ createdByUserId: ALICE });
      expect(await servingRows(bar.id)).toHaveLength(2);
    });
  });
});
