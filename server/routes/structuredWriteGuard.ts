import type { Request, Response } from "express";

import { env } from "../env";
import { reqLogger } from "../logger";
import { incrementStructuredExerciseCounter } from "../services/structuredExerciseHealth";

const STRUCTURED_REQUIRED_MSG = "Structured exercise rows are required for non-legacy writes.";

let fallbackErrorCount = 0;
let fallbackWindowStartedAt = Date.now();
const FALLBACK_WINDOW_MS = 60_000;
const FALLBACK_ERROR_THRESHOLD = 10;

function structuredBlocksGateOpen(): boolean {
  return env.STRUCTURED_BLOCKS_ENABLED === "true" && env.STRUCTURED_BLOCKS_FALLBACK_FORCE_LEGACY !== "true";
}

function noteFallback(req: Request, ownerType: "workout_log" | "plan_day", reason: "gate_off" | "error_spike"): void {
  reqLogger(req).warn({ context: "structured-write-guard", ownerType, reason }, "Structured blocks fallback to legacy path");
  void incrementStructuredExerciseCounter(ownerType, "manual", "structured_blocks_fallback", 1).catch(() => undefined);
}

function refreshFallbackWindow(): void {
  const now = Date.now();
  if (now - fallbackWindowStartedAt > FALLBACK_WINDOW_MS) {
    fallbackWindowStartedAt = now;
    fallbackErrorCount = 0;
  }
}

function noteStructuredError(): boolean {
  refreshFallbackWindow();
  fallbackErrorCount += 1;
  return fallbackErrorCount >= FALLBACK_ERROR_THRESHOLD;
}

export interface TextOnlyWriteContext {
  /**
   * The body's `planDayId` names a plan day the caller owns, checked by the
   * route. Only then is a text-only write let through: the log is seeded from
   * that day's prescribed rows. A `planDayId` that is someone else's, or gone,
   * is dropped when the workout is saved (resolveActivePlanLinks), so it used
   * to exempt a write that then saved as a text-only, unlinked log.
   */
  readonly ownedPlanDayLink?: boolean;
}

export function rejectTextOnlyWriteIfNeeded(
  req: Request,
  res: Response,
  ownerType: "workout_log" | "plan_day",
  context: TextOnlyWriteContext = {},
): boolean {
  refreshFallbackWindow();

  if (!structuredBlocksGateOpen()) {
    noteFallback(req, ownerType, "gate_off");
    return false;
  }

  if (fallbackErrorCount >= FALLBACK_ERROR_THRESHOLD) {
    noteFallback(req, ownerType, "error_spike");
    return false;
  }

  try {
    const body = req.body as { exercises?: unknown[]; structureBlocks?: unknown[]; mainWorkout?: string | null; accessory?: string | null };
    if (context.ownedPlanDayLink === true) {
      return false;
    }
    const hasExerciseRows = Array.isArray(body.exercises) && body.exercises.length > 0;
    const hasStructureBlocks = Array.isArray(body.structureBlocks) && body.structureBlocks.length > 0;
    const hasRows = hasExerciseRows || hasStructureBlocks;
    const hasText = Boolean((body.mainWorkout ?? "").trim() || (body.accessory ?? "").trim());

    if (!hasRows && hasText) {
      void incrementStructuredExerciseCounter(ownerType, "manual", "rejected_text_only_write").catch(() => undefined);
      res.status(422).json({ error: STRUCTURED_REQUIRED_MSG, code: "STRUCTURED_ROWS_REQUIRED" });
      return true;
    }

    if (hasRows) {
      void incrementStructuredExerciseCounter(ownerType, "manual", "structured_blocks_accepted").catch(() => undefined);
    }

    return false;
  } catch (error) {
    const spike = noteStructuredError();
    reqLogger(req).error({ context: "structured-write-guard", ownerType, spike, error }, "Structured guard failed; using legacy fallback");
    noteFallback(req, ownerType, spike ? "error_spike" : "gate_off");
    return false;
  }
}

