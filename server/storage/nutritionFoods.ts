/**
 * Foods: the shared provider cache, per-user custom foods and named servings (A8).
 *
 * Extracted from the single NutritionStorage class so each sub-domain is a
 * focused, separately-testable module; `nutrition.ts` keeps the class as the
 * storage facade's entry point, with every method name unchanged.
 */
import {
  type CreateCustomFoodInput,
  type Food,
  foodLogEntries,
  foods,
  type FoodServing,
  foodServings,
  type FoodWithPortionMemory,
  recipeIngredients,
  recipes,
  type ServingInput,
  type UpdateCustomFoodInput,
} from "@shared/schema";
import {
  and,
  asc,
  count,
  desc,
  eq,
  getTableColumns,
  inArray,
  isNull,
  ne,
  sql,
} from "drizzle-orm";

import { db, type DbExecutor } from "../db";
import { env } from "../env";
import { AppError, ErrorCode } from "../errors";
import { computeRecipeFood } from "../services/nutrition/recipe";
import { expandQuery } from "../services/nutrition/relevance";
import { sanitizeMappedFood } from "../services/nutrition/sanitize";
import type { MappedFood } from "../services/nutrition/types";
import { buildVariantMatch, DEFAULT_SEARCH_LIMIT, escapeLike, getLastPortions, type LocalFood, visibleTo, withPortionMemory } from "./nutritionShared";

// --- foods (shared cache + per-user custom) -------------------------------

/**
 * Search foods visible to the user (shared cache + their own custom foods/
 * recipes), matching NAME and BRAND case-insensitively. The fast/offline path and
 * the fallback when the live APIs are unavailable.
 *
 * The query is expanded with synonyms (`expandQuery`) so a "courgette" search also
 * retrieves a local "Zucchini" row. Each variant matches by exact substring plus,
 * when `NUTRITION_FUZZY_ENABLED` is on, a pg_trgm similarity fallback so typos /
 * mid-word queries hit ("yoghrt" -> "Yogurt"). Rows carry `_localSim` (trigram
 * score vs the verbatim query) so the orchestrator's ranker can place typo hits;
 * synonym hits are scored by the synonym-aware ranker, not `_localSim`. Ordered
 * name-prefix > name-substring > brand > trigram-only, then similarity, then name.
 */
export async function searchLocalFoods(
  query: string,
  userId: string,
  limit = DEFAULT_SEARCH_LIMIT,
): Promise<LocalFood[]> {
  const variants = expandQuery(query);
  if (variants.length === 0) return [];
  const fuzzy = env.NUTRITION_FUZZY_ENABLED !== "false";
  const primary = variants[0]; // the verbatim (normalized) query
  const prefix = `${escapeLike(primary)}%`;
  const primaryContains = `%${escapeLike(primary)}%`;

  // Trigram similarity vs the verbatim query (ranks typo hits). `0` (no similarity()
  // call) when fuzzy is off, so the column is always present and pg_trgm is only
  // touched when enabled. Synonym hits don't rely on this — the ranker scores them.
  const sim = fuzzy
    ? sql<number>`greatest(similarity(lower(${foods.name}), ${primary}), coalesce(similarity(lower(${foods.brand}), ${primary}), 0))`
    : sql<number>`0`;

  // Retrieve a row if ANY variant (the query or a synonym form) matches name/brand
  // by substring, or — when fuzzy — by trigram similarity (see buildVariantMatch
  // for why the `%` operator, not similarity(), is load-bearing). The synonym
  // variants are what let "courgette" pull a local "Zucchini" row for the ranker.
  // Wrap the OR-join in parens so the visibility AND below binds to the whole
  // group, not just the last variant (SQL AND binds tighter than OR).
  const orSeparator = sql` or `;
  const match = sql`(${sql.join(
    variants.map((v) => buildVariantMatch(v, fuzzy)),
    orSeparator,
  )})`;

  return await db
    .select({ ...getTableColumns(foods), _localSim: sim })
    .from(foods)
    .where(and(match, visibleTo(userId)))
    .orderBy(
      sql`case
        when lower(${foods.name}) like ${prefix} then 0
        when lower(${foods.name}) like ${primaryContains} then 1
        when ${foods.brand} is not null and lower(${foods.brand}) like ${primaryContains} then 2
        else 3 end`,
      desc(sim),
      asc(foods.name),
    )
    .limit(limit);
}


