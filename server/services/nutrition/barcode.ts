import type { Food } from "@shared/schema";

import { logger } from "../../logger";
import { storage } from "../../storage";
import { resolveEdamamBarcode } from "./edamamClient";
import { resolveBarcode } from "./offClient";
import { refreshStaleFoodsInBackground } from "./refresh";
import type { MappedFood } from "./types";

/**
 * OFF's resolver throws once its retries are exhausted (outage, 429). D43
 * (CODEBASE_ANALYSIS_2026-10-03): treat that as "not recognized" so the route
 * returns its 404 → add-a-custom-food path instead of a 500.
 */
async function resolveOffBarcodeSafely(code: string): Promise<MappedFood | null> {
  try {
    return await resolveBarcode(code);
  } catch (err) {
    // `code` is a product barcode (public GTIN), not user data.
    // bearer:disable javascript_lang_logger_leak
    logger.warn({ err, code }, "[nutrition] Open Food Facts barcode lookup failed");
    return null;
  }
}

/**
 * Resolve a barcode to a Food (FR-2.1). Order: local cache → Edamam (curated
 * branded UPC data) → Open Food Facts (long-tail safety net).
 *
 * Cached OFF foods are keyed by the barcode itself, so a repeat scan hits cache.
 * Edamam foods are keyed by their foodId (not the barcode), so an Edamam barcode
 * re-resolves on a repeat scan — the upsert dedupes by foodId so no duplicate row
 * is created. (A future `foods.barcode` column would let Edamam barcodes hit cache
 * too.) Returns null when the barcode isn't recognized anywhere — the route turns
 * that into a 404. Never throws on a provider being unavailable; both resolvers
 * degrade to null.
 */
export async function lookupBarcode(code: string): Promise<Food | null> {
  const cached = await storage.nutrition.getFoodBySourceId("off", code);
  if (cached) {
    logger.info({ code, source: cached.source }, "[nutrition] barcode resolved from cache");
    refreshStaleFoodsInBackground([cached]);
    return cached;
  }

  // Edamam first (curated branded UPC data); fall back to OFF only when it has
  // nothing (unknown barcode or unavailable).
  const mapped = (await resolveEdamamBarcode(code)) ?? (await resolveOffBarcodeSafely(code));
  if (!mapped) {
    logger.info({ code }, "[nutrition] barcode not recognized by Edamam or Open Food Facts");
    return null;
  }
  logger.info({ code, source: mapped.source }, "[nutrition] barcode resolved");

  try {
    const [food] = await storage.nutrition.upsertFoods([mapped]);
    return food ?? null;
  } catch (err) {
    // A caching failure (transient DB error, or the window before an additive
    // `foods` migration lands) shouldn't surface as a 500 — treat it as "not
    // resolved" (404) so the scan degrades cleanly rather than crashing.
    logger.warn({ err, source: mapped.source }, "[nutrition] caching barcode result failed");
    return null;
  }
}
