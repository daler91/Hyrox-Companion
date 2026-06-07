import {
  type CreateCustomFoodInput,
  type CreateRecipeInput,
  type Food,
  type FoodFavorite,
  foodFavorites,
  foodLogEntries,
  type FoodLogEntry,
  foods,
  type FoodServing,
  foodServings,
  type MealType,
  type NutritionMacroTotals,
  type Recipe,
  recipeIngredients,
  type RecipeListItem,
  recipes,
  type RecipeWithIngredients,
  type ServingInput,
  type UpdateCustomFoodInput,
} from "@shared/schema";
import { and, asc, count, desc, eq, gte, inArray, isNull, lte, sql } from "drizzle-orm";

import { db, type DbExecutor } from "../db";
import { AppError, ErrorCode } from "../errors";
import { computeRecipeFood } from "../services/nutrition/recipe";
import { type LogEntryWithFood, roundMacros, scaleNutrition } from "../services/nutrition/rollup";
import type { MappedFood } from "../services/nutrition/types";

const DEFAULT_SEARCH_LIMIT = 25;

/** Escape LIKE metacharacters in user input (backslash is the default escape char). */
function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, (c) => `\\${c}`);
}

/**
 * Visibility predicate for the mixed shared + per-user `foods` table: a row is
 * visible if it's shared (created_by_user_id IS NULL — USDA/OFF) or owned by the
 * requesting user (a custom food / recipe-backing food). Applied to EVERY
 * food-by-id resolution and listing so custom foods never leak cross-user.
 */
function visibleTo(userId: string) {
  return sql`(${foods.createdByUserId} IS NULL OR ${foods.createdByUserId} = ${userId})`;
}

interface CreateLogEntryData {
  foodId: string;
  quantityG: number;
  mealType: MealType;
  loggedAt: Date;
  logDate: string;
  entryMethod?: "manual" | "barcode";
}

interface UpdateLogEntryPatch {
  quantityG?: number;
  mealType?: MealType;
  // loggedAt and its derived logDate move together (the route recomputes logDate).
  loggedAt?: Date;
  logDate?: string;
}

/**
 * Data access for the nutrition module. Follows the codebase's majority storage
 * pattern: uses `db` directly, with an optional `DbExecutor` only where a caller
 * might compose a transaction. Every per-user read/write scopes its SQL `WHERE`
 * by `userId`, so a foreign id resolves to "not found" rather than leaking.
 */
export class NutritionStorage {
  // --- foods (shared cache + per-user custom) -------------------------------

  /**
   * Search foods visible to the user (shared cache + their own custom foods/
   * recipes) case-insensitively, ranking prefix hits first. The fast/offline path
   * and the fallback when the USDA API is unavailable.
   */
  async searchLocalFoods(query: string, userId: string, limit = DEFAULT_SEARCH_LIMIT): Promise<Food[]> {
    const q = query.trim().toLowerCase();
    if (q.length === 0) return [];
    const escaped = escapeLike(q);
    const prefix = `${escaped}%`;
    const contains = `%${escaped}%`;
    return db
      .select()
      .from(foods)
      .where(and(sql`lower(${foods.name}) like ${contains}`, visibleTo(userId)))
      .orderBy(
        sql`case when lower(${foods.name}) like ${prefix} then 0 else 1 end`,
        asc(foods.name),
      )
      .limit(limit);
  }

  /** Cache USDA/OFF results into `foods`, upserting on (source, source_id). */
  async upsertFoods(mapped: MappedFood[], executor: DbExecutor = db): Promise<Food[]> {
    if (mapped.length === 0) return [];
    // Dedupe within the batch so ON CONFLICT can't try to touch one row twice.
    const byKey = new Map<string, MappedFood>();
    for (const m of mapped) byKey.set(`${m.source}:${m.sourceId}`, m);
    const values = [...byKey.values()].map((m) => ({
      source: m.source,
      sourceId: m.sourceId,
      name: m.name,
      brand: m.brand,
      servingSizeG: m.servingSizeG,
      caloriesPer100g: m.caloriesPer100g,
      proteinPer100g: m.proteinPer100g,
      carbPer100g: m.carbPer100g,
      fatPer100g: m.fatPer100g,
      fiberPer100g: m.fiberPer100g,
    }));

    return executor
      .insert(foods)
      .values(values)
      .onConflictDoUpdate({
        target: [foods.source, foods.sourceId],
        targetWhere: sql`${foods.sourceId} is not null`,
        set: {
          name: sql`excluded.name`,
          brand: sql`excluded.brand`,
          servingSizeG: sql`excluded.serving_size_g`,
          caloriesPer100g: sql`excluded.calories_per_100g`,
          proteinPer100g: sql`excluded.protein_per_100g`,
          carbPer100g: sql`excluded.carb_per_100g`,
          fatPer100g: sql`excluded.fat_per_100g`,
          fiberPer100g: sql`excluded.fiber_per_100g`,
          updatedAt: new Date(),
        },
      })
      .returning();
  }

