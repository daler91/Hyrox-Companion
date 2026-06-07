import type {
  CreateFoodLogInput,
  DailySummaryResponse,
  Food,
  FoodLogEntry,
  FoodSearchResponse,
  RepeatDayInput,
  RepeatDayResponse,
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