/** Cache USDA/OFF results into `foods`, upserting on (source, source_id). */
export async function upsertFoods(mapped: MappedFood[], executor: DbExecutor = db): Promise<Food[]> {
  if (mapped.length === 0) return [];
  // Sanity-clamp every external food at this single cache boundary so a NaN /
  // negative / absurd upstream value can never poison a cached row (and thus
  // every future log of that food); unusable records are dropped. Also dedupe
  // within the batch so ON CONFLICT can't try to touch one row twice.
  const byKey = new Map<string, MappedFood>();
  for (const m of mapped) {
    const clean = sanitizeMappedFood(m);
    if (clean) byKey.set(`${clean.source}:${clean.sourceId}`, clean);
  }
  if (byKey.size === 0) return [];
  // One freshness instant for the whole batch, stamped on insert AND update so
  // every cache write records when the row was last pulled from its source —
  // the anchor for the lazy staleness re-fetch.
  const now = new Date();
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
    micros: m.micros,
    lastFetchedAt: now,
  }));

  return await executor
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
        // MERGED, not replaced. A search hit carries whatever micronutrients
        // that one provider happened to return, and overwriting wiped a row's
        // USDA enrichment the next time the same product surfaced in an OFF
        // search (audit M21). Right-hand side wins per key, so fresher values
        // still land; keys the incoming payload simply does not mention are
        // kept rather than deleted. `nullif` keeps the column NULL when neither
        // side has anything, so "no micros" stays distinguishable from
        // "measured and found to contain none".
        //
        // The trade-off, stated because it is real: a provider that DROPS a
        // micronutrient no longer clears it here. Losing enrichment on every
        // search is the worse of the two.
        micros: sql`nullif(coalesce(${foods.micros}, '{}'::jsonb) || coalesce(excluded.micros, '{}'::jsonb), '{}'::jsonb)`,
        lastFetchedAt: now,
        updatedAt: now,
      },
    })
    .returning();
}


/** Resolve a food by id, but only if it's visible to the user (shared or owned). */
export async function getVisibleFoodById(userId: string, id: string): Promise<Food | undefined> {
  const [row] = await db
    .select()
    .from(foods)
    .where(and(eq(foods.id, id), visibleTo(userId)));
  return row;
}


/** Resolve a cached external food by (source, source_id) — e.g. an OFF barcode. */
export async function getFoodBySourceId(source: string, sourceId: string): Promise<Food | undefined> {
  const [row] = await db
    .select()
    .from(foods)
    .where(and(eq(foods.source, source), eq(foods.sourceId, sourceId)));
  return row;
}


/** Map of visible foods by id, for resolving recipe ingredients in one query. */
export async function getVisibleFoodsByIds(userId: string, ids: string[]): Promise<Map<string, Food>> {
  const unique = [...new Set(ids)];
  if (unique.length === 0) return new Map();
  const rows = await db
    .select()
    .from(foods)
    .where(and(inArray(foods.id, unique), visibleTo(userId)));
  return new Map(rows.map((f) => [f.id, f]));
}


/** Distinct foods from the user's log entries, staples first (FR-1.4).
 *
 *  Ranked by how often the food was logged in the last 30 days, then by
 *  most-recently-logged. Pure recency buried the athlete's actual staples
 *  under whatever was tried once yesterday; frequency-first keeps the
 *  quick-add chips pointed at what they genuinely eat repeatedly, while
 *  the recency tiebreak still surfaces new foods when history is thin
 *  (anything older than the window counts 0 and sorts by recency alone). */
