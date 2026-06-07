import type {
  AddFavoriteInput,
  CreateFoodLogInput,
  DailySummaryResponse,
  Food,
  FoodLogEntry,
  FoodSearchResponse,
  RepeatDayInput,
  RepeatDayResponse,
  UpdateFoodLogInput,
} from "@shared/schema";

import { typedRequest } from "./client";

/**
 * Client surface for the nutrition module (Phase 1). Mirrors the server routes
 * and shares request/response types from @shared/schema so the two layers can't
 * drift. Gated behind VITE_NUTRITION_ENABLED at the route/nav level; the server
 * 404s every call when its own flag is off.
 */
export const nutrition = {
  search: (q: string) =>
    typedRequest<FoodSearchResponse>(
      "GET",
      `/api/v1/nutrition/foods/search?q=${encodeURIComponent(q)}`,
    ),

  recent: () => typedRequest<Food[]>("GET", "/api/v1/nutrition/foods/recent"),

  getSummary: (date?: string) =>
    typedRequest<DailySummaryResponse>(
      "GET",
      date ? `/api/v1/nutrition/summary?date=${date}` : "/api/v1/nutrition/summary",
    ),

  createLog: (data: CreateFoodLogInput) =>
    typedRequest<FoodLogEntry>("POST", "/api/v1/nutrition/logs", data),

  updateLog: (id: string, data: UpdateFoodLogInput) =>
    typedRequest<FoodLogEntry>("PATCH", `/api/v1/nutrition/logs/${id}`, data),

  deleteLog: (id: string) =>
    typedRequest<{ success: boolean }>("DELETE", `/api/v1/nutrition/logs/${id}`),

  listFavorites: () => typedRequest<Food[]>("GET", "/api/v1/nutrition/favorites"),

  addFavorite: (data: AddFavoriteInput) =>
    typedRequest<{ success: boolean }>("POST", "/api/v1/nutrition/favorites", data),

  removeFavorite: (foodId: string) =>
    typedRequest<{ success: boolean }>(
      "DELETE",
      `/api/v1/nutrition/favorites/${encodeURIComponent(foodId)}`,
    ),

  repeatDay: (data: RepeatDayInput) =>
    typedRequest<RepeatDayResponse>("POST", "/api/v1/nutrition/logs/repeat", data),
} as const;
