/**
 * shared/planPhase.ts, ported to mobile/core/.../core/plans/PlanPhase.kt.
 *
 * `computeCurrentWeek` defaults `today` to the UTC clock; every case here passes
 * `today` explicitly, so the fixture never depends on when it is generated.
 * `computePlanPhase` is swept over every week (and the weeks either side) of
 * blocks from 1 to 24 weeks, which crosses every phase transition.
 */
import { addDaysToISODate } from "@shared/dateUtils";
import { computeCurrentWeek, computePlanPhase, PLAN_PHASE_ORDER } from "@shared/planPhase";

import { suite } from "../types";

/** A Monday, used as the fixed "today" and plan start of the sweeps. */
const MONDAY = "2026-11-09";

type CurrentWeekInput = readonly [planStartDate: string | null, totalWeeks: number, today: string];

const CURRENT_WEEK_CASES: CurrentWeekInput[] = [
  // No start date (null and "" are both falsy).
  [null, 12, "2026-06-15"],
  ["", 12, "2026-06-15"],
  // Today from 15 days before the start to 30 days after, then far past the end.
  ...[...Array.from({ length: 46 }, (_, i) => i - 15), 83, 84, 99, 100, 365, 1000].map(
    (offset): CurrentWeekInput => [MONDAY, 12, addDaysToISODate(MONDAY, offset)],
  ),
  // docs/mobile-shared-logic.md: started 100 days ago on a 12-week plan, starts in 10 days.
  [addDaysToISODate(MONDAY, -100), 12, MONDAY],
  [addDaysToISODate(MONDAY, 10), 12, MONDAY],
  // Spans across the US and EU DST changes, a leap day and a year boundary.
  ["2026-03-01", 12, "2026-03-29"],
  ["2026-03-23", 12, "2026-03-30"],
  ["2026-10-26", 12, "2026-11-02"],
  ["2024-02-26", 8, "2024-03-04"],
  ["2024-02-29", 8, "2024-03-07"],
  ["2026-12-28", 8, "2027-01-04"],
  ["2026-12-31", 8, "2027-01-06"],
  ["2026-12-31", 8, "2027-01-07"],
  // totalWeeks is not read: the week is never clamped to it.
  [MONDAY, 0, "2026-12-07"],
  [MONDAY, -1, "2026-12-07"],
  [MONDAY, 1, "2027-11-09"],
  // Tolerated dates parse to some day; one that does not parse gives NaN.
  ["2026-02-30", 12, "2026-03-09"],
  [" 2026-11-09", 12, "2026-11-16"],
  ["garbage", 12, MONDAY],
  [MONDAY, 12, "garbage"],
  [MONDAY, 12, ""],
];

const PHASE_BLOCKS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 16, 20, 24];

const PLAN_PHASE_CASES: (readonly [totalWeeks: number, currentWeek: number])[] = [
  // Every week of each block, plus week 0, week -1 and the week after the end.
  ...PHASE_BLOCKS.flatMap((total) =>
    Array.from({ length: total + 3 }, (_, i) => [total, i - 1] as const),
  ),
  // Not a block.
  [0, -1],
  [0, 0],
  [0, 1],
  [-1, 0],
  [-1, 1],
  // Longer than the 24-week cap: the function itself does not care.
  ...[1, 13, 26, 44, 45, 50, 51, 52, 53].map((week) => [52, week] as const),
];

export const planPhaseSuites = [
  suite({
    name: "planPhase.constants",
    description: "PLAN_PHASE_ORDER: the phases in the order an athlete passes through them.",
    run: () => ({ PLAN_PHASE_ORDER }),
    cases: [null],
  }),
  suite({
    name: "planPhase.computeCurrentWeek",
    description: "1-based week of the block today falls in: at least 1, never clamped to totalWeeks; NaN for a bad date.",
    run: ([planStartDate, totalWeeks, today]: CurrentWeekInput) => computeCurrentWeek(planStartDate, totalWeeks, today),
    cases: CURRENT_WEEK_CASES,
  }),
  suite({
    name: "planPhase.computePlanPhase",
    description: "Phase, midpoint progress and remaining phases for a week; null outside 1..totalWeeks.",
    run: ([totalWeeks, currentWeek]: readonly [number, number]) => computePlanPhase(totalWeeks, currentWeek) ?? null,
    cases: PLAN_PHASE_CASES,
  }),
];