// (getLastPortions' query lives at module scope as buildLastPortionsQuery so
// its SQL shape can be pinned — see nutrition.searchShape.test.ts.)
export async function getRecentFoods(userId: string, limit = 20): Promise<FoodWithPortionMemory[]> {
  const stapleCount = sql`count(*) filter (where ${foodLogEntries.loggedAt} >= now() - interval '30 days')`;
  const recent = await db
    .select({
      foodId: foodLogEntries.foodId,
      lastLogged: sql<string>`max(${foodLogEntries.loggedAt})`,
    })
    .from(foodLogEntries)
    .where(eq(foodLogEntries.userId, userId))
    .groupBy(foodLogEntries.foodId)
    .orderBy(desc(stapleCount), desc(sql`max(${foodLogEntries.loggedAt})`))
    .limit(limit);

  if (recent.length === 0) return [];
  const ids = recent.map((r) => r.foodId);
  const [rows, portions] = await Promise.all([
    db.select().from(foods).where(and(inArray(foods.id, ids), visibleTo(userId))),
    getLastPortions(userId, ids),
  ]);
  const byId = new Map(rows.map((f) => [f.id, f]));
  const ordered = ids.map((id) => byId.get(id)).filter((f): f is Food => Boolean(f));
  return withPortionMemory(ordered, portions);
}


// --- custom foods (FR-2.2) ------------------------------------------------

export async function createCustomFood(userId: string, data: CreateCustomFoodInput): Promise<Food> {
  return await db.transaction(async (tx) => {
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
      // Seed servings are shared rows, so a portion listed twice (same label
      // and grams) is kept once rather than failing uq_food_servings_shared.
      await tx
        .insert(foodServings)
        .values(data.servings.map((s) => ({ foodId: food.id, label: s.label, grams: s.grams })))
        .onConflictDoNothing();
    }
    return food;
  });
}


/**
 * The per-100g columns a logged entry's nutrition is computed from, each as
 * (patched, stored). Log entries store only `foodId` + `quantityG` and every
 * read joins `foods` live.
 */
function loggedMacroPairs(
  current: Food,
  patch: UpdateCustomFoodInput,
): [patched: number | null | undefined, stored: number | null][] {
  return [
    [patch.caloriesPer100g, current.caloriesPer100g],
    [patch.proteinPer100g, current.proteinPer100g],
    [patch.carbPer100g, current.carbPer100g],
    [patch.fatPer100g, current.fatPer100g],
    [patch.fiberPer100g, current.fiberPer100g],
  ];
}

/** Equal as stored: the macro columns are float4, so compare at that precision. */
function sameStoredReal(a: number | null, b: number | null): boolean {
  if (a === null || b === null) return a === b;
  return Math.fround(a) === Math.fround(b);
}

/**
 * Whether the patch changes anything another athlete's logged history shows:
 * the name, the brand or a per-100g macro. `servingSizeG` (a default portion)
 * and `isPublic` don't touch logged totals. The edit dialog always resends
 * every field, so this compares values instead of checking which keys are set.
 */
function rewritesLoggedHistory(current: Food, patch: UpdateCustomFoodInput): boolean {
  if (patch.name !== undefined && patch.name !== current.name) return true;
  if (patch.brand !== undefined && (patch.brand || null) !== (current.brand || null)) return true;
  return changesMacros(current, patch);
}

/** Whether the patch changes a per-100g macro: what a recipe's totals are built from. */
function changesMacros(current: Food, patch: UpdateCustomFoodInput): boolean {
  return loggedMacroPairs(current, patch).some(
    ([patched, stored]) => patched !== undefined && !sameStoredReal(patched, stored),
  );
}

/** Whether anyone other than the owner has logged this food or uses it in a recipe. */
async function isReferencedByOtherUsers(
  executor: DbExecutor,
  foodId: string,
  ownerId: string,
): Promise<boolean> {
  const logged = await executor
    .select({ id: foodLogEntries.id })
    .from(foodLogEntries)
    .where(and(eq(foodLogEntries.foodId, foodId), ne(foodLogEntries.userId, ownerId)))
    .limit(1);
  if (logged.length > 0) return true;
  const inRecipe = await executor
    .select({ id: recipeIngredients.id })
    .from(recipeIngredients)
    .innerJoin(recipes, eq(recipes.id, recipeIngredients.recipeId))
    .where(and(eq(recipeIngredients.foodId, foodId), ne(recipes.userId, ownerId)))
    .limit(1);
  return inRecipe.length > 0;
}

