/**
 * How a session grade reads everywhere it appears — the workout card, the
 * Weekly Review chip, the Analytics tab — so a verdict is always the same
 * words, icon and colour. Colour is never the only signal: every verdict
 * carries a label and an icon too.
 */
import type {
  SessionGradeConfidence,
  SessionGradeDataSource,
  SessionGradeVerdict,
  SessionStreamState,
} from "@shared/schema";
import { RUN_PURPOSE_LABELS, type RunPurpose, type SessionGradeIntent } from "@shared/sessionIntent";

import { getToneClassName, type Tone } from "./adherenceFormat";

export type GradeTone = Tone | "neutral";

const VERDICT_TONES: Readonly<Record<SessionGradeVerdict, GradeTone>> = {
  on_target: "good",
  crept_up: "partial",
  under: "partial",
  too_hard: "low",
  drifted_harder: "low",
  inconclusive: "neutral",
  ungradeable: "neutral",
};

const NEUTRAL_CLASSNAME = "border-border text-muted-foreground bg-muted/40";

export function getGradeTone(verdict: SessionGradeVerdict): GradeTone {
  return VERDICT_TONES[verdict];
}

export function getGradeToneClassName(verdict: SessionGradeVerdict): string {
  const tone = getGradeTone(verdict);
  return tone === "neutral" ? NEUTRAL_CLASSNAME : getToneClassName(tone);
}

/** The short chip label; the headline says the same thing in a sentence. */
export function getGradeLabel(intent: SessionGradeIntent, verdict: SessionGradeVerdict): string {
  switch (verdict) {
    case "on_target":
      return intent === "easy" ? "Stayed easy" : "Held threshold";
    case "crept_up":
      return "Crept up";
    case "too_hard":
      return "Too hard";
    case "drifted_harder":
      return "Drifted harder";
    case "under":
      return "Under threshold";
    case "inconclusive":
      return "Can't tell";
    case "ungradeable":
      return "Not graded";
  }
}

export function getPurposeLabel(purpose: RunPurpose): string {
  return RUN_PURPOSE_LABELS[purpose];
}

const CONFIDENCE_LABELS: Readonly<Record<SessionGradeConfidence, string>> = {
  high: "High confidence",
  medium: "Medium confidence",
  low: "Low confidence",
};

/** Where the grade came from and how far to trust it, in one line. */
export function describeGradeBasis(grade: {
  dataSource: SessionGradeDataSource | null;
  confidence: SessionGradeConfidence | null;
  streamStatus: SessionStreamState;
}): string | null {
  if (!grade.dataSource) return null;
  let source = "From whole-run averages";
  if (grade.dataSource === "stream") source = "From the heart-rate and pace stream";
  else if (grade.streamStatus === "pending") source = "From whole-run averages — the detailed stream is on its way";
  return grade.confidence ? `${source} · ${CONFIDENCE_LABELS[grade.confidence]}` : source;
}

/** "4:52/km" from seconds per km, in the athlete's unit. */
export function formatGradePace(secondsPerKm: number | null, distanceUnit: string): string | null {
  if (secondsPerKm === null || secondsPerKm <= 0) return null;
  const perUnit = distanceUnit === "miles" ? secondsPerKm * 1.609344 : secondsPerKm;
  const total = Math.round(perUnit);
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, "0")}${distanceUnit === "miles" ? "/mi" : "/km"}`;
}
