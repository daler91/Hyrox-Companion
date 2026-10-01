import type { ExerciseSet, PlanAdjustmentProposal, PlanDay, PlanProposalDayUndo } from "@shared/schema";
import { describe, expect, it } from "vitest";

import {
  appliedPlanDayIds,
  captureDayUndo,
  isUndoable,
  planDayRestore,
  setsFingerprint,
} from "./planProposalUndo";

const NOTE_AT = new Date("2026-07-10T08:00:00.000Z");

function day(overrides: Partial<PlanDay> = {}): PlanDay {
  return {
    id: "day-1",
    planId: "plan-1",
    weekNumber: 1,
    dayName: "Thursday",
    focus: "Tempo Run",
    mainWorkout: "40min tempo",
    accessory: null,
    notes: null,
    scheduledDate: "2026-07-16",
    status: "planned",
    aiSource: null,
    aiRationale: null,
    aiNoteUpdatedAt: null,
    aiInputsUsed: null,
    expectedDurationMin: 40,
    expectedRpe: 7,
    plannedTimeOfDayMin: null,
    skipReason: null,
    priority: null,
    recovery: null,
    missedOn: null,
    recoveryUndo: null,
    ...overrides,
  };
}

function set(id: string, exerciseName: string): ExerciseSet {
  return { id, planDayId: "day-1", exerciseName, category: "functional", setNumber: 1, sortOrder: 0 } as ExerciseSet;
}

/** day-1 moved to Saturday and made easier, with the coach's note on it. */
function dayUndo(overrides: Partial<PlanProposalDayUndo> = {}): PlanProposalDayUndo {
  return {
    planDayId: "day-1",
    fields: {
      scheduledDate: { before: "2026-07-16", after: "2026-07-18" },
      expectedRpe: { before: 7, after: 5 },
    },
    coachNote: {
      before: { aiSource: "rag", aiRationale: "Older note.", aiNoteUpdatedAt: "2026-07-01T00:00:00.000Z", aiInputsUsed: null },
      writtenAt: NOTE_AT.toISOString(),
    },
    ...overrides,
  };
}

const applied = day({ scheduledDate: "2026-07-18", expectedRpe: 5, aiRationale: "Saturday suits.", aiNoteUpdatedAt: NOTE_AT });

describe("captureDayUndo", () => {
  it("keeps the fields the apply changed, with what it stored, and the note it replaced", () => {
    const before = day({ aiSource: "rag", aiRationale: "Older note.", aiNoteUpdatedAt: new Date("2026-07-01T00:00:00.000Z") });
    // The apply also "wrote" notes, but to the value they already had.
    const written = { scheduledDate: "2026-07-18", expectedRpe: 5, notes: null, aiNoteUpdatedAt: NOTE_AT };

    expect(captureDayUndo(before, applied, written)).toEqual(dayUndo());
  });

  it("keeps a replaced table whole, with a fingerprint of the one the apply left", () => {
    const before = [set("set-1", "rowing")];
    const after = [set("set-2", "ski erg")];

    const undo = captureDayUndo(day(), applied, { aiNoteUpdatedAt: NOTE_AT }, { before, after });

    expect(undo.sets).toEqual({ before, afterFingerprint: setsFingerprint(after) });
  });
});

describe("planDayRestore", () => {
  it("puts back every field and the coach note while they still read what the apply wrote", () => {
    expect(planDayRestore(dayUndo(), applied, [])).toEqual({
      planDayId: "day-1",
      update: {
        scheduledDate: "2026-07-16",
        expectedRpe: 7,
        aiSource: "rag",
        aiRationale: "Older note.",
        aiNoteUpdatedAt: new Date("2026-07-01T00:00:00.000Z"),
        aiInputsUsed: null,
      },
      sets: null,
      kept: false,
    });
  });

  it("keeps a field the athlete changed since, and a newer coach note", () => {
    const edited = day({ ...applied, expectedRpe: 6, aiNoteUpdatedAt: new Date("2026-07-12T00:00:00.000Z") });

    const restore = planDayRestore(dayUndo(), edited, []);

    expect(restore.update).toEqual({ scheduledDate: "2026-07-16" });
    expect(restore.kept).toBe(true);
  });

  it.each([
    ["gone", undefined],
    ["done since", day({ ...applied, status: "completed" })],
  ])("leaves a day that is %s", (_label, current) => {
    expect(planDayRestore(dayUndo(), current, [])).toEqual({ planDayId: "day-1", update: null, sets: null, kept: true });
  });

  it("puts the table back only while it is the one the apply left", () => {
    const before = [set("set-1", "rowing")];
    const left = [set("set-2", "ski erg")];
    const undo = dayUndo({ sets: { before, afterFingerprint: setsFingerprint(left) } });

    expect(planDayRestore(undo, applied, left).sets).toEqual(before);
    const edited = planDayRestore(undo, applied, [set("set-3", "burpees")]);
    expect(edited.sets).toBeNull();
    expect(edited.kept).toBe(true);
  });
});

function proposal(overrides: Partial<PlanAdjustmentProposal> = {}): PlanAdjustmentProposal {
  return {
    id: "prop-1",
    userId: "user-1",
    planId: "plan-1",
    status: "applied",
    summaryMessage: "Moved two sessions.",
    userRequest: "move things",
    payload: { changes: [{ planDayId: "day-1" }, { planDayId: "day-2" }] as never },
    aiSource: null,
    createdAt: new Date(),
    resolvedAt: new Date(),
    applyUndo: { days: [dayUndo()] },
    revertedAt: null,
    ...overrides,
  };
}

describe("appliedPlanDayIds", () => {
  it("names the days the apply changed", () => {
    expect(appliedPlanDayIds(proposal())).toEqual(["day-1"]);
  });

  it("counts every change on a proposal applied before undo existed", () => {
    expect(appliedPlanDayIds(proposal({ applyUndo: null }))).toEqual(["day-1", "day-2"]);
  });
});

describe("isUndoable", () => {
  const now = Date.parse("2026-07-20T12:00:00.000Z");

  it("is true for a week after the apply", () => {
    expect(isUndoable(proposal({ resolvedAt: new Date("2026-07-14T12:00:00.000Z") }), now)).toBe(true);
    expect(isUndoable(proposal({ resolvedAt: new Date("2026-07-13T11:59:00.000Z") }), now)).toBe(false);
  });

  it("is false without a record of the apply, or once undone", () => {
    expect(isUndoable(proposal({ applyUndo: null }), now)).toBe(false);
    expect(isUndoable(proposal({ status: "reverted" }), now)).toBe(false);
  });
});
