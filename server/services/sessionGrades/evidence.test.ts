import type { SessionGradeTargets, SessionGradeVerdict } from "@shared/schema";
import { describe, expect, it } from "vitest";

import { bpm, fmtPace, fmtPaceRange, headlineFor, hrBasisNote, pickEvidence } from "./evidence";

const VERDICTS: SessionGradeVerdict[] = [
  "on_target",
  "crept_up",
  "too_hard",
  "drifted_harder",
  "under",
  "inconclusive",
  "ungradeable",
];

describe("headlineFor", () => {
  it("words every verdict for an easy run", () => {
    expect(VERDICTS.map((verdict) => headlineFor("easy", verdict))).toEqual([
      "Stayed easy",
      "Crept above easy",
      "Too hard for an easy day",
      "Too hard for an easy day",
      "Stayed easy",
      "Can't tell from this data",
      "Can't grade yet",
    ]);
  });

  it("words every verdict for a threshold run", () => {
    expect(VERDICTS.map((verdict) => headlineFor("threshold", verdict))).toEqual([
      "Held threshold",
      "Drifted harder than threshold",
      "Drifted harder than threshold",
      "Drifted harder than threshold",
      "Stayed under threshold",
      "Can't tell from the averages",
      "Can't grade yet",
    ]);
  });
});

describe("pace and heart-rate formatting", () => {
  it("shows a pace in the athlete's unit", () => {
    expect(fmtPace(300, "km")).toBe("5:00/km");
    expect(fmtPace(300, "miles")).toBe("8:03/mi");
  });

  it("shows a pace range with the unit only once, fast end first", () => {
    expect(fmtPaceRange({ fast: 270, slow: 300 }, "km")).toBe("4:30–5:00/km");
    expect(fmtPaceRange({ fast: 270, slow: 300 }, "miles")).toMatch(/^\d:\d\d–\d:\d\d\/mi$/);
  });

  it("rounds heart rate to whole bpm", () => {
    expect(bpm(151.4)).toBe("151 bpm");
    expect(bpm(151.5)).toBe("152 bpm");
  });
});

describe("hrBasisNote", () => {
  it("nudges toward a measured max HR only when the zones rest on an age estimate", () => {
    expect(hrBasisNote({ hrBasis: "age_estimated" } as SessionGradeTargets)).toMatch(/measured max HR/);
    expect(hrBasisNote({ hrBasis: "measured" } as unknown as SessionGradeTargets)).toBeNull();
  });
});

describe("pickEvidence", () => {
  it("drops empty and falsy entries and keeps the first three by default", () => {
    expect(pickEvidence([null, "a", "", false, undefined, "b", "c", "d"])).toEqual(["a", "b", "c"]);
  });

  it("honours an explicit maximum", () => {
    expect(pickEvidence(["a", "b", "c"], 2)).toEqual(["a", "b"]);
    expect(pickEvidence([null, false])).toEqual([]);
  });
});
