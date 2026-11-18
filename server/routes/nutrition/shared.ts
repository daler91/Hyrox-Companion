import type { Food, ParsedFoodItem } from "@shared/schema";

import { storage } from "../../storage";

// Pieces used by more than one nutrition sub-route module. Anything used by
// a single module stays private to that module.

export const FOOD_NOT_FOUND = "Food not found";
export const LOG_ENTRY_NOT_FOUND = "Log entry not found";
export const RECIPE_NOT_FOUND = "Recipe not found";

/** Resolve the user's IANA timezone, defaulting to UTC pre-detection. */
export async function getUserTimezone(userId: string): Promise<string> {
  const user = await storage.users.getUser(userId);
  return user?.userTimezone ?? "UTC";
}

/**
 * Null a food's owner id unless the requester is the owner. A public custom or
 * recipe-backing food is visible to every searcher, and its internal Clerk user
 * id would let anyone link all of that author's shared foods. The client never
 * reads `foods.createdByUserId`, so the owner keeps theirs and everyone else
 * sees null. Every route that returns a whole food row goes through this:
 * search, recent, food detail, favourites and the parsed-meal items.
 * P16 (CODEBASE_ANALYSIS_2026-10-03)
 */
export function redactFoodOwner<T extends Food>(food: T, userId: string): T {
  if (food.createdByUserId == null || food.createdByUserId === userId) return food;
  return { ...food, createdByUserId: null };
}

/** redactFoodOwner over a parsed meal's items, whose matched `food` may be another athlete's public food. */
export function redactParsedFoodOwners(items: ParsedFoodItem[], userId: string): ParsedFoodItem[] {
  return items.map((item) => (item.food ? { ...item, food: redactFoodOwner(item.food, userId) } : item));
}
