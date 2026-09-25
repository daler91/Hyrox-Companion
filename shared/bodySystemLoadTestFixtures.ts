import { BODY_SYSTEMS } from "./bodySystemLoad";
import type {
  BodySystem,
  BodySystemLoadOverview,
  BodySystemLoadSummary,
} from "./schema/types/analytics";

/**
 * Body-system load fixtures, shared by the suites that need the whole shape:
 * the shared sentence builder, the coach prompt block, the Overview analysis
 * facts and the Analytics card. Kept in one place so the literal isn't
 * copy-pasted across the client/server boundary.
 */

/** One system at a steady, normal week unless overridden. */
export function bodySystemSummary(
  system: BodySystem,
  overrides: Partial<BodySystemLoadSummary> = {},
): BodySystemLoadSummary {
  return {
    system,
    current: 500,
    baseline: 500,
    ratio: 1,
    status: "normal",
    sixWeekHigh: false,
    previousPeak: 520,
    weekly: [480, 500, 510, 490, 520, 500],
    ...overrides,
  };
}

/** All four systems (steady and normal unless overridden), ending 2026-09-25. */
export function bodySystemOverview(
  systems: Partial<Record<BodySystem, Partial<BodySystemLoadSummary>>> = {},
  overrides: Partial<Omit<BodySystemLoadOverview, "systems">> = {},
): BodySystemLoadOverview {
  return {
    asOf: "2026-09-25",
    weeks: [
      { start: "2026-08-15", end: "2026-08-21" },
      { start: "2026-08-22", end: "2026-08-28" },
      { start: "2026-08-29", end: "2026-09-04" },
      { start: "2026-09-05", end: "2026-09-11" },
      { start: "2026-09-12", end: "2026-09-18" },
      { start: "2026-09-19", end: "2026-09-25" },
    ],
    systems: BODY_SYSTEMS.map((system) => bodySystemSummary(system, systems[system])),
    sessionCount: 24,
    estimatedSessions: 0,
    unattributedSessions: 0,
    unscoredSessions: 0,
    ...overrides,
  };
}

/** The headline case: leg muscle at a six-week high while aerobic load stays normal. */
export function legSpikeOverview(
  overrides: Partial<Omit<BodySystemLoadOverview, "systems">> = {},
): BodySystemLoadOverview {
  return bodySystemOverview(
    {
      leg_muscle: {
        current: 1080,
        baseline: 540,
        ratio: 2,
        status: "very_high",
        sixWeekHigh: true,
        previousPeak: 540,
        weekly: [540, 540, 540, 540, 540, 1080],
      },
      upper_pull: {
        current: 0,
        baseline: 0,
        ratio: null,
        status: "minimal",
        previousPeak: 0,
        weekly: [0, 0, 0, 0, 0, 0],
      },
    },
    overrides,
  );
}
