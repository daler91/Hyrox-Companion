/**
 * Race Predictor orchestrator.
 *
 * Builds deterministic per-segment features (featureBuilder), then — when AI is
 * available and consented — asks the reasoning model to synthesize per-segment
 * estimates, a total finish time, and a short narrative. Falls back to the
 * deterministic baseline whenever AI is disabled, not consented, over budget,
 * or errors, so the endpoint always returns a usable prediction.
 *
 * Mirrors the structured-AI pattern in server/gemini/suggestionService.ts
 * (generateJsonText + zod safeParse + sanitize) and the gating order in
 * server/services/aiSuggestionService.ts.
 */
import { deriveAgeGroupFromAge, type HyroxStation, RACE_SEGMENTS } from "@shared/raceSpec";
import type {
  RacePredictionAiUnavailableReason,
  RacePredictionConfidence,
  RacePredictionPercentile,
  RacePredictionResponse,
  RaceSegmentPrediction,
} from "@shared/schema";
import type { Logger } from "pino";
import { z } from "zod";

import { generateJsonText } from "../../ai/providers";
import { env } from "../../env";
import { logger as defaultLogger } from "../../logger";
import { storage } from "../../storage";
import { checkAiBudget } from "../aiUsageService";
import { buildRacePredictionFeatures, type RacePredictionFeatures } from "./featureBuilder";
import { computeRanking } from "./ranking";

type RacePredictionLogger = Pick<Logger, "warn" | "error">;

type StoredGender = RacePredictionResponse["gender"];

const RACE_PREDICTOR_SYSTEM_PROMPT = `You are an elite HYROX coach. Estimate an athlete's finish time for a full HYROX race: 8 x 1 km runs interleaved with 8 functional stations in a fixed order (16 segments total), plus the inevitable transition ("roxzone") time between segments.

You are given, as JSON, the athlete's division, gender, and per-segment data derived from their logged training. For each of the 16 race segments you get a deterministic baseline split, a floorSeconds (the fastest physically-plausible split for that segment), and, where available, their logged best/median split seconds, sample size, recency (days since last trained), and — for stations — the load they trained at vs the division-standard load (loadRatio = trained / standard, in the athlete's weight unit). Logged split seconds are already normalized to the full race-station distance/reps, so treat them as full-station efforts.

Rules:
- Anchor each estimate on the athlete's logged median where sampleSize > 0; trust it more as sampleSize grows.
- For stations, scale for load: trained lighter than standard (loadRatio < 1) means slower at race load; heavier (loadRatio > 1) means faster. Stay conservative.
- Model compromised running: race runs are slower than fresh 1 km efforts because they are run under fatigue between stations, and later runs degrade more.
- Where sampleSize = 0, lean on the provided deterministic baseline, which already reflects this cohort's real per-run-leg fatigue curve (later runs are slower) and median station splits.
- Keep each estimate close to the segment's deterministicBaselineSeconds — a refinement, not a rewrite. Only go much faster than it when the athlete's own logged data clearly justifies it.
- floorSeconds is an EXTREME world-class limit, not a target: never output below it, and do not approach it unless logged data proves that athlete is near-elite on that segment.
- transitionTotalSeconds is the real median total "roxzone" (transition) time for this athlete's cohort. Your totalFinishSeconds must equal the sum of your 16 segment estimates PLUS a transition allowance close to transitionTotalSeconds (stay within roughly ±50% of it), and never less than the segment sum.

Return ONLY a JSON object (no prose, no markdown fences) with exactly these fields:
{
  "segments": [ { "index": <1-16>, "estimatedSeconds": <number>, "confidence": "low"|"medium"|"high", "basis": "logged"|"benchmark"|"blended" }, ... one object per index 1..16 ],
  "totalFinishSeconds": <number>,
  "overallConfidence": "low"|"medium"|"high",
  "narrative": "<2-4 plain sentences, athlete-facing, no markdown headings>"
}`;

