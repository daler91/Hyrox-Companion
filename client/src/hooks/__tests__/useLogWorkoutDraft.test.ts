import { beforeEach, describe, expect, it } from "vitest";

import {
  clearLogWorkoutDraft,
  loadLogWorkoutDraft,
  saveLogWorkoutDraft,
} from "../useLogWorkoutDraft";

describe("useLogWorkoutDraft", () => {
  const userKey = "test-user-1";

  beforeEach(() => {
    globalThis.window.localStorage.clear();
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
});
