/**
 * Grade one run against its purpose: pick the grader for the intent, grade
 * from the stream when there is one and from the summary otherwise.
 *
 * `GRADERS` is the extension point — grading a new kind of session (intervals,
 * say) is a new intent in shared/sessionIntent.ts plus a grader here.
 */
import type { SessionGradeVerdict } from "@shared/schema";
import type { SessionStreamSamples } from "@shared/schema/sessionStream";
import type { SessionGradeIntent } from "@shared/sessionIntent";

import { gradeEasyStream, gradeEasySummary } from "./gradeEasy";
import { gradeThresholdStream, gradeThresholdSummary } from "./gradeThreshold";
import { hasTargets } from "./targets";
import { type GradeContext, type GradeOutcome, type Grader, type SummaryMetrics, ungradeable } from "./types";

export const GRADERS: Readonly<Record<SessionGradeIntent, Grader>> = {
  easy: { stream: gradeEasyStream, summary: gradeEasySummary },
  threshold: { stream: gradeThresholdStream, summary: gradeThresholdSummary },
};

export interface GradeRunInput {
  intent: SessionGradeIntent;
  samples: SessionStreamSamples | null;
  summary: SummaryMetrics;
  ctx: GradeContext;
}

export const NO_TARGETS_EVIDENCE =
  "Add your max heart rate (or your age) in Settings, or log a couple of timed runs, so there is an easy and a threshold to measure against.";

export function gradeRun(input: GradeRunInput): GradeOutcome {
  if (!hasTargets(input.intent, input.ctx.targets)) {
    return ungradeable("no_targets", [NO_TARGETS_EVIDENCE]);
  }
  const grader = GRADERS[input.intent];
  return input.samples ? grader.stream(input.samples, input.ctx) : grader.summary(input.summary, input.ctx);
}

/** Verdicts that say something definite about the run. */
export function isDefinite(verdict: SessionGradeVerdict): boolean {
  return verdict !== "inconclusive" && verdict !== "ungradeable";
}