const aiSegmentSchema = z.object({
  index: z.number().int().min(1).max(RACE_SEGMENTS.length),
  estimatedSeconds: z.number().positive().max(3600),
  confidence: z.enum(["low", "medium", "high"]),
  basis: z.enum(["logged", "benchmark", "blended"]),
});

const racePredictionAiSchema = z.object({
  segments: z.array(aiSegmentSchema),
  totalFinishSeconds: z.number().positive().max(20_000),
  overallConfidence: z.enum(["low", "medium", "high"]),
  narrative: z.string().max(2000),
});

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function normalizeStoredGender(gender: string | null | undefined): StoredGender {
  return gender === "male" || gender === "female" || gender === "prefer_not_to_say" ? gender : null;
}

/** Confidence for a single deterministic segment, from its logged sample size. */
function deterministicSegmentConfidence(sampleSize: number): RacePredictionConfidence {
  if (sampleSize >= 3) return "high";
  if (sampleSize >= 1) return "medium";
  return "low";
}

/** Overall confidence for the deterministic baseline, from data coverage. */
function deterministicOverallConfidence(
  completeness: RacePredictionFeatures["dataCompleteness"],
): RacePredictionConfidence {
  if (completeness.stationsWithData >= 7 && completeness.hasRunData) return "high";
  if (completeness.stationsWithData >= 4) return "medium";
  return "low";
}

/** Human label for the ranking cohort, e.g. "Open Men 40-44" / "Open Women (all ages)". */
function cohortLabel(
  division: RacePredictionFeatures["division"],
  gender: "male" | "female",
  ageGroup: string | null,
): string {
  const div = division === "pro" ? "Pro" : "Open";
  const g = gender === "male" ? "Men" : "Women";
  return ageGroup ? `${div} ${g} ${ageGroup}` : `${div} ${g} (all ages)`;
}

/** Percentile rank of a finish time vs the athlete's real-field cohort, or null
 *  when gender is withheld (no gendered field) or the cohort is missing. */
function buildPercentile(
  features: RacePredictionFeatures,
  totalFinishSeconds: number,
): RacePredictionPercentile | null {
  if (!features.resolvedGender) return null;
  const ranking = computeRanking(
    features.division,
    features.resolvedGender,
    features.resolvedAgeGroup,
    totalFinishSeconds,
  );
  if (!ranking) return null;
  return {
    fasterThanPct: ranking.fasterThanPct,
    cohortLabel: cohortLabel(features.division, features.resolvedGender, ranking.ageGroup),
    cohortSize: ranking.cohortSize,
    basis: ranking.basis,
  };
}

function buildFeaturePromptPayload(features: RacePredictionFeatures): unknown {
  return {
    division: features.division,
    gender: features.resolvedGender ?? "unspecified",
    genderAssumed: features.genderAssumed,
    ageGroup: features.resolvedAgeGroup ?? "all",
    weightUnit: features.weightUnit,
    transitionTotalSeconds: features.transitionSeconds,
    deterministicBaselineFinishSeconds: features.deterministicFinishSeconds,
    segments: RACE_SEGMENTS.map((segment, i) => {
      const baseline = features.baselineSegments[i];
      const base = {
        index: segment.index,
        label: segment.label,
        kind: segment.kind,
        deterministicBaselineSeconds: baseline.estimatedSeconds,
        baselineBasis: baseline.basis,
        floorSeconds: baseline.floorSeconds,
      };
      if (segment.kind === "run") {
        const f = features.runFeature;
        return {
          ...base,
          loggedBestSeconds: f.bestSeconds,
          loggedMedianSeconds: f.medianSeconds,
          sampleSize: f.sampleSize,
          lastTrainedDaysAgo: f.lastTrainedDaysAgo,
        };
      }
      const f = features.stationFeatures[segment.exerciseName as HyroxStation];
      return {
        ...base,
        loggedBestSeconds: f.bestSeconds,
        loggedMedianSeconds: f.medianSeconds,
        sampleSize: f.sampleSize,
        lastTrainedDaysAgo: f.lastTrainedDaysAgo,
        loggedLoad: f.loggedLoadUserUnit,
        standardLoad: f.standardLoadUserUnit,
        loadRatio: f.loadRatio == null ? null : Number(f.loadRatio.toFixed(2)),
      };
    }),
  };
}

