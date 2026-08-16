import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { mondayOf } from "./weekDates";
import { dismissPrompt, getWeeklyReviewPrompt, isPromptDismissed } from "./weeklyReviewPrompt";

// 2026-06-21 is a Sunday; the week it closes opens on Mon 2026-06-15.
const SUNDAY = "2026-06-21";
const WEEK_START = "2026-06-15";

function at(dateStr: string, hour: number): Date {
  return new Date(`${dateStr}T${String(hour).padStart(2, "0")}:00:00`);
}

describe("getWeeklyReviewPrompt", () => {
  it("stays quiet mid-week", () => {
    // Wed, Thu, Fri, Sat — the review is an end-of-week ritual, and a prompt
    // that stands all week is wallpaper.
    for (const date of ["2026-06-17", "2026-06-18", "2026-06-19", "2026-06-20"]) {
      expect(getWeeklyReviewPrompt(at(date, 19))).toBeNull();
    }
  });

  it("stays quiet on Sunday morning, when the week is still being trained", () => {
    expect(getWeeklyReviewPrompt(at(SUNDAY, 9))).toBeNull();
    expect(getWeeklyReviewPrompt(at(SUNDAY, 16))).toBeNull();
  });

  it("appears on Sunday evening, pointing at the week closing tonight", () => {
    expect(getWeeklyReviewPrompt(at(SUNDAY, 17))).toEqual({
      weekStart: mondayOf(SUNDAY),
      isWrappingUp: true,
    });
    expect(getWeeklyReviewPrompt(at(SUNDAY, 22))?.weekStart).toBe(WEEK_START);
  });

  it("appears on Monday and Tuesday, pointing at the week that closed", () => {
    // Mon 2026-06-22 and Tue 2026-06-23 both look back to the week opening
    // Mon 2026-06-15 — the one that ended on Sunday the 21st.
    for (const date of ["2026-06-22", "2026-06-23"]) {
      expect(getWeeklyReviewPrompt(at(date, 8))).toEqual({
        weekStart: WEEK_START,
        isWrappingUp: false,
      });
    }
  });

  it("points at the same week either side of Sunday midnight", () => {
    // This is what makes one dismissal hold for the whole window: Sunday's
    // "closing tonight" and Monday's "just closed" are the same Monday.
    const sundayEvening = getWeeklyReviewPrompt(at(SUNDAY, 20));
    const mondayMorning = getWeeklyReviewPrompt(at("2026-06-22", 7));
    expect(sundayEvening?.weekStart).toBe(mondayMorning?.weekStart);
  });
});

describe("prompt dismissal", () => {
  beforeEach(() => globalThis.localStorage.clear());
  afterEach(() => vi.restoreAllMocks());

  it("remembers a dismissal for that week only", () => {
    dismissPrompt("u1", WEEK_START);

    expect(isPromptDismissed("u1", WEEK_START)).toBe(true);
    // Next week's prompt is a different prompt.
    expect(isPromptDismissed("u1", "2026-06-22")).toBe(false);
  });

  it("scopes the dismissal to the user", () => {
    dismissPrompt("u1", WEEK_START);

    expect(isPromptDismissed("u2", WEEK_START)).toBe(false);
  });

  it("treats denied storage as 'not dismissed' rather than throwing", () => {
    // Safari private mode and locked-down browsers throw on access. A prompt
    // that cannot remember is a nuisance; one that throws is a broken page.
    vi.spyOn(globalThis.Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("denied");
    });
    vi.spyOn(globalThis.Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("denied");
    });

    expect(() => dismissPrompt("u1", WEEK_START)).not.toThrow();
    expect(isPromptDismissed("u1", WEEK_START)).toBe(false);
  });
});
