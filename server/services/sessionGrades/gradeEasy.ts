/**
 * Did the easy run stay easy?
 *
 * Heart rate decides when the recording has it: the share of moving time
 * above the easy ceiling (top of Z2, or the MAF ceiling), and whether HR crept
 * up over the run. A little time above the ceiling is normal — a hill, a
 * crossing — so only a sustained share or a late climb counts against the run.
 * Pace is evidence alongside HR (a quick pace at an easy HR means the easy
 * range is conservative, not that the run was hard) and decides only when the
 * recording has no HR.
 */
import type { EasyGradeMetrics } from "@shared/schema";
import type { SessionStreamSamples } from "@shared/schema/sessionStream";

import {
  EASY_CREPT_MAX_ABOVE,
  EASY_DRIFT_CREPT_PCT,
  EASY_DRIFT_WARMUP_EXCLUDE_S,
  EASY_MIN_ANALYSED_S,
  EASY_ON_TARGET_MAX_ABOVE,
  EASY_PACE_FAST_TOLERANCE,
  MIN_EASY_RUN_S,
  SUMMARY_EASY_CREPT_FAST,
  SUMMARY_EASY_TOO_FAST,
  SUMMARY_PEAK_TOLERANCE_BPM,
} from "./constants";
import { bpm, fmtPace, fmtPaceRange, hrBasisNote, pickEvidence } from "./evidence";
import {
  fasterThanShare,
  hrOver,
  hrShare,
  movingBuckets,
  movingSeconds,
  paceOver,
  pct,
  roundTo,
  splitByMovingTime,
} from "./signals";
import { type GradeContext, type GradeOutcome, type SummaryMetrics, ungradeable } from "./types";

type EasyVerdict = "on_target" | "crept_up" | "too_hard";

function bandVerdict(share: number): EasyVerdict {
  if (share > EASY_CREPT_MAX_ABOVE) return "too_hard";
  if (share > EASY_ON_TARGET_MAX_ABOVE) return "crept_up";
  return "on_target";
}

/** Moving buckets minus a long run's planned harder finish (counted back from the end). */
function withoutFinish(samples: SessionStreamSamples, moving: number[], finishMinutes: number | null): number[] {
  if (!finishMinutes) return moving;
  let remaining = finishMinutes * 60;
  let end = moving.length;
  while (end > 0 && remaining > 0) {
    end -= 1;
    remaining -= samples.mov.at(moving.at(end) ?? 0) ?? 0;
  }
  return moving.slice(0, end);
}

interface Drift {
  first: number;
  last: number;
  pct: number;
}

/** First-third vs last-third HR after the warm-up, or null when the run is too short to say. */
function hrDrift(samples: SessionStreamSamples, buckets: number[]): Drift | null {
  let elapsed = 0;
  const settled = buckets.filter((i) => {
    const keep = elapsed >= EASY_DRIFT_WARMUP_EXCLUDE_S;
    elapsed += samples.mov.at(i) ?? 0;
    return keep;
  });
  if (movingSeconds(samples, settled) < EASY_MIN_ANALYSED_S) return null;
  const thirds = splitByMovingTime(samples, settled, 3);
  const first = hrOver(samples, thirds.at(0) ?? []).avg;
  const last = hrOver(samples, thirds.at(2) ?? []).avg;
  if (first === null || last === null) return null;
  return { first, last, pct: roundTo(((last - first) / first) * 100, 1) };
}

function emptyMetrics(movingMinutes: number, excluded: number | null): EasyGradeMetrics {
  return {
    movingMinutes,
    avgHr: null,
    pctAboveCeiling: null,
    firstThirdHr: null,
    lastThirdHr: null,
    hrDriftPct: null,
    avgPaceSecPerKm: null,
    pctFasterThanEasy: null,
    excludedFinishMinutes: excluded,
  };
}

