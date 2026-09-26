import { describe, expect, it } from "vitest";

import {
  candidateDates,
  dayLabel,
  planMissedSessionRecovery,
  type PlannerInput,
  type PlannerMissedSession,
  type PlannerSession,
  sessionLoad,
} from "./planner";

// Thursday. The week runs Mon 21 → Sun 27 September 2026.
const TODAY = "2026-09-24";

function missed(overrides: Partial<PlannerMissedSession> = {}): PlannerMissedSession {
  return {
    planDayId: "pd-missed",
    date: "2026-09-22",
    focus: "Threshold run",
    priority: "key",
    recovery: null,
    durationMin: 50,
    estimated: false,
    rpe: 7,
    fixedToDate: false,
    shortened: { durationMin: 30, keptFraction: 0.6, changes: [], notes: [] },
    ...overrides,
  };
}

function session(date: string, focus: string, overrides: Partial<PlannerSession> = {}): PlannerSession {
  return {
    date,
    focus,
    priority: "supporting",
    state: "planned",
    durationMin: 45,
    rpe: 5,
    ...overrides,
  };
}

function input(overrides: Partial<PlannerInput> = {}): PlannerInput {
  return {
    today: TODAY,
    missed: missed(),
    sessions: [],
    absences: [],
    lastDate: null,
    raceDate: null,
    ...overrides,
  };
}

function target(preview: ReturnType<typeof planMissedSessionRecovery>, option: "fold" | "shorten", date: string) {
  const move = option === "fold" ? preview.fold : preview.shorten;
  const found = move.targets.find((t) => t.date === date);
  if (!found) throw new Error(`no ${option} target on ${date}`);
  return found;
}

function noteCodes(preview: ReturnType<typeof planMissedSessionRecovery>, option: "fold" | "shorten", date: string) {
  return target(preview, option, date).impact.notes.map((note) => note.code);
}

describe("candidateDates", () => {
  it("offers today and the next six days", () => {
    expect(candidateDates(input())).toEqual([
      "2026-09-24",
      "2026-09-25",
      "2026-09-26",
      "2026-09-27",
      "2026-09-28",
      "2026-09-29",
      "2026-09-30",
    ]);
  });

  it("skips declared absences, and stops at the plan's end and before race day", () => {
    expect(
      candidateDates(
        input({ absences: [{ startDate: "2026-09-25", endDate: "2026-09-26" }], lastDate: "2026-09-29" }),
      ),
    ).toEqual(["2026-09-24", "2026-09-27", "2026-09-28", "2026-09-29"]);
    expect(candidateDates(input({ raceDate: "2026-09-27" }))).toEqual(["2026-09-24", "2026-09-25", "2026-09-26"]);
  });
});

