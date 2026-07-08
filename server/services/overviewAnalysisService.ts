/**
 * Overview AI chart analysis — a single AI call that produces a short, plain-
 * language "what this means for you" reading for each chart on the Analytics →
 * Overview tab. The output is keyed per chart so each chart card can render its
 * own explanation inline.
 *
 * Mirrors coachInsightsService's two-entry shape: `generateOverviewAnalysis`
 * assumes gating already happened (the route runs aiConsentCheck +
 * aiBudgetCheck before calling it); `generateOverviewAnalysisIfAllowed` does its
 * OWN gating for the midnight recompute cron. Structured-output handling
 * (generateJsonText + JSON.parse + zod) follows the race-predictor service.
 */
import type { OverviewAnalysisResult, OverviewChartKey, TrainingLoadOverview, TrainingOverview, WeeklySummary } from "@shared/schema";
import type { Logger } from "pino";
import { z } from "zod";

import { generateJsonText } from "../ai/providers";
import { env } from "../env";
import { logger as defaultLogger } from "../logger";
import { storage } from "../storage";
import { checkAiBudget } from "./aiUsageService";
import { assembleTrainingOverview } from "./trainingOverviewLoader";

export type OverviewAnalysisBlockedReason = "ai_disabled" | "ai_consent_off" | "ai_budget_exceeded";

export type OverviewAnalysisGenerationOutcome =
  | { ok: true; result: OverviewAnalysisResult }
  | { ok: false; reason: OverviewAnalysisBlockedReason };

const MIN_POINTS = 2;
const RECENT_WEEKS = 8;

// One human-readable title per chart so the model labels each section correctly.
const CHART_TITLES: Record<OverviewChartKey, string> = {
  trainingLoad: "Training Load Governor (ACWR)",
  formMonotony: "Form (TSB) & Monotony",
  objectiveLoad: "Objective Load, Fitness/Fatigue & Strain",
  weeklyWorkouts: "Weekly Workouts",
  rpeDuration: "Average RPE & Duration trends",
  consistency: "Workout Consistency",
};

// Fixed system instruction. Teaches the model what each metric means so the
// per-chart readings are correct, and pins the strict-JSON output contract.
const OVERVIEW_ANALYSIS_SYSTEM_PROMPT = [
  "You are a HYROX performance coach. The athlete is looking at charts on their training Overview dashboard and wants to understand, in plain language, what each chart is telling THEM specifically.",
  "",
  "You will receive a JSON object describing the charts that are currently on screen and the athlete's actual numbers for each. For every chart key present in the input, write a short reading (2-3 sentences) that:",
  "- interprets THIS athlete's numbers (cite the concrete values — ACWR, Form/TSB, monotony, weekly counts vs goal, RPE, streak),",
  "- says whether that's good, a watch-out, or neutral, and",
  "- gives one concrete takeaway when warranted.",
  "Keep it warm but direct, jargon-light (briefly gloss a term the first time), and NEVER invent numbers that aren't in the input.",
  "",
  "Metric reference:",
  "- ACWR (acute:chronic workload ratio): 0.8-1.3 is the sweet spot; <0.8 under-training; 1.3-1.5 caution; >1.5 high injury risk.",
  "- Form / TSB (training stress balance): positive = fresh/tapered, negative = carrying fatigue; very negative (≤ -25) is deep fatigue.",
  "- Monotony (Foster): >2.0 flags overtraining/illness risk from too-samey training; variety lowers it.",
  "- Strain (Foster) = weekly load × monotony; high strain with high monotony is the risky combination.",
  "- Fitness (chronic EWMA) vs Fatigue (acute EWMA): fitness above fatigue and rising is a good base; fatigue spiking above fitness means a hard block.",
  "- hrTSS / Power TSS are objective load (from HR / power); UTSS is subjective (from RPE). They should broadly agree.",
  "- Weekly Workouts vs the weekly goal shows consistency against target; RPE/Duration trends show how hard and how long sessions are trending; the consistency heatmap + streak show training regularity.",
  "",
  'Respond with STRICT JSON only, shaped exactly as: {"sections": {"<chartKey>": "<reading>"}}. Use ONLY the chart keys present in the input. Do not add commentary outside the JSON.',
].join("\n");

/** rising / falling / flat over the first→last of a numeric series. */
function trendDirection(values: Array<number | null | undefined>): "rising" | "falling" | "flat" | "n/a" {
  const nums = values.filter((v): v is number => typeof v === "number");
  if (nums.length < MIN_POINTS) return "n/a";
  const first = nums[0];
  const last = nums[nums.length - 1];
  const eps = Math.abs(first) * 0.05 + 1e-9;
  if (last - first > eps) return "rising";
  if (first - last > eps) return "falling";
  return "flat";
}

function round(value: number | null | undefined, dp = 0): number | null {
  if (typeof value !== "number" || Number.isNaN(value)) return null;
  const f = 10 ** dp;
  return Math.round(value * f) / f;
}

function lastNonNull<T>(values: Array<T | null | undefined>): T | null {
  for (let i = values.length - 1; i >= 0; i--) {
    const v = values[i];
    if (v != null) return v;
  }
  return null;
}