export const SHARED_FOOD_EDIT_CONFLICT =
  "Other people have logged this shared food, so its name and nutrition can't be changed. " +
  "Create a new custom food with the corrected values instead.";

/**
 * Refuse a write to `current` that would rewrite another athlete's logged
 * history (D18, below). Call inside the write transaction with the row locked
 * FOR UPDATE. Shared by the custom-food edit and the recipe edit, which
 * rewrites its backing food's name and macros.
 */
export function assertLoggedHistoryKept(
  executor: DbExecutor,
  current: Food,
  next: UpdateCustomFoodInput,
  ownerId: string,
  message = SHARED_FOOD_EDIT_CONFLICT,
): Promise<void> {
  if (!rewritesLoggedHistory(current, next)) return Promise.resolve();
  return isReferencedByOtherUsers(executor, current.id, ownerId).then((referenced) => {
    if (referenced) throw new AppError(ErrorCode.CONFLICT, message, 409);
  });
}

/**
 * Edit the user's own custom food. Returns undefined if it isn't theirs (→ 404).
 *
 * D18 (CODEBASE_ANALYSIS_2026-10-03): a shared food is read live by every
 * other athlete who logged it, so editing its name or macros in place would
 * silently rewrite their past days, targets and insights. Once anyone else
 * references it (a log entry or a recipe ingredient), those fields are frozen
 * and the edit is refused with a 409; the owner can still change the serving
 * size and toggle sharing. This holds even after `isPublic` is switched back
 * off, since the other athletes' entries still point at the row. The row is
 * locked FOR UPDATE first: a new log entry takes FOR KEY SHARE on it through
 * the foreign key, so nobody can start referencing it between the check and
 * the write. A macro change also refreshes the athlete's recipes that use the
 * food (C40, refreshRecipesAfterMacroEdit).
 */
export async function updateCustomFood(
  userId: string,
  id: string,
  patch: UpdateCustomFoodInput,
): Promise<Food | undefined> {
  return await db.transaction(async (tx) => {
    const ownCustomFood = and(eq(foods.id, id), eq(foods.createdByUserId, userId), eq(foods.source, "custom"));
    // A recipe's backing food is also source='custom', but it is edited only
    // through its recipe, which recomputes it (listCustomFoods hides it too).
    // Matching it here let this PATCH share it, and the recipe edit then
    // rewrote it in place around the freeze below (D18).
    const notARecipe = sql`NOT EXISTS (SELECT 1 FROM ${recipes} WHERE ${recipes.foodId} = ${foods.id})`;
    const current = (await tx.select().from(foods).where(and(ownCustomFood, notARecipe)).for("update")).at(0);
    if (!current) return undefined;

    await assertLoggedHistoryKept(tx, current, patch, userId);

    const [row] = await tx
      .update(foods)
      .set({
        ...(patch.name !== undefined && { name: patch.name }),
        ...(patch.brand !== undefined && { brand: patch.brand ?? null }),
        ...(patch.caloriesPer100g !== undefined && {
          caloriesPer100g: patch.caloriesPer100g ?? null,
        }),
        ...(patch.proteinPer100g !== undefined && { proteinPer100g: patch.proteinPer100g ?? null }),
        ...(patch.carbPer100g !== undefined && { carbPer100g: patch.carbPer100g ?? null }),
        ...(patch.fatPer100g !== undefined && { fatPer100g: patch.fatPer100g ?? null }),
        ...(patch.fiberPer100g !== undefined && { fiberPer100g: patch.fiberPer100g ?? null }),
        ...(patch.servingSizeG !== undefined && { servingSizeG: patch.servingSizeG ?? null }),
        // Public sharing opt-in/out. The WHERE below already pins ownership and
        // source='custom', so only the owner can toggle and only custom foods.
        ...(patch.isPublic !== undefined && { isPublic: patch.isPublic }),
        updatedAt: new Date(),
      })
      .where(ownCustomFood)
      .returning();
    if (row) await refreshRecipesAfterMacroEdit(tx, userId, current, patch);
    return row;
  });
}

type RecipeRef = { id: string; foodId: string; servings: number };

