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

/**
 * Preserve the day's own coach state across coach-note rewrites.
 * `aiInputsUsed` is rebuilt from scratch on every coach run (and by review
 * notes / manual refreshes), so without this the next write to a day wiped:
 *   - the "Originally planned" record captured when the day was converted;
 *   - lastFatigueReduction / lastModification, which the repeat-fatigue guard
 *     reads. A suppressed repeat cut gets a review note, so the guard erased
 *     its own record and the pass after that cut the day again.
 *     AI15 (CODEBASE_ANALYSIS_2026-10-03)
 *   - missedSessionHold, the card's "adjusted after a missed session" line.
 * Each is carried forward only when the fresh inputs don't set one — a genuine
 * new conversion or modification always wins. The plan adaptation's
 * buildInputs carries the same state.
 *
 * `replaced` marks a write that swapped the day's whole prescription. The
 * sets a missed-session hold was written on went with it, so its line no
 * longer describes the day and is not carried.
 */
export function carryPriorCoachState(
  next: CoachNoteInputs,
  prior: CoachNoteInputs | null | undefined,
  options: { readonly replaced?: boolean } = {},
): CoachNoteInputs {
  if (!prior) return next;
  return {
    ...next,
    ...(!next.replacedPrescription && prior.replacedPrescription
      ? { replacedPrescription: prior.replacedPrescription }
      : {}),
    ...(!next.lastModification && prior.lastModification
      ? { lastModification: prior.lastModification }
      : {}),
    ...(!next.lastFatigueReduction && prior.lastFatigueReduction
      ? { lastFatigueReduction: prior.lastFatigueReduction }
      : {}),
    // Why the day's loads are held (a session before it never happened): the
    // card says so until the engine next changes the day, and a review note
    // written in between must not make it forget.
    ...(!options.replaced && !next.missedSessionHold && prior.missedSessionHold
      ? { missedSessionHold: prior.missedSessionHold }
      : {}),
  };
}
