import { mafTestResults, mafWorkoutAnalysis } from "@shared/schema";
import { desc, eq } from "drizzle-orm";

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