/**
 * Recompute one recipe's backing food from its ingredients as they are now.
 * Skipped for a backing food someone else has logged or put in a recipe
 * (shared before D18): their history must not move with this athlete's edit.
 */
async function refreshBackingFood(
  tx: DbExecutor,
  userId: string,
  recipe: RecipeRef,
): Promise<void> {
  const [current] = await tx.select().from(foods).where(eq(foods.id, recipe.foodId)).for("update");
  if (!current) return;
  const ingredients = await tx
    .select({ food: foods, quantityG: recipeIngredients.quantityG })
    .from(recipeIngredients)
    .innerJoin(foods, eq(recipeIngredients.foodId, foods.id))
    .where(eq(recipeIngredients.recipeId, recipe.id));
  const computed = computeRecipeFood(ingredients, recipe.servings);
  const macros = {
    caloriesPer100g: computed.caloriesPer100g,
    proteinPer100g: computed.proteinPer100g,
    carbPer100g: computed.carbPer100g,
    fatPer100g: computed.fatPer100g,
    fiberPer100g: computed.fiberPer100g,
  };
  if (!changesMacros(current, macros)) return;
  if (await isReferencedByOtherUsers(tx, current.id, userId)) return;
  await tx
    .update(foods)
    .set({ ...macros, micros: computed.micros, updatedAt: new Date() })
    .where(eq(foods.id, current.id));
}

interface DependentRecipes {
  reached: Map<string, RecipeRef>;
  usedBy: Map<string, Set<string>>;
}

/**
 * The athlete's recipes that use `foodId`, directly or through other recipes,
 * keyed by backing food in the order found, plus `usedBy`: for each food
 * reached (`foodId` included), the backing foods of the recipes it is in.
 * `foodId` itself is never reached, even when a recipe cycle leads back to it.
 */
async function collectDependentRecipes(tx: DbExecutor, userId: string, foodId: string) {
  const found: DependentRecipes = { reached: new Map(), usedBy: new Map() };
  await collectLevel(tx, userId, foodId, [foodId], found);
  return found;
}

/**
 * One level of collectDependentRecipes: the athlete's recipes that use any of
 * `frontier`, then the level above them. Each level needs the one before it,
 * so they run one after another, one query per level.
 */
async function collectLevel(
  tx: DbExecutor,
  userId: string,
  foodId: string,
  frontier: string[],
  found: DependentRecipes,
): Promise<void> {
  if (frontier.length === 0) return;
  const uses = await tx
    .select({
      ingredientFoodId: recipeIngredients.foodId,
      id: recipes.id,
      foodId: recipes.foodId,
      servings: recipes.servings,
    })
    .from(recipes)
    .innerJoin(recipeIngredients, eq(recipeIngredients.recipeId, recipes.id))
    .where(and(inArray(recipeIngredients.foodId, frontier), eq(recipes.userId, userId)));
  const next: string[] = [];
  for (const { ingredientFoodId, ...recipe } of uses) {
    const users = found.usedBy.get(ingredientFoodId) ?? new Set<string>();
    found.usedBy.set(ingredientFoodId, users.add(recipe.foodId));
    if (recipe.foodId === foodId || found.reached.has(recipe.foodId)) continue;
    found.reached.set(recipe.foodId, recipe);
    next.push(recipe.foodId);
  }
  await collectLevel(tx, userId, foodId, next, found);
}

/**
 * `reached` in dependency order (Kahn's algorithm): each recipe after every
 * reached recipe it uses. In a cycle no member is ever ready, so the earliest
 * found is taken anyway; every recipe still appears exactly once.
 */
function refreshOrder(
  reached: Map<string, RecipeRef>,
  usedBy: Map<string, Set<string>>,
): RecipeRef[] {
  const waitingOn = new Map<string, number>([...reached.keys()].map((id) => [id, 0]));
  for (const [ingredient, users] of usedBy) {
    // Nothing waits on the edited food itself: it is already up to date.
    if (reached.has(ingredient)) adjustWaiting(waitingOn, users, 1);
  }
  const order: RecipeRef[] = [];
  for (let next = nextReady(waitingOn); next !== undefined; next = nextReady(waitingOn)) {
    waitingOn.delete(next);
    const recipe = reached.get(next);
    if (recipe) order.push(recipe);
    adjustWaiting(waitingOn, usedBy.get(next) ?? [], -1);
  }
  return order;
}

