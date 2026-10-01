import type { SessionGradeTargets } from "@shared/schema";
import { describe, expect, it } from "vitest";

import { gradeThresholdStream, gradeThresholdSummary } from "./gradeThreshold";
import { bucketsFromStretches, thresholdSession } from "./testFixtures";
import type { GradeContext, SummaryMetrics } from "./types";

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

const summary = (overrides: Partial<SummaryMetrics>): SummaryMetrics => ({
  avgHr: null,
  maxHr: null,
  avgSpeed: null,
  durationMin: 60,
  ...overrides,
});

describe("gradeThresholdStream edge cases", () => {
  it("holds threshold, with a note, when HR was at Z4 but the pace was slow", () => {
    const samples = bucketsFromStretches(thresholdSession({ pace: 320, hrStart: 164, hrEnd: 170 }));
    const grade = gradeThresholdStream(samples, ctx());
    expect(grade.verdict).toBe("on_target");
    expect(grade.threshold?.paceDeltaPct).toBeGreaterThan(5);
    expect(grade.evidence.join(" ")).toMatch(/HR was at threshold though the pace was slow/);
  });

  it("holds threshold, with a note, when pace was on target but HR stayed under Z4", () => {
    const samples = bucketsFromStretches(thresholdSession({ pace: 290, hrStart: 150, hrEnd: 155 }));
    const grade = gradeThresholdStream(samples, ctx());
    expect(grade.verdict).toBe("on_target");
    expect(grade.evidence.join(" ")).toMatch(/Pace was on target but HR stayed under Z4/);
  });

  it("grades on pace alone when there is no HR target, at medium confidence", () => {
    const samples = bucketsFromStretches(thresholdSession({ pace: 330, hrStart: 150, hrEnd: 155 }), { hr: false });
    const grade = gradeThresholdStream(samples, ctx({ targets: { ...TARGETS, thresholdHr: null, z5FloorHr: null } }));
    expect(grade.verdict).toBe("under");
    expect(grade.confidence).toBe("medium");
    expect(grade.threshold?.workAvgHr).toBeNull();
    expect(grade.threshold?.pctWorkZ5).toBeNull();
  });

  it("drops to low confidence when it can only lean on a history-derived pace", () => {
    const samples = bucketsFromStretches(thresholdSession({ pace: 290, hrStart: 150, hrEnd: 155 }), { hr: false });
    const grade = gradeThresholdStream(
      samples,
      ctx({ targets: { ...TARGETS, paceSource: "history", thresholdHr: null, z5FloorHr: null } }),
    );
    expect(grade.verdict).toBe("on_target");
    expect(grade.confidence).toBe("low");
  });

  it("is ungradeable as no_data when the work has neither HR nor a pace target to compare with", () => {
    const samples = bucketsFromStretches(thresholdSession({ pace: 290, hrStart: 168, hrEnd: 170 }), { hr: false });
    const grade = gradeThresholdStream(samples, ctx({ targets: { ...TARGETS, thresholdPace: null } }));
    expect(grade).toMatchObject({ verdict: "ungradeable", ungradeableReason: "no_data", dataSource: "stream" });
  });

  it("warns when pace-to-HR efficiency decouples across the work", () => {
    const rep = (pace: number) => ({ seconds: 600, paceSecPerKm: pace, hr: 168, hrEnd: 168 });
    const jog = { seconds: 120, paceSecPerKm: 390, hr: 140 };
    const samples = bucketsFromStretches([
      { seconds: 900, paceSecPerKm: 380, hr: 125, hrEnd: 138 },
      rep(290),
      jog,
      rep(290),
      jog,
      rep(320),
      { seconds: 600, paceSecPerKm: 390, hr: 135 },
    ]);
    const grade = gradeThresholdStream(samples, ctx());
    expect(grade.threshold?.decouplingPct).toBeGreaterThanOrEqual(5);
    expect(grade.evidence.join(" ")).toMatch(/Pace-to-HR decoupled/);
  });
});

describe("gradeThresholdSummary", () => {
  it("confirms a session was too hard when even the whole-run HR reached Z5", () => {
    const grade = gradeThresholdSummary(summary({ avgHr: 178, avgSpeed: 1000 / 340 }), ctx());
    expect(grade).toMatchObject({ verdict: "drifted_harder", confidence: "low", dataSource: "summary" });
    expect(grade.evidence.join(" ")).toMatch(/HR was 178 bpm — Z5 starts at 176 bpm/);
  });

  it("confirms a session was too hard when the whole-run pace beat threshold", () => {
    const grade = gradeThresholdSummary(summary({ avgHr: 150, avgSpeed: 1000 / 280 }), ctx());
    expect(grade.verdict).toBe("drifted_harder");
    expect(grade.threshold?.paceDeltaPct).toBe(-3.4);
    expect(grade.evidence.join(" ")).toMatch(/faster than .* threshold/);
  });

  it("never confirms a held threshold from averages: it asks for the stream", () => {
    const grade = gradeThresholdSummary(summary({ avgHr: 150, avgSpeed: 1000 / 340 }), ctx());
    expect(grade).toMatchObject({ verdict: "inconclusive", confidence: null });
    expect(grade.threshold).toMatchObject({ segmentation: "whole_run", repCount: 0, workMinutes: 60 });
    expect(grade.evidence.join(" ")).toMatch(/stream is needed/);
  });

  it("is ungradeable with no HR and no trusted pace", () => {
    const untrusted = gradeThresholdSummary(summary({ avgSpeed: 3 }), ctx({ speedTrusted: false }));
    const none = gradeThresholdSummary(summary({}), ctx());
    for (const grade of [untrusted, none]) {
      expect(grade).toMatchObject({ verdict: "ungradeable", ungradeableReason: "no_data", dataSource: "summary" });
    }
  });
});