function heartRateVerdict(
  avgHr: number,
  ceiling: number,
  aboveShare: number,
  drift: Drift | null,
): { verdict: EasyVerdict; byDrift: boolean } {
  if (avgHr > ceiling) return { verdict: "too_hard", byDrift: false };
  const band = bandVerdict(aboveShare);
  if (band !== "on_target") return { verdict: band, byDrift: false };
  if (drift && drift.pct >= EASY_DRIFT_CREPT_PCT && drift.last > ceiling) return { verdict: "crept_up", byDrift: true };
  return { verdict: "on_target", byDrift: false };
}

/** What the HR and pace graders of one recording share. */
interface EasyStreamRun {
  samples: SessionStreamSamples;
  /** Moving buckets, less any planned harder finish. */
  analysed: number[];
  ctx: GradeContext;
  metrics: EasyGradeMetrics;
  pace: number | null;
  excludedNote: string | null;
}

/** A quick pace at an easy HR means the easy range is conservative, not that the run was hard. */
function quickPaceNote(verdict: EasyVerdict, pace: number | null, ctx: GradeContext): string | null {
  const easyPace = ctx.targets.easyPace;
  if (verdict !== "on_target" || pace === null || !easyPace) return null;
  if (pace >= easyPace.fast * (1 - EASY_PACE_FAST_TOLERANCE)) return null;
  return `Pace (${fmtPace(pace, ctx.distanceUnit)}) was quicker than your easy range at an easy heart rate — your easy paces may be conservative.`;
}

function gradeEasyOnHr(run: EasyStreamRun, avgHr: number, ceiling: number): GradeOutcome {
  const { samples, analysed, ctx, metrics } = run;
  const above = hrShare(samples, analysed, (value) => value > ceiling);
  const drift = hrDrift(samples, analysed);
  metrics.avgHr = roundTo(avgHr);
  metrics.pctAboveCeiling = pct(above.matched, above.total);
  metrics.firstThirdHr = drift ? roundTo(drift.first) : null;
  metrics.lastThirdHr = drift ? roundTo(drift.last) : null;
  metrics.hrDriftPct = drift?.pct ?? null;
  const aboveShare = above.total > 0 ? above.matched / above.total : 0;
  const { verdict, byDrift } = heartRateVerdict(avgHr, ceiling, aboveShare, drift);

  const lead =
    verdict === "on_target"
      ? `HR averaged ${bpm(avgHr)}, under your easy ceiling of ${bpm(ceiling)}.`
      : `HR averaged ${bpm(avgHr)} against an easy ceiling of ${bpm(ceiling)}.`;
  const pctAbove = metrics.pctAboveCeiling ?? 0;
  const share = pctAbove > 0 ? `${pctAbove}% of the run was above ${bpm(ceiling)}.` : null;
  const driftLine =
    drift && byDrift
      ? `HR climbed from ${bpm(drift.first)} to ${bpm(drift.last)} over the run, finishing above easy.`
      : null;
  return {
    verdict,
    evidence: pickEvidence([
      lead,
      driftLine,
      share,
      quickPaceNote(verdict, run.pace, ctx),
      run.excludedNote,
      hrBasisNote(ctx.targets),
    ]),
    confidence: ctx.targets.hrBasis === "age_estimated" ? "medium" : "high",
    dataSource: "stream",
    ungradeableReason: null,
    easy: metrics,
    threshold: null,
  };
}

/** No HR in the recording: the same bands, applied to time quicker than easy pace. */
function gradeEasyOnPace(run: EasyStreamRun, easyPace: { fast: number; slow: number }, pace: number): GradeOutcome {
  const { samples, analysed, ctx, metrics } = run;
  const faster = fasterThanShare(samples, analysed, easyPace.fast * (1 - EASY_PACE_FAST_TOLERANCE));
  const share = faster.total > 0 ? faster.matched / faster.total : 0;
  metrics.pctFasterThanEasy = pct(faster.matched, faster.total);
  return {
    verdict: bandVerdict(share),
    evidence: pickEvidence([
      `${metrics.pctFasterThanEasy ?? 0}% of the run was quicker than your easy pace (${fmtPaceRange(easyPace, ctx.distanceUnit)}); average ${fmtPace(pace, ctx.distanceUnit)}.`,
      "No heart rate in this recording, so it is graded on pace.",
      run.excludedNote,
    ]),
    confidence: ctx.targets.paceSource === "history" ? "low" : "medium",
    dataSource: "stream",
    ungradeableReason: null,
    easy: metrics,
    threshold: null,
  };
}

