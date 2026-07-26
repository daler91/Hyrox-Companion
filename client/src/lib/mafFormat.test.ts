import { describe, expect, it } from "vitest";

import { getMafCeiling, summariseMafTile } from "./mafFormat";

describe("getMafCeiling", () => {
  it("returns the ceiling for a MAF-method athlete", () => {
    expect(getMafCeiling({ trainingStyleId: "maf_method", mafHr: 145 })).toBe(145);
  });

  it("withholds a stale ceiling from an athlete who switched style", () => {
    // mafHr is only written at onboarding, so it survives a style change and
    // stops describing how they train.
    expect(getMafCeiling({ trainingStyleId: "balanced_default", mafHr: 145 })).toBeNull();
  });

  it("returns null when no ceiling has been computed", () => {
    expect(getMafCeiling({ trainingStyleId: "maf_method", mafHr: null })).toBeNull();
    expect(getMafCeiling({ trainingStyleId: "maf_method" })).toBeNull();
  });

  it("returns null when signed out", () => {
    expect(getMafCeiling(null)).toBeNull();
    expect(getMafCeiling(undefined)).toBeNull();
  });
});

describe("summariseMafTile", () => {
  it("names how far under the ceiling an aerobic run sat", () => {
    const summary = summariseMafTile({ avgHeartRate: 138, maxHeartRate: 142, ceiling: 145 });
    expect(summary.labelSuffix).toBe(" · 7 under MAF");
    expect(summary.accentClassName).toContain("emerald");
  });

  it("reads as at the ceiling when the average lands on it", () => {
    expect(summariseMafTile({ avgHeartRate: 145, ceiling: 145 }).labelSuffix).toBe(" · at MAF");
  });

  it("flags peaks when the average held but the peak drifted over", () => {
    const summary = summariseMafTile({ avgHeartRate: 140, maxHeartRate: 158, ceiling: 145 });
    expect(summary.labelSuffix).toBe(" · MAF peaks");
    expect(summary.accentClassName).toContain("amber");
  });

  it("names the overshoot when the average ran over", () => {
    const summary = summariseMafTile({ avgHeartRate: 150, maxHeartRate: 165, ceiling: 145 });
    expect(summary.labelSuffix).toBe(" · 5 over MAF");
    expect(summary.accentClassName).toContain("rose");
    expect(summary.title).toContain("5 bpm over");
  });
});
