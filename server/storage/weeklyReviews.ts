import type { WeeklyReviewRow } from "@shared/schema";
import { weeklyReviews } from "@shared/schema";
import { and, eq, inArray } from "drizzle-orm";

import { db } from "../db";

/**
 * The athlete's per-week intent — one row per (user, week).
 *
 * Every method is scoped by `userId` in SQL rather than filtered afterwards,
 * matching `TimelineAnnotationsStorage`.
 */
export class WeeklyReviewsStorage {
  /**
   * Both weeks the review needs in one round trip: the week being viewed and
   * the week before it, whose intent is shown back as "last week you said".
   * Returned as a map so the caller does not care which rows exist.
   */
  async getIntents(userId: string, weekStarts: string[]): Promise<Map<string, string | null>> {
    if (weekStarts.length === 0) return new Map();

    const rows = await db
      .select({ weekStart: weeklyReviews.weekStart, intent: weeklyReviews.intent })
      .from(weeklyReviews)
      .where(and(eq(weeklyReviews.userId, userId), inArray(weeklyReviews.weekStart, weekStarts)));

    return new Map(rows.map((row) => [row.weekStart, row.intent]));
  }

  /**
   * Write the intent for a week, replacing whatever was there.
   *
   * An upsert rather than insert-or-update-in-two-steps: the unique index on
   * (user_id, week_start) is the conflict target, so two tabs saving at once
   * resolve to one row instead of racing into a duplicate-key error.
   *
   * A blank intent clears the row's text rather than deleting the row —
   * "I wrote nothing this week" and "I cleared what I wrote" are the same
   * thing to the athlete, and keeping the row keeps `updatedAt` meaningful.
   */
  async setIntent(userId: string, weekStart: string, intent: string | null): Promise<WeeklyReviewRow> {
    const [row] = await db
      .insert(weeklyReviews)
      .values({ userId, weekStart, intent })
      .onConflictDoUpdate({
        target: [weeklyReviews.userId, weeklyReviews.weekStart],
        set: { intent, updatedAt: new Date() },
      })
      .returning();
    return row;
  }
}