  /** Resolve a food by id, but only if it's visible to the user (shared or owned). */
  async getVisibleFoodById(userId: string, id: string): Promise<Food | undefined> {
    const [row] = await db
      .select()
      .from(foods)
      .where(and(eq(foods.id, id), visibleTo(userId)));
    return row;
  }

  /** Resolve a cached external food by (source, source_id) — e.g. an OFF barcode. */
  async getFoodBySourceId(source: string, sourceId: string): Promise<Food | undefined> {
    const [row] = await db
      .select()
      .from(foods)
      .where(and(eq(foods.source, source), eq(foods.sourceId, sourceId)));
    return row;
  }

  /** Map of visible foods by id, for resolving recipe ingredients in one query. */
  async getVisibleFoodsByIds(userId: string, ids: string[]): Promise<Map<string, Food>> {
    const unique = [...new Set(ids)];
    if (unique.length === 0) return new Map();
    const rows = await db
      .select()
      .from(foods)
      .where(and(inArray(foods.id, unique), visibleTo(userId)));
    return new Map(rows.map((f) => [f.id, f]));
  }

  /** Distinct foods from the user's most recent log entries, newest first (FR-1.4). */
  async getRecentFoods(userId: string, limit = 20): Promise<Food[]> {
    const recent = await db
      .select({
        foodId: foodLogEntries.foodId,
        lastLogged: sql<string>`max(${foodLogEntries.loggedAt})`,
      })
      .from(foodLogEntries)
      .where(eq(foodLogEntries.userId, userId))
      .groupBy(foodLogEntries.foodId)
      .orderBy(desc(sql`max(${foodLogEntries.loggedAt})`))
      .limit(limit);

    if (recent.length === 0) return [];
    const ids = recent.map((r) => r.foodId);
    const rows = await db
      .select()
      .from(foods)
      .where(and(inArray(foods.id, ids), visibleTo(userId)));
    const byId = new Map(rows.map((f) => [f.id, f]));
    return ids.map((id) => byId.get(id)).filter((f): f is Food => Boolean(f));
  }

  // --- custom foods (FR-2.2) ------------------------------------------------

  async createCustomFood(userId: string, data: CreateCustomFoodInput): Promise<Food> {
    return db.transaction(async (tx) => {
      const [food] = await tx
        .insert(foods)
        .values({
          source: "custom",
          sourceId: null,
          name: data.name,
          brand: data.brand ?? null,
          createdByUserId: userId,
          servingSizeG: data.servingSizeG ?? null,
          caloriesPer100g: data.caloriesPer100g ?? null,
          proteinPer100g: data.proteinPer100g ?? null,
          carbPer100g: data.carbPer100g ?? null,
          fatPer100g: data.fatPer100g ?? null,
          fiberPer100g: data.fiberPer100g ?? null,
        })
        .returning();
      if (data.servings?.length) {
        await tx
          .insert(foodServings)
          .values(data.servings.map((s) => ({ foodId: food.id, label: s.label, grams: s.grams })));
      }
      return food;
    });
  }

