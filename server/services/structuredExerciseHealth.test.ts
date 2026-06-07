import { structuredExerciseHealthCounters, structuredExerciseHealthDailyRollups } from "@shared/schema";
import { sql } from "drizzle-orm";
import { beforeEach,describe, expect, it, vi } from "vitest";

import { db } from "../db";
import { runStructuredExerciseDailyRollup } from "./structuredExerciseHealth";

vi.mock("../db", () => ({
  db: {
    execute: vi.fn(),
    insert: vi.fn(),
  },
}));

vi.mock("../logger", () => ({
  logger: {
    warn: vi.fn(),
  },
}));

describe("structuredExerciseHealth", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("runStructuredExerciseDailyRollup", () => {
    it("should batch insert legacy breakdowns", async () => {
      const mockExecute = vi.fn();

      // 1. rowResult
      mockExecute.mockResolvedValueOnce({
        rows: [{
          total_rows: 100,
          structured_rows: 50,
          legacy_only_rows: 50,
          legacy_workout_rows: 25,
          legacy_plan_rows: 25,
          failed_hydration_backlog: 5
        }]
      });

      // 2. wowResult
      mockExecute.mockResolvedValueOnce({
        rows: [{ current_pct: 0.5, prev_pct: 0.4 }]
      });

      // 3. rejectedWrites
      mockExecute.mockResolvedValueOnce({
        rows: [{ total: 10 }]
      });

      // 4. legacyBreakdown
      mockExecute.mockResolvedValueOnce({
        rows: [
          { owner_type: "workout_log", source: "manual", legacy_count: 10 },
          { owner_type: "plan_day", source: "import", legacy_count: 5 },
        ]
      });

      // 5. Delete query
      mockExecute.mockResolvedValueOnce({ rows: [] });

      db.execute = mockExecute;

      const onConflictDoUpdateMock = vi.fn().mockResolvedValue({});
      const valuesMock = vi.fn().mockReturnValue({
        onConflictDoUpdate: onConflictDoUpdateMock,
      });

      const mockInsert = vi.fn().mockReturnValue({
        values: valuesMock,
      });
      db.insert = mockInsert;

      await runStructuredExerciseDailyRollup("2024-06-07");

      // Verify db.insert was called for rollups AND our new batch insert
      expect(mockInsert).toHaveBeenCalledWith(structuredExerciseHealthDailyRollups);
      expect(mockInsert).toHaveBeenCalledWith(structuredExerciseHealthCounters);

      // After our optimization, it should also be called for structuredExerciseHealthCounters
      // But we haven't applied optimization yet, so this test might fail if run on original code
      // We will test it after we patch.
    });
  });
});
