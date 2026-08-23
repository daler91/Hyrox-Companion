import type { UnitPreferences } from "@shared/unitConversion";

import { storage } from "../storage";

/**
 * The athlete's display units, for write paths that must record what unit an
 * incoming number is in (audit L4).
 *
 * Every `exercise_sets` insert now stamps the unit its numbers arrived in. Most
 * write paths already carry the athlete's preferences; the few that only carry
 * a `userId` use this rather than each growing its own `getUser` call and its
 * own idea of what to do when the row is missing.
 *
 * A missing user falls back to the schema defaults (kg / km) — the same values
 * `users.weight_unit` and `users.distance_unit` default to, so a row written
 * through this path is stamped with the unit it would have been written in
 * anyway. It cannot silently mean something else.
 */
export async function loadUnitPreferences(userId: string): Promise<UnitPreferences> {
  const user = await storage.users.getUser(userId);
  return { weightUnit: user?.weightUnit ?? "kg", distanceUnit: user?.distanceUnit ?? "km" };
}
