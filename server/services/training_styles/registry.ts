import type { TrainingContext, UpcomingWorkout, WorkoutSuggestion } from "../../gemini";
import type { ResolvedTrainingStyle, TrainingStyleStrategy } from "./types";

const DEFAULT_TRAINING_STYLE_ID = "balanced_default";

type AnalysisClass = "compliant" | "mostly" | "non-compliant" | "concerning";

const STYLE_CORE_FRAGMENTS: Record<string, string> = {
  balanced_default: "Style core: balance progression, recovery, and consistency. Prefer sustainable overload and avoid abrupt spikes.",
  maf_method:
    "Style core (MAF): prioritize aerobic base development, low-intensity durability, and strict intensity discipline around the MAF ceiling.",
};

const PHASE_CONSTRAINTS: Record<string, string> = {
  early: "Phase constraints (EARLY): build base and movement quality; keep intensity conservative.",
  build: "Phase constraints (BUILD): progress load/volume gradually with clear intent.",
  peak: "Phase constraints (PEAK): preserve quality, specificity, and recovery between hard sessions.",
  taper: "Phase constraints (TAPER): reduce volume and preserve sharpness; no new stressors.",
  race_week: "Phase constraints (RACE WEEK): reduce work only, prioritize freshness and confidence.",
  unknown: "Phase constraints (UNKNOWN): default to conservative progression and risk control.",
};

const WORKOUT_ANALYSIS_RUBRIC =
  "Workout-analysis rubric: classify each planned workout by intent alignment, recovery cost, and progression value before recommending any edits.";

const RESPONSE_TONE_AND_SAFETY_GUARDRAILS =
  "Response tone/safety guardrails: be direct, specific, and supportive; never prescribe abrupt overload when fatigue/risk signals are elevated.";

const ANALYSIS_CLASS_TEMPLATES: Record<AnalysisClass, string> = {
  compliant: "Analysis class template - compliant: preserve structure and only add minor execution cues.",
  mostly: "Analysis class template - mostly: keep intent, apply one focused adjustment.",
  "non-compliant": "Analysis class template - non-compliant: rewrite key prescription elements to restore phase/style compliance.",
  concerning: "Analysis class template - concerning: prioritize risk reduction, simplify session load, and protect recovery first.",
};

function getPhaseKey(trainingContext: TrainingContext): keyof typeof PHASE_CONSTRAINTS {
  return trainingContext.coachingInsights?.planPhase?.phaseLabel ?? "unknown";
}

function buildStructuredFields(trainingContext: TrainingContext, styleId: string, upcomingWorkouts: UpcomingWorkout[]) {
  const phase = getPhaseKey(trainingContext);
  const completed = trainingContext.completedWorkouts ?? 0;
  const attempted = completed + (trainingContext.missedWorkouts ?? 0) + (trainingContext.skippedWorkouts ?? 0);
  const completionRate = attempted > 0
    ? Math.round((completed / attempted) * 100)
    : Math.round(trainingContext.completionRate ?? 0);

  return {
    trainingStyleId: styleId,
    phase,
    computed: {
      mafHr: trainingContext.coachingInsights?.decisionTree?.currentPhase === "aerobic_base" ? "use_user_profile_maf_hr" : null,
      complianceStats: {
        completionRatePct: completionRate,
        currentStreak: trainingContext.currentStreak,
        fatigueFlag: trainingContext.coachingInsights?.fatigueFlag ?? false,
        undertrainingFlag: trainingContext.coachingInsights?.undertrainingFlag ?? false,
      },
      upcomingWorkoutCount: upcomingWorkouts.length,
    },
  };
}

function buildPromptSuffix(trainingContext: TrainingContext, styleId: string, upcomingWorkouts: UpcomingWorkout[]) {
  const phase = getPhaseKey(trainingContext);
  const sections = [
    `Training style: ${styleId}`,
    STYLE_CORE_FRAGMENTS[styleId] ?? STYLE_CORE_FRAGMENTS.balanced_default,
    PHASE_CONSTRAINTS[phase],
    WORKOUT_ANALYSIS_RUBRIC,
    RESPONSE_TONE_AND_SAFETY_GUARDRAILS,
    ...Object.values(ANALYSIS_CLASS_TEMPLATES),
    `Structured fields: ${JSON.stringify(buildStructuredFields(trainingContext, styleId, upcomingWorkouts))}`,
  ];

  return sections.join("\n");
}

const defaultStrategy: TrainingStyleStrategy = {
  id: DEFAULT_TRAINING_STYLE_ID,
  computeProfile(trainingContext: TrainingContext) {
    return {
      completionRate: trainingContext.completionRate,
      currentStreak: trainingContext.currentStreak,
      rpeTrend: trainingContext.coachingInsights?.rpeTrend ?? "insufficient_data",
    };
  },
  analyzeWorkout(_trainingContext: TrainingContext, upcomingWorkouts: UpcomingWorkout[]) {
    return `Review ${upcomingWorkouts.length} upcoming workouts and prioritize sustainable progression.`;
  },
  prescribeNext(input: { suggestions: WorkoutSuggestion[]; trainingContext: TrainingContext }) {
    return input.suggestions;
  },
  phaseLogic(trainingContext: TrainingContext) {
    return trainingContext.coachingInsights?.planPhase
      ? `Follow ${trainingContext.coachingInsights.planPhase.phaseLabel} phase intent.`
      : "Use conservative progression when plan phase is unknown.";
  },
  safetyRules(trainingContext: TrainingContext) {
    return trainingContext.coachingInsights?.fatigueFlag
      ? ["Reduce intensity/volume when fatigue flag is active."]
      : ["Avoid sudden spikes in intensity or volume."];
  },
  buildPromptContext(trainingContext: TrainingContext, upcomingWorkouts: UpcomingWorkout[]) {
    return {
      promptSuffix: buildPromptSuffix(trainingContext, this.id, upcomingWorkouts),
    };
  },
};

const mafMethodStrategy: TrainingStyleStrategy = {
  ...defaultStrategy,
  id: "maf_method",
  buildPromptContext(trainingContext: TrainingContext, upcomingWorkouts: UpcomingWorkout[]) {
    return {
      promptSuffix: buildPromptSuffix(trainingContext, this.id, upcomingWorkouts),
    };
  },
};

const strategies = new Map<string, TrainingStyleStrategy>([
  [defaultStrategy.id, defaultStrategy],
  [mafMethodStrategy.id, mafMethodStrategy],
]);

export function resolveTrainingStyle(trainingStyleId?: string | null): ResolvedTrainingStyle {
  const strategy = (trainingStyleId && strategies.get(trainingStyleId)) || strategies.get(DEFAULT_TRAINING_STYLE_ID)!;
  return { trainingStyleId: strategy.id, strategy };
}

export { DEFAULT_TRAINING_STYLE_ID };
