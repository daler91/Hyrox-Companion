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
  sql,
} from "drizzle-orm";

import { db, type DbExecutor } from "../db";
import { env } from "../env";
import { AppError, ErrorCode } from "../errors";
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

  return db
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


export async function updateCustomFood(
  userId: string,
  id: string,
  patch: UpdateCustomFoodInput,
): Promise<Food | undefined> {
  const [row] = await db
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
    .where(and(eq(foods.id, id), eq(foods.createdByUserId, userId), eq(foods.source, "custom")))
    .returning();
  return row;
}


/**
 * Delete a user's custom food. Returns false if it isn't the user's custom food
 * (→ 404). Throws a 409 `AppError` if it's referenced by a log entry or a recipe
 * (the FK is restrict; deleting would fail anyway — history is preserved).
 */
export async function deleteCustomFood(userId: string, id: string): Promise<boolean> {
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
  return db
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


/** Cache enrichment servings (e.g. USDA portions) for a food. */
export async function cacheServings(
  foodId: string,
  servings: { label: string; grams: number }[],
): Promise<FoodServing[]> {
  if (servings.length === 0) return [];
  return db
    .insert(foodServings)
    .values(servings.map((s) => ({ foodId, label: s.label, grams: s.grams })))
    .returning();
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
