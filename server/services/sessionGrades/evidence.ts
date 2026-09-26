/**
 * The words on a grade: headlines per verdict, and the formatting every
 * evidence sentence shares (paces in the athlete's unit, whole bpm).
 */
import type { SessionGradeTargets, SessionGradeVerdict } from "@shared/schema";
import type { SessionGradeIntent } from "@shared/sessionIntent";
import { formatPace } from "@shared/unitConversion";

const HEADLINES: Readonly<Record<SessionGradeIntent, Readonly<Record<SessionGradeVerdict, string>>>> = {
  easy: {
    on_target: "Stayed easy",
    crept_up: "Crept above easy",
    too_hard: "Too hard for an easy day",
    drifted_harder: "Too hard for an easy day",
    under: "Stayed easy",
    inconclusive: "Can't tell from this data",
    ungradeable: "Can't grade yet",
  },
  threshold: {
    on_target: "Held threshold",
    crept_up: "Drifted harder than threshold",
    too_hard: "Drifted harder than threshold",
    drifted_harder: "Drifted harder than threshold",
    under: "Stayed under threshold",
    inconclusive: "Can't tell from the averages",
    ungradeable: "Can't grade yet",
  },
};

export function headlineFor(intent: SessionGradeIntent, verdict: SessionGradeVerdict): string {
  return HEADLINES[intent][verdict];
}

export function fmtPace(secondsPerKm: number, distanceUnit: string): string {
  return formatPace(1000 / secondsPerKm, distanceUnit);
}

export function fmtPaceRange(range: { fast: number; slow: number }, distanceUnit: string): string {
  const slow = fmtPace(range.slow, distanceUnit);
  const fast = fmtPace(range.fast, distanceUnit).replace(/\/(?:km|mi)$/, "");
  return `${fast}–${slow}`;
}

export function bpm(value: number): string {
  return `${Math.round(value)} bpm`;
}

/** Nudge toward a measured max HR when the zones rest on an age estimate. */
export function hrBasisNote(targets: SessionGradeTargets): string | null {
  return targets.hrBasis === "age_estimated"
    ? "Zones use an age-estimated max HR — add a measured max HR in Settings for sharper grades."
    : null;
}

/** Keep the strongest few sentences; drop empties. */
export function pickEvidence(sentences: readonly (string | null | false | undefined)[], max = 3): string[] {
  return sentences.filter((sentence): sentence is string => typeof sentence === "string" && sentence.length > 0).slice(0, max);
}
