import type {
  BatchLogResponse,
  BlockViewResponse,
  CreateCustomFoodInput,
  CreateFoodLogBatchInput,
  CreateFoodLogInput,
  CreateRecipeInput,
  DailySummaryResponse,
  Food,
  FoodLogEntry,
  FoodSearchResponse,
  FoodServing,
  FoodWithServingsResponse,
  FuellingRangeResponse,
  MealTarget,
  MealType,
  MicroSummaryResponse,
  NutritionInsightsResponse,
  NutritionTarget,
  NutritionTargetsResponse,
  ParseMealResponse,
  RecipeListItem,
  RecipeWithIngredients,
  RepeatDayInput,
  RepeatDayResponse,
  ServingInput,
  SessionFuellingResponse,
  UpdateCustomFoodInput,
  UpdateFoodLogInput,
  UpsertMealTargetInput,
  UpsertNutritionTargetInput,
} from "@shared/schema";
import { useQuery } from "@tanstack/react-query";

import { useApiMutation } from "@/hooks/useApiMutation";
import { api, QUERY_KEYS } from "@/lib/api";

/** Daily summary (totals + per-meal entries) for a local calendar date (FR-1.3). */
export function useNutritionDay(date: string) {
  return useQuery<DailySummaryResponse>({
    queryKey: QUERY_KEYS.nutritionDay(date),
    queryFn: () => api.nutrition.getSummary(date),
  });
}

/** Debounced-by-caller food search; only fires once the term is meaningful. */
export function useSearchFoods(query: string) {
  return useQuery<FoodSearchResponse>({
    queryKey: QUERY_KEYS.nutritionSearch(query),
    queryFn: () => api.nutrition.search(query),
    enabled: query.trim().length >= 2,
    staleTime: 60_000,
  });
}

export function useRecentFoods(enabled = true) {
  return useQuery<Food[]>({
    queryKey: QUERY_KEYS.nutritionRecent,
    queryFn: () => api.nutrition.recent(),
    enabled,
  });
}

export function useFavorites(enabled = true) {
  return useQuery<Food[]>({
    queryKey: QUERY_KEYS.nutritionFavorites,
    queryFn: () => api.nutrition.listFavorites(),
    enabled,
  });
}

export function useLogFood(date: string) {
  return useApiMutation<FoodLogEntry, Error, CreateFoodLogInput>({
    mutationFn: (input) => api.nutrition.createLog(input),
    invalidateQueries: [
      QUERY_KEYS.nutritionDay(date),
      QUERY_KEYS.nutritionRecent,
      QUERY_KEYS.nutritionRangePrefix,
    ],
    successToast: "Food logged",
    errorToast: "Couldn't log that food",
  });
}

export function useUpdateLog(date: string) {
  return useApiMutation<FoodLogEntry, Error, { id: string; data: UpdateFoodLogInput }>({
    mutationFn: ({ id, data }) => api.nutrition.updateLog(id, data),
    invalidateQueries: [QUERY_KEYS.nutritionDay(date), QUERY_KEYS.nutritionRangePrefix],
    successToast: "Entry updated",
    errorToast: "Couldn't update that entry",
  });
}

export function useDeleteLog(date: string) {
  return useApiMutation<{ success: boolean }, Error, string>({
    mutationFn: (id) => api.nutrition.deleteLog(id),
    invalidateQueries: [QUERY_KEYS.nutritionDay(date), QUERY_KEYS.nutritionRangePrefix],
    successToast: "Entry removed",
    errorToast: "Couldn't remove that entry",
  });
}

export function useToggleFavorite() {
  return useApiMutation<{ success: boolean }, Error, { foodId: string; isFavorite: boolean }>({
    mutationFn: ({ foodId, isFavorite }) =>
      isFavorite ? api.nutrition.removeFavorite(foodId) : api.nutrition.addFavorite({ foodId }),
    invalidateQueries: [QUERY_KEYS.nutritionFavorites],
  });
}

export function useRepeatDay(date: string) {
  return useApiMutation<RepeatDayResponse, Error, RepeatDayInput>({
    mutationFn: (input) => api.nutrition.repeatDay(input),
    invalidateQueries: [
      QUERY_KEYS.nutritionDay(date),
      QUERY_KEYS.nutritionRecent,
      QUERY_KEYS.nutritionRangePrefix,
    ],
    successToast: (data) => ({
      title: `Repeated ${data.created} item${data.created === 1 ? "" : "s"}`,
    }),
    errorToast: "Couldn't repeat that day",
  });
}

// --- Phase 2: barcode / food detail / custom foods / recipes ----------------

/** A food + its named servings, loaded when the log dialog opens (FR-2.4). */
export function useFoodWithServings(id: string | null) {
  return useQuery<FoodWithServingsResponse>({
    queryKey: QUERY_KEYS.nutritionFood(id ?? "none"),
    queryFn: () => api.nutrition.getFood(id as string),
    enabled: !!id,
    staleTime: 5 * 60 * 1000,
  });
}