export function gradeEasyStream(samples: SessionStreamSamples, ctx: GradeContext): GradeOutcome {
  const analysed = withoutFinish(samples, movingBuckets(samples), ctx.hardFinishMinutes);
  const seconds = movingSeconds(samples, analysed);
  if (seconds < MIN_EASY_RUN_S) {
    return ungradeable("too_short", ["Too little running in this recording to judge."], "stream");
  }
  const pace = ctx.speedTrusted ? paceOver(samples, analysed) : null;
  const metrics = emptyMetrics(roundTo(seconds / 60), ctx.hardFinishMinutes);
  metrics.avgPaceSecPerKm = pace === null ? null : roundTo(pace);
  const run: EasyStreamRun = {
    samples,
    analysed,
    ctx,
    metrics,
    pace,
    excludedNote: ctx.hardFinishMinutes
      ? `The last ${ctx.hardFinishMinutes} min (the planned harder finish) is left out.`
      : null,
  };

  const avgHr = hrOver(samples, analysed).avg;
  const ceiling = ctx.targets.easyCeilingHr;
  if (avgHr !== null && ceiling !== null) return gradeEasyOnHr(run, avgHr, ceiling);
  const easyPace = ctx.targets.easyPace;
  if (easyPace && pace !== null) return gradeEasyOnPace(run, easyPace, pace);
  return ungradeable(
    "no_data",
    ["This recording has no heart rate, and no GPS pace to grade against your easy pace."],
    "stream",
  );
}

export function gradeEasySummary(summary: SummaryMetrics, ctx: GradeContext): GradeOutcome {
  const { targets } = ctx;
  const metrics = emptyMetrics(roundTo(summary.durationMin ?? 0), null);
  const averagesNote = "Graded on whole-run averages — the detailed stream is not in yet.";
  const ceiling = targets.easyCeilingHr;

  if (summary.avgHr !== null && ceiling !== null) {
    metrics.avgHr = roundTo(summary.avgHr);
    let verdict: EasyVerdict = "on_target";
    if (summary.avgHr > ceiling) verdict = "too_hard";
    else if (summary.maxHr !== null && summary.maxHr > ceiling + SUMMARY_PEAK_TOLERANCE_BPM) verdict = "crept_up";
    const peak =
      verdict === "crept_up" && summary.maxHr !== null ? `HR peaked at ${bpm(summary.maxHr)}, well above easy.` : null;
    return {
      verdict,
      evidence: pickEvidence([
        `HR averaged ${bpm(summary.avgHr)} against an easy ceiling of ${bpm(ceiling)}.`,
        peak,
        averagesNote,
      ]),
      confidence: "low",
      dataSource: "summary",
      ungradeableReason: null,
      easy: metrics,
      threshold: null,
    };
  }

  const easyPace = targets.easyPace;
  if (easyPace && ctx.speedTrusted && summary.avgSpeed && summary.avgSpeed > 0) {
    const pace = 1000 / summary.avgSpeed;
    metrics.avgPaceSecPerKm = roundTo(pace);
    const quicker = (easyPace.fast - pace) / easyPace.fast;
    let verdict: EasyVerdict = "on_target";
    if (quicker > SUMMARY_EASY_TOO_FAST) verdict = "too_hard";
    else if (quicker > SUMMARY_EASY_CREPT_FAST) verdict = "crept_up";
    return {
      verdict,
      evidence: pickEvidence([
        `Averaged ${fmtPace(pace, ctx.distanceUnit)}; your easy range is ${fmtPaceRange(easyPace, ctx.distanceUnit)}.`,
        averagesNote,
      ]),
      confidence: "low",
      dataSource: "summary",
      ungradeableReason: null,
      easy: metrics,
      threshold: null,
    };
  }

  return ungradeable("no_data", ["This session has no heart rate or pace to grade. Link a Strava recording to grade it."], "summary");
}
