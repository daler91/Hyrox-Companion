/**
 * Server-side planned-session estimate that the fuelling panel prefers over its
 * instant client-side heuristic. Three grounded layers:
 *   1. deterministic, distance-aware estimate (`estimatePlannedSession`);
 *   2. personalized by the athlete's recent run pace (`getRunPaceRatio`, clamped);
 *   3. a small, always-on AI nudge (clamped to ±20% duration / ±2 RPE of layer 1+2).
 *
 * Cached per plan day keyed by an input signature so AI runs once per session (not per
 * render) and respects the kill switch + per-user budget. Any AI failure/disable/over-
 * budget degrades gracefully to the deterministic+personalized value.
 */

import { estimatePlannedSession } from "@shared/plannedSessionEstimate";
import type {
  ExerciseSet,
  PlanDay,
  PlannedSessionEstimateResponse,
  StructureBlockInput,
} from "@shared/schema";
import { z } from "zod";

import { generateJsonText } from "../../ai/providers";
import { env } from "../../env";
import { logger } from "../../logger";
import { getRuntimeCache, runtimeCacheKey, setRuntimeCache } from "../../sharedRuntimeState";
import { storage } from "../../storage";
import { checkAiBudget } from "../aiUsageService";
import { getRunPaceRatio } from "./runPace";

const CACHE_SCOPE = "planned-session-estimate";
const CACHE_TTL_MS = 14 * 24 * 60 * 60 * 1000; // 14 days; the input signature busts it earlier
const AI_MAX_DURATION_DELTA = 0.2; // AI may move duration ±20%
const AI_MAX_RPE_DELTA = 2; // …and RPE ±2
const DURATION_FLOOR = 10;
const DURATION_CEIL = 180;
const DEFAULT_RPE_ANCHOR = 5;

const aiEstimateSchema = z.object({
  durationMin: z.number().finite(),
  rpe: z.number().finite(),
  rationale: z.string().max(280).nullish(),
});

const SYSTEM_PROMPT =
  "You are a Hyrox/endurance coach refining ONE training session's expected DURATION " +
  "(minutes) and EFFORT (RPE 1-10) so fuelling can be planned. You get a deterministic " +
  "estimate and the session's exercises. Adjust only when the exercises clearly justify " +
  "it (e.g. dense supersets run longer; long easy aerobic work is low RPE). Stay within " +
  "±20% of the given duration and ±2 of the given RPE. Respond ONLY with JSON: " +
  '{"durationMin": number, "rpe": number, "rationale": string}. Keep rationale under 20 words.';

function clamp(n: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, n));
}

/** Stable signature of everything that affects the estimate, for cache invalidation. */
function buildSignature(
  focus: string,
  exerciseSets: readonly ExerciseSet[],
  structureBlocks: readonly StructureBlockInput[],
  runPaceRatio: number,
): string {
  const sets = exerciseSets.map((s) => [
    s.exerciseName,
    s.plannedDistance ?? s.distance,
    s.plannedTime ?? s.time,
    s.plannedReps ?? s.reps,
  ]);
  const blocks = structureBlocks.map((b) => [
    b.formatType,
    b.sectionType,
    b.durationMinutes,
    b.durationSeconds,
    b.timeCapMinutes,
    b.roundCount,
    b.workSeconds,
    b.restSeconds,
  ]);
  // Bucket the pace ratio so day-to-day pace drift doesn't constantly bust the cache.
  const ratioBucket = Math.round(runPaceRatio * 20) / 20;
  return JSON.stringify({ focus, sets, blocks, ratioBucket });
}

function buildPrompt(
  day: PlanDay,
  base: { durationMin: number; rpe: number | null },
  exerciseSets: readonly ExerciseSet[],
  distanceUnit: string,
): string {
  const distLabel = distanceUnit === "miles" ? "ft" : "m";
  const exercises = exerciseSets.slice(0, 30).map((s) => {
    const parts = [s.exerciseName ?? "exercise"];
    const dist = s.plannedDistance ?? s.distance;
    const time = s.plannedTime ?? s.time;
    const reps = s.plannedReps ?? s.reps;
    if (dist) parts.push(`${dist}${distLabel}`);
    if (time) parts.push(`${time}min`);
    if (reps) parts.push(`${reps} reps`);
    return `- ${parts.join(" ")}`;
  });
  return [
    `Focus: ${day.focus}`,
    `Deterministic estimate: ${base.durationMin} min, RPE ${base.rpe ?? "unknown"}`,
    "Exercises:",
    ...(exercises.length > 0 ? exercises : ["- (none listed)"]),
  ].join("\n");
}

