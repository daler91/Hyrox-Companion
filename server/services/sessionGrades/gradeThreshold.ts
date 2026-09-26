/**
 * Did the threshold run stay at threshold, or drift harder?
 *
 * Only the work counts (workSegments.ts finds it). Three things mean the
 * session went harder than threshold: the work was run clearly faster than
 * threshold pace, a real share of it sat in Z5, or HR climbed into Z5 over
 * the reps — the classic "last rep turned into a VO2 effort". Stayed under
 * means the work was both slower than threshold pace and below Z4 (either
 * alone when only one signal exists). When pace and HR disagree the evidence
 * says so rather than hiding it.
 */
import type { SessionGradeTargets, ThresholdGradeMetrics } from "@shared/schema";
import type { SessionStreamSamples } from "@shared/schema/sessionStream";

import {
  DECOUPLING_WARN_PCT,
  HR_LAG_S,
  THRESHOLD_FAST_TOLERANCE,
  THRESHOLD_SLOW_TOLERANCE,
  THRESHOLD_Z5_SHARE,
} from "./constants";
import { bpm, fmtPace, hrBasisNote, pickEvidence } from "./evidence";
import { hrOver, hrShare, movingSeconds, paceOver, pct, roundTo, splitByMovingTime } from "./signals";
import { type GradeContext, type GradeOutcome, type SummaryMetrics, ungradeable } from "./types";
import { findWorkSegments, type Segmentation } from "./workSegments";

const FAST_PCT = THRESHOLD_FAST_TOLERANCE * 100;
const SLOW_PCT = THRESHOLD_SLOW_TOLERANCE * 100;

/** Each segment minus its first minute, while HR catches up with the pace. */
function settledSegments(samples: SessionStreamSamples, segments: number[][]): number[][] {
  const lagBuckets = Math.round(HR_LAG_S / samples.bucketSeconds);
  return segments.map((segment) => (segment.length > lagBuckets * 2 ? segment.slice(lagBuckets) : segment));
}

function decoupling(samples: SessionStreamSamples, work: number[]): number | null {
  const [firstHalf = [], secondHalf = []] = splitByMovingTime(samples, work, 2);
  const efficiency = (buckets: number[]) => {
    const pace = paceOver(samples, buckets);
    const hr = hrOver(samples, buckets).avg;
    return pace === null || hr === null ? null : 1000 / pace / hr;
  };
  const first = efficiency(firstHalf);
  const second = efficiency(secondHalf);
  if (first === null || second === null || first <= 0) return null;
  return roundTo(((first - second) / first) * 100, 1);
}

function measure(samples: SessionStreamSamples, seg: Segmentation, ctx: GradeContext): ThresholdGradeMetrics {
  const { targets } = ctx;
  const work = seg.segments.flat();
  const settled = settledSegments(samples, seg.segments);
  const settledWork = settled.flat();
  const pace = ctx.speedTrusted ? paceOver(samples, work) : null;
  const hr = hrOver(samples, settledWork);
  const z4 = targets.thresholdHr;
  const z5 = targets.z5FloorHr;
  const inZ4 = z4 ? hrShare(samples, settledWork, (value) => value >= z4.min && (z5 === null || value < z5)) : null;
  const inZ5 = z5 === null ? null : hrShare(samples, settledWork, (value) => value >= z5);
  const repHr = (segment: number[] | undefined) => {
    const avg = segment ? hrOver(samples, segment).avg : null;
    return avg === null ? null : roundTo(avg);
  };
  return {
    segmentation: seg.kind === "reps" ? "reps" : "continuous",
    workMinutes: roundTo(movingSeconds(samples, work) / 60),
    repCount: seg.kind === "reps" ? seg.segments.length : 1,
    workAvgPaceSecPerKm: pace === null ? null : roundTo(pace),
    paceDeltaPct:
      pace !== null && targets.thresholdPace
        ? roundTo(((pace - targets.thresholdPace) / targets.thresholdPace) * 100, 1)
        : null,
    workAvgHr: hr.avg === null ? null : roundTo(hr.avg),
    pctWorkZ4: inZ4 ? pct(inZ4.matched, inZ4.total) : null,
    pctWorkZ5: inZ5 ? pct(inZ5.matched, inZ5.total) : null,
    firstRepHr: repHr(settled.at(0)),
    lastRepHr: repHr(settled.at(-1)),
    decouplingPct: pace === null || hr.avg === null ? null : decoupling(samples, work),
  };
}

type ThresholdVerdict = "on_target" | "drifted_harder" | "under";

interface VerdictReasons {
  verdict: ThresholdVerdict;
  tooFast: boolean;
  z5Share: boolean;
  climbedIntoZ5: boolean;
}

