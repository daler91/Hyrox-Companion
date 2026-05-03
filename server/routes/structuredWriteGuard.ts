import type { Request, Response } from "express";

import { reqLogger } from "../logger";
import { incrementStructuredExerciseCounter } from "../services/structuredExerciseHealth";

const LEGACY_IMPORT_ALLOWLIST = new Set<string>([
  "/api/v1/plans/import",
]);

const STRUCTURED_REQUIRED_MSG = "Structured exercise rows are required for non-legacy writes.";

export function isLegacyImportRoute(path: string): boolean {
  return LEGACY_IMPORT_ALLOWLIST.has(path);
}

export async function rejectTextOnlyWriteIfNeeded(req: Request, res: Response, ownerType: "workout_log" | "plan_day"): Promise<boolean> {
  if (isLegacyImportRoute(req.route?.path ?? req.path)) {
    reqLogger(req).info({ context: "structured-write-guard", route: req.path, ownerType }, "Legacy import allowlist route used");
    return false;
  }
  const body = req.body as { exercises?: unknown[]; mainWorkout?: string | null; accessory?: string | null };
  const hasRows = Array.isArray(body.exercises) && body.exercises.length > 0;
  const hasText = Boolean((body.mainWorkout ?? "").trim() || (body.accessory ?? "").trim());
  if (!hasRows && hasText) {
    void incrementStructuredExerciseCounter(ownerType, "manual", "rejected_text_only_write").catch(() => undefined);
    res.status(422).json({ error: STRUCTURED_REQUIRED_MSG, code: "STRUCTURED_ROWS_REQUIRED" });
    return true;
  }
  return false;
}

export const structuredRowsRequiredMessage = STRUCTURED_REQUIRED_MSG;