function buildDeterministicResponse(
  features: RacePredictionFeatures,
  storedGender: StoredGender,
  reason: RacePredictionAiUnavailableReason | null,
): RacePredictionResponse {
  const segments: RaceSegmentPrediction[] = features.baselineSegments.map((s) => ({
    index: s.index,
    kind: s.kind,
    exerciseName: s.exerciseName,
    label: s.label,
    estimatedSeconds: s.estimatedSeconds,
    basis: s.basis,
    confidence: deterministicSegmentConfidence(s.sampleSize),
    sampleSize: s.sampleSize,
  }));

  return {
    totalFinishSeconds: features.deterministicFinishSeconds,
    segments,
    transitionSeconds: features.transitionSeconds,
    aiUsed: false,
    aiUnavailableReason: reason,
    overallConfidence: deterministicOverallConfidence(features.dataCompleteness),
    narrative: null,
    division: features.division,
    gender: storedGender,
    genderAssumed: features.genderAssumed,
    ageGroup: features.resolvedAgeGroup,
    ageGroupAssumed: features.ageGroupAssumed,
    percentile: buildPercentile(features, features.deterministicFinishSeconds),
    dataCompleteness: features.dataCompleteness,
    generatedAt: new Date().toISOString(),
  };
}

/** A refined per-segment split may be at most this fraction below the cohort
 *  median — a guardrail so a model error can't surface a world-class-elite
 *  split (e.g. 2:30 wall balls) for a normal athlete. */
const AI_MIN_SEGMENT_FRACTION = 0.6;

function buildAiResponse(
  features: RacePredictionFeatures,
  storedGender: StoredGender,
  ai: z.infer<typeof racePredictionAiSchema>,
): RacePredictionResponse {
  const aiByIndex = new Map(ai.segments.map((s) => [s.index, s]));

  let segmentSum = 0;
  const segments: RaceSegmentPrediction[] = features.baselineSegments.map((baseline) => {
    const aiSegment = aiByIndex.get(baseline.index);
    // Clamp the model's split to a plausible range. The lower bound is a soft,
    // cohort-relative floor — the model may predict at most ~40% faster than the
    // real cohort median for this segment — so a model error can't surface the
    // world-class floor (e.g. 2:30 wall balls) as a normal athlete's split. The
    // absolute world-class floor still applies where it is the higher of the two.
    const lower = Math.max(
      baseline.floorSeconds,
      Math.round(AI_MIN_SEGMENT_FRACTION * baseline.benchmarkSeconds),
    );
    const estimatedSeconds = aiSegment
      ? clamp(Math.round(aiSegment.estimatedSeconds), lower, 3600)
      : baseline.estimatedSeconds;
    segmentSum += estimatedSeconds;
    return {
      index: baseline.index,
      kind: baseline.kind,
      exerciseName: baseline.exerciseName,
      label: baseline.label,
      estimatedSeconds,
      // The model may blend logged data with benchmarks; fall back to the
      // deterministic basis when it didn't return this segment.
      basis: aiSegment ? aiSegment.basis : baseline.basis,
      confidence: aiSegment ? aiSegment.confidence : "low",
      sampleSize: baseline.sampleSize,
    };
  });

  // Anchor the headline on the cohort's real transition budget: the model may
  // add between 0.5× and 1.5× the data-derived transition total on top of its
  // 16-segment sum, but never less than the sum itself.
  const transition = features.transitionSeconds;
  const totalFinishSeconds = clamp(
    Math.round(ai.totalFinishSeconds),
    segmentSum + Math.round(0.5 * transition),
    segmentSum + Math.round(1.5 * transition),
  );

  return {
    totalFinishSeconds,
    segments,
    // The transition portion implied by THIS headline, so the breakdown
    // (16 splits + transition) always reconciles to the total.
    transitionSeconds: totalFinishSeconds - segmentSum,
    aiUsed: true,
    aiUnavailableReason: null,
    overallConfidence: ai.overallConfidence,
    // Plain text rendered as markdown on the client (rehypeSanitize). Match the
    // repo convention of swapping "&" → "and" to avoid stray HTML entities.
    narrative: ai.narrative.replaceAll("&", "and").trim().slice(0, 1200),
    division: features.division,
    gender: storedGender,
    genderAssumed: features.genderAssumed,
    ageGroup: features.resolvedAgeGroup,
    ageGroupAssumed: features.ageGroupAssumed,
    percentile: buildPercentile(features, totalFinishSeconds),
    dataCompleteness: features.dataCompleteness,
    generatedAt: new Date().toISOString(),
  };
}

