import type { Food } from "@shared/schema";

import { storage } from "../../storage";
import { resolveBarcode } from "./offClient";

/**
 * Resolve a barcode to a Food (FR-2.1). Hits the local `foods` cache first
 * (OFF foods are shared, keyed by the barcode), then Open Food Facts, caching
 * the result. Returns null when the barcode isn't recognized — the route turns
 * that into a 404. Never throws on OFF being unavailable (resolveBarcode handles it).
 */
export async function lookupBarcode(code: string): Promise<Food | null> {
  const cached = await storage.nutrition.getFoodBySourceId("off", code);
  if (cached) return cached;

  const mapped = await resolveBarcode(code);
  if (!mapped) return null;

  const [food] = await storage.nutrition.upsertFoods([mapped]);
  return food ?? null;
}
