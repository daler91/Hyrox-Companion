import type { ExerciseSet, TimelineEntry } from "@shared/schema";
import { beforeEach, describe, expect, it } from "vitest";

import {
  clearLogWorkoutDraft,
  hasAnnouncedDraftRestore,
  loadLogWorkoutDraft,
  markAnnouncedDraftRestore,
  saveLogWorkoutDraft,
  saveLogWorkoutDraftFromTimelineEntry,
} from "../useLogWorkoutDraft";

describe("useLogWorkoutDraft", () => {
  const userKey = "test-user-1";

  beforeEach(() => {
    globalThis.window.localStorage.clear();
    globalThis.window.sessionStorage.clear();
  });

  it("returns null when no draft is stored", () => {
    expect(loadLogWorkoutDraft(userKey)).toBeNull();
  });

  it("round-trips a draft through save and load", () => {
    saveLogWorkoutDraft(userKey, {
      title: "Leg day",
      date: "2026-04-11",
      freeText: "",
      notes: "Felt strong",
      rpe: 8,
      useTextMode: false,
      exerciseBlocks: ["squat__1"],
      exerciseData: {
        squat__1: {
          exerciseName: "back-squat",
          category: "strength",
          sets: [{ setNumber: 1, reps: 5, weight: 100 }],
        },
      },
      blockCounter: 1,
    });

    const loaded = loadLogWorkoutDraft(userKey);
    expect(loaded).not.toBeNull();
    expect(loaded?.title).toBe("Leg day");
    expect(loaded?.notes).toBe("Felt strong");
    expect(loaded?.rpe).toBe(8);
    expect(loaded?.exerciseBlocks).toEqual(["squat__1"]);
    expect(loaded?.blockCounter).toBe(1);
  });

  it("refuses to persist a blank draft and clears any existing entry", () => {
    saveLogWorkoutDraft(userKey, {
      title: "Leg day",
      date: "2026-04-11",
      freeText: "",
      notes: "",
      rpe: null,
      useTextMode: false,
      exerciseBlocks: [],
      exerciseData: {},
      blockCounter: 0,
    });
    expect(loadLogWorkoutDraft(userKey)).not.toBeNull();

    saveLogWorkoutDraft(userKey, {
      title: "",
      date: "2026-04-11",
      freeText: "",
      notes: "",
      rpe: null,
      useTextMode: false,
      exerciseBlocks: [],
      exerciseData: {},
      blockCounter: 0,
    });
    expect(loadLogWorkoutDraft(userKey)).toBeNull();
  });

  it("isolates drafts per userKey", () => {
    saveLogWorkoutDraft("user-a", {
      title: "A's workout",
      date: "2026-04-11",
      freeText: "",
      notes: "",
      rpe: null,
      useTextMode: false,
      exerciseBlocks: [],
      exerciseData: {},
      blockCounter: 0,
    });

    expect(loadLogWorkoutDraft("user-a")?.title).toBe("A's workout");
    expect(loadLogWorkoutDraft("user-b")).toBeNull();
  });

  it("clears the draft", () => {
    saveLogWorkoutDraft(userKey, {
      title: "Leg day",
      date: "2026-04-11",
      freeText: "",
      notes: "",
      rpe: null,
      useTextMode: false,
      exerciseBlocks: [],
      exerciseData: {},
      blockCounter: 0,
    });
    clearLogWorkoutDraft(userKey);
    expect(loadLogWorkoutDraft(userKey)).toBeNull();
  });

  it("seeds a guided log draft from a planned timeline entry", () => {
    const entry = {
      id: "plan-day-1",
      date: "2026-04-14",
      type: "planned",
      status: "planned",
      focus: "Bench day",
      mainWorkout: "4x8 bench press",
      accessory: "Easy accessories",
      notes: null,
      workoutLogId: null,
      planDayId: "plan-day-1",
      duration: null,
      rpe: null,
    } as TimelineEntry;
    const exerciseSet = {
      id: "plan-set-1",
      workoutLogId: null,
      planDayId: "plan-day-1",
      exerciseName: "bench_press",
      customLabel: null,
      category: "strength",
      setNumber: 1,
      reps: 8,
      weight: 100,
      distance: null,
      time: null,
      plannedReps: null,
      plannedWeight: null,
      plannedDistance: null,
      plannedTime: null,
      notes: null,
      confidence: 95,
      sortOrder: 0,
    } as ExerciseSet;

    saveLogWorkoutDraftFromTimelineEntry(userKey, entry, [exerciseSet]);

    const loaded = loadLogWorkoutDraft(userKey);
    expect(loaded?.planDayId).toBe("plan-day-1");
    expect(loaded?.freeText).toBe("4x8 bench press\n\nEasy accessories");
    expect(loaded?.rpe).toBeNull();
    expect(loaded?.exerciseBlocks).toEqual(["bench_press__1"]);
    expect(loaded?.exerciseData["bench_press__1"].sets[0]).toMatchObject({
      reps: 8,
      weight: 100,
      plannedReps: 8,
      plannedWeight: 100,
    });
  });

  describe("draft-restore announce flag", () => {
    it("reports not-yet-announced by default", () => {
      expect(hasAnnouncedDraftRestore(userKey)).toBe(false);
    });

    it("reports announced after marking, isolated per userKey", () => {
      markAnnouncedDraftRestore(userKey);
      expect(hasAnnouncedDraftRestore(userKey)).toBe(true);
      expect(hasAnnouncedDraftRestore("other-user")).toBe(false);
    });

    it("resets the announced flag when the draft is cleared so the next draft re-announces", () => {
      markAnnouncedDraftRestore(userKey);
      expect(hasAnnouncedDraftRestore(userKey)).toBe(true);

      clearLogWorkoutDraft(userKey);
      expect(hasAnnouncedDraftRestore(userKey)).toBe(false);
    });
  });
});
