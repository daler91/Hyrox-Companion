import type { Food } from "@shared/schema";

import { storage } from "../../storage";
import { resolveFatSecretBarcode } from "./fatsecretClient";
import { resolveBarcode } from "./offClient";
import { refreshStaleFoodsInBackground } from "./refresh";

/**
 * Resolve a barcode to a Food (FR-2.1). Order: local cache → FatSecret (verified,
 * highest branded barcode hit-rate) → Open Food Facts (long-tail safety net).
 *
 * Cached OFF foods are keyed by the barcode itself, so a repeat scan hits cache.
 * FatSecret foods are keyed by their food_id (not the barcode), so a FatSecret
 * barcode re-resolves on a repeat scan — cheap, because barcode-capable FatSecret
 * tiers have unlimited calls, and the upsert dedupes by food_id so no duplicate
 * row is created. (A future `foods.barcode` column would let FatSecret barcodes
 * hit cache too.) Returns null when the barcode isn't recognized anywhere — the
 * route turns that into a 404. Never throws on a provider being unavailable; both
 * resolvers degrade to null.
 */
export async function lookupBarcode(code: string): Promise<Food | null> {
  const cached = await storage.nutrition.getFoodBySourceId("off", code);
  if (cached) {
    refreshStaleFoodsInBackground([cached]);
    return cached;
  }

  // FatSecret first (branded barcode strength); fall back to OFF only when it has
  // nothing (unknown barcode or unavailable).
  const mapped = (await resolveFatSecretBarcode(code)) ?? (await resolveBarcode(code));
  if (!mapped) return null;

  const [food] = await storage.nutrition.upsertFoods([mapped]);
  return food ?? null;
}