/** Add a personal named portion (e.g. "1 slice") to a food while logging. No
 *  success toast — selecting the new portion in the dialog is the feedback.
 *  Invalidates the food detail so the serving list refetches with it included. */
export function useAddServing(foodId: string) {
  return useApiMutation<FoodServing, Error, ServingInput>({
    mutationFn: (input) => api.nutrition.addServing(foodId, input),
    invalidateQueries: [QUERY_KEYS.nutritionFood(foodId)],
    errorToast: "Couldn't add that portion",
  });
}

/** Remove one of the user's own personal portions from a food. */
export function useRemoveServing(foodId: string) {
  return useApiMutation<{ success: boolean }, Error, string>({
    mutationFn: (servingId) => api.nutrition.removeServing(foodId, servingId),
    invalidateQueries: [QUERY_KEYS.nutritionFood(foodId)],
    successToast: "Portion removed",
    errorToast: "Couldn't remove that portion",
  });
}

export function useBarcodeLookup() {
  return useApiMutation<Food, Error, string>({
    mutationFn: (code) => api.nutrition.lookupBarcode(code),
    errorToast: "Couldn't find that barcode",
  });
}

export function useCustomFoods(enabled = true) {
  return useQuery<Food[]>({
    queryKey: QUERY_KEYS.nutritionCustomFoods,
    queryFn: () => api.nutrition.listCustomFoods(),
    enabled,
  });
}

export function useCreateCustomFood() {
  return useApiMutation<Food, Error, CreateCustomFoodInput>({
    mutationFn: (input) => api.nutrition.createCustomFood(input),
    invalidateQueries: [QUERY_KEYS.nutritionCustomFoods],
    successToast: "Custom food saved",
    errorToast: "Couldn't save that food",
  });
}

export function useUpdateCustomFood() {
  return useApiMutation<Food, Error, { id: string; data: UpdateCustomFoodInput }>({
    mutationFn: ({ id, data }) => api.nutrition.updateCustomFood(id, data),
    invalidateQueries: [QUERY_KEYS.nutritionCustomFoods],
    successToast: "Custom food updated",
    errorToast: "Couldn't update that food",
  });
}

export function useDeleteCustomFood() {
  return useApiMutation<{ success: boolean }, Error, string>({
    mutationFn: (id) => api.nutrition.deleteCustomFood(id),
    invalidateQueries: [QUERY_KEYS.nutritionCustomFoods],
    successToast: "Custom food deleted",
    errorToast: "Couldn't delete that food",
  });
}

export function useRecipes(enabled = true) {
  return useQuery<RecipeListItem[]>({
    queryKey: QUERY_KEYS.nutritionRecipes,
    queryFn: () => api.nutrition.listRecipes(),
    enabled,
  });
}

export function useRecipe(id: string | null) {
  return useQuery<RecipeWithIngredients>({
    queryKey: QUERY_KEYS.nutritionRecipe(id ?? "none"),
    queryFn: () => api.nutrition.getRecipe(id as string),
    enabled: !!id,
  });
}

export function useCreateRecipe() {
  return useApiMutation<RecipeWithIngredients, Error, CreateRecipeInput>({
    mutationFn: (input) => api.nutrition.createRecipe(input),
    invalidateQueries: [QUERY_KEYS.nutritionRecipes, QUERY_KEYS.nutritionCustomFoods],
    successToast: "Recipe saved",
    errorToast: "Couldn't save that recipe",
  });
}

export function useUpdateRecipe() {
  return useApiMutation<RecipeWithIngredients, Error, { id: string; data: CreateRecipeInput }>({
    mutationFn: ({ id, data }) => api.nutrition.updateRecipe(id, data),
    invalidateQueries: [QUERY_KEYS.nutritionRecipes],
    successToast: "Recipe updated",
    errorToast: "Couldn't update that recipe",
  });
}

export function useDeleteRecipe() {
  return useApiMutation<{ success: boolean }, Error, string>({
    mutationFn: (id) => api.nutrition.deleteRecipe(id),
    invalidateQueries: [QUERY_KEYS.nutritionRecipes, QUERY_KEYS.nutritionCustomFoods],
    successToast: "Recipe deleted",
    errorToast: "Couldn't delete that recipe",
  });
}

// --- Phase 3: fuelling around a session / block intake-vs-load --------------

/** A session's pre/post fuelling (FR-3.1/3.2/3.4); only fires for a real workout. */
export function useSessionFuelling(workoutId: string | null, enabled = true) {
  return useQuery<SessionFuellingResponse>({
    queryKey: QUERY_KEYS.nutritionSessionFuelling(workoutId ?? "none"),
    queryFn: () => api.nutrition.getSessionFuelling(workoutId as string),
    enabled: enabled && !!workoutId,
    staleTime: 60_000,
  });
}

/** Daily intake macros vs training UTSS over a block range (FR-3.3). */
export function useBlockView(from: string, to: string, enabled = true) {
  return useQuery<BlockViewResponse>({
    queryKey: QUERY_KEYS.nutritionBlock(from, to),
    queryFn: () => api.nutrition.getBlock(from, to),
    enabled: enabled && from.length > 0,
    staleTime: 60_000,
  });
}

