import { Request, Response } from "express";
import { beforeEach, describe, expect, it, vi } from "vitest";

import * as healthService from "../../services/structuredExerciseHealth";
import { isLegacyImportRoute, rejectTextOnlyWriteIfNeeded } from "../structuredWriteGuard";

// Mock the environment to ensure structured blocks are enabled for testing
vi.mock("../../env", () => ({
  env: {
    STRUCTURED_BLOCKS_ENABLED: "true",
    STRUCTURED_BLOCKS_FALLBACK_FORCE_LEGACY: "false"
  }
}));

// Mock the logger
vi.mock("../../logger", () => ({
  reqLogger: () => ({
    warn: vi.fn(),
    info: vi.fn(),
    error: vi.fn()
  })
}));

// Mock the health service
vi.mock("../../services/structuredExerciseHealth", () => ({
  incrementStructuredExerciseCounter: vi.fn().mockResolvedValue(undefined)
}));

describe("structuredWriteGuard", () => {
  describe("isLegacyImportRoute", () => {
    it("should return true for the legacy import allowlist route", () => {
      expect(isLegacyImportRoute("/api/v1/plans/import")).toBe(true);
    });

    it("should return false for other routes", () => {
      expect(isLegacyImportRoute("/api/v1/workouts")).toBe(false);
      expect(isLegacyImportRoute("/api/v1/plans")).toBe(false);
      expect(isLegacyImportRoute("/api/v1/health")).toBe(false);
      expect(isLegacyImportRoute("/api/v1/plans/export")).toBe(false);
      expect(isLegacyImportRoute("")).toBe(false);
    });
  });

  describe("rejectTextOnlyWriteIfNeeded", () => {
    let req: Partial<Request>;
    let res: Partial<Response>;
    let jsonMock: any;
    let statusMock: any;

    beforeEach(() => {
      vi.clearAllMocks();
      jsonMock = vi.fn();
      statusMock = vi.fn().mockReturnValue({ json: jsonMock });

      req = {
        path: "/api/v1/workouts",
        route: { path: "/api/v1/workouts" },
        body: {}
      };

      res = {
        status: statusMock
      };
    });

    it("should allow legacy import routes to pass without rejection", () => {
      req.path = "/api/v1/plans/import";
      req.route = { path: "/api/v1/plans/import" };
      req.body = { mainWorkout: "text without rows" };

      const result = rejectTextOnlyWriteIfNeeded(req, res, "workout_log");

      expect(result).toBe(false);
      expect(statusMock).not.toHaveBeenCalled();
    });

    it("should allow writes linked to a plan day the caller owns to pass", () => {
      req.body = { planDayId: "plan_day_123", mainWorkout: "text without rows" };

      const result = rejectTextOnlyWriteIfNeeded(req, res, "workout_log", { ownedPlanDayLink: true });

      expect(result).toBe(false);
      expect(statusMock).not.toHaveBeenCalled();
    });

    it("should reject a text-only write whose planDayId the caller does not own", () => {
      // Another athlete's (or a deleted) plan day is dropped when the workout is
      // saved, so naming one must not exempt a text-only write.
      req.body = { planDayId: "someone_elses_day", mainWorkout: "text without rows" };

      const result = rejectTextOnlyWriteIfNeeded(req, res, "workout_log", { ownedPlanDayLink: false });

      expect(result).toBe(true);
      expect(statusMock).toHaveBeenCalledWith(422);
      expect(jsonMock).toHaveBeenCalledWith(expect.objectContaining({ code: "STRUCTURED_ROWS_REQUIRED" }));
    });

    it("should not trust a planDayId in the body when the caller confirmed no ownership", () => {
      req.body = { planDayId: "plan_day_123", mainWorkout: "text without rows" };

      const result = rejectTextOnlyWriteIfNeeded(req, res, "workout_log");

      expect(result).toBe(true);
      expect(statusMock).toHaveBeenCalledWith(422);
    });

    it("should reject writes with text but no structured rows", () => {
      req.body = { mainWorkout: "Did some running today", accessory: "and stretching" };

      const result = rejectTextOnlyWriteIfNeeded(req, res, "workout_log");

      expect(result).toBe(true);
      expect(statusMock).toHaveBeenCalledWith(422);
      expect(jsonMock).toHaveBeenCalledWith(expect.objectContaining({
        code: "STRUCTURED_ROWS_REQUIRED"
      }));
      expect(healthService.incrementStructuredExerciseCounter).toHaveBeenCalledWith(
        "workout_log", "manual", "rejected_text_only_write"
      );
    });

    it("should allow writes with exercises rows even if text is present", () => {
      req.body = {
        mainWorkout: "Did some running today",
        exercises: [{ id: 1, name: "Run" }]
      };

      const result = rejectTextOnlyWriteIfNeeded(req, res, "workout_log");

      expect(result).toBe(false);
      expect(statusMock).not.toHaveBeenCalled();
      expect(healthService.incrementStructuredExerciseCounter).toHaveBeenCalledWith(
        "workout_log", "manual", "structured_blocks_accepted"
      );
    });

    it("should allow writes with structureBlocks even if text is present", () => {
      req.body = {
        mainWorkout: "Did some running today",
        structureBlocks: [{ id: 1, type: "circuit" }]
      };

      const result = rejectTextOnlyWriteIfNeeded(req, res, "workout_log");

      expect(result).toBe(false);
      expect(statusMock).not.toHaveBeenCalled();
    });

    it("should allow empty writes (no text, no rows)", () => {
      req.body = {};

      const result = rejectTextOnlyWriteIfNeeded(req, res, "workout_log");

      expect(result).toBe(false);
      expect(statusMock).not.toHaveBeenCalled();
    });
  });
});
