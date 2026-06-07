import type {
  CreateCustomFoodInput,
  CreateFoodLogInput,
  CreateRecipeInput,
  DailySummaryResponse,
  Food,
  FoodLogEntry,
  FoodSearchResponse,
  FoodWithServingsResponse,
  RecipeListItem,
  RecipeWithIngredients,
  RepeatDayInput,
  RepeatDayResponse,
  UpdateCustomFoodInput,
  UpdateFoodLogInput,
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
    invalidateQueries: [QUERY_KEYS.nutritionDay(date), QUERY_KEYS.nutritionRecent],
    successToast: "Food logged",
    errorToast: "Couldn't log that food",
  });
}

export function useUpdateLog(date: string) {
  return useApiMutation<FoodLogEntry, Error, { id: string; data: UpdateFoodLogInput }>({
    mutationFn: ({ id, data }) => api.nutrition.updateLog(id, data),
    invalidateQueries: [QUERY_KEYS.nutritionDay(date)],
    successToast: "Entry updated",
    errorToast: "Couldn't update that entry",
  });
}

export function useDeleteLog(date: string) {
  return useApiMutation<{ success: boolean }, Error, string>({
    mutationFn: (id) => api.nutrition.deleteLog(id),
    invalidateQueries: [QUERY_KEYS.nutritionDay(date)],
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
    invalidateQueries: [QUERY_KEYS.nutritionDay(date), QUERY_KEYS.nutritionRecent],
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