/** Add `delta` to how many recipes each of `users` still waits on, for those not yet ordered. */
function adjustWaiting(
  waitingOn: Map<string, number>,
  users: Iterable<string>,
  delta: number,
): void {
  for (const user of users) {
    const waiting = waitingOn.get(user);
    if (waiting !== undefined) waitingOn.set(user, waiting + delta);
  }
}

/** The first recipe left with nothing to wait on; failing that (a cycle), the first left. */
function nextReady(waitingOn: Map<string, number>): string | undefined {
  for (const [id, waiting] of waitingOn) {
    if (waiting === 0) return id;
  }
  return waitingOn.keys().next().value;
}

/**
 * C40 (CODEBASE_ANALYSIS_2026-10-03): a recipe logs through a backing food
 * whose macros were computed from its ingredients when it was saved, while
 * the recipe views recompute from the ingredients live. After the athlete
 * corrected an ingredient, the recipe showed the new total but logged the old
 * one until it was saved again. So an edit to a food's macros (a custom food,
 * or a recipe's backing food through the recipe edit) recomputes the backing
 * food of each of the athlete's recipes that uses it, directly or through
 * other recipes, inside the edit's transaction. They are recomputed in
 * dependency order, so a recipe that reaches the food two ways is not
 * computed from a recipe that has yet to be refreshed.
 *
 * Food logs join `foods` live, so the athlete's own past logs of such a recipe
 * move with it, exactly as their logs of the edited food itself already do
 * (the accepted M11 behaviour). Other athletes' logs never move: see
 * refreshBackingFood.
 */
export async function refreshRecipesAfterMacroEdit(
  tx: DbExecutor,
  userId: string,
  current: Food,
  next: UpdateCustomFoodInput,
): Promise<void> {
  if (!changesMacros(current, next)) return;
  const { reached, usedBy } = await collectDependentRecipes(tx, userId, current.id);
  await refreshInOrder(tx, userId, refreshOrder(reached, usedBy), 0);
}

/**
 * Refresh `order` from `index` on, one recipe at a time and inside the edit's
 * transaction: each refresh reads the ones before it.
 */
async function refreshInOrder(
  tx: DbExecutor,
  userId: string,
  order: readonly RecipeRef[],
  index: number,
): Promise<void> {
  const recipe = order.at(index);
  if (!recipe) return;
  await refreshBackingFood(tx, userId, recipe);
  await refreshInOrder(tx, userId, order, index + 1);
}


export const RECIPE_FOOD_DELETE_CONFLICT = "This food is a recipe. Delete the recipe instead.";

/**
 * Delete a user's custom food. Returns false if it isn't the user's custom food
 * (→ 404). Throws a 409 `AppError` if it's referenced by a log entry or a recipe
 * (the FK is restrict; deleting would fail anyway — history is preserved), or
 * if it is a recipe's backing food: `recipes.food_id` is restrict too, so that
 * delete used to fail as a generic 500 every time. The recipe delete decides
 * the backing food's fate. C39 (CODEBASE_ANALYSIS_2026-10-03)
 */