describe("planMissedSessionRecovery", () => {
  it("folds a key session into a free day in the same week", () => {
    const preview = planMissedSessionRecovery(
      input({
        sessions: [
          session("2026-09-21", "Strength A", { state: "done", durationMin: 60, rpe: 6 }),
          session("2026-09-25", "Strength B", { durationMin: 60, rpe: 6 }),
          session("2026-09-27", "Long run", { priority: "key", durationMin: 90, rpe: 4 }),
        ],
      }),
    );

    // Thursday is free, and the neighbours are a planned supporting strength
    // day (RPE 6, not hard) and nothing — the cleanest slot.
    expect(preview.recommendation).toEqual({
      action: "fold",
      targetDate: "2026-09-24",
      reason: "A key session, and today has room for all of it.",
    });
    expect(preview.fold.suggestedDate).toBe("2026-09-24");

    const today = target(preview, "fold", "2026-09-24");
    expect(today.sessions).toEqual([]);
    expect(today.impact.summary).toBe("Today gets the full Threshold run (50 min).");
    expect(today.impact.keptFraction).toBe(1);
    // Folding inside the week keeps the week exactly as written.
    expect(today.impact.weeks).toEqual([
      expect.objectContaining({
        weekStart: "2026-09-21",
        minutesBefore: 260,
        minutesAfter: 260,
        keyBefore: 2,
        keyAfter: 2,
        keyScheduled: 2,
      }),
    ]);
  });

  it("shows what letting it go costs the week", () => {
    const preview = planMissedSessionRecovery(
      input({ sessions: [session("2026-09-27", "Long run", { priority: "key", durationMin: 90, rpe: 4 })] }),
    );

    const { impact } = preview.letGo;
    expect(impact.keptFraction).toBe(0);
    expect(impact.day).toBeNull();
    expect(impact.summary).toBe("Threshold run stays missed, and the rest of the plan carries on as it is.");
    expect(impact.weeks).toEqual([
      {
        weekStart: "2026-09-21",
        minutesBefore: 140,
        minutesAfter: 90,
        loadBefore: Math.round(sessionLoad(90, 4) + sessionLoad(50, 7)),
        loadAfter: Math.round(sessionLoad(90, 4)),
        keyBefore: 2,
        keyAfter: 1,
        keyScheduled: 2,
      },
    ]);
  });

  it("leaves skipped and other missed sessions out of the week's numbers", () => {
    const preview = planMissedSessionRecovery(
      input({
        sessions: [
          session("2026-09-21", "Intervals", { priority: "key", state: "not_happening" }),
          session("2026-09-26", "Easy run", { priority: "optional", durationMin: 40, rpe: 3 }),
        ],
      }),
    );
    expect(preview.letGo.impact.weeks).toEqual([
      expect.objectContaining({
        minutesBefore: 90,
        minutesAfter: 40,
        // The skipped key session still counts as scheduled: "1 of 2 key sessions".
        keyScheduled: 2,
        keyAfter: 0,
      }),
    ]);
  });

  it("recommends letting an optional session go", () => {
    const preview = planMissedSessionRecovery(input({ missed: missed({ priority: "optional", focus: "Easy spin", rpe: 3 }) }));
    expect(preview.recommendation).toEqual({
      action: "let_go",
      targetDate: null,
      reason: "It's an optional session — the plan doesn't need it back.",
    });
    // The other options are still there if the athlete wants them.
    expect(preview.fold.available).toBe(true);
  });

  it("only offers letting go once the session is more than a week old", () => {
    const preview = planMissedSessionRecovery(input({ missed: missed({ date: "2026-09-15" }) }));
    expect(preview.fold).toEqual({
      available: false,
      unavailableReason: "It was missed more than a week ago — the plan has moved on.",
      suggestedDate: null,
      targets: [],
    });
    expect(preview.shorten.available).toBe(false);
    expect(preview.recommendation.action).toBe("let_go");
    expect(preview.recommendation.reason).toBe("It was missed more than a week ago — the plan has moved on.");
  });

  it("never moves a race-week session", () => {
    const preview = planMissedSessionRecovery(input({ missed: missed({ fixedToDate: true, focus: "Shakeout" }) }));
    expect(preview.fold.available).toBe(false);
    expect(preview.fold.unavailableReason).toBe("Race-week sessions are set around race day, so this one can't move.");
  });

  it("flags two key sessions on one day, and back to back", () => {
    const preview = planMissedSessionRecovery(
      input({
        sessions: [
          session("2026-09-25", "Intervals", { priority: "key", durationMin: 50, rpe: 8 }),
          session("2026-09-27", "Long run", { priority: "key", durationMin: 90, rpe: 4 }),
        ],
      }),
    );
    expect(noteCodes(preview, "fold", "2026-09-25")).toContain("stacked_key");
    expect(target(preview, "fold", "2026-09-25").impact.notes[0]?.message).toBe(
      "Tomorrow already has a key session, Intervals — two in one day is a lot.",
    );
    expect(noteCodes(preview, "fold", "2026-09-26")).toContain("back_to_back_key");
    expect(target(preview, "fold", "2026-09-26").impact.notes.find((n) => n.code === "back_to_back_key")?.message).toBe(
      "It sits next to tomorrow's Intervals — two key sessions back to back.",
    );
  });

  it("flags back-to-back hard days for a hard supporting session", () => {
    const preview = planMissedSessionRecovery(
      input({
        missed: missed({ priority: "supporting", focus: "Conditioning", rpe: 8 }),
        sessions: [session("2026-09-25", "Wall ball AMRAP", { rpe: 8 })],
      }),
    );
    expect(noteCodes(preview, "fold", "2026-09-24")).toEqual(["hard_neighbor"]);
    expect(noteCodes(preview, "fold", "2026-09-26")).toEqual(["hard_neighbor"]);
  });

  it("warns about a long double day, and suggests dropping an optional session on it", () => {
    const preview = planMissedSessionRecovery(
      input({
        missed: missed({ priority: "supporting", focus: "Strength B", durationMin: 75, rpe: 6 }),
        sessions: [session("2026-09-24", "Easy run", { priority: "optional", durationMin: 60, rpe: 3 })],
      }),
    );
    const today = target(preview, "fold", "2026-09-24");
    expect(today.impact.summary).toBe(
      "Today gets the full Strength B (1h 15m) alongside Easy run — about 2h 15m in all.",
    );
    expect(today.impact.notes.map((note) => [note.code, note.tone])).toEqual([
      ["long_day", "warning"],
      ["optional_on_day", "info"],
    ]);
    // Shortened, the same day fits.
    expect(noteCodes(preview, "shorten", "2026-09-24")).toEqual(["optional_on_day"]);
  });

  it("warns about hard work in the days before race day", () => {
    const preview = planMissedSessionRecovery(input({ raceDate: "2026-09-27" }));
    expect(noteCodes(preview, "fold", "2026-09-26")).toContain("race_close");
    expect(target(preview, "fold", "2026-09-26").impact.notes.find((n) => n.code === "race_close")?.message).toBe(
      "It's the day before race day — keep the legs fresh.",
    );
    expect(noteCodes(preview, "fold", "2026-09-24")).toContain("race_close");
  });

  it("shows both weeks when a session moves into the next one, and flags a jump", () => {
    const preview = planMissedSessionRecovery(
      input({
        missed: missed({ date: "2026-09-26", priority: "key", focus: "Long run", durationMin: 100, rpe: 4 }),
        today: "2026-09-28",
        sessions: [
          session("2026-09-24", "Strength", { state: "done", durationMin: 60, rpe: 6 }),
          session("2026-09-29", "Easy run", { priority: "optional", durationMin: 40, rpe: 3 }),
          session("2026-10-01", "Intervals", { priority: "key", durationMin: 50, rpe: 8 }),
        ],
      }),
    );
    const monday = target(preview, "fold", "2026-09-28");
    expect(monday.impact.weeks.map((week) => [week.weekStart, week.minutesBefore, week.minutesAfter])).toEqual([
      ["2026-09-21", 160, 60],
      ["2026-09-28", 90, 190],
    ]);
    expect(monday.impact.notes.map((note) => note.code)).toContain("week_jump");
    // Moved in, the long run counts among next week's key sessions.
    expect(monday.impact.weeks[1]).toMatchObject({ keyBefore: 1, keyAfter: 2, keyScheduled: 2 });
  });

  it("recommends a shorter version when every full-length slot has a caution", () => {
    const preview = planMissedSessionRecovery(
      input({
        missed: missed({ durationMin: 90 }),
        sessions: ["2026-09-24", "2026-09-25", "2026-09-26", "2026-09-27", "2026-09-28", "2026-09-29", "2026-09-30"].map(
          (date) => session(date, "Strength", { durationMin: 50, rpe: 6 }),
        ),
      }),
    );
    // Every day already has 50 min, so the full 90 makes a 2h20m day; the
    // shortened 30 min does not.
    expect(preview.fold.targets.every((t) => t.impact.notes.some((n) => n.code === "long_day"))).toBe(true);
    expect(preview.recommendation.action).toBe("shorten");
    expect(preview.recommendation.targetDate).toBe("2026-09-24");
    expect(preview.shorten.suggestedDate).toBe("2026-09-24");
  });

  it("suggests the same day it recommends when no day is free of cautions", () => {
    // Sunday is free but follows today's long run; Thursday next week only
    // grows that week. The recommendation avoids the severe caution, and so
    // must each option's "best fit".
    const preview = planMissedSessionRecovery(
      input({
        // The week the local preview showed: everything before today missed,
        // a long run today, then next week's plan.
        missed: missed({ durationMin: 60, rpe: 5 }),
        today: "2026-09-26",
        sessions: [
          session("2026-09-26", "Long run", { priority: "key", durationMin: 60 }),
          session("2026-09-28", "Strength A", { durationMin: 60 }),
          session("2026-09-29", "Threshold run", { priority: "key", durationMin: 60 }),
          session("2026-09-30", "Easy run", { priority: "optional", durationMin: 60 }),
          session("2026-10-01", "Strength B", { durationMin: 60 }),
          session("2026-10-02", "Stations", { durationMin: 60 }),
        ],
      }),
    );
    expect(noteCodes(preview, "shorten", "2026-09-27")).toContain("back_to_back_key");
    expect(preview.recommendation).toMatchObject({ action: "shorten", targetDate: "2026-10-01" });
    expect(preview.shorten.suggestedDate).toBe("2026-10-01");
    expect(preview.fold.suggestedDate).toBe("2026-10-01");
  });

  it("marks the recommended day best fit even when another day is free of cautions", () => {
    // A key session missed yesterday: a shorter one today sits next to
    // tomorrow's strength (a caution, not a severe one) but keeps the week;
    // next Monday is clean but a week late. The recommendation takes today,
    // and the sheet must not open on today with "best fit" on Monday.
    const preview = planMissedSessionRecovery(
      input({
        today: "2026-09-22",
        missed: missed({ date: "2026-09-21", durationMin: 60, rpe: 8, shortened: { durationMin: 36, keptFraction: 0.6, changes: [], notes: [] } }),
        sessions: [
          session("2026-09-23", "Strength", { durationMin: 60, rpe: 7 }),
          session("2026-09-24", "Tempo run", { priority: "key", durationMin: 50, rpe: 8 }),
          session("2026-09-26", "Long run", { priority: "key", durationMin: 100, rpe: 6 }),
          session("2026-09-29", "Strength", { durationMin: 60, rpe: 6 }),
          session("2026-09-30", "Easy run", { priority: "optional", durationMin: 45, rpe: 4 }),
          session("2026-10-01", "Tempo run", { priority: "key", durationMin: 60, rpe: 8 }),
          session("2026-10-02", "Strength", { durationMin: 60, rpe: 6 }),
          session("2026-10-03", "Long run", { priority: "key", durationMin: 150, rpe: 6 }),
          session("2026-10-04", "Hyrox sim", { priority: "key", durationMin: 100, rpe: 8 }),
        ],
      }),
    );
    expect(noteCodes(preview, "shorten", "2026-09-22")).toEqual(["hard_neighbor"]);
    expect(noteCodes(preview, "shorten", "2026-09-28")).toEqual([]);
    expect(preview.recommendation).toMatchObject({ action: "shorten", targetDate: "2026-09-22" });
    expect(preview.shorten.suggestedDate).toBe("2026-09-22");
  });

  it("marks a supporting session's same-week day best fit, as recommended", () => {
    // Today is busy but clean; next Monday scores a little better on its own,
    // but only a day inside the missed week keeps the week as planned.
    const preview = planMissedSessionRecovery(
      input({
        missed: missed({ priority: "supporting", focus: "Strength", durationMin: 45, rpe: 5 }),
        sessions: [
          session("2026-09-24", "Strength B", { durationMin: 30 }),
          session("2026-09-24", "Row", { durationMin: 30 }),
          session("2026-09-25", "Bike", { durationMin: 30 }),
          session("2026-09-25", "Ski", { durationMin: 30 }),
          session("2026-09-26", "Run", { durationMin: 30 }),
          session("2026-09-26", "Core", { durationMin: 30 }),
          session("2026-09-27", "Swim", { durationMin: 30 }),
          session("2026-09-27", "Bike", { durationMin: 30 }),
          session("2026-09-29", "Strength", { durationMin: 300 }),
          session("2026-10-01", "Run", { durationMin: 300 }),
        ],
      }),
    );
    expect(preview.recommendation).toMatchObject({ action: "fold", targetDate: "2026-09-24" });
    expect(preview.fold.suggestedDate).toBe("2026-09-24");
  });

  it("lets a supporting session go rather than push it into next week", () => {
    const preview = planMissedSessionRecovery(
      input({
        missed: missed({ priority: "supporting", focus: "Strength B", durationMin: 60, rpe: 8 }),
        today: "2026-09-27",
        sessions: [
          session("2026-09-27", "Long run", { priority: "key", durationMin: 90, rpe: 4 }),
          session("2026-09-28", "Intervals", { priority: "key", rpe: 8 }),
          session("2026-09-29", "Tempo", { priority: "key", rpe: 7 }),
          session("2026-09-30", "Hills", { priority: "key", rpe: 8 }),
          session("2026-10-01", "Intervals", { priority: "key", rpe: 8 }),
          session("2026-10-02", "Tempo", { priority: "key", rpe: 7 }),
          session("2026-10-03", "Intervals", { priority: "key", rpe: 8 }),
        ],
      }),
    );
    expect(preview.recommendation.action).toBe("let_go");
    expect(preview.recommendation.reason).toBe(
      "There's no clean slot for it, and a supporting session costs little to let go.",
    );
  });

  it("does not chase a session that was already moved once", () => {
    const supporting = planMissedSessionRecovery(
      input({ missed: missed({ priority: "supporting", recovery: "folded" }) }),
    );
    expect(supporting.recommendation.action).toBe("let_go");
    expect(supporting.recommendation.reason).toBe(
      "It has already been moved once — chasing it again usually costs more than it gives.",
    );

    const key = planMissedSessionRecovery(input({ missed: missed({ recovery: "shortened" }) }));
    expect(key.recommendation.action).toBe("shorten");
  });

  it("carries the shortened version's cuts and notes", () => {
    const preview = planMissedSessionRecovery(
      input({
        missed: missed({
          shortened: {
            durationMin: 30,
            keptFraction: 0.6,
            changes: [{ label: "Interval run", from: "5 sets", to: "3 sets" }],
            notes: [{ code: "blocks_not_trimmed", tone: "info", message: "Timed blocks stay as written." }],
          },
        }),
      }),
    );
    expect(preview.shorten).toMatchObject({
      durationMin: 30,
      keptFraction: 0.6,
      changes: [{ label: "Interval run", from: "5 sets", to: "3 sets" }],
    });
    const today = target(preview, "shorten", "2026-09-24");
    expect(today.impact.summary).toBe("Today gets a 30 min version of Threshold run (instead of 50 min).");
    expect(today.impact.notes.map((note) => note.code)).toEqual(["blocks_not_trimmed"]);
    expect(today.impact.keptFraction).toBe(0.6);
  });
});

describe("labels", () => {
  it("names days relative to today", () => {
    expect(dayLabel("2026-09-24", TODAY)).toBe("today");
    expect(dayLabel("2026-09-25", TODAY)).toBe("tomorrow");
    expect(dayLabel("2026-09-23", TODAY)).toBe("yesterday");
    expect(dayLabel("2026-09-27", TODAY)).toBe("Sunday");
    expect(dayLabel("2026-09-21", TODAY)).toBe("Monday");
    expect(dayLabel("2026-09-19", TODAY)).toBe("last Saturday");
    expect(dayLabel("2026-10-06", TODAY)).toBe("Tue 6 Oct");
  });
});
