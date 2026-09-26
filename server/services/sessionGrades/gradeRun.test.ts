import type { SessionGradeTargets } from "@shared/schema";
import { describe, expect, it } from "vitest";

import { downsampleStravaStreams } from "./downsample";
import { gradeRun, NO_TARGETS_EVIDENCE } from "./gradeSession";
import { bucketsFromStretches, streamFromStretches, thresholdSession } from "./testFixtures";
import type { GradeContext, SummaryMetrics } from "./types";
import { findWorkSegments, otsuCut } from "./workSegments";

// Karvonen zones for rest 50 / max 190: Z2 top 148, Z4 162-176, Z5 from 176.
const TARGETS: SessionGradeTargets = {
  easyCeilingHr: 148,
  thresholdHr: { min: 162, max: 176 },
  z5FloorHr: 176,
  hrBasis: "measured",
  easyPace: { fast: 360, slow: 400 },
  thresholdPace: 290,
  paceSource: "plan",
};

function ctx(overrides: Partial<GradeContext> = {}): GradeContext {
  return { targets: TARGETS, distanceUnit: "km", speedTrusted: true, hardFinishMinutes: null, ...overrides };
}

const NO_SUMMARY: SummaryMetrics = { avgHr: null, maxHr: null, avgSpeed: null, durationMin: null };

describe("easy runs, from the stream", () => {
  it("passes a steady run under the ceiling with high confidence", () => {
    const samples = bucketsFromStretches([{ seconds: 45 * 60, paceSecPerKm: 375, hr: 132, hrEnd: 142 }]);
    const grade = gradeRun({ intent: "easy", samples, summary: NO_SUMMARY, ctx: ctx() });
    expect(grade).toMatchObject({ verdict: "on_target", confidence: "high", dataSource: "stream" });
    expect(grade.easy?.pctAboveCeiling).toBe(0);
    expect(grade.evidence[0]).toMatch(/under your easy ceiling of 148 bpm/);
  });

  it("calls a run that spends 10-25% above the ceiling crept up", () => {
    const samples = bucketsFromStretches([
      { seconds: 40 * 60, paceSecPerKm: 370, hr: 135, hrEnd: 145 },
      { seconds: 8 * 60, paceSecPerKm: 350, hr: 150, hrEnd: 152 },
    ]);
    const grade = gradeRun({ intent: "easy", samples, summary: NO_SUMMARY, ctx: ctx() });
    expect(grade.verdict).toBe("crept_up");
    expect(grade.easy?.pctAboveCeiling).toBe(17);
  });

  it("calls a run spent mostly above the ceiling too hard", () => {
    const samples = bucketsFromStretches([{ seconds: 40 * 60, paceSecPerKm: 320, hr: 150, hrEnd: 160 }]);
    const grade = gradeRun({ intent: "easy", samples, summary: NO_SUMMARY, ctx: ctx() });
    expect(grade.verdict).toBe("too_hard");
    expect(grade.evidence[0]).toMatch(/against an easy ceiling of 148 bpm/);
  });

  it("flags a quick pace at an easy HR as conservative paces, not a hard run", () => {
    const samples = bucketsFromStretches([{ seconds: 40 * 60, paceSecPerKm: 320, hr: 138 }]);
    const grade = gradeRun({ intent: "easy", samples, summary: NO_SUMMARY, ctx: ctx() });
    expect(grade.verdict).toBe("on_target");
    expect(grade.evidence.join(" ")).toMatch(/easy paces may be conservative/);
  });

  it("uses the MAF ceiling when that is what the athlete trains to", () => {
    const samples = bucketsFromStretches([{ seconds: 40 * 60, paceSecPerKm: 380, hr: 140 }]);
    const maf = { ...TARGETS, easyCeilingHr: 135, hrBasis: "maf" as const };
    expect(gradeRun({ intent: "easy", samples, summary: NO_SUMMARY, ctx: ctx({ targets: maf }) }).verdict).toBe("too_hard");
  });

  it("grades on pace when the recording has no heart rate, at medium confidence", () => {
    const samples = bucketsFromStretches([{ seconds: 40 * 60, paceSecPerKm: 320 }], { hr: false });
    const grade = gradeRun({ intent: "easy", samples, summary: NO_SUMMARY, ctx: ctx() });
    expect(grade).toMatchObject({ verdict: "too_hard", confidence: "medium" });
    expect(grade.easy?.pctFasterThanEasy).toBe(100);
  });

  it("leaves a long run's planned harder finish out of the grade", () => {
    const samples = bucketsFromStretches([
      { seconds: 90 * 60, paceSecPerKm: 380, hr: 135, hrEnd: 144 },
      { seconds: 15 * 60, paceSecPerKm: 310, hr: 158, hrEnd: 165 },
    ]);
    const withFinish = gradeRun({ intent: "easy", samples, summary: NO_SUMMARY, ctx: ctx({ hardFinishMinutes: 15 }) });
    expect(withFinish.verdict).toBe("on_target");
    expect(withFinish.easy?.excludedFinishMinutes).toBe(15);
    const without = gradeRun({ intent: "easy", samples, summary: NO_SUMMARY, ctx: ctx() });
    expect(without.verdict).not.toBe("on_target");
  });

  it("drops to medium confidence and says why when max HR is only age-estimated", () => {
    const samples = bucketsFromStretches([{ seconds: 40 * 60, paceSecPerKm: 380, hr: 138 }]);
    const grade = gradeRun({
      intent: "easy",
      samples,
      summary: NO_SUMMARY,
      ctx: ctx({ targets: { ...TARGETS, hrBasis: "age_estimated" } }),
    });
    expect(grade.confidence).toBe("medium");
    expect(grade.evidence.join(" ")).toMatch(/age-estimated max HR/);
  });

  it("will not judge a few minutes of running", () => {
    const samples = bucketsFromStretches([{ seconds: 3 * 60, paceSecPerKm: 380, hr: 138 }]);
    expect(gradeRun({ intent: "easy", samples, summary: NO_SUMMARY, ctx: ctx() })).toMatchObject({
      verdict: "ungradeable",
      ungradeableReason: "too_short",
    });
  });
});

