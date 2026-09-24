import { describe, expect, it } from "vitest";

import { rescalePaces } from "./paceRewrite";
import { paceAtFraction } from "./running";

function clock(secondsPerKm: number): string {
  const total = Math.round(secondsPerKm);
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, "0")}`;
}

describe("rescalePaces", () => {
  it("moves a zone pace to the same zone of the new fitness", () => {
    const threshold40 = clock(paceAtFraction(40, 0.88));
    const threshold42 = clock(paceAtFraction(42, 0.88));
    expect(rescalePaces(`3 x 8 min @ ${threshold40}/km`, 40, 42)).toEqual({
      text: `3 x 8 min @ ${threshold42}/km`,
      changed: true,
    });
  });

  it("moves both ends of a range and keeps the writer's unit style", () => {
    const { text } = rescalePaces("easy 6:05-6:42 min/km, then 5:04 per km", 40, 42);
    expect(text).toMatch(/^easy 5:\d\d-6:\d\d min\/km, then 4:5\d per km$/);
  });

  it("reads and writes miles", () => {
    const { text, changed } = rescalePaces("tempo @ 8:10/mi", 40, 42);
    expect(changed).toBe(true);
    expect(text).toMatch(/^tempo @ 7:\d\d\/mi$/);
  });

  it("moves a range only when both of its ends are zone paces", () => {
    for (const text of ["walk 12:30-6:05/km", "jog 6:05 - 12:30 per km"]) {
      expect(rescalePaces(text, 40, 42)).toEqual({ text, changed: false });
    }
  });

  it("leaves numbers that were never a zone pace alone", () => {
    for (const text of ["walk 12:30/km", "rest 1:30 between sets", "sprint 2:10/km"]) {
      expect(rescalePaces(text, 40, 42)).toEqual({ text, changed: false });
    }
  });
});
