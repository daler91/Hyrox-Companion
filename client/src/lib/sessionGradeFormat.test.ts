import { describe, expect, it } from "vitest";

import {
  describeGradeBasis,
  formatGradePace,
  getGradeLabel,
  getGradeTone,
  getGradeToneClassName,
  getPurposeLabel,
} from "./sessionGradeFormat";

describe("sessionGradeFormat", () => {
  it("tones a verdict good, partial, low or neutral", () => {
    expect(getGradeTone("on_target")).toBe("good");
    expect(getGradeTone("crept_up")).toBe("partial");
    expect(getGradeTone("under")).toBe("partial");
    expect(getGradeTone("too_hard")).toBe("low");
    expect(getGradeTone("drifted_harder")).toBe("low");
    expect(getGradeTone("inconclusive")).toBe("neutral");
    expect(getGradeToneClassName("ungradeable")).toContain("text-muted-foreground");
    expect(getGradeToneClassName("on_target")).toContain("emerald");
  });

  it("words the verdict for the kind of run", () => {
    expect(getGradeLabel("easy", "on_target")).toBe("Stayed easy");
    expect(getGradeLabel("threshold", "on_target")).toBe("Held threshold");
    expect(getGradeLabel("threshold", "drifted_harder")).toBe("Drifted harder");
    expect(getPurposeLabel("long")).toBe("Long run");
  });

  it("says where a grade came from and how far to trust it", () => {
    expect(describeGradeBasis({ dataSource: "stream", confidence: "high", streamStatus: "ok" })).toBe(
      "From the heart-rate and pace stream · High confidence",
    );
    expect(describeGradeBasis({ dataSource: "summary", confidence: "low", streamStatus: "pending" })).toMatch(
      /on its way · Low confidence$/,
    );
    expect(describeGradeBasis({ dataSource: "summary", confidence: null, streamStatus: "unavailable" })).toBe(
      "From whole-run averages",
    );
    expect(describeGradeBasis({ dataSource: null, confidence: null, streamStatus: "pending" })).toBeNull();
  });

  it("formats a pace in the athlete's unit", () => {
    expect(formatGradePace(292, "km")).toBe("4:52/km");
    expect(formatGradePace(292, "miles")).toBe("7:50/mi");
    expect(formatGradePace(null, "km")).toBeNull();
  });
});