  async updateCustomFood(
    userId: string,
    id: string,
    patch: UpdateCustomFoodInput,
  ): Promise<Food | undefined> {
    const [row] = await db
      .update(foods)
      .set({
        ...(patch.name !== undefined && { name: patch.name }),
        ...(patch.brand !== undefined && { brand: patch.brand ?? null }),
        ...(patch.caloriesPer100g !== undefined && { caloriesPer100g: patch.caloriesPer100g ?? null }),
        ...(patch.proteinPer100g !== undefined && { proteinPer100g: patch.proteinPer100g ?? null }),
        ...(patch.carbPer100g !== undefined && { carbPer100g: patch.carbPer100g ?? null }),
        ...(patch.fatPer100g !== undefined && { fatPer100g: patch.fatPer100g ?? null }),
        ...(patch.fiberPer100g !== undefined && { fiberPer100g: patch.fiberPer100g ?? null }),
        ...(patch.servingSizeG !== undefined && { servingSizeG: patch.servingSizeG ?? null }),
        updatedAt: new Date(),
      })
      .where(and(eq(foods.id, id), eq(foods.createdByUserId, userId), eq(foods.source, "custom")))
      .returning();
    return row;
  }

  /**
   * Delete a user's custom food. Returns false if it isn't the user's custom food
   * (→ 404). Throws a 409 `AppError` if it's referenced by a log entry or a recipe
   * (the FK is restrict; deleting would fail anyway — history is preserved).
   */
  async deleteCustomFood(userId: string, id: string): Promise<boolean> {
    const [food] = await db
      .select({ id: foods.id })
      .from(foods)
      .where(and(eq(foods.id, id), eq(foods.createdByUserId, userId), eq(foods.source, "custom")));
    if (!food) return false;

    const [{ logs }] = await db
      .select({ logs: count() })
      .from(foodLogEntries)
      .where(eq(foodLogEntries.foodId, id));
    const [{ ings }] = await db
      .select({ ings: count() })
      .from(recipeIngredients)
      .where(eq(recipeIngredients.foodId, id));
    if (logs > 0 || ings > 0) {
      throw new AppError(
        ErrorCode.CONFLICT,
        "This food is used in a log entry or recipe and can't be deleted.",
        409,
      );
    }

    await db.delete(foods).where(eq(foods.id, id));
    return true;
  }

  /** A user's custom foods, EXCLUDING recipe-backing foods (those surface via /recipes). */
  async listCustomFoods(userId: string): Promise<Food[]> {
    const rows = await db
      .select({ food: foods })
      .from(foods)
      .leftJoin(recipes, eq(recipes.foodId, foods.id))
      .where(and(eq(foods.createdByUserId, userId), eq(foods.source, "custom"), isNull(recipes.id)))
      .orderBy(asc(foods.name));
    return rows.map((r) => r.food);
  }

  // --- named servings (FR-2.4) ----------------------------------------------

  async getServings(foodId: string): Promise<FoodServing[]> {
    return db
      .select()
      .from(foodServings)
      .where(eq(foodServings.foodId, foodId))
      .orderBy(asc(foodServings.grams));
  }

  /** Cache enrichment servings (e.g. USDA portions) for a food. */
  async cacheServings(foodId: string, servings: { label: string; grams: number }[]): Promise<FoodServing[]> {
    if (servings.length === 0) return [];
    return db
      .insert(foodServings)
      .values(servings.map((s) => ({ foodId, label: s.label, grams: s.grams })))
      .returning();
  }

  /** Add a named serving to the user's own custom food. undefined → 404 (not owner). */
  async createServing(userId: string, foodId: string, input: ServingInput): Promise<FoodServing | undefined> {
    const [food] = await db
      .select({ id: foods.id })
      .from(foods)
      .where(and(eq(foods.id, foodId), eq(foods.createdByUserId, userId), eq(foods.source, "custom")));
    if (!food) return undefined;
    const [row] = await db
      .insert(foodServings)
      .values({ foodId, label: input.label, grams: input.grams })
      .returning();
    return row;
  }

  async deleteServing(userId: string, servingId: string): Promise<boolean> {
    const rows = await db
      .select({ id: foodServings.id })
      .from(foodServings)
      .innerJoin(foods, eq(foodServings.foodId, foods.id))
      .where(and(eq(foodServings.id, servingId), eq(foods.createdByUserId, userId)));
    if (rows.length === 0) return false;
    await db.delete(foodServings).where(eq(foodServings.id, servingId));
    return true;
  }

  // --- log entries ----------------------------------------------------------