/**
 * Per-day fuelling progress over a date range, for the Timeline home-screen chips
 * (Phase 2). One request for the whole visible window. `refetchOnMount` keeps the
 * chips fresh when returning to the Timeline after logging elsewhere.
 */
export function useFuellingRange(from: string, to: string, enabled = true) {
  return useQuery<FuellingRangeResponse>({
    queryKey: QUERY_KEYS.nutritionRange(from, to),
    queryFn: () => api.nutrition.getFuellingRange(from, to),
    enabled: enabled && from.length > 0 && to.length > 0,
    staleTime: 60_000,
    refetchOnMount: true,
  });
}

// --- Phase 4: natural-language meal logging ---------------------------------

/** Parse a free-text meal into suggested items (FR-4.1). Opens the review sheet
 *  on success, so no success toast; errors map AI codes (consent/budget). */
export function useParseMealText() {
  return useApiMutation<ParseMealResponse, Error, string>({
    mutationFn: (text) => api.nutrition.parseMealText(text),
    errorToast: "Couldn't read that meal",
  });
}

/** Parse a meal *photo* into suggested items (FR-4.1, photo path). Opens the
 *  review sheet on success, so no success toast; errors map AI codes. */
export function useParseMealPhoto() {
  return useApiMutation<ParseMealResponse, Error, { imageBase64: string; mimeType: string }>({
    mutationFn: ({ imageBase64, mimeType }) => api.nutrition.parseMealPhoto(imageBase64, mimeType),
    errorToast: "Couldn't read that photo",
  });
}

/** Confirm the reviewed items: persist them in one batch (FR-4.1). */
export function useLogMealBatch(date: string) {
  return useApiMutation<BatchLogResponse, Error, CreateFoodLogBatchInput>({
    mutationFn: (data) => api.nutrition.createLogBatch(data),
    invalidateQueries: [
      QUERY_KEYS.nutritionDay(date),
      QUERY_KEYS.nutritionRecent,
      QUERY_KEYS.nutritionRangePrefix,
    ],
    successToast: (data) => ({
      title: `Logged ${data.created} item${data.created === 1 ? "" : "s"}`,
    }),
    errorToast: "Couldn't log those items",
  });
}

// --- Phase 5: targets -------------------------------------------------------

/** The user's current macro/calorie target (for today) + version history (FR-5.2). */
export function useNutritionTargets(enabled = true) {
  return useQuery<NutritionTargetsResponse>({
    queryKey: QUERY_KEYS.nutritionTargets,
    queryFn: () => api.nutrition.getTargets(),
    enabled,
  });
}

export function useSetTarget() {
  return useApiMutation<NutritionTarget, Error, UpsertNutritionTargetInput>({
    mutationFn: (data) => api.nutrition.setTarget(data),
    invalidateQueries: [QUERY_KEYS.nutritionTargets],
    successToast: "Targets saved",
    errorToast: "Couldn't save targets",
  });
}

/** Pin one meal's macro/calorie target (per-meal fuelling override). */
export function useSetMealTargetOverride(date: string) {
  return useApiMutation<MealTarget, Error, UpsertMealTargetInput>({
    mutationFn: (data) => api.nutrition.setMealTargetOverride(data),
    invalidateQueries: [QUERY_KEYS.nutritionDay(date)],
    successToast: "Meal target saved",
    errorToast: "Couldn't save meal target",
  });
}

/** Clear one meal's override, reverting it to the suggested split. */
export function useClearMealTargetOverride(date: string) {
  return useApiMutation<{ success: boolean }, Error, MealType>({
    mutationFn: (mealType) => api.nutrition.clearMealTargetOverride(mealType),
    invalidateQueries: [QUERY_KEYS.nutritionDay(date)],
    successToast: "Reset to suggested",
    errorToast: "Couldn't reset that meal",
  });
}

/** The day's micronutrient totals vs reference daily intakes (FR-5.1). */
export function useMicros(date: string) {
  return useQuery<MicroSummaryResponse>({
    queryKey: QUERY_KEYS.nutritionMicros(date),
    queryFn: () => api.nutrition.getMicros(date),
  });
}

/** The last stored AI nutrition insights — no AI spend; authoritative until
 *  regenerated, so treated as fresh across remounts (FR-5.3). */
export function useNutritionInsights(enabled = true) {
  return useQuery<NutritionInsightsResponse>({
    queryKey: QUERY_KEYS.nutritionInsights,
    queryFn: () => api.nutrition.getInsights(),
    enabled,
    staleTime: Infinity,
    gcTime: Infinity,
  });
}

/** Regenerate the AI nutrition insights (spends AI); refreshes the cached query. */
export function useRegenerateNutritionInsights() {
  return useApiMutation<NutritionInsightsResponse, Error, void>({
    mutationFn: () => api.nutrition.regenerateInsights(),
    invalidateQueries: [QUERY_KEYS.nutritionInsights],
    errorToast: "Couldn't generate insights",
  });
}