function decide(m: ThresholdGradeMetrics, targets: SessionGradeTargets): VerdictReasons {
  const tooFast = m.paceDeltaPct !== null && m.paceDeltaPct < -FAST_PCT;
  const z5Share = m.pctWorkZ5 !== null && m.pctWorkZ5 >= THRESHOLD_Z5_SHARE * 100;
  const z5 = targets.z5FloorHr;
  const climbedIntoZ5 =
    m.repCount >= 2 &&
    z5 !== null &&
    m.firstRepHr !== null &&
    m.lastRepHr !== null &&
    m.firstRepHr < z5 &&
    m.lastRepHr >= z5;
  if (tooFast || z5Share || climbedIntoZ5) {
    return { verdict: "drifted_harder", tooFast, z5Share, climbedIntoZ5 };
  }
  const hasPace = m.paceDeltaPct !== null;
  const hasHr = m.workAvgHr !== null && targets.thresholdHr !== null;
  const paceUnder = hasPace && (m.paceDeltaPct ?? 0) > SLOW_PCT;
  const hrUnder = hasHr && (m.workAvgHr ?? 0) < (targets.thresholdHr?.min ?? 0);
  let under = false;
  if (hasPace && hasHr) under = paceUnder && hrUnder;
  else if (hasPace) under = paceUnder;
  else if (hasHr) under = hrUnder;
  return { verdict: under ? "under" : "on_target", tooFast, z5Share, climbedIntoZ5 };
}

function workLine(m: ThresholdGradeMetrics, targets: SessionGradeTargets, unit: string): string {
  const reps = m.repCount === 1 ? "rep" : "reps";
  const what =
    m.segmentation === "reps"
      ? `Found ${m.repCount} ${reps}, ${m.workMinutes} min of work`
      : `No clear reps, so the middle ${m.workMinutes} min was graded as one block`;
  if (m.workAvgPaceSecPerKm === null) return `${what}.`;
  const target = targets.thresholdPace ? ` vs ${fmtPace(targets.thresholdPace, unit)} threshold` : "";
  return `${what} at ${fmtPace(m.workAvgPaceSecPerKm, unit)}${target}.`;
}

function driftedLines(m: ThresholdGradeMetrics, r: VerdictReasons, z5: number | null): (string | null)[] {
  const climbed =
    r.climbedIntoZ5 && m.firstRepHr !== null && m.lastRepHr !== null
      ? `HR climbed from ${bpm(m.firstRepHr)} on the first rep to ${bpm(m.lastRepHr)} on the last, into Z5.`
      : null;
  const inZ5 = r.z5Share && z5 !== null ? `${m.pctWorkZ5}% of the work was in Z5 (${bpm(z5)} and up).` : null;
  const fast =
    r.tooFast && m.paceDeltaPct !== null ? `That is ${Math.abs(m.paceDeltaPct)}% faster than threshold pace.` : null;
  return [climbed, inZ5, fast];
}

/** When an on-target grade rests on pace and HR that tell different stories, say so. */
function disagreementLine(m: ThresholdGradeMetrics, z4: SessionGradeTargets["thresholdHr"]): string | null {
  if (m.workAvgHr === null || z4 === null) return null;
  const hrBelow = m.workAvgHr < z4.min;
  if (hrBelow && m.paceDeltaPct !== null && Math.abs(m.paceDeltaPct) <= SLOW_PCT) {
    return "Pace was on target but HR stayed under Z4 — if that is usual for you, your max HR may be set high.";
  }
  if (!hrBelow && (m.paceDeltaPct ?? 0) > SLOW_PCT) {
    return "HR was at threshold though the pace was slow — heat, hills or fatigue can do that.";
  }
  return null;
}

function reasonLines(m: ThresholdGradeMetrics, r: VerdictReasons, targets: SessionGradeTargets): (string | null)[] {
  if (r.verdict === "drifted_harder") return driftedLines(m, r, targets.z5FloorHr);
  const z4 = targets.thresholdHr;
  const hrLine =
    m.workAvgHr !== null && z4 ? `Work HR averaged ${bpm(m.workAvgHr)}; your Z4 is ${z4.min}–${z4.max} bpm.` : null;
  return [hrLine, r.verdict === "on_target" ? disagreementLine(m, z4) : null];
}

