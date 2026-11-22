import type { AnalyticsFeature } from "@shared/schema";

import { computeStale, type HistoryAnchor } from "../../services/analyticsStaleness";
import { storage } from "../../storage";

export type StoredAnalysis<T> = T & { generatedAt: string; stale: boolean };

/**
 * The read behind the "stored analysis first" GET routes (coach insights,
 * overview analysis, race prediction, nutrition insights), which paint the last
 * stored result on tab open with no AI spend. It was written out in each of
 * them (C-storedAnalysis, REFACTORING_REVIEW 2026-09-23).
 *
 * The stored row and the staleness anchor are read concurrently: they read
 * unrelated tables, so there is no ordering between them, and the common case
 * (a row exists) pays one round trip instead of two, at the cost of one unused
 * anchor query when nothing is stored yet.
 *
 * Returns null when nothing is stored, else the payload with the row's
 * `generatedAt` and whether the history has moved since (`stale`).
 */
export async function readStoredAnalysis<T extends object>(
  userId: string,
  feature: AnalyticsFeature,
  getAnchor: (userId: string) => Promise<HistoryAnchor>,
): Promise<StoredAnalysis<T> | null> {
  const [row, anchor] = await Promise.all([
    storage.analyticsResults.get(userId, feature),
    getAnchor(userId),
  ]);
  if (!row) return null;
  return {
    ...(row.payload as T),
    generatedAt: row.generatedAt.toISOString(),
    stale: computeStale(row, anchor),
  };
}