  async createLogEntry(
    userId: string,
    data: CreateLogEntryData,
    executor: DbExecutor = db,
  ): Promise<FoodLogEntry> {
    const [row] = await executor
      .insert(foodLogEntries)
      .values({
        userId,
        foodId: data.foodId,
        loggedAt: data.loggedAt,
        logDate: data.logDate,
        quantityG: data.quantityG,
        mealType: data.mealType,
        entryMethod: data.entryMethod ?? "manual",
      })
      .returning();
    return row;
  }

  /** A day's entries joined to their foods, ordered by time, for the daily view. */
  async listEntriesWithFoodForDate(userId: string, logDate: string): Promise<LogEntryWithFood[]> {
    const rows = await db
      .select({ entry: foodLogEntries, food: foods })
      .from(foodLogEntries)
      .innerJoin(foods, eq(foodLogEntries.foodId, foods.id))
      .where(and(eq(foodLogEntries.userId, userId), eq(foodLogEntries.logDate, logDate)))
      .orderBy(asc(foodLogEntries.loggedAt));
    return rows.map((r) => ({ ...r.entry, food: r.food }));
  }

  /**
   * Entries joined to foods whose `loggedAt` instant falls within [from, to],
   * time-ordered. Backs the session-fuelling windows when a workout has a known
   * start instant (FR-3.1/3.2; served by idx_food_log_entries_user_logged_at).
   */
  async listEntriesWithFoodInWindow(
    userId: string,
    fromInstant: Date,
    toInstant: Date,
  ): Promise<LogEntryWithFood[]> {
    const rows = await db
      .select({ entry: foodLogEntries, food: foods })
      .from(foodLogEntries)
      .innerJoin(foods, eq(foodLogEntries.foodId, foods.id))
      .where(
        and(
          eq(foodLogEntries.userId, userId),
          gte(foodLogEntries.loggedAt, fromInstant),
          lte(foodLogEntries.loggedAt, toInstant),
        ),
      )
      .orderBy(asc(foodLogEntries.loggedAt));
    return rows.map((r) => ({ ...r.entry, food: r.food }));
  }

  /**
   * Entries joined to foods whose local `logDate` falls within [fromDate, toDate],
   * ordered by day then time. Backs the block view's daily macro totals (FR-3.3;
   * served by idx_food_log_entries_user_log_date).
   */
  async listEntriesWithFoodForDateRange(
    userId: string,
    fromDate: string,
    toDate: string,
  ): Promise<LogEntryWithFood[]> {
    const rows = await db
      .select({ entry: foodLogEntries, food: foods })
      .from(foodLogEntries)
      .innerJoin(foods, eq(foodLogEntries.foodId, foods.id))
      .where(
        and(
          eq(foodLogEntries.userId, userId),
          gte(foodLogEntries.logDate, fromDate),
          lte(foodLogEntries.logDate, toDate),
        ),
      )
      .orderBy(asc(foodLogEntries.logDate), asc(foodLogEntries.loggedAt));
    return rows.map((r) => ({ ...r.entry, food: r.food }));
  }

  async updateLogEntry(
    userId: string,
    id: string,
    patch: UpdateLogEntryPatch,
  ): Promise<FoodLogEntry | undefined> {
    const [row] = await db
      .update(foodLogEntries)
      .set({
        ...(patch.quantityG !== undefined && { quantityG: patch.quantityG }),
        ...(patch.mealType !== undefined && { mealType: patch.mealType }),
        ...(patch.loggedAt !== undefined && { loggedAt: patch.loggedAt }),
        ...(patch.logDate !== undefined && { logDate: patch.logDate }),
        updatedAt: new Date(),
      })
      .where(and(eq(foodLogEntries.id, id), eq(foodLogEntries.userId, userId)))
      .returning();
    return row;
  }

  async deleteLogEntry(userId: string, id: string): Promise<boolean> {
    const result = await db
      .delete(foodLogEntries)
      .where(and(eq(foodLogEntries.id, id), eq(foodLogEntries.userId, userId)))
      .returning({ id: foodLogEntries.id });
    return result.length > 0;
  }

