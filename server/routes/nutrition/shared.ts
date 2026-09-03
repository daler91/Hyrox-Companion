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
