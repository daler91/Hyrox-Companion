import type { CoachNoteInputs } from "@shared/schema";

import type { TrainingContext } from "../gemini/index";

/**
 * Capture a compact audit of which inputs were present when the coach
 * produced the note for a plan day. Persisted as `plan_days.ai_inputs_used`
 * so the athlete sees "Based on: RPE trend · plan phase · coaching docs"
 * on the workout card. Shared by the auto-coach (coachService) and the
 * timeline-suggestion flow (aiSuggestionService).
 */
export function buildCoachNoteInputs(
  ctx: TrainingContext,
  ragUsed: boolean,
  planGoalPresent: boolean,
): CoachNoteInputs {
  const insights = ctx.coachingInsights;
  return {
    rpeTrend: insights?.rpeTrend,
    fatigueFlag: insights?.fatigueFlag,
    planPhase: insights?.planPhase?.phaseLabel,
    weeklyVolumeTrend: insights?.weeklyVolume?.trend,
    loadGovernorAcwrZone: insights?.loadGovernor?.zone,
    loadGovernorAcwr: insights?.loadGovernor?.acwr ?? undefined,
    loadGovernorFlaggedVectors: insights?.loadGovernor?.flaggedVectors,
    loadGovernorRestrictions: insights?.loadGovernor?.activeRestrictions.map((r) => r.id),
    stationGaps: insights?.stationGaps
      ?.filter((g) => g.daysSinceLastTrained === null || g.daysSinceLastTrained >= 10)
      .map((g) => g.station),
    progressionFlags: insights?.progressionFlags
      ?.filter((f) => f.flag === "plateau" || f.flag === "regressing")
      .map((f) => `${f.exercise}:${f.flag}`),
    ragUsed,
    recentWorkoutCount: ctx.recentWorkouts?.length ?? 0,
    completedWorkoutCount: ctx.completedWorkouts,
    planGoalPresent,
  };
}