describe("threshold runs, from the stream", () => {
  it("finds three reps between the warm-up and cool-down", () => {
    const samples = bucketsFromStretches(thresholdSession({ pace: 290, hrStart: 158, hrEnd: 170 }));
    const seg = findWorkSegments(samples, { speedTrusted: true });
    expect(seg.kind).toBe("reps");
    expect(seg.segments).toHaveLength(3);
    // Each rep is its ten minutes, give or take the smoothing at its edges.
    for (const rep of seg.segments) expect(Math.abs(rep.length * 15 - 600)).toBeLessThanOrEqual(30);
  });

  it("holds threshold when the work pace and HR sit on target", () => {
    const samples = bucketsFromStretches(thresholdSession({ pace: 290, hrStart: 158, hrEnd: 172 }));
    const grade = gradeRun({ intent: "threshold", samples, summary: NO_SUMMARY, ctx: ctx() });
    expect(grade).toMatchObject({ verdict: "on_target", confidence: "high" });
    expect(grade.threshold).toMatchObject({ segmentation: "reps", repCount: 3, pctWorkZ5: 0 });
    // The buckets store whole metres, so 4:50/km reads back a second or two quick.
    expect(grade.evidence[0]).toMatch(/^Found 3 reps, 30 min of work at 4:(48|49|50)\/km vs 4:50\/km threshold\.$/);
  });

  it("drifts harder when HR climbs into Z5 over the reps", () => {
    const samples = bucketsFromStretches(
      thresholdSession({ pace: 290, hrStart: 160, hrEnd: 172, driftPerRep: 7 }),
    );
    const grade = gradeRun({ intent: "threshold", samples, summary: NO_SUMMARY, ctx: ctx() });
    expect(grade.verdict).toBe("drifted_harder");
    expect(grade.evidence.join(" ")).toMatch(/into Z5/);
  });

  it("drifts harder when the reps are run clearly faster than threshold", () => {
    const samples = bucketsFromStretches(thresholdSession({ pace: 275, hrStart: 160, hrEnd: 172 }));
    const grade = gradeRun({ intent: "threshold", samples, summary: NO_SUMMARY, ctx: ctx() });
    expect(grade.verdict).toBe("drifted_harder");
    expect(grade.threshold?.paceDeltaPct).toBeLessThan(-3);
    expect(grade.evidence.join(" ")).toMatch(/faster than threshold pace/);
  });

  it("drifts harder when a fifth of the work sits in Z5", () => {
    const samples = bucketsFromStretches(thresholdSession({ pace: 290, hrStart: 172, hrEnd: 182 }));
    const grade = gradeRun({ intent: "threshold", samples, summary: NO_SUMMARY, ctx: ctx() });
    expect(grade.verdict).toBe("drifted_harder");
    expect(grade.threshold?.pctWorkZ5).toBeGreaterThanOrEqual(20);
  });

  it("stays under when the work is both slower and below Z4", () => {
    const samples = bucketsFromStretches(thresholdSession({ pace: 312, hrStart: 148, hrEnd: 156 }));
    const grade = gradeRun({ intent: "threshold", samples, summary: NO_SUMMARY, ctx: ctx() });
    expect(grade.verdict).toBe("under");
    expect(grade.evidence.join(" ")).toMatch(/your Z4 is 162–176 bpm/);
  });

  it("says so when pace and HR disagree instead of calling it under", () => {
    const samples = bucketsFromStretches(thresholdSession({ pace: 292, hrStart: 150, hrEnd: 157 }));
    const grade = gradeRun({ intent: "threshold", samples, summary: NO_SUMMARY, ctx: ctx() });
    expect(grade.verdict).toBe("on_target");
    expect(grade.evidence.join(" ")).toMatch(/max HR may be set high/);
  });

  it("finds the reps from HR on a treadmill, and grades on HR alone", () => {
    const samples = bucketsFromStretches(thresholdSession({ pace: 290, hrStart: 160, hrEnd: 172 }));
    const grade = gradeRun({
      intent: "threshold",
      samples,
      summary: NO_SUMMARY,
      ctx: ctx({ speedTrusted: false }),
    });
    expect(grade.threshold?.segmentation).toBe("reps");
    expect(grade.threshold?.paceDeltaPct).toBeNull();
    expect(grade.verdict).toBe("on_target");
  });

  it("grades a run with no separable reps as one continuous block", () => {
    const samples = bucketsFromStretches([{ seconds: 40 * 60, paceSecPerKm: 380, hr: 140, hrEnd: 146 }]);
    const grade = gradeRun({ intent: "threshold", samples, summary: NO_SUMMARY, ctx: ctx() });
    expect(grade.threshold?.segmentation).toBe("continuous");
    expect(grade.threshold?.workMinutes).toBe(25);
    expect(grade.verdict).toBe("under");
  });

  it("is inconclusive when there is no sustained effort to find", () => {
    const samples = bucketsFromStretches([{ seconds: 8 * 60, paceSecPerKm: 380, hr: 140 }]);
    expect(gradeRun({ intent: "threshold", samples, summary: NO_SUMMARY, ctx: ctx() }).verdict).toBe("inconclusive");
  });
});

