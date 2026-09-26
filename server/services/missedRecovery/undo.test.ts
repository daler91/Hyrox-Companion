import type { ExerciseSet } from "@shared/schema";
import { describe, expect, it } from "vitest";

import { createMockPlanDay } from "../../../test/factories";
import { captureMove, planUndo } from "./undo";

function runSet(id: string, overrides: Partial<ExerciseSet> = {}): ExerciseSet {
  return {
    id,
    planDayId: "pd-1",
    exerciseName: "easy_run",
    setNumber: 1,
    plannedDistance: 10000,
    plannedTime: 60,
    distance: null,
    time: null,
    reps: null,
    plannedReps: null,
    ...overrides,
  } as ExerciseSet;
}

const missed = createMockPlanDay({
  id: "pd-1",
  scheduledDate: "2026-09-22",
  status: "missed",
  notes: "Keep it conversational",
  expectedDurationMin: 60,
});

const INSTRUCTION = "Shortened after it was missed on Tue 22 Sep: do about 60% of it.";

/** Shorten: set 1 scaled from 10 km / 60 min to 6 km / 36 min, set 2 dropped, a line and a length pinned. */
function shortened() {
  const sets = [runSet("s1"), runSet("s2", { setNumber: 2 })];
  const undo = captureMove(missed, {
    sets,
    deleteSetIds: ["s2"],
    setUpdates: [{ id: "s1", plannedDistance: 6000, plannedTime: 36 }],
    notes: `${INSTRUCTION}\nKeep it conversational`,
    expectedDurationMin: 36,
  });
  const day = {
    ...missed,
    scheduledDate: "2026-09-25",
    status: "planned",
    recovery: "shortened",
    missedOn: "2026-09-22",
    notes: `${INSTRUCTION}\nKeep it conversational`,
    expectedDurationMin: 36,
    recoveryUndo: undo,
  };
  return { undo, day, remaining: [runSet("s1", { plannedDistance: 6000, plannedTime: 36 })] };
}

describe("captureMove", () => {
  it("records a fold: where the day was, and nothing else", () => {
    expect(captureMove(missed)).toEqual({
      scheduledDate: "2026-09-22",
      status: "missed",
      recovery: null,
      missedOn: null,
      deletedSets: [],
      scaledSets: [],
      previous: null,
    });
  });

  it("records what a shorten changed, before and after", () => {
    const { undo } = shortened();
    expect(undo.deletedSets.map((set) => set.id)).toEqual(["s2"]);
    expect(undo.scaledSets).toEqual([
      { id: "s1", before: { plannedDistance: 10000, plannedTime: 60 }, after: { plannedDistance: 6000, plannedTime: 36 } },
    ]);
    expect(undo.notes).toEqual({ before: "Keep it conversational", after: `${INSTRUCTION}\nKeep it conversational` });
    expect(undo.expectedDurationMin).toEqual({ before: 60, after: 36 });
  });

  it("keeps the undo it replaces, so a second move goes back to the first", () => {
    const first = captureMove(missed);
    const movedAgain = { ...missed, scheduledDate: "2026-09-24", status: "missed", recovery: "folded", missedOn: "2026-09-22", recoveryUndo: first };
    const second = captureMove(movedAgain);
    expect(second).toMatchObject({ scheduledDate: "2026-09-24", recovery: "folded", missedOn: "2026-09-22", previous: first });
  });
});

describe("planUndo", () => {
  it("puts the whole session back on the day it was missed, undecided", () => {
    const { undo, day, remaining } = shortened();
    const write = planUndo(day, undo, remaining);

    expect(write.update).toEqual({
      scheduledDate: "2026-09-22",
      status: "missed",
      recovery: null,
      missedOn: null,
      recoveryUndo: null,
      notes: "Keep it conversational",
      expectedDurationMin: 60,
    });
    expect(write.insertSets?.map((set) => set.id)).toEqual(["s2"]);
    expect(write.setUpdates).toEqual([{ id: "s1", plannedDistance: 10000, plannedTime: 60 }]);
  });

  it("keeps what the athlete changed since: only values still as the shorten wrote them come back", () => {
    const { undo, day } = shortened();
    const edited = {
      ...day,
      // Their own length, and a note of their own under the instruction.
      expectedDurationMin: 40,
      notes: `${INSTRUCTION}\nKeep it conversational\nFelt a twinge — go easy`,
    };
    // They set their own distance on the kept run; its time is still the shorten's.
    const write = planUndo(edited, undo, [runSet("s1", { plannedDistance: 7000, plannedTime: 36 })]);

    expect(write.update).not.toHaveProperty("expectedDurationMin");
    // The shortened session's instruction goes; their lines stay.
    expect(write.update.notes).toBe("Keep it conversational\nFelt a twinge — go easy");
    expect(write.setUpdates).toEqual([{ id: "s1", plannedTime: 60 }]);
  });

  it("leaves notes alone when the athlete removed the instruction themselves", () => {
    const { undo, day, remaining } = shortened();
    const write = planUndo({ ...day, notes: "My own words" }, undo, remaining);
    expect(write.update).not.toHaveProperty("notes");
  });

  it("does not put back a set that is already there, or scale one that is gone", () => {
    const { undo, day } = shortened();
    const write = planUndo(day, undo, [runSet("s2", { setNumber: 2 })]);
    expect(write.insertSets).toEqual([]);
    expect(write.setUpdates).toEqual([]);
  });
});