async function resolveAiBlocker(
  user: { aiCoachEnabled?: boolean | null } | undefined,
  userId: string,
  log: RacePredictionLogger,
): Promise<RacePredictionAiUnavailableReason | null> {
  if (env.AI_FEATURES_ENABLED === "false") return "ai_disabled";
  if (user?.aiCoachEnabled !== true) return "ai_consent_off";
  try {
    const budget = await checkAiBudget(userId);
    if (!budget.allowed) return "ai_budget_exceeded";
  } catch (err) {
    // Budget lookup failure shouldn't hard-block the feature — log and allow,
    // matching the timeline-suggestion behavior.
    log.warn({ err, userId }, "[race-predictor] AI budget check failed; allowing AI call");
  }
  return null;
}

/**
 * Generate a HYROX finish-time prediction for the athlete. Always resolves to a
 * full response (AI-enhanced when available, deterministic otherwise).
 */
export async function generateRacePrediction(
  userId: string,
  log: RacePredictionLogger = defaultLogger,
): Promise<RacePredictionResponse> {
  const [user, sets] = await Promise.all([
    storage.users.getUser(userId),
    storage.analytics.getAllExerciseSetsWithDates(userId),
  ]);

  const storedGender = normalizeStoredGender(user?.gender);
  const features = buildRacePredictionFeatures(sets ?? [], {
    division: user?.division ?? null,
    gender: storedGender,
    weightUnit: user?.weightUnit ?? "kg",
    distanceUnit: user?.distanceUnit ?? "km",
    // Age group drives the cohort benchmarks/ranking; derived from MAF age when
    // set, else null (falls back to the all-ages division×gender cohort).
    ageGroup: deriveAgeGroupFromAge(user?.mafAge ?? null),
  });

  const blocker = await resolveAiBlocker(user, userId, log);
  if (blocker) {
    return buildDeterministicResponse(features, storedGender, blocker);
  }

  try {
    const response = await generateJsonText({
      systemInstruction: RACE_PREDICTOR_SYSTEM_PROMPT,
      messages: [{ role: "user", content: JSON.stringify(buildFeaturePromptPayload(features)) }],
      modelRole: "reasoning",
      label: "race-predictor",
      feature: "race-predictor",
      userId,
      timeoutMs: 90_000,
    });

    let raw: unknown;
    try {
      raw = JSON.parse(response.text || "{}");
    } catch (parseErr) {
      log.warn(
        { err: parseErr },
        "[race-predictor] AI JSON.parse failed; using deterministic baseline",
      );
      return buildDeterministicResponse(features, storedGender, "ai_error");
    }

    const parsed = racePredictionAiSchema.safeParse(raw);
    if (!parsed.success) {
      log.warn(
        { issues: parsed.error.issues },
        "[race-predictor] AI output failed validation; using deterministic baseline",
      );
      return buildDeterministicResponse(features, storedGender, "ai_error");
    }

    return buildAiResponse(features, storedGender, parsed.data);
  } catch (err) {
    log.error(
      { err, userId },
      "[race-predictor] AI generation failed; using deterministic baseline",
    );
    return buildDeterministicResponse(features, storedGender, "ai_error");
  }
}