export function gradeThresholdStream(samples: SessionStreamSamples, ctx: GradeContext): GradeOutcome {
  const seg = findWorkSegments(samples, { speedTrusted: ctx.speedTrusted });
  if (seg.kind === "none") {
    return {
      verdict: "inconclusive",
      evidence: ["Couldn't find a sustained effort in this recording to grade."],
      confidence: null,
      dataSource: "stream",
      ungradeableReason: null,
      easy: null,
      threshold: null,
    };
  }
  const m = measure(samples, seg, ctx);
  const hasPace = m.paceDeltaPct !== null;
  const hasHr = m.workAvgHr !== null && ctx.targets.thresholdHr !== null;
  if (!hasPace && !hasHr) {
    return ungradeable("no_data", ["The work had neither heart rate nor a pace to compare with threshold."], "stream");
  }
  const reasons = decide(m, ctx.targets);
  const decoupled =
    m.decouplingPct !== null && m.decouplingPct >= DECOUPLING_WARN_PCT
      ? `Pace-to-HR decoupled ${m.decouplingPct}% from the first half of the work to the second.`
      : null;

  const hrStrong = hasHr && ctx.targets.hrBasis === "measured";
  const paceStrong = hasPace && ctx.targets.paceSource !== "history";
  let confidence: GradeOutcome["confidence"] = "medium";
  if (hrStrong && (paceStrong || !hasPace)) confidence = "high";
  else if (!hasHr && ctx.targets.paceSource === "history") confidence = "low";

  return {
    verdict: reasons.verdict,
    evidence: pickEvidence([
      workLine(m, ctx.targets, ctx.distanceUnit),
      ...reasonLines(m, reasons, ctx.targets),
      decoupled,
      hrBasisNote(ctx.targets),
    ]),
    confidence,
    dataSource: "stream",
    ungradeableReason: null,
    easy: null,
    threshold: m,
  };
}

/**
 * Whole-run averages include the warm-up and cool-down, which pull both HR and
 * pace toward easy. So the summary can confirm a session went too hard (even
 * diluted, it averaged Z5 or faster than threshold) but can never confirm it
 * held threshold — that needs the stream.
 */
function summaryPace(summary: SummaryMetrics, ctx: GradeContext): number | null {
  if (!ctx.speedTrusted || !summary.avgSpeed || summary.avgSpeed <= 0) return null;
  return 1000 / summary.avgSpeed;
}

function summaryMetrics(summary: SummaryMetrics, pace: number | null, thresholdPace: number | null): ThresholdGradeMetrics {
  const paceDeltaPct =
    pace !== null && thresholdPace ? roundTo(((pace - thresholdPace) / thresholdPace) * 100, 1) : null;
  return {
    segmentation: "whole_run",
    workMinutes: roundTo(summary.durationMin ?? 0),
    repCount: 0,
    workAvgPaceSecPerKm: pace === null ? null : roundTo(pace),
    paceDeltaPct,
    workAvgHr: summary.avgHr === null ? null : roundTo(summary.avgHr),
    pctWorkZ4: null,
    pctWorkZ5: null,
    firstRepHr: null,
    lastRepHr: null,
    decouplingPct: null,
  };
}

/** Whole-run HR already in Z5, or whole-run pace already under threshold: harder than planned even diluted. */
function summaryHarderLines(
  summary: SummaryMetrics,
  pace: number | null,
  metrics: ThresholdGradeMetrics,
  ctx: GradeContext,
): (string | null)[] {
  const { z5FloorHr: z5, thresholdPace } = ctx.targets;
  const hrLine =
    summary.avgHr !== null && z5 !== null && summary.avgHr >= z5
      ? `Even averaged over the whole run, HR was ${bpm(summary.avgHr)} — Z5 starts at ${bpm(z5)}.`
      : null;
  const paceLine =
    pace !== null && thresholdPace && metrics.paceDeltaPct !== null && metrics.paceDeltaPct < 0
      ? `Even averaged over the whole run, pace was ${fmtPace(pace, ctx.distanceUnit)}, faster than ${fmtPace(thresholdPace, ctx.distanceUnit)} threshold.`
      : null;
  return [hrLine, paceLine];
}

/**
 * Whole-run averages include the warm-up and cool-down, which pull both HR and
 * pace toward easy. So the summary can confirm a session went too hard (even
 * diluted, it averaged Z5 or faster than threshold) but can never confirm it
 * held threshold — that needs the stream.
 */
export function gradeThresholdSummary(summary: SummaryMetrics, ctx: GradeContext): GradeOutcome {
  const pace = summaryPace(summary, ctx);
  if (summary.avgHr === null && pace === null) {
    return ungradeable("no_data", ["This session has no heart rate or pace to grade. Link a Strava recording to grade it."], "summary");
  }
  const metrics = summaryMetrics(summary, pace, ctx.targets.thresholdPace);
  const harder = summaryHarderLines(summary, pace, metrics, ctx);
  const averagesLine = "These are whole-run averages with the warm-up and cool-down in them.";
  const drifted = harder.some((line) => line !== null);
  return {
    verdict: drifted ? "drifted_harder" : "inconclusive",
    evidence: drifted
      ? pickEvidence([...harder, averagesLine])
      : [averagesLine, "The heart-rate and pace stream is needed to see the reps; it is fetched from Strava shortly after sync."],
    confidence: drifted ? "low" : null,
    dataSource: "summary",
    ungradeableReason: null,
    easy: null,
    threshold: metrics,
  };
}
