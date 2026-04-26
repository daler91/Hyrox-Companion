import { describe, expect, it } from "vitest";

import { annotationToWeekBounds } from "./utils";

describe("annotationToWeekBounds", () => {
  it("returns null when an annotation does not overlap visible weeks", () => {
    expect(
      annotationToWeekBounds({ startDate: "2026-04-01", endDate: "2026-04-02" }, [
        "2026-04-06",
        "2026-04-13",
      ]),
    ).toBeNull();
  });

  it("returns the first and last overlapping week starts", () => {
    expect(
      annotationToWeekBounds({ startDate: "2026-04-08", endDate: "2026-04-20" }, [
        "2026-04-06",
        "2026-04-13",
        "2026-04-20",
        "2026-04-27",
      ]),
    ).toEqual({ x1: "2026-04-06", x2: "2026-04-20" });
  });
});
