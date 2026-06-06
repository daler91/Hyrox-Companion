import { type AnalyticsFeature, type AnalyticsResult, analyticsResults } from "@shared/schema";
import { and, eq, inArray, isNull, ne, or } from "drizzle-orm";

import { db } from "../db";

export type { AnalyticsFeature, AnalyticsResult } from "@shared/schema";

export interface UpsertAnalyticsResultInput {
  userId: string;
  feature: AnalyticsFeature;
  payload: unknown;
  generatedAt: Date;
  /** Latest logged workout date (YYYY-MM-DD) at generation time, or null. */
  lastWorkoutDateAtGeneration: string | null;
  /**
   * Local calendar date of a cron recompute. Pass a date from the cron path so
   * the row records the daily claim; OMIT it (undefined) from manual route
   * regenerations so they don't clear the cron's once-per-day guard.
   */
  recomputedOn?: string | null;
}

/**
 * Durable last-computed-result store for the expensive analytics surfaces
 * (Coach Insights, Race Predictor). One row per (userId, feature), upserted on
 * the unique index. The mere existence of a row marks the user as "engaged"
 * with that feature — the scope the midnight recompute is limited to.
 */
export class AnalyticsResultsStorage {
  async get(userId: string, feature: AnalyticsFeature): Promise<AnalyticsResult | undefined> {
    const [row] = await db
      .select()
      .from(analyticsResults)
      .where(and(eq(analyticsResults.userId, userId), eq(analyticsResults.feature, feature)))
      .limit(1);
    return row;
  }

  async upsert(input: UpsertAnalyticsResultInput): Promise<void> {
    const now = new Date();
    await db
      .insert(analyticsResults)
      .values({
        userId: input.userId,
        feature: input.feature,
        payload: input.payload,
        generatedAt: input.generatedAt,
        lastWorkoutDateAtGeneration: input.lastWorkoutDateAtGeneration,
        recomputedOn: input.recomputedOn ?? null,
        updatedAt: now,
      })
      .onConflictDoUpdate({
        target: [analyticsResults.userId, analyticsResults.feature],
        set: {
          payload: input.payload,
          generatedAt: input.generatedAt,
          lastWorkoutDateAtGeneration: input.lastWorkoutDateAtGeneration,
          // Only advance recomputedOn when the caller supplies one. A manual
          // (route) regeneration passes undefined and must NOT clear a claim
          // the cron already made today.
          ...(input.recomputedOn === undefined ? {} : { recomputedOn: input.recomputedOn }),
          updatedAt: now,
        },
      });
  }

  /** User ids that have at least one stored result for any of `features`. */
  async listEngagedUserIds(features: AnalyticsFeature[]): Promise<string[]> {
    if (features.length === 0) return [];
    const rows = await db
      .selectDistinct({ userId: analyticsResults.userId })
      .from(analyticsResults)
      .where(inArray(analyticsResults.feature, features));
    return rows.map((r) => r.userId);
  }

  /**
   * Atomically claim the once-per-day recompute slot for (userId, feature).
   * Returns true iff THIS call won the claim — i.e. a stored row exists and its
   * recomputedOn was not already `localDate`. A losing caller (already claimed
   * today, or no stored row) gets false and must skip, so two overlapping jobs
   * can never both recompute the same feature in a day (W4 — race between the
   * cron scan enqueue and the worker run, robust to at-least-once delivery).
   */
  async markRecomputedOn(userId: string, feature: AnalyticsFeature, localDate: string): Promise<boolean> {
    const result = await db
      .update(analyticsResults)
      .set({ recomputedOn: localDate, updatedAt: new Date() })
      .where(
        and(
          eq(analyticsResults.userId, userId),
          eq(analyticsResults.feature, feature),
          // recomputed_on IS DISTINCT FROM localDate
          or(isNull(analyticsResults.recomputedOn), ne(analyticsResults.recomputedOn, localDate)),
        ),
      );
    return (result.rowCount ?? 0) > 0;
  }
}
