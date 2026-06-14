import type { Food } from "@shared/schema";

import { storage } from "../../storage";
import { resolveBarcode } from "./offClient";
import { refreshStaleFoodsInBackground } from "./refresh";
import { resolveSpoonacularBarcode } from "./spoonacularClient";

/**
 * Resolve a barcode to a Food (FR-2.1). Order: local cache → Spoonacular (verified
 * branded UPC data) → Open Food Facts (long-tail safety net).
 *
 * Cached OFF foods are keyed by the barcode itself, so a repeat scan hits cache.
 * Spoonacular foods are keyed by their product id (not the barcode), so a
 * Spoonacular barcode re-resolves on a repeat scan — the upsert dedupes by product
 * id so no duplicate row is created. (A future `foods.barcode` column would let
 * Spoonacular barcodes hit cache too.) Returns null when the barcode isn't
 * recognized anywhere — the route turns that into a 404. Never throws on a
 * provider being unavailable; both resolvers degrade to null.
 */
export async function lookupBarcode(code: string): Promise<Food | null> {
  const cached = await storage.nutrition.getFoodBySourceId("off", code);
  if (cached) {
    refreshStaleFoodsInBackground([cached]);
    return cached;
  }

  // Spoonacular first (branded barcode strength); fall back to OFF only when it
  // has nothing (unknown barcode or unavailable).
  const mapped = (await resolveSpoonacularBarcode(code)) ?? (await resolveBarcode(code));
  if (!mapped) return null;

  const [food] = await storage.nutrition.upsertFoods([mapped]);
  return food ?? null;
}
