/**
 * Data access for the nutrition module. Follows the codebase's majority storage
 * pattern: uses `db` directly, with an optional `DbExecutor` only where a caller
 * might compose a transaction. Every per-user read/write scopes its SQL `WHERE`
 * by `userId`, so a foreign id resolves to "not found" rather than leaking.
 *
 * The implementations live in the per-sub-domain modules imported below (A8);
 * this class binds them under their original names so `storage.nutrition.X()`
 * and every existing mock keep working.
 */
import {
  addFavorite,
  listFavorites,
  removeFavorite,
} from "./nutritionFavorites";
import {
  cacheServings,
  createCustomFood,
  createServing,
  deleteCustomFood,
  deleteServing,
  getFoodBySourceId,
  getRecentFoods,
  getServings,
  getVisibleFoodById,
  getVisibleFoodsByIds,
  listCustomFoods,
  listPrivateCustomFoodIds,
  searchLocalFoods,
  updateCustomFood,
  upsertFoods,
} from "./nutritionFoods";
import {
  countLogEntries,
  createLogEntriesBatch,
  createLogEntry,
  deleteLogEntry,
  getLatestLogDate,
  hasEntriesOnDate,
  hasEntriesSince,
  listEntriesWithFoodForDate,
  listEntriesWithFoodForDateRange,
  listEntriesWithFoodInWindow,
  repeatDay,
  updateLogEntry,
} from "./nutritionLogs";
import {
  createRecipe,
  deleteRecipe,
  getRecipeWithIngredients,
  listRecipes,
  updateRecipe,
} from "./nutritionRecipes";
import {
  createTarget,
  deleteMealTarget,
  getCurrentTarget,
  getMealTargetOverrides,
  listTargets,
  upsertMealTarget,
} from "./nutritionTargets";

export {
  buildLastPortionsQuery,
  buildVariantMatch,
  type LocalFood,
  retryOnceOnUniqueViolation,
  TRGM_SIMILARITY_THRESHOLD,
  visibleTo,
} from "./nutritionShared";

export class NutritionStorage {
  readonly searchLocalFoods = searchLocalFoods;
  readonly upsertFoods = upsertFoods;
  readonly getVisibleFoodById = getVisibleFoodById;
  readonly getFoodBySourceId = getFoodBySourceId;
  readonly getVisibleFoodsByIds = getVisibleFoodsByIds;
  readonly getRecentFoods = getRecentFoods;
  readonly createCustomFood = createCustomFood;
  readonly updateCustomFood = updateCustomFood;
  readonly deleteCustomFood = deleteCustomFood;
  readonly listPrivateCustomFoodIds = listPrivateCustomFoodIds;
  readonly listCustomFoods = listCustomFoods;
  readonly getServings = getServings;
  readonly cacheServings = cacheServings;
  readonly createServing = createServing;
  readonly deleteServing = deleteServing;
  readonly createLogEntry = createLogEntry;
  readonly createLogEntriesBatch = createLogEntriesBatch;
  readonly listEntriesWithFoodForDate = listEntriesWithFoodForDate;
  readonly hasEntriesOnDate = hasEntriesOnDate;
  readonly hasEntriesSince = hasEntriesSince;
  readonly listEntriesWithFoodInWindow = listEntriesWithFoodInWindow;
  readonly listEntriesWithFoodForDateRange = listEntriesWithFoodForDateRange;
  readonly updateLogEntry = updateLogEntry;
  readonly deleteLogEntry = deleteLogEntry;
  readonly repeatDay = repeatDay;
  readonly listFavorites = listFavorites;
  readonly addFavorite = addFavorite;
  readonly removeFavorite = removeFavorite;
  readonly createRecipe = createRecipe;
  readonly updateRecipe = updateRecipe;
  readonly deleteRecipe = deleteRecipe;
  readonly listRecipes = listRecipes;
  readonly getRecipeWithIngredients = getRecipeWithIngredients;
  readonly getLatestLogDate = getLatestLogDate;
  readonly countLogEntries = countLogEntries;
  readonly getCurrentTarget = getCurrentTarget;
  readonly listTargets = listTargets;
  readonly createTarget = createTarget;
  readonly getMealTargetOverrides = getMealTargetOverrides;
  readonly upsertMealTarget = upsertMealTarget;
  readonly deleteMealTarget = deleteMealTarget;
}
