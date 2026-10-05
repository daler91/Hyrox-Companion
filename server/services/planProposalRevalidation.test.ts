import type {
  EnrichedPlanAdjustmentChange,
  PlanAdjustmentUpdatedFields,
  PlanDay,
} from "@shared/schema";
import { describe, expect, it } from "vitest";

import { buildWorkoutPrescriptionFingerprint } from "./aiModificationGuard";
import { revalidateProposalChanges } from "./planProposalRevalidation";

const TODAY = "2026-07-15";

function planDay(overrides: Partial<PlanDay> = {}): PlanDay {
  return {
    id: "day-1",
    planId: "plan-1",
    focus: "Tempo Run",
    mainWorkout: "40min tempo",
    accessory: null,
    notes: null,
    scheduledDate: "2026-07-16",
    status: "planned",
    ...overrides,
  } as PlanDay;
}

/** A change to `day` proposed while it read as `day` does now. */
function changeTo(
  day: PlanDay,
  updatedFields: PlanAdjustmentUpdatedFields,
): EnrichedPlanAdjustmentChange {
  return {
    planDayId: day.id,
    updatedFields,
    rationale: "Ease off.",
    kind: "tune",
    dayLabel: "Thu Jul 16 — Tempo Run",
    baseline: {
      focus: day.focus,
      mainWorkout: day.mainWorkout,
      accessory: day.accessory,
      notes: day.notes,
      scheduledDate: day.scheduledDate,
      expectedDurationMin: null,
      expectedRpe: null,
      status: "planned",
      fingerprint: buildWorkoutPrescriptionFingerprint({
        mainWorkout: day.mainWorkout,
        exerciseDetails: [],
      }),
    },
    structured: false,
    hasStructureBlocks: false,
  };
}

function revalidate(change: EnrichedPlanAdjustmentChange, live: PlanDay) {
  return revalidateProposalChanges(
    [change],
    { dayById: new Map([[live.id, live]]), setsByDay: new Map([[live.id, []]]) },
    TODAY,
  );
}

const STALE = [{ planDayId: "day-1", dayLabel: "Thu Jul 16 — Tempo Run" }];

describe("revalidateProposalChanges", () => {
  it("keeps a change whose day is still planned, unchanged and ahead", () => {
    const day = planDay();

    const { liveDays, staleChanges } = revalidate(changeTo(day, { expectedRpe: 6 }), day);

    expect(staleChanges).toEqual([]);
    expect(liveDays.get("day-1")).toEqual({ day, sets: [] });
  });

  it("calls a change stale when its day is no longer planned or was edited since", () => {
    const day = planDay();
    const change = changeTo(day, { expectedRpe: 6 });

    expect(revalidate(change, planDay({ status: "completed" })).staleChanges).toEqual(STALE);
    expect(revalidate(change, planDay({ mainWorkout: "Edited meanwhile" })).staleChanges).toEqual(
      STALE,
    );
  });

  // C33 (CODEBASE_ANALYSIS_2026-10-03): a proposal applied days after it was
  // made could put a session on a date already gone, where it read as missed.
  describe("a change for a day before today (C33)", () => {
    it("is stale when the day itself has passed", () => {
      const day = planDay({ scheduledDate: "2026-07-14" });

      expect(revalidate(changeTo(day, { expectedRpe: 6 }), day).staleChanges).toEqual(STALE);
    });

    it("is stale when it moves the day onto a date that has passed", () => {
      const day = planDay();

      expect(revalidate(changeTo(day, { scheduledDate: "2026-07-14" }), day).staleChanges).toEqual(
        STALE,
      );
    });

    it("keeps a change for today", () => {
      const day = planDay({ scheduledDate: TODAY });

      expect(revalidate(changeTo(day, { expectedRpe: 6 }), day).staleChanges).toEqual([]);
    });

    it("keeps a change that moves a passed day forward", () => {
      const day = planDay({ scheduledDate: "2026-07-14" });

      expect(revalidate(changeTo(day, { scheduledDate: "2026-07-17" }), day).staleChanges).toEqual(
        [],
      );
    });
  });
});