describe("from a raw Strava stream", () => {
  it("grades a 1 Hz threshold recording the same way once it is downsampled", () => {
    const stream = streamFromStretches(thresholdSession({ pace: 290, hrStart: 158, hrEnd: 172 }));
    const { samples } = downsampleStravaStreams(stream);
    const grade = gradeRun({ intent: "threshold", samples, summary: NO_SUMMARY, ctx: ctx() });
    expect(grade).toMatchObject({ verdict: "on_target", dataSource: "stream" });
    expect(grade.threshold?.repCount).toBe(3);
  });
});

describe("summary fallback", () => {
  it("grades an easy run from its averages at low confidence", () => {
    const grade = gradeRun({
      intent: "easy",
      samples: null,
      summary: { avgHr: 141, maxHr: 162, avgSpeed: 2.7, durationMin: 45 },
      ctx: ctx(),
    });
    expect(grade).toMatchObject({ verdict: "crept_up", confidence: "low", dataSource: "summary" });
  });

  it("grades an easy run without HR from its average pace", () => {
    const grade = gradeRun({
      intent: "easy",
      samples: null,
      summary: { avgHr: null, maxHr: null, avgSpeed: 1000 / 320, durationMin: 40 },
      ctx: ctx(),
    });
    expect(grade.verdict).toBe("too_hard");
  });

  it("can only confirm a threshold session went too hard, never that it held", () => {
    const tooHard = gradeRun({
      intent: "threshold",
      samples: null,
      summary: { avgHr: 178, maxHr: 186, avgSpeed: 3.2, durationMin: 55 },
      ctx: ctx(),
    });
    expect(tooHard.verdict).toBe("drifted_harder");
    const diluted = gradeRun({
      intent: "threshold",
      samples: null,
      summary: { avgHr: 158, maxHr: 175, avgSpeed: 1000 / 330, durationMin: 55 },
      ctx: ctx(),
    });
    expect(diluted).toMatchObject({ verdict: "inconclusive", dataSource: "summary" });
    expect(diluted.threshold?.segmentation).toBe("whole_run");
  });

  it("has nothing to grade a session with no HR and no pace", () => {
    expect(gradeRun({ intent: "easy", samples: null, summary: NO_SUMMARY, ctx: ctx() })).toMatchObject({
      verdict: "ungradeable",
      ungradeableReason: "no_data",
    });
  });
});

describe("targets", () => {
  it("asks for a max HR or runs when there is nothing to grade against", () => {
    const none: SessionGradeTargets = {
      easyCeilingHr: null,
      thresholdHr: null,
      z5FloorHr: null,
      hrBasis: null,
      easyPace: null,
      thresholdPace: null,
      paceSource: null,
    };
    const samples = bucketsFromStretches([{ seconds: 40 * 60, paceSecPerKm: 380, hr: 140 }]);
    expect(gradeRun({ intent: "easy", samples, summary: NO_SUMMARY, ctx: ctx({ targets: none }) })).toMatchObject({
      verdict: "ungradeable",
      ungradeableReason: "no_targets",
      evidence: [NO_TARGETS_EVIDENCE],
    });
  });
});

describe("otsuCut", () => {
  it("splits two clear groups between them", () => {
    const cut = otsuCut([2.6, 2.6, 2.7, 2.6, 3.4, 3.5, 3.4]);
    expect(cut).toBeGreaterThan(2.7);
    expect(cut).toBeLessThanOrEqual(3.4);
  });

  it("has no cut for a single value", () => {
    expect(otsuCut([3])).toBeNull();
    expect(otsuCut([3, 3, 3])).toBeNull();
  });
});
