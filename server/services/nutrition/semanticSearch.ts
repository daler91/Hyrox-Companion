import type { Food } from "@shared/schema";

import { env } from "../../env";
import { generateEmbedding, trackEmbeddingUsage } from "../../gemini/client";
import { logger } from "../../logger";
import { storage } from "../../storage";
import { checkAiBudget } from "../aiUsageService";
import { searchFoodIdsByEmbedding } from "./foodEmbeddings";

/**
 * Semantic (vector) food search (Phase 2) — supplements a SPARSE keyword/fuzzy
 * result set with embedding-similarity matches over cached foods, so a conceptual
 * query ("post workout protein") can surface relevant foods that share no tokens.
 *
 * Deliberately OFF the hot path and never gating the route: it only fires when the
 * keyword/fuzzy result set is thin AND every safety condition holds (flag on, AI
 * configured, user consented, within budget). Any failure degrades silently to the
 * keyword results — semantic is purely additive.
 */

// Only supplement when keyword/fuzzy returned fewer than this many results.
const SEMANTIC_RESULT_FLOOR = 5;
const SEMANTIC_TOP_K = 10;

/**
 * Returns extra foods (in cosine-similarity order) to append to a thin result set,
 * or [] when semantic search shouldn't run / found nothing. Never throws.
 */
export async function maybeSemanticSearch(
  query: string,
  userId: string,
  currentResultCount: number,
): Promise<Food[]> {
  // Cheap gates first (no I/O), so the common case pays nothing.
  if (env.NUTRITION_SEMANTIC_ENABLED !== "true") return [];
  if (env.AI_FEATURES_ENABLED === "false" || !env.GEMINI_API_KEY) return [];
  if (currentResultCount >= SEMANTIC_RESULT_FLOOR) return [];

  try {
    // Consent + budget are checked inline (the search route is intentionally NOT an
    // AI route, so non-consented users still get keyword results).
    const user = await storage.users.getUser(userId);
    if (user?.aiCoachEnabled !== true) return [];
    const budget = await checkAiBudget(userId);
    if (!budget.allowed) return [];

    const embedding = await generateEmbedding(query); // LRU-cached; repeat queries don't re-bill
    trackEmbeddingUsage(userId, 1);

    const ids = await searchFoodIdsByEmbedding(embedding, SEMANTIC_TOP_K);
    if (ids.length === 0) return [];

    // Resolve ids back to rows through the visibility-checked lookup, then restore
    // the cosine order (and drop any id that's not visible / was deleted).
    const byId = await storage.nutrition.getVisibleFoodsByIds(userId, ids);
    return ids.map((id) => byId.get(id)).filter((food): food is Food => food !== undefined);
  } catch (err) {
    logger.warn({ err, query }, "[nutrition] semantic search degraded; using keyword results only");
    return [];
  }
}
