import "@testing-library/jest-dom/vitest";

import type { TimelineEntry } from "@shared/schema";
import { render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { buildMissedAftermath } from "./missedAftermath";
import { MissedAftermathNote, MissedAftermathProvider } from "./MissedAftermathNote";

// Wednesday 25 November 2026.
const TODAY = "2026-11-25";

function entry(id: string, date: string, overrides: Partial<TimelineEntry> = {}): TimelineEntry {
  return {
    id,
    date,
    type: "planned",
    status: "planned",
    focus: "Lower Strength",
    mainWorkout: "A) Back Squat 5x5 @ 100 kg",
    accessory: null,
    notes: null,
    planDayId: `pd-${id}`,
    priority: "supporting",
    ...overrides,
  };
}

const missed = entry("missed", "2026-11-24", { status: "missed" });

function held(id: string, date: string, focus: string, exercise: string, from: number, to: number): TimelineEntry {
  return entry(id, date, {
    focus,
    aiSource: "progression",
    aiNoteUpdatedAt: "2026-11-25T00:20:00",
    aiInputsUsed: {
      missedSessionHold: { kind: "missed", date: "2026-11-24", changes: [{ exercise, kind: "hold", from, to, unit: "kg" }] },
    },
  });
}

/** An upcoming session the coach wrote on at `at`, changed or kept by `aiSource`. */
function reviewed(id: string, date: string, aiSource: TimelineEntry["aiSource"], at = "2026-11-25T00:20:00") {
  return entry(id, date, { focus: "Easy Run", aiSource, aiNoteUpdatedAt: at, aiRationale: "…" });
}

describe("buildMissedAftermath", () => {
  it("lists the sessions ahead whose loads are held for the miss, soonest first", () => {
    const aftermath = buildMissedAftermath(
      [
        held("squat", "2026-12-01", "Lower Strength", "back_squat", 102.5, 100),
        missed,
        held("bench", "2026-11-27", "Upper Strength", "bench_press", 72.5, 70),
      ],
      TODAY,
    );

    expect(aftermath.get("missed")).toEqual({
      held: [
        { id: "bench", date: "2026-11-27", focus: "Upper Strength", changes: [{ exercise: "bench_press", kind: "hold", from: 72.5, to: 70, unit: "kg" }] },
        { id: "squat", date: "2026-12-01", focus: "Lower Strength", changes: [{ exercise: "back_squat", kind: "hold", from: 102.5, to: 100, unit: "kg" }] },
      ],
      reviewed: null,
    });
  });

  it("counts the other sessions the coach has gone over since the miss", () => {
    const aftermath = buildMissedAftermath(
      [
        missed,
        held("bench", "2026-11-27", "Upper Strength", "bench_press", 72.5, 70),
        reviewed("kept-1", "2026-11-26", "review"),
        reviewed("kept-2", "2026-11-28", "review"),
        reviewed("changed", "2026-11-29", "rag"),
        // Written on the day of the miss or before: the coach had not seen the plan without it.
        reviewed("before", "2026-11-30", "review", "2026-11-24T21:00:00"),
        // Beyond the week the coach looks ahead, and one with no note at all.
        reviewed("far", "2026-12-10", "review"),
        entry("bare", "2026-11-26"),
      ],
      TODAY,
    );

    expect(aftermath.get("missed")?.reviewed).toEqual({ adjusted: 1, kept: 2 });
  });

  it("leaves a session held for another miss out of the coach's count", () => {
    const sunday = entry("sunday", "2026-11-22", { status: "missed", focus: "Long Run", priority: "key" });
    const longRun = entry("run", "2026-11-29", {
      focus: "Long Run",
      aiSource: "progression",
      aiNoteUpdatedAt: "2026-11-25T00:20:00",
      aiInputsUsed: {
        missedSessionHold: {
          kind: "missed",
          date: "2026-11-22",
          changes: [{ exercise: "long_run", kind: "hold", from: 10, to: 9, unit: "km" }],
        },
      },
    });
    const aftermath = buildMissedAftermath(
      [sunday, missed, longRun, held("bench", "2026-11-27", "Upper Strength", "bench_press", 72.5, 70)],
      TODAY,
    );

    // Listed under Sunday's miss, so not counted again under Tuesday's.
    expect(aftermath.get("sunday")?.held.map((session) => session.id)).toEqual(["run"]);
    expect(aftermath.get("missed")?.reviewed).toBeNull();
  });

  it("has nothing to say for a miss the plan did nothing about", () => {
    expect(buildMissedAftermath([missed, entry("next", "2026-11-27")], TODAY).size).toBe(0);
  });

  it("follows a skip, and only the sessions the plan leans on", () => {
    const bench = held("bench", "2026-11-27", "Upper Strength", "bench_press", 72.5, 70);
    const skipped = entry("skipped", "2026-11-24", { status: "skipped" });
    expect(buildMissedAftermath([skipped, bench], TODAY).has("skipped")).toBe(true);

    for (const ignored of [
      entry("optional", "2026-11-24", { status: "missed", priority: "optional" }),
      entry("rest", "2026-11-24", { status: "missed", priority: undefined }),
      // Held out of missed by a declared absence: never called a miss.
      entry("excused", "2026-11-24", { status: "missed", excused: true }),
      // Logged, and longer ago than a week.
      entry("done", "2026-11-24", { status: "completed" }),
      entry("old", "2026-11-17", { status: "missed" }),
    ]) {
      expect(buildMissedAftermath([ignored, bench], TODAY).size).toBe(0);
    }
  });

  it("gives the coach's reviews to the latest miss only", () => {
    const earlier = entry("earlier", "2026-11-22", { status: "missed" });
    const aftermath = buildMissedAftermath([earlier, missed, reviewed("kept", "2026-11-26", "review")], TODAY);

    expect(aftermath.get("missed")?.reviewed).toEqual({ adjusted: 0, kept: 1 });
    expect(aftermath.has("earlier")).toBe(false);
  });
});

describe("MissedAftermathNote", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-11-25T09:00:00"));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  function renderNote(entries: TimelineEntry[], of: TimelineEntry = missed) {
    return render(
      <MissedAftermathProvider entries={entries}>
        <MissedAftermathNote entry={of} />
      </MissedAftermathProvider>,
    );
  }

  it("says on the missed card what the plan changed after it", () => {
    renderNote([
      missed,
      held("bench", "2026-11-27", "Upper Strength", "bench_press", 72.5, 70),
      held("squat", "2026-12-01", "Lower Strength", "back_squat", 102.5, 100),
      reviewed("kept", "2026-11-26", "review"),
    ]);

    const note = screen.getByTestId("missed-aftermath-missed");
    expect(note).toHaveTextContent("What your plan changed after this");
    expect(note).toHaveTextContent("Fri 27 Nov · Upper Strength — Bench Press: 72.5 → 70 kg");
    expect(note).toHaveTextContent("Tue 1 Dec · Lower Strength — Back Squat: 102.5 → 100 kg");
    expect(note).toHaveTextContent("Your coach also went over 1 more upcoming session: 1 kept as planned.");
  });

  it("says the coach has been over the sessions ahead when nothing was held", () => {
    renderNote([missed, reviewed("a", "2026-11-26", "review"), reviewed("b", "2026-11-27", "rag"), reviewed("c", "2026-11-28", "review")]);

    const note = screen.getByTestId("missed-aftermath-missed");
    expect(note).toHaveTextContent(
      "Since then your coach has gone over 3 upcoming sessions: 1 adjusted, 2 kept as planned.",
    );
    expect(note).not.toHaveTextContent("What your plan changed after this");
  });

  it("says a session named for its one exercise once", () => {
    const sunday = entry("sunday", "2026-11-22", { status: "missed", focus: "Long Run", priority: "key" });
    const longRun = entry("run", "2026-11-29", {
      focus: "Long Run",
      aiInputsUsed: {
        missedSessionHold: {
          kind: "missed",
          date: "2026-11-22",
          changes: [{ exercise: "long_run", kind: "hold", from: 10, to: 9, unit: "km" }],
        },
      },
    });
    renderNote([sunday, longRun], sunday);

    const note = screen.getByTestId("missed-aftermath-sunday");
    expect(note).toHaveTextContent("Sun 29 Nov · Long Run: 10 → 9 km");
    expect(note).not.toHaveTextContent("Long Run — Long Run");
  });

  it("names the first few held sessions of a long list", () => {
    const many = ["2026-11-26", "2026-11-27", "2026-11-28", "2026-11-29", "2026-11-30"].map((date) =>
      held(date, date, "Lower Strength", "back_squat", 102.5, 100),
    );
    renderNote([missed, ...many]);

    expect(screen.getByTestId("missed-aftermath-missed")).toHaveTextContent("and 2 more sessions");
  });

  it("renders nothing on any other card, or outside a provider", () => {
    const next = entry("next", "2026-11-27");
    const { unmount } = renderNote([missed, held("bench", "2026-11-27", "Upper Strength", "bench_press", 72.5, 70)], next);
    expect(screen.queryByTestId(/missed-aftermath-/)).toBeNull();
    unmount();

    render(<MissedAftermathNote entry={missed} />);
    expect(screen.queryByTestId(/missed-aftermath-/)).toBeNull();
  });
});
