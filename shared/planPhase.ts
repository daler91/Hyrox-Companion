/**
 * Where an athlete is inside a training block: which week they are on, and which
 * periodisation phase that puts them in.
 *
 * Shared because both halves of the product need the same answer. The server
 * feeds `planPhase` into the coaching prompts (`server/services/ai/coachingInsights.ts`
 * re-exports these), and the Timeline summary card renders "Week 6 of 12 · Build"
 * from the plan it already holds. Computing it twice would let the coach and the
 * card disagree about what week it is.
 *
 * Span math is delegated to `dayDiff`, which works in UTC on `YYYY-MM-DD` strings
 * so a viewer crossing a DST boundary never sees a 23h/25h "day".
 */

import { dayDiff } from "./dateUtils";
import type { TrainingPhase } from "./nutritionTargets";

/** Phases in the order an athlete passes through them. */
export const PLAN_PHASE_ORDER = ["early", "build", "peak", "taper", "race_week"] as const;

export interface PlanPhase {
  currentWeek: number;
  totalWeeks: number;
  phaseLabel: TrainingPhase;
  progressPct: number;
  remainingPhases: TrainingPhase[];
}

/** Today as `YYYY-MM-DD` in UTC — matches the server's `toDateStr()` default. */
function utcToday(): string {
  return new Date().toISOString().split("T")[0];
}

/**
 * Which week of the block today falls in, 1-based and clamped to `totalWeeks`.
 *
 * A plan that has not started yet reads as week 1 rather than a negative week,
 * and a missing start date is treated the same way — the block exists, we just
 * cannot place today inside it.
 *
 * `today` defaults to UTC today; the client passes its own local date string so
 * the card doesn't roll over at the wrong hour for a non-UTC athlete.
 */
export function computeCurrentWeek(
  planStartDate: string | null | undefined,
  totalWeeks: number,
  today: string = utcToday(),
): number {
  if (!planStartDate) return 1;
  const days = dayDiff(planStartDate, today);
  const week = Math.max(1, Math.ceil((days + 1) / 7));
  return Math.min(week, totalWeeks);
}

/**
 * Bucket a week into a periodisation phase by how far through the block it is.
 *
 * The final week is always race week regardless of percentage, so a short block
 * still ends on a taper rather than reading as "peak" throughout.
 * Returns `undefined` for a block we cannot place a week inside.
 */
export function computePlanPhase(
  totalWeeks: number,
  currentWeek: number,
): PlanPhase | undefined {
  if (totalWeeks <= 0 || currentWeek <= 0) return undefined;

  const progressPct = Math.round((currentWeek / totalWeeks) * 100);

  let phaseLabel: TrainingPhase;
  if (currentWeek >= totalWeeks) phaseLabel = "race_week";
  else if (progressPct >= 85) phaseLabel = "taper";
  else if (progressPct >= 60) phaseLabel = "peak";
  else if (progressPct >= 25) phaseLabel = "build";
  else phaseLabel = "early";

  const phaseIndex = PLAN_PHASE_ORDER.indexOf(phaseLabel);
  const remainingPhases = PLAN_PHASE_ORDER.slice(Math.max(phaseIndex + 1, 0));

  return { currentWeek, totalWeeks, phaseLabel, progressPct, remainingPhases: [...remainingPhases] };
}

/** Phase label as prose: `race_week` → "Race week", everything else capitalised. */
export function formatPhaseName(phase: TrainingPhase): string {
  if (phase === "race_week") return "Race week";
  return `${phase.charAt(0).toUpperCase()}${phase.slice(1)}`;
}