interface ChartFacts {
  title: string;
  facts: Record<string, unknown>;
}

/** Per-week avg duration (minutes), mirroring the client's buildTrendData. */
function avgDuration(week: WeeklySummary): number {
  return week.workoutCount > 0 ? Math.round(week.totalDuration / week.workoutCount) : 0;
}

/**
 * Build the per-chart fact payload, including ONLY the charts that have enough
 * data to actually render on the tab (mirroring each component's data guards).
 * Returns null when no chart is worth explaining (brand-new athlete).
 */
export function buildOverviewChartFacts(
  overview: TrainingOverview,
): Partial<Record<OverviewChartKey, ChartFacts>> {
  const load: TrainingLoadOverview = overview.trainingLoad;
  const trend = load.trend ?? [];
  const out: Partial<Record<OverviewChartKey, ChartFacts>> = {};

  // trainingLoad — the ACWR governor card renders whenever there is real load.
  if (trend.some((p) => p.utss > 0)) {
    const acwrSeries = trend.map((p) => p.acwr);
    out.trainingLoad = {
      title: CHART_TITLES.trainingLoad,
      facts: {
        currentUtss: round(load.currentUtss),
        acwr: round(load.acwr, 2),
        zone: load.zone,
        acwrTrend: trendDirection(acwrSeries),
        acuteUtss: round(load.acuteAvg),
        chronicUtss: round(load.chronicAvg),
        form_tsb: round(load.tsb),
        monotony: round(load.monotony, 2),
        monotonyZone: load.monotonyZone,
        activeRestrictions: load.activeRestrictions.map((r) => r.label),
        daysOfHistory: acwrSeries.filter((v) => v != null).length,
      },
    };
  }

  // formMonotony — renders when either Form or Monotony has 2+ seeded points.
  const tsbPoints = trend.filter((p) => p.tsb != null);
  const monotonyPoints = trend.filter((p) => p.monotony != null);
  if (tsbPoints.length > 1 || monotonyPoints.length > 1) {
    out.formMonotony = {
      title: CHART_TITLES.formMonotony,
      facts: {
        currentForm_tsb: round(load.tsb),
        formTrend: trendDirection(trend.map((p) => p.tsb)),
        currentMonotony: round(load.monotony, 2),
        monotonyZone: load.monotonyZone,
        monotonyTrend: trendDirection(trend.map((p) => p.monotony)),
        strain: round(load.strain),
        monotonyRiskThreshold: 2.0,
      },
    };
  }

  // objectiveLoad — matches ObjectiveLoadTrendCharts' render condition.
  const hasHrTss = trend.filter((p) => p.hrTss != null).length >= MIN_POINTS;
  const hasTss = trend.filter((p) => p.tss != null).length >= MIN_POINTS;
  const fitnessPoints = trend.filter((p) => p.chronicEwma != null && p.acuteEwma != null);
  const strainPoints = trend.filter((p) => p.strain != null);
  if (hasHrTss || hasTss || fitnessPoints.length >= MIN_POINTS || strainPoints.length >= MIN_POINTS) {
    out.objectiveLoad = {
      title: CHART_TITLES.objectiveLoad,
      facts: {
        hasHeartRateData: hasHrTss,
        hasPowerData: hasTss,
        currentHrTss: round(load.hrTss),
        currentHrZone: load.hrZone,
        estimatedLthr: round(load.estimatedLthr),
        fitness_chronicEwma: round(lastNonNull(fitnessPoints.map((p) => p.chronicEwma))),
        fatigue_acuteEwma: round(lastNonNull(fitnessPoints.map((p) => p.acuteEwma))),
        currentStrain: round(load.strain),
      },
    };
  }

  // weeklyWorkouts — the bar chart card renders with any weekly history.
  if (overview.weeklySummaries.length >= 1) {
    const recent = overview.weeklySummaries.slice(-RECENT_WEEKS);
    const goal = overview.weeklyGoal;
    out.weeklyWorkouts = {
      title: CHART_TITLES.weeklyWorkouts,
      facts: {
        weeklyGoal: goal,
        recentWeeklyCounts: recent.map((w) => ({ weekStart: w.weekStart, workouts: w.workoutCount })),
        weeksMeetingGoal: goal ? recent.filter((w) => w.workoutCount >= goal).length : null,
        weeksShown: recent.length,
        thisWeekCompleted: overview.weeklyCompletedWorkouts,
      },
    };
  }

  // rpeDuration — the two mini charts each need 2+ seeded weeks.
  const rpeWeeks = overview.weeklySummaries.filter((w) => w.avgRpe != null);
  const durationWeeks = overview.weeklySummaries.filter((w) => w.totalDuration > 0);
  if (rpeWeeks.length >= MIN_POINTS || durationWeeks.length >= MIN_POINTS) {
    const recent = overview.weeklySummaries.slice(-RECENT_WEEKS);
    out.rpeDuration = {
      title: CHART_TITLES.rpeDuration,
      facts: {
        avgRpe: round(overview.currentStats.avgRpe, 1),
        rpeTrend: trendDirection(overview.weeklySummaries.map((w) => w.avgRpe)),
        avgDurationMin: overview.currentStats.avgDuration,
        durationTrend: trendDirection(overview.weeklySummaries.map((w) => avgDuration(w))),
        recentWeeks: recent.map((w) => ({ weekStart: w.weekStart, avgRpe: round(w.avgRpe, 1), avgDurationMin: avgDuration(w) })),
      },
    };
  }

  // consistency — the heatmap card always renders; explain it once there's any
  // logged history to talk about.
  if (overview.workoutDates.length >= 1) {
    out.consistency = {
      title: CHART_TITLES.consistency,
      facts: {
        currentStreakDays: overview.currentStreak,
        loggedDaysInWindow: overview.workoutDates.length,
        thisWeekCompleted: overview.weeklyCompletedWorkouts,
        weeklyGoal: overview.weeklyGoal,
      },
    };
  }

  return out;
}

