import type { RecycleBinEntityType } from "../enums";
import type {
  exerciseSets,
  planDays,
  trainingPlans,
  workoutLogs,
  workoutStructureBlocks,
  workoutStructureSteps,
} from "../tables";
import { z } from "../zod";

// ---------------------------------------------------------------------------
// Recycle bin — snapshots of deleted records, restorable for a fixed window.
//
// A delete still hard-deletes (every read path, cascade and unique index keeps
// working exactly as before); the only addition is that the record graph is
// serialised into `recycle_bin_items` first, inside the same transaction.
// Restore re-inserts that graph with the ORIGINAL ids, so anything that still
// points at the record (a MAF analysis, a client cache) resolves again.
// ---------------------------------------------------------------------------

/** How long a deleted record stays restorable before the purge cron removes it. */
export const RECYCLE_BIN_RETENTION_DAYS = 90;

/**
 * Bumped whenever the payload shape changes incompatibly. Restore reads the
 * version so an item captured under an older shape can be migrated (or refused)
 * rather than mis-inserted.
 */
export const RECYCLE_BIN_PAYLOAD_VERSION = 1 as const;

export type RecycleBinWorkoutLogRow = typeof workoutLogs.$inferSelect;
export type RecycleBinPlanDayRow = typeof planDays.$inferSelect;
export type RecycleBinTrainingPlanRow = typeof trainingPlans.$inferSelect;
export type RecycleBinExerciseSetRow = typeof exerciseSets.$inferSelect;
export type RecycleBinStructureBlockRow = typeof workoutStructureBlocks.$inferSelect;
export type RecycleBinStructureStepRow = typeof workoutStructureSteps.$inferSelect;

export interface RecycleBinStructureBlockSnapshot {
  block: RecycleBinStructureBlockRow;
  steps: RecycleBinStructureStepRow[];
}

export interface RecycleBinWorkoutLogSnapshot {
  /** The full row, original id included. */
  log: RecycleBinWorkoutLogRow;
  exerciseSets: RecycleBinExerciseSetRow[];
  structureBlocks: RecycleBinStructureBlockSnapshot[];
  /**
   * `maf_workout_analysis.workout_log_id` is SET NULL by the delete rather than
   * cascaded, so the rows survive but forget the log. Their ids are kept so
   * restore can point them back.
   */
  mafWorkoutAnalysisIds: string[];
}

export interface RecycleBinPlanDaySnapshot {
  day: RecycleBinPlanDayRow;
  exerciseSets: RecycleBinExerciseSetRow[];
  structureBlocks: RecycleBinStructureBlockSnapshot[];
  /**
   * `workout_logs.plan_day_id` is SET NULL by the delete. The logs stay on the
   * timeline as unplanned sessions; restore re-links the ones that still exist.
   */
  linkedWorkoutLogIds: string[];
}

export type RecycleBinPayload =
  | {
      version: typeof RECYCLE_BIN_PAYLOAD_VERSION;
      kind: "workout_log";
      workout: RecycleBinWorkoutLogSnapshot;
    }
  | {
      version: typeof RECYCLE_BIN_PAYLOAD_VERSION;
      kind: "plan_day";
      planDay: RecycleBinPlanDaySnapshot;
    }
  | {
      version: typeof RECYCLE_BIN_PAYLOAD_VERSION;
      kind: "training_plan";
      plan: RecycleBinTrainingPlanRow;
      days: RecycleBinPlanDaySnapshot[];
      /**
       * Every workout log that pointed at the plan (`plan_id`) or one of its
       * days (`plan_day_id`); both FKs are SET NULL by the delete.
       */
      linkedWorkoutLogs: Array<{ id: string; planDayId: string | null }>;
    };

/** One row of `GET /api/v1/recycle-bin` — the listing never ships the payload. */
export interface RecycleBinListItem {
  id: string;
  entityType: RecycleBinEntityType;
  entityId: string;
  /** Shared by every item one bulk delete produced, so a single Undo restores them together. */
  batchId: string | null;
  label: string;
  summary: string | null;
  /** The record's own date (workout date, scheduled date, plan start), for display. */
  entityDate: string | null;
  childCount: number;
  deletedAt: string;
  expiresAt: string;
}

export interface RecycleBinListResponse {
  items: RecycleBinListItem[];
  counts: Record<RecycleBinEntityType, number> & { total: number };
}

export type RecycleBinRestoreFailureReason =
  "not_found" | "id_conflict" | "device_activity_reimported" | "plan_overlap";

export type RecycleBinRestoreResult =
  | {
      ok: true;
      entityType: RecycleBinEntityType;
      entityId: string;
      batchId: string | null;
      /** Things restore could not put back exactly (e.g. a parent plan day that no longer exists). */
      warnings: string[];
    }
  | {
      ok: false;
      reason: RecycleBinRestoreFailureReason;
      message: string;
    };

export type RecycleBinBatchRestoreResult =
  | {
      ok: true;
      batchId: string;
      restored: Array<{ entityType: RecycleBinEntityType; entityId: string }>;
      warnings: string[];
    }
  | {
      ok: false;
      reason: RecycleBinRestoreFailureReason;
      message: string;
    };

export const recycleBinItemIdParamsSchema = z.object({
  id: z.string().min(1).max(255),
});

export const recycleBinBatchIdParamsSchema = z.object({
  batchId: z.string().min(1).max(255),
});
