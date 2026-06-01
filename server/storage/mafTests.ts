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
  async createTestResult(data: InsertMafTestResult): Promise<MafTestResult> {
    const [row] = await db.insert(mafTestResults).values(data).returning();
    return row;
  }

  async createWorkoutAnalysis(data: InsertMafWorkoutAnalysis): Promise<MafWorkoutAnalysis> {
    const [row] = await db.insert(mafWorkoutAnalysis).values(data).returning();
    return row;
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