const overviewAnalysisAiSchema = z.object({
  sections: z.record(z.string(), z.string()),
});

/**
 * Build the Overview chart analysis. Gating is the caller's responsibility (the
 * route middleware, or generateOverviewAnalysisIfAllowed for the cron).
 */
export async function generateOverviewAnalysis(
  userId: string,
  log: Logger = defaultLogger,
): Promise<OverviewAnalysisResult> {
  const startedAt = Date.now();
  const overview = await assembleTrainingOverview(userId);
  const chartFacts = buildOverviewChartFacts(overview);
  const presentKeys = Object.keys(chartFacts) as OverviewChartKey[];

  // Nothing meaningful on screen yet (brand-new athlete) — store an empty
  // result rather than spending AI on charts that aren't rendered.
  if (presentKeys.length === 0) {
    return { sections: {}, generatedAt: new Date().toISOString() };
  }

  const promptPayload = {
    charts: Object.fromEntries(
      presentKeys.map((key) => [key, { title: chartFacts[key]!.title, ...chartFacts[key]!.facts }]),
    ),
  };

  const response = await generateJsonText({
    systemInstruction: OVERVIEW_ANALYSIS_SYSTEM_PROMPT,
    messages: [{ role: "user", content: JSON.stringify(promptPayload) }],
    modelRole: "reasoning",
    label: "overview-analysis",
    feature: "overview-analysis",
    userId,
    timeoutMs: 90_000,
  });

  let raw: unknown;
  try {
    raw = JSON.parse(response.text || "{}");
  } catch (err) {
    // bearer:disable javascript_lang_logger_leak — err is a JSON.parse
    // SyntaxError on the AI provider's own output, not user data.
    log.warn({ err }, "[overview-analysis] AI JSON.parse failed");
    throw new Error("Overview analysis returned malformed JSON", { cause: err });
  }

  const parsed = overviewAnalysisAiSchema.safeParse(raw);
  if (!parsed.success) {
    // bearer:disable javascript_lang_logger_leak — zod issue paths/messages
    // describe the AI output schema, not user data.
    log.warn({ issues: parsed.error.issues }, "[overview-analysis] AI output failed validation");
    throw new Error("Overview analysis failed schema validation");
  }

  // Keep only known, non-empty sections for charts we actually asked about, so a
  // hallucinated key or a section for an off-screen chart never reaches the UI.
  const sections: Partial<Record<OverviewChartKey, string>> = {};
  for (const key of presentKeys) {
    const text = parsed.data.sections[key];
    if (typeof text === "string" && text.trim().length > 0) {
      sections[key] = text.trim();
    }
  }

  // bearer:disable javascript_lang_logger_leak — counts and a duration only,
  // no user data.
  log.info(
    { durationMs: Date.now() - startedAt, charts: presentKeys.length, sections: Object.keys(sections).length },
    "[ai] Overview analysis generated",
  );

  return { sections, generatedAt: new Date().toISOString() };
}

/**
 * Self-gating variant for the midnight cron. Returns the reason the analysis was
 * skipped (so the caller can preserve the previously stored result) rather than
 * throwing. Mirrors generateCoachInsightsIfAllowed.
 */
export async function generateOverviewAnalysisIfAllowed(
  userId: string,
  log: Logger = defaultLogger,
): Promise<OverviewAnalysisGenerationOutcome> {
  if (env.AI_FEATURES_ENABLED === "false") return { ok: false, reason: "ai_disabled" };

  const user = await storage.users.getUser(userId);
  if (user?.aiCoachEnabled !== true) return { ok: false, reason: "ai_consent_off" };

  try {
    const budget = await checkAiBudget(userId);
    if (!budget.allowed) return { ok: false, reason: "ai_budget_exceeded" };
  } catch (err) {
    // Budget lookup failure shouldn't hard-block the feature — log and allow,
    // matching coach-insights / the race-predictor's resolveAiBlocker behavior.
    // bearer:disable javascript_lang_logger_leak — err is the budget-lookup
    // failure; userId is the internal Clerk id used for correlation (same as
    // the race-predictor / coach-insights paths).
    log.warn({ err, userId }, "[overview-analysis] AI budget check failed; allowing AI call");
  }

  return { ok: true, result: await generateOverviewAnalysis(userId, log) };
}
