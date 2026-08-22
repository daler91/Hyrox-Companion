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

/**
 * Today as `YYYY-MM-DD` in UTC — matches the server's `toDateStr()` default.
 *
 * Sliced rather than split on "T": `toISOString()` always yields a fixed-width
 * `YYYY-MM-DDTHH:mm:ss.sssZ`, so the first ten characters are exactly the date,
 * and slice stays total where an index into `split()` is `string | undefined`
 * under this directory's `noUncheckedIndexedAccess` ratchet.
 */
function utcToday(): string {
  // shared/ has no access to an athlete's timezone. This is only the DEFAULT
  // for `today`; the client passes its own local date and the server passes
  // getLocalDateStrSafe, so no athlete-facing path relies on it (audit H11).
  // eslint-disable-next-line no-restricted-syntax
  return new Date().toISOString().slice(0, 10);
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
  // NOT clamped to totalWeeks. It used to be, which meant a plan that ended
  // months ago still reported its FINAL week — and because computePlanPhase
  // maps `currentWeek >= totalWeeks` to race_week, the coach was locked into
  // "reduce work only" forever (audit H15). Returning the true week lets
  // computePlanPhase recognise a block today does not sit inside; callers that
  // display "week N of M" clamp for display with planWeekForDisplay.
  return Math.max(1, Math.ceil((days + 1) / 7));
}

/** The week number to SHOW, clamped into the block. */
export function planWeekForDisplay(currentWeek: number, totalWeeks: number): number {
  return Math.min(Math.max(1, currentWeek), Math.max(1, totalWeeks));
}

/** True when `today` is past the end of the block. */
export function isPlanEnded(currentWeek: number, totalWeeks: number): boolean {
  return totalWeeks > 0 && currentWeek > totalWeeks;
}

/**
 * Bucket a week into a periodisation phase by how far through the block it is.
 *
 * The final week is always race week regardless of percentage, so a short block
 * still ends on a taper rather than reading as "peak" throughout.
 * Returns `undefined` for a block we cannot place a week inside.
 */
export function computePlanPhase(totalWeeks: number, currentWeek: number): PlanPhase | undefined {
  if (totalWeeks <= 0 || currentWeek <= 0) return undefined;
  // A week past the end of the block is not a phase of it. Previously
  // unreachable because computeCurrentWeek clamped, which is what made an ended
  // plan read as race week indefinitely (audit H15).
  if (currentWeek > totalWeeks) return undefined;

  // Progress is measured at the MIDPOINT of the current week, not its end.
  //
  // The end-of-week form (`currentWeek / totalWeeks`) made a 4-week plan open
  // in BUILD — week 1 already reading 25% — and a 3-week plan PEAK in week 2 at
  // 67% (audit H15). Measuring at the week's start instead would fix both but
  // costs the taper: an 11th week of 12 would read 83%, never reaching the 85%
  // taper band, so a 12-week block would jump peak → race week. The midpoint
  // keeps every band reachable:
  //
  //   12-week: w1 4% early · w4 29% build · w8 63% peak · w11 88% taper · w12 race
  //    4-week: w1 12% early · w2 38% build · w3 62% peak · w4 race
  //    3-week: w1 17% early · w2 50% build · w3 race
  const progressPct = Math.round(((currentWeek - 0.5) / totalWeeks) * 100);

  let phaseLabel: TrainingPhase;
  if (currentWeek >= totalWeeks) phaseLabel = "race_week";
  // The week before the race is the taper, structurally — the same kind of rule
  // as "the final week is always race week", and for the same reason. Leaving
  // taper to the percentage band alone made it depend on block length: under
  // the midpoint measure only blocks of 10+ weeks would ever reach 85%, so an
  // 8-week plan went peak → race week with no taper at all. Skipped for very
  // short blocks, where a third of the plan should not be spent tapering.
  else if (totalWeeks >= 4 && currentWeek === totalWeeks - 1) phaseLabel = "taper";
  else if (progressPct >= 85) phaseLabel = "taper";
  else if (progressPct >= 60) phaseLabel = "peak";
  else if (progressPct >= 25) phaseLabel = "build";
  else phaseLabel = "early";

  const phaseIndex = PLAN_PHASE_ORDER.indexOf(phaseLabel);
  const remainingPhases = PLAN_PHASE_ORDER.slice(Math.max(phaseIndex + 1, 0));

  return {
    currentWeek,
    totalWeeks,
    phaseLabel,
    progressPct,
    remainingPhases: [...remainingPhases],
  };
}

/** Phase label as prose: `race_week` → "Race week", everything else capitalised. */
export function formatPhaseName(phase: TrainingPhase): string {
  if (phase === "race_week") return "Race week";
  return `${phase.charAt(0).toUpperCase()}${phase.slice(1)}`;
}
