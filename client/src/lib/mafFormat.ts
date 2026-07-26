/**
 * Presentation for the MAF aerobic ceiling — the heart rate a MAF-method
 * athlete is meant to stay under on easy aerobic work.
 *
 * `users.mafHr` has been computed at onboarding, stored, sent to the client,
 * fed to the coach and used to score MAF tests since the training-style rollout,
 * but was never rendered as a number: the MAF trend tab plots compliance against
 * a ceiling the athlete has never been shown. These helpers are the display
 * layer for it. The scoring itself stays in `shared/maf.ts` — nothing here
 * re-derives a threshold.
 */
import { computeMafCompliance, type MafComplianceClass } from "@shared/maf";

import { getToneClassName, type Tone } from "./adherenceFormat";

/** The user shape these helpers need — a subset of the auth user. */
export interface MafAthlete {
  readonly trainingStyleId?: string | null;
  readonly mafHr?: number | null;
}

/**
 * The athlete's ceiling, or null when it shouldn't be shown.
 *
 * `mafHr` is only written at onboarding for MAF-method athletes, so a stored
 * ceiling on someone who has since switched style no longer describes how they
 * train. Same gate as `MafTestTagSection`.
 */
export function getMafCeiling(athlete: MafAthlete | null | undefined): number | null {
  if (!athlete) return null;
  if (athlete.trainingStyleId !== "maf_method") return null;
  return athlete.mafHr ?? null;
}

const CLASS_TONES: Record<MafComplianceClass, Tone> = {
  compliant: "good",
  mostly_compliant: "partial",
  over_ceiling: "low",
};

export interface MafTileSummary {
  /** Appended to the tile's visible label, so colour is never the only signal. */
  readonly labelSuffix: string;
  readonly accentClassName: string;
  /** The coaching cue from `computeMafCompliance`, for the tile's tooltip. */
  readonly title: string;
}

/** How a completed session's average HR sat against the ceiling. */
export function summariseMafTile(input: {
  avgHeartRate: number;
  maxHeartRate?: number | null;
  ceiling: number;
}): MafTileSummary {
  const compliance = computeMafCompliance({
    avgHeartRate: input.avgHeartRate,
    maxHeartRate: input.maxHeartRate ?? null,
    ceiling: input.ceiling,
  });
  const { avgOverBy } = compliance.details;

  let labelSuffix: string;
  if (compliance.classification === "over_ceiling") {
    labelSuffix = ` · ${avgOverBy} over MAF`;
  } else if (compliance.classification === "mostly_compliant") {
    labelSuffix = " · MAF peaks";
  } else {
    labelSuffix = avgOverBy === 0 ? " · at MAF" : ` · ${Math.abs(avgOverBy)} under MAF`;
  }

  return {
    labelSuffix,
    accentClassName: getToneClassName(CLASS_TONES[compliance.classification]),
    title: compliance.nextAction,
  };
}
