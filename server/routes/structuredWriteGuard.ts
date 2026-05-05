import type { Request, Response } from "express";

import { env } from "../env";
import { reqLogger } from "../logger";
import { incrementStructuredExerciseCounter } from "../services/structuredExerciseHealth";

const LEGACY_IMPORT_ALLOWLIST = new Set<string>([
  "/api/v1/plans/import",
]);

const STRUCTURED_REQUIRED_MSG = "Structured exercise rows are required for non-legacy writes.";

let fallbackErrorCount = 0;
let fallbackWindowStartedAt = Date.now();
const FALLBACK_WINDOW_MS = 60_000;
const FALLBACK_ERROR_THRESHOLD = 10;

export function isLegacyImportRoute(path: string): boolean {
  return LEGACY_IMPORT_ALLOWLIST.has(path);
}

function structuredBlocksGateOpen(): boolean {
  return env.STRUCTURED_BLOCKS_ENABLED === "true" && env.STRUCTURED_BLOCKS_FALLBACK_FORCE_LEGACY !== "true";
}

async function noteFallback(req: Request, ownerType: "workout_log" | "plan_day", reason: "gate_off" | "error_spike"): Promise<void> {
  reqLogger(req).warn({ context: "structured-write-guard", ownerType, reason }, "Structured blocks fallback to legacy path");
  await incrementStructuredExerciseCounter(ownerType, "manual", "structured_blocks_fallback", 1).catch(() => undefined);
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

function getRoutePath(req: Request): string {
  const routeCandidate: unknown = req.route;
  if (routeCandidate && typeof routeCandidate === "object" && "path" in routeCandidate) {
    const pathValue = (routeCandidate as { path?: unknown }).path;
    if (typeof pathValue === "string") return pathValue;
  }
  return req.path;
}

export async function rejectTextOnlyWriteIfNeeded(req: Request, res: Response, ownerType: "workout_log" | "plan_day"): Promise<boolean> {
  refreshFallbackWindow();

  if (!structuredBlocksGateOpen()) {
    await noteFallback(req, ownerType, "gate_off");
    return false;
  }

  if (fallbackErrorCount >= FALLBACK_ERROR_THRESHOLD) {
    await noteFallback(req, ownerType, "error_spike");
    return false;
  }

  if (isLegacyImportRoute(getRoutePath(req))) {
    reqLogger(req).info({ context: "structured-write-guard", route: req.path, ownerType }, "Legacy import allowlist route used");
    return false;
  }

  try {
    const body = req.body as { exercises?: unknown[]; structureBlocks?: unknown[]; mainWorkout?: string | null; accessory?: string | null };
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
    await noteFallback(req, ownerType, spike ? "error_spike" : "gate_off");
    return false;
  }
}

export const structuredRowsRequiredMessage = STRUCTURED_REQUIRED_MSG;