  /**
   * Re-log a previous day (or one meal of it) onto a target date (FR-1.5).
   * Repeated entries are stamped with `loggedAt` (the target day's instant) and
   * filed under `targetDate`. Returns the number of entries created.
   */
  async repeatDay(
    userId: string,
    params: { sourceDate: string; mealType?: MealType; targetDate: string; loggedAt: Date },
  ): Promise<number> {
    const conditions = [
      eq(foodLogEntries.userId, userId),
      eq(foodLogEntries.logDate, params.sourceDate),
    ];
    if (params.mealType) conditions.push(eq(foodLogEntries.mealType, params.mealType));

    const sources = await db.select().from(foodLogEntries).where(and(...conditions));
    if (sources.length === 0) return 0;

    const rows = sources.map((s) => ({
      userId,
      foodId: s.foodId,
      loggedAt: params.loggedAt,
      logDate: params.targetDate,
      quantityG: s.quantityG,
      mealType: s.mealType,
      entryMethod: "manual" as const,
    }));
    const inserted = await db
      .insert(foodLogEntries)
      .values(rows)
      .returning({ id: foodLogEntries.id });
    return inserted.length;
  }

  // --- favorites ------------------------------------------------------------

  async listFavorites(userId: string): Promise<Food[]> {
    const rows = await db
      .select({ food: foods })
      .from(foodFavorites)
      .innerJoin(foods, eq(foodFavorites.foodId, foods.id))
      .where(and(eq(foodFavorites.userId, userId), visibleTo(userId)))
      .orderBy(desc(foodFavorites.createdAt));
    return rows.map((r) => r.food);
  }

  async addFavorite(userId: string, foodId: string): Promise<FoodFavorite | undefined> {
    const [row] = await db
      .insert(foodFavorites)
      .values({ userId, foodId })
      .onConflictDoNothing({ target: [foodFavorites.userId, foodFavorites.foodId] })
      .returning();
    return row;
  }

  async removeFavorite(userId: string, foodId: string): Promise<boolean> {
    const result = await db
      .delete(foodFavorites)
      .where(and(eq(foodFavorites.userId, userId), eq(foodFavorites.foodId, foodId)))
      .returning({ id: foodFavorites.id });
    return result.length > 0;
  }

  // --- recipes (FR-2.3) -----------------------------------------------------

  /** Resolve + validate ingredient foods, then compute the backing food's macros. */
  private computeFromInputs(input: CreateRecipeInput, foodsById: Map<string, Food>) {
    const withFoods = input.ingredients.map((ing) => {
      const food = foodsById.get(ing.foodId);
      if (!food) {
        throw new AppError(ErrorCode.VALIDATION_ERROR, "One or more ingredient foods were not found", 400);
      }
      return { food, quantityG: ing.quantityG };
    });
    return computeRecipeFood(withFoods, input.servings);
  }

  private backingFoodValues(
    userId: string,
    name: string,
    computed: ReturnType<typeof computeRecipeFood>,
  ) {
    return {
      source: "custom" as const,
      sourceId: null,
      name,
      brand: null,
      createdByUserId: userId,
      servingSizeG: computed.servingSizeG,
      caloriesPer100g: computed.caloriesPer100g,
      proteinPer100g: computed.proteinPer100g,
      carbPer100g: computed.carbPer100g,
      fatPer100g: computed.fatPer100g,
      fiberPer100g: computed.fiberPer100g,
    };
  }

  async createRecipe(userId: string, input: CreateRecipeInput): Promise<Recipe> {
    const foodsById = await this.getVisibleFoodsByIds(userId, input.ingredients.map((i) => i.foodId));
    const computed = this.computeFromInputs(input, foodsById);

    return db.transaction(async (tx) => {
      const [backing] = await tx
        .insert(foods)
        .values(this.backingFoodValues(userId, input.name, computed))
        .returning();
      const [recipe] = await tx
        .insert(recipes)
        .values({ userId, foodId: backing.id, name: input.name, servings: input.servings })
        .returning();
      await tx.insert(recipeIngredients).values(
        input.ingredients.map((ing, idx) => ({
          recipeId: recipe.id,
          foodId: ing.foodId,
          quantityG: ing.quantityG,
          position: idx,
        })),
      );
      return recipe;
    });
  }

