import type { SessionGradeTargets } from "@shared/schema";
import { describe, expect, it } from "vitest";

import { gradeEasyStream, gradeEasySummary } from "./gradeEasy";
import { bucketsFromStretches } from "./testFixtures";
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
  durationMin: 40,
  ...overrides,
});

describe("gradeEasyStream edge cases", () => {
  it("calls a run crept up when HR drifts past the ceiling late, even though little of it was above", () => {
    // 10 min warm-up, then three 700 s thirds; the last has a short spike that lifts its mean to ~150.
    const samples = bucketsFromStretches([
      { seconds: 600, paceSecPerKm: 375, hr: 125 },
      { seconds: 700, paceSecPerKm: 375, hr: 130 },
      { seconds: 700, paceSecPerKm: 375, hr: 140 },
      { seconds: 600, paceSecPerKm: 375, hr: 147 },
      { seconds: 100, paceSecPerKm: 375, hr: 170 },
    ]);
    const grade = gradeEasyStream(samples, ctx());
    expect(grade.verdict).toBe("crept_up");
    expect(grade.easy?.pctAboveCeiling).toBe(4);
    expect(grade.easy?.firstThirdHr).toBe(130);
    expect(grade.easy?.lastThirdHr).toBe(150);
    expect(grade.easy?.hrDriftPct).toBeGreaterThanOrEqual(5);
    expect(grade.evidence.join(" ")).toMatch(/HR climbed from 130 bpm to 150 bpm/);
  });

  it("does not call drift on a run too short to leave a settled stretch after the warm-up", () => {
    const samples = bucketsFromStretches([{ seconds: 20 * 60, paceSecPerKm: 375, hr: 130, hrEnd: 147 }]);
    const grade = gradeEasyStream(samples, ctx());
    expect(grade.verdict).toBe("on_target");
    expect(grade.easy?.hrDriftPct).toBeNull();
    expect(grade.easy?.firstThirdHr).toBeNull();
  });

  it("is ungradeable as too_short under five minutes of running", () => {
    const samples = bucketsFromStretches([{ seconds: 4 * 60, paceSecPerKm: 375, hr: 130 }]);
    const grade = gradeEasyStream(samples, ctx());
    expect(grade).toMatchObject({ verdict: "ungradeable", ungradeableReason: "too_short", dataSource: "stream" });
  });

  it("grades a no-HR run on pace at low confidence when the easy pace came from history", () => {
    const samples = bucketsFromStretches([{ seconds: 20 * 60, paceSecPerKm: 320 }], { hr: false });
    const grade = gradeEasyStream(samples, ctx({ targets: { ...TARGETS, paceSource: "history" } }));
    expect(grade.verdict).toBe("too_hard");
    expect(grade.confidence).toBe("low");
    expect(grade.easy?.pctFasterThanEasy).toBe(100);
    expect(grade.evidence.join(" ")).toMatch(/100% of the run was quicker than your easy pace/);
  });

  it("is ungradeable as no_data without HR or usable pace", () => {
    const samples = bucketsFromStretches([{ seconds: 20 * 60, paceSecPerKm: 375 }], { hr: false, distance: false });
    const grade = gradeEasyStream(samples, ctx());
    expect(grade).toMatchObject({ verdict: "ungradeable", ungradeableReason: "no_data" });
  });

  it("will not grade on pace when speed is not trusted", () => {
    const samples = bucketsFromStretches([{ seconds: 20 * 60, paceSecPerKm: 320 }], { hr: false });
    const grade = gradeEasyStream(samples, ctx({ speedTrusted: false }));
    expect(grade.verdict).toBe("ungradeable");
    expect(grade.easy).toBeNull();
  });
});

describe("gradeEasySummary", () => {
  it("is on target when average and peak HR stay near the ceiling", () => {
    const grade = gradeEasySummary(summary({ avgHr: 140, maxHr: 154 }), ctx());
    expect(grade).toMatchObject({ verdict: "on_target", confidence: "low", dataSource: "summary" });
  });

  it("calls a run crept up when the peak is well above easy and says so", () => {
    const grade = gradeEasySummary(summary({ avgHr: 140, maxHr: 170 }), ctx());
    expect(grade.verdict).toBe("crept_up");
    expect(grade.evidence.join(" ")).toMatch(/HR peaked at 170 bpm/);
  });

  it("calls a run too hard when the average is above the ceiling", () => {
    const grade = gradeEasySummary(summary({ avgHr: 150, maxHr: 175 }), ctx());
    expect(grade.verdict).toBe("too_hard");
    expect(grade.easy?.avgHr).toBe(150);
  });

  it("falls back to average pace when there is no HR, banding how far under the easy range it was", () => {
    const at = (pace: number) => gradeEasySummary(summary({ avgSpeed: 1000 / pace }), ctx());
    expect(at(375).verdict).toBe("on_target");
    expect(at(350).verdict).toBe("crept_up"); // 2.8% quicker than the fast end
    expect(at(330).verdict).toBe("too_hard"); // 8.3% quicker
    expect(at(330).easy?.avgPaceSecPerKm).toBe(330);
  });

  it("ignores pace when speed is not trusted, or when there is none", () => {
    const untrusted = gradeEasySummary(summary({ avgSpeed: 3 }), ctx({ speedTrusted: false }));
    const zero = gradeEasySummary(summary({ avgSpeed: 0 }), ctx());
    for (const grade of [untrusted, zero]) {
      expect(grade).toMatchObject({ verdict: "ungradeable", ungradeableReason: "no_data", dataSource: "summary" });
    }
  });
});
