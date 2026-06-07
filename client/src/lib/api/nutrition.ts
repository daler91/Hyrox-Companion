import type {
  AddFavoriteInput,
  CreateCustomFoodInput,
  CreateFoodLogInput,
  CreateRecipeInput,
  DailySummaryResponse,
  Food,
  FoodLogEntry,
  FoodSearchResponse,
  FoodServing,
  FoodWithServingsResponse,
  RecipeListItem,
  RecipeWithIngredients,
  RepeatDayInput,
  RepeatDayResponse,
  ServingInput,
  UpdateCustomFoodInput,
  UpdateFoodLogInput,
} from "@shared/schema";

import { typedRequest } from "./client";

const base = "/api/v1/nutrition";
const enc = encodeURIComponent;

/**
 * Client surface for the nutrition module. Mirrors the server routes and shares
 * request/response types from @shared/schema so the two layers can't drift.
 * Gated behind VITE_NUTRITION_ENABLED at the route/nav level; the server 404s
 * every call when its own flag is off.
 */
export const nutrition = {
  // --- Phase 1: search / log / favorites ---
  search: (q: string) =>
    typedRequest<FoodSearchResponse>("GET", `${base}/foods/search?q=${enc(q)}`),

  recent: () => typedRequest<Food[]>("GET", `${base}/foods/recent`),

  getSummary: (date?: string) =>
    typedRequest<DailySummaryResponse>(
      "GET",
      date ? `${base}/summary?date=${date}` : `${base}/summary`,
    ),

  createLog: (data: CreateFoodLogInput) =>
    typedRequest<FoodLogEntry>("POST", `${base}/logs`, data),

  updateLog: (id: string, data: UpdateFoodLogInput) =>
    typedRequest<FoodLogEntry>("PATCH", `${base}/logs/${enc(id)}`, data),

  deleteLog: (id: string) =>
    typedRequest<{ success: boolean }>("DELETE", `${base}/logs/${enc(id)}`),

  listFavorites: () => typedRequest<Food[]>("GET", `${base}/favorites`),

  addFavorite: (data: AddFavoriteInput) =>
    typedRequest<{ success: boolean }>("POST", `${base}/favorites`, data),

  removeFavorite: (foodId: string) =>
    typedRequest<{ success: boolean }>("DELETE", `${base}/favorites/${enc(foodId)}`),

  repeatDay: (data: RepeatDayInput) =>
    typedRequest<RepeatDayResponse>("POST", `${base}/logs/repeat`, data),

  // --- Phase 2: barcode / food detail / custom foods / servings / recipes ---
  lookupBarcode: (code: string) =>
    typedRequest<Food>("POST", `${base}/foods/barcode`, { code }),

  getFood: (id: string) =>
    typedRequest<FoodWithServingsResponse>("GET", `${base}/foods/${enc(id)}`),

  listCustomFoods: () => typedRequest<Food[]>("GET", `${base}/foods/custom`),

  createCustomFood: (data: CreateCustomFoodInput) =>
    typedRequest<Food>("POST", `${base}/foods`, data),

  updateCustomFood: (id: string, data: UpdateCustomFoodInput) =>
    typedRequest<Food>("PATCH", `${base}/foods/${enc(id)}`, data),

  deleteCustomFood: (id: string) =>
    typedRequest<{ success: boolean }>("DELETE", `${base}/foods/${enc(id)}`),

  addServing: (foodId: string, data: ServingInput) =>
    typedRequest<FoodServing>("POST", `${base}/foods/${enc(foodId)}/servings`, data),

  removeServing: (foodId: string, servingId: string) =>
    typedRequest<{ success: boolean }>("DELETE", `${base}/foods/${enc(foodId)}/servings/${enc(servingId)}`),

  listRecipes: () => typedRequest<RecipeListItem[]>("GET", `${base}/recipes`),

  getRecipe: (id: string) =>
    typedRequest<RecipeWithIngredients>("GET", `${base}/recipes/${enc(id)}`),

  createRecipe: (data: CreateRecipeInput) =>
    typedRequest<RecipeWithIngredients>("POST", `${base}/recipes`, data),

  updateRecipe: (id: string, data: CreateRecipeInput) =>
    typedRequest<RecipeWithIngredients>("PATCH", `${base}/recipes/${enc(id)}`, data),

  deleteRecipe: (id: string) =>
    typedRequest<{ success: boolean }>("DELETE", `${base}/recipes/${enc(id)}`),
} as const;
