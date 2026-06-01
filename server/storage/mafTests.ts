import { mafTestResults, mafWorkoutAnalysis } from "@shared/schema";
import { and, asc, desc, eq, sql } from "drizzle-orm";

import { db } from "../db";

export type MafTestResult = typeof mafTestResults.$inferSelect;
export type InsertMafTestResult = typeof mafTestResults.$inferInsert;
export type MafWorkoutAnalysis = typeof mafWorkoutAnalysis.$inferSelect;
export type InsertMafWorkoutAnalysis = typeof mafWorkoutAnalysis.$inferInsert;

/**
 * Data access for MAF test results and per-test workout-compliance analysis.
 * Both tables are user-owned (cascade on account deletion) and append-only —
 * each logged MAF test adds a row so the athlete's aerobic trend builds over
 * time.
 */
export class MafTestStorage {
  /**
   * Persist a MAF test and (when HR data produced one) its compliance analysis
   * in a single transaction. Either both rows commit or neither does, so a
   * tagged workout can never be left with a test row but no analysis — a partial
   * state that would silently drop it from the compliance trend on a later
   * idempotent re-tag (Codex P2). Pass `analysisData: null` to record a test
   * with no analysis (e.g. a run logged without heart-rate data).
   */
  async createTestWithAnalysis(
    testData: InsertMafTestResult,
    analysisData: InsertMafWorkoutAnalysis | null,
  ): Promise<{ testResult: MafTestResult; analysis: MafWorkoutAnalysis | null }> {
    return db.transaction(async (tx) => {
      const [testResult] = await tx.insert(mafTestResults).values(testData).returning();
      let analysis: MafWorkoutAnalysis | null = null;
      if (analysisData) {
        [analysis] = await tx.insert(mafWorkoutAnalysis).values(analysisData).returning();
      }
      return { testResult, analysis };
    });
  }

  /**
   * The existing MAF test for a tagged workout, if any. `workoutLogId` lives in
   * the `conditions` JSONB (the table also serves untagged tests), so the lookup
   * matches on `conditions->>'workoutLogId'`. Returns the earliest row so a
   * re-tag resolves to the original record. Used to keep tagging idempotent.
   */
  async getTestResultByWorkoutLogId(
    userId: string,
    workoutLogId: string,
  ): Promise<MafTestResult | undefined> {
    const [row] = await db
      .select()
      .from(mafTestResults)
      .where(
        and(
          eq(mafTestResults.userId, userId),
          sql`${mafTestResults.conditions}->>'workoutLogId' = ${workoutLogId}`,
        ),
      )
      .orderBy(asc(mafTestResults.createdAt))
      .limit(1);
    return row;
  }

  /** The earliest compliance analysis for a tagged workout, if any. */
  async getWorkoutAnalysisByWorkoutLogId(
    userId: string,
    workoutLogId: string,
  ): Promise<MafWorkoutAnalysis | undefined> {
    const [row] = await db
      .select()
      .from(mafWorkoutAnalysis)
      .where(
        and(
          eq(mafWorkoutAnalysis.userId, userId),
          eq(mafWorkoutAnalysis.workoutLogId, workoutLogId),
        ),
      )
      .orderBy(asc(mafWorkoutAnalysis.createdAt))
      .limit(1);
    return row;
  }

  /**
   * Remove the MAF test (and its compliance analysis) recorded for a tagged
   * workout, in a single transaction — the inverse of `createTestWithAnalysis`
   * for a `tagged_workout` source. The analysis carries `workoutLogId` as a
   * column; the test keeps it inside the `conditions` JSONB, so match it exactly
   * as `getTestResultByWorkoutLogId` does. Returns true when a test row was
   * removed, false when the workout wasn't tagged (so the route can 404).
   */
  async deleteTestForWorkout(userId: string, workoutLogId: string): Promise<boolean> {
    return db.transaction(async (tx) => {
      await tx
        .delete(mafWorkoutAnalysis)
        .where(
          and(
            eq(mafWorkoutAnalysis.userId, userId),
            eq(mafWorkoutAnalysis.workoutLogId, workoutLogId),
          ),
        );
      const result = await tx
        .delete(mafTestResults)
        .where(
          and(
            eq(mafTestResults.userId, userId),
            sql`${mafTestResults.conditions}->>'workoutLogId' = ${workoutLogId}`,
          ),
        );
      return result.rowCount != null && result.rowCount > 0;
    });
  }

  async listTestResults(userId: string, limit = 20): Promise<MafTestResult[]> {
    return db
      .select()
      .from(mafTestResults)
      .where(eq(mafTestResults.userId, userId))
      .orderBy(desc(mafTestResults.createdAt))
      .limit(limit);
  }

  async listWorkoutAnalysis(userId: string, limit = 20): Promise<MafWorkoutAnalysis[]> {
    return db
      .select()
      .from(mafWorkoutAnalysis)
      .where(eq(mafWorkoutAnalysis.userId, userId))
      .orderBy(desc(mafWorkoutAnalysis.createdAt))
      .limit(limit);
  }
}