interface Refined {
  durationMin: number;
  rpe: number | null;
  rationale: string | null;
  refined: boolean;
}

async function refineWithAi(
  day: PlanDay,
  base: { durationMin: number; rpe: number | null },
  exerciseSets: readonly ExerciseSet[],
  distanceUnit: string,
  userId: string,
): Promise<Refined> {
  const fallback: Refined = {
    durationMin: base.durationMin,
    rpe: base.rpe,
    rationale: null,
    refined: false,
  };

  if (env.AI_FEATURES_ENABLED === "false") return fallback;
  try {
    const budget = await checkAiBudget(userId);
    if (!budget.allowed) return fallback;
  } catch {
    return fallback; // don't spend if we can't confirm the budget
  }

  try {
    const response = await generateJsonText({
      systemInstruction: SYSTEM_PROMPT,
      messages: [{ role: "user", content: buildPrompt(day, base, exerciseSets, distanceUnit) }],
      modelRole: "fast",
      label: "plannedSessionEstimate",
      feature: "session_estimate",
      userId,
    });
    const parsed = aiEstimateSchema.parse(JSON.parse(response.text));

    // Ground the AI to a band around the deterministic+personalized value so it can
    // refine but never produce an extreme number.
    const durationMin = clamp(
      Math.round(parsed.durationMin),
      Math.max(DURATION_FLOOR, Math.round(base.durationMin * (1 - AI_MAX_DURATION_DELTA))),
      Math.min(DURATION_CEIL, Math.round(base.durationMin * (1 + AI_MAX_DURATION_DELTA))),
    );
    const rpeAnchor = base.rpe ?? DEFAULT_RPE_ANCHOR;
    const rpe = clamp(
      Math.round(parsed.rpe),
      Math.max(1, rpeAnchor - AI_MAX_RPE_DELTA),
      Math.min(10, rpeAnchor + AI_MAX_RPE_DELTA),
    );
    const rationale = parsed.rationale?.trim() ? parsed.rationale.trim().slice(0, 280) : null;
    return { durationMin, rpe, rationale, refined: durationMin !== base.durationMin || rpe !== base.rpe };
  } catch {
    // Static message only — never log user session data on the error path.
    logger.warn("[session-estimate] AI refine failed; using deterministic estimate");
    return fallback;
  }
}

/**
 * Personalized + AI-refined duration/RPE for a planned session, or null when the plan
 * day doesn't exist / isn't owned by the user. Athlete overrides are intentionally NOT
 * applied here — the caller layers those on top of this system estimate.
 */
export async function getPlannedSessionEstimate(
  planDayId: string,
  userId: string,
): Promise<PlannedSessionEstimateResponse | null> {
  const day = await storage.plans.getPlanDay(planDayId, userId);
  if (!day) return null;

  const [sets, structure, user] = await Promise.all([
    storage.workouts.getExerciseSetsByPlanDay(planDayId, userId),
    storage.workouts.getWorkoutStructureByPlanDay(planDayId, userId),
    storage.users.getUser(userId),
  ]);
  const exerciseSets = sets ?? [];
  const structureBlocks = structure ?? [];
  const distanceUnit = user?.distanceUnit ?? "km";

  const runPaceRatio = await getRunPaceRatio(userId);
  const base = estimatePlannedSession({ structureBlocks, exerciseSets, distanceUnit, runPaceRatio });

  // Nothing usable to estimate from → return the empty heuristic, no AI spend.
  if (base.durationMin == null) {
    return {
      planDayId,
      durationMin: null,
      rpe: base.rpe,
      rationale: null,
      source: base.source,
      refined: false,
    };
  }

  const signature = buildSignature(day.focus, exerciseSets, structureBlocks, runPaceRatio);
  const cacheKey = runtimeCacheKey(CACHE_SCOPE, `${planDayId}:${signature}`);
  const cached = await getRuntimeCache<PlannedSessionEstimateResponse>(cacheKey).catch(() => undefined);
  if (cached) return cached;

  const refined = await refineWithAi(
    day,
    { durationMin: base.durationMin, rpe: base.rpe },
    exerciseSets,
    distanceUnit,
    userId,
  );
  const result: PlannedSessionEstimateResponse = {
    planDayId,
    durationMin: refined.durationMin,
    rpe: refined.rpe,
    rationale: refined.rationale,
    source: base.source,
    refined: refined.refined,
  };

  await setRuntimeCache(cacheKey, result, CACHE_TTL_MS).catch(() => {
    // Caching is best-effort; a write failure just means we recompute next open.
  });
  return result;
}