  async updateRecipe(userId: string, id: string, input: CreateRecipeInput): Promise<Recipe | undefined> {
    const [existing] = await db
      .select()
      .from(recipes)
      .where(and(eq(recipes.id, id), eq(recipes.userId, userId)));
    if (!existing) return undefined;
    // A recipe can't include its own backing food as an ingredient (self-loop).
    if (input.ingredients.some((i) => i.foodId === existing.foodId)) {
      throw new AppError(ErrorCode.VALIDATION_ERROR, "A recipe can't include itself as an ingredient", 400);
    }

    const foodsById = await this.getVisibleFoodsByIds(userId, input.ingredients.map((i) => i.foodId));
    const computed = this.computeFromInputs(input, foodsById);

    await db.transaction(async (tx) => {
      await tx
        .update(foods)
        .set({ ...this.backingFoodValues(userId, input.name, computed), updatedAt: new Date() })
        .where(eq(foods.id, existing.foodId));
      await tx.delete(recipeIngredients).where(eq(recipeIngredients.recipeId, id));
      await tx.insert(recipeIngredients).values(
        input.ingredients.map((ing, idx) => ({
          recipeId: id,
          foodId: ing.foodId,
          quantityG: ing.quantityG,
          position: idx,
        })),
      );
      await tx
        .update(recipes)
        .set({ name: input.name, servings: input.servings, updatedAt: new Date() })
        .where(eq(recipes.id, id));
    });

    const [updated] = await db.select().from(recipes).where(eq(recipes.id, id));
    return updated;
  }

  /**
   * Delete a recipe + its ingredients. The backing food is deleted only if no log
   * entry references it (otherwise it's kept so logged history survives).
   */
  async deleteRecipe(userId: string, id: string): Promise<boolean> {
    const [recipe] = await db
      .select()
      .from(recipes)
      .where(and(eq(recipes.id, id), eq(recipes.userId, userId)));
    if (!recipe) return false;

    await db.transaction(async (tx) => {
      await tx.delete(recipes).where(eq(recipes.id, id)); // cascades recipe_ingredients
      const [{ refs }] = await tx
        .select({ refs: count() })
        .from(foodLogEntries)
        .where(eq(foodLogEntries.foodId, recipe.foodId));
      if (refs === 0) {
        await tx.delete(foods).where(eq(foods.id, recipe.foodId));
      }
    });
    return true;
  }

  async listRecipes(userId: string): Promise<RecipeListItem[]> {
    return db
      .select({
        id: recipes.id,
        name: recipes.name,
        servings: recipes.servings,
        foodId: recipes.foodId,
      })
      .from(recipes)
      .where(eq(recipes.userId, userId))
      .orderBy(asc(recipes.name));
  }

  async getRecipeWithIngredients(userId: string, id: string): Promise<RecipeWithIngredients | null> {
    const [recipe] = await db
      .select()
      .from(recipes)
      .where(and(eq(recipes.id, id), eq(recipes.userId, userId)));
    if (!recipe) return null;

    const rows = await db
      .select({ ing: recipeIngredients, food: foods })
      .from(recipeIngredients)
      .innerJoin(foods, eq(recipeIngredients.foodId, foods.id))
      .where(eq(recipeIngredients.recipeId, id))
      .orderBy(asc(recipeIngredients.position));

    const totals: NutritionMacroTotals = { calories: 0, protein: 0, carb: 0, fat: 0, fiber: 0 };
    let totalGrams = 0;
    const ingredients = rows.map((r) => {
      const n = scaleNutrition(r.food, r.ing.quantityG);
      totals.calories += n.calories;
      totals.protein += n.protein;
      totals.carb += n.carb;
      totals.fat += n.fat;
      totals.fiber += n.fiber;
      totalGrams += r.ing.quantityG;
      return {
        id: r.ing.id,
        foodId: r.ing.foodId,
        name: r.food.name,
        brand: r.food.brand,
        quantityG: r.ing.quantityG,
        position: r.ing.position,
        nutrition: roundMacros(n),
      };
    });

    const divisor = recipe.servings > 0 ? recipe.servings : 1;
    const perServing = roundMacros({
      calories: totals.calories / divisor,
      protein: totals.protein / divisor,
      carb: totals.carb / divisor,
      fat: totals.fat / divisor,
      fiber: totals.fiber / divisor,
    });

    return {
      id: recipe.id,
      name: recipe.name,
      servings: recipe.servings,
      foodId: recipe.foodId,
      totalGrams,
      perServing,
      ingredients,
    };
  }
}