export async function deleteCustomFood(userId: string, id: string): Promise<boolean> {
  const [food] = await db
    .select({ id: foods.id })
    .from(foods)
    .where(and(eq(foods.id, id), eq(foods.createdByUserId, userId), eq(foods.source, "custom")));
  if (!food) return false;

  const backedRecipes = await db.select({ id: recipes.id }).from(recipes).where(eq(recipes.foodId, id));
  if (backedRecipes.length > 0) {
    throw new AppError(ErrorCode.CONFLICT, RECIPE_FOOD_DELETE_CONFLICT, 409);
  }

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


/**
 * Ids of the user's PRIVATE custom foods — including recipe-backing foods —
 * i.e. the set that must be erased with the account (public shares survive by
 * explicit opt-in). Used by account deletion to purge the foods' embeddings
 * from the separate vector DB, so it must be called BEFORE the user-delete
 * cascade set-nulls created_by_user_id (the only ownership signal).
 */
export async function listPrivateCustomFoodIds(userId: string): Promise<string[]> {
  const rows = await db
    .select({ id: foods.id })
    .from(foods)
    .where(
      and(eq(foods.createdByUserId, userId), eq(foods.source, "custom"), eq(foods.isPublic, false)),
    );
  return rows.map((r) => r.id);
}


/** A user's custom foods, EXCLUDING recipe-backing foods (those surface via /recipes). */
export async function listCustomFoods(userId: string): Promise<Food[]> {
  const rows = await db
    .select({ food: foods })
    .from(foods)
    .leftJoin(recipes, eq(recipes.foodId, foods.id))
    .where(and(eq(foods.createdByUserId, userId), eq(foods.source, "custom"), isNull(recipes.id)))
    .orderBy(asc(foods.name));
  return rows.map((r) => r.food);
}


// --- named servings (FR-2.4) ----------------------------------------------

/** A food's servings visible to the user: shared seed/USDA portions (NULL owner)
 *  plus the user's own personal portions. Ordered by grams for a stable picker. */
export async function getServings(foodId: string, userId: string): Promise<FoodServing[]> {
  return await db
    .select()
    .from(foodServings)
    .where(
      and(
        eq(foodServings.foodId, foodId),
        sql`(${foodServings.createdByUserId} IS NULL OR ${foodServings.createdByUserId} = ${userId})`,
      ),
    )
    .orderBy(asc(foodServings.grams));
}


/**
 * Cache enrichment servings (e.g. USDA portions) for a food, as shared rows.
 * Two first opens of a food at once both get here: uq_food_servings_shared
 * keeps one copy of each portion, and an open whose rows were already there
 * reads back the food's shared servings instead of returning a short list.
 * PF11 (CODEBASE_ANALYSIS_2026-10-03)
 */
export async function cacheServings(
  foodId: string,
  servings: { label: string; grams: number }[],
): Promise<FoodServing[]> {
  if (servings.length === 0) return [];
  const inserted = await db
    .insert(foodServings)
    .values(servings.map((s) => ({ foodId, label: s.label, grams: s.grams })))
    .onConflictDoNothing()
    .returning();
  if (inserted.length === servings.length) return inserted;
  return await db
    .select()
    .from(foodServings)
    .where(and(eq(foodServings.foodId, foodId), isNull(foodServings.createdByUserId)))
    .orderBy(asc(foodServings.grams));
}


/**
 * Add a PERSONAL named portion to any food visible to the user (a USDA/OFF food
 * or one of their own). undefined → 404 (food not visible). Idempotent: a repeat
 * of the same (food, label) for this user returns the existing row rather than
 * duplicating it. Always stamped with the owner, so it stays private to them.
 */
export async function createServing(
  userId: string,
  foodId: string,
  input: ServingInput,
): Promise<FoodServing | undefined> {
  const food = await getVisibleFoodById(userId, foodId);
  if (!food) return undefined;
  const [existing] = await db
    .select()
    .from(foodServings)
    .where(
      and(
        eq(foodServings.foodId, foodId),
        eq(foodServings.createdByUserId, userId),
        sql`lower(${foodServings.label}) = lower(${input.label})`,
      ),
    );
  if (existing) return existing;
  const [row] = await db
    .insert(foodServings)
    .values({ foodId, label: input.label, grams: input.grams, createdByUserId: userId })
    .returning();
  return row;
}


/** Delete a serving the user owns — either a personal portion they created or a
 *  serving on a food they own. A shared USDA portion (both owners NULL) never
 *  matches, so it can never be deleted. false → 404. */
export async function deleteServing(userId: string, servingId: string): Promise<boolean> {
  const rows = await db
    .select({ id: foodServings.id })
    .from(foodServings)
    .innerJoin(foods, eq(foodServings.foodId, foods.id))
    .where(
      and(
        eq(foodServings.id, servingId),
        sql`(${foodServings.createdByUserId} = ${userId} OR ${foods.createdByUserId} = ${userId})`,
      ),
    );
  if (rows.length === 0) return false;
  await db.delete(foodServings).where(eq(foodServings.id, servingId));
  return true;
}
