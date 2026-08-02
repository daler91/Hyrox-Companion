import type { Food } from "@shared/schema";
import { describe, expect, it } from "vitest";

import { type LogEntryWithFood } from "./rollup";
import { computeSessionFuelling, POST_WINDOW_MS, PRE_WINDOW_MS } from "./sessionFuelling";

function makeFood(over: Partial<Food> = {}): Food {
  return {
    id: "f1",
    source: "usda",
    sourceId: "1",
    name: "Test Food",
    brand: null,
    createdByUserId: null,
    servingSizeG: null,
    caloriesPer100g: 100,
    proteinPer100g: 10,
    carbPer100g: 20,
    fatPer100g: 5,
    fiberPer100g: 2,
    micros: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...over,
  };
}

function makeRow(entryOver: Partial<LogEntryWithFood> = {}, foodOver: Partial<Food> = {}): LogEntryWithFood {
  const food = makeFood(foodOver);
  return {
    id: "e1",
    userId: "u1",
    foodId: food.id,
    loggedAt: new Date("2026-06-07T12:00:00Z"),
    logDate: "2026-06-07",
    quantityG: 100,
    mealType: "snack",
    entryMethod: "manual",
    rawInput: null,
    parseConfidence: null,
    pendingReview: false,
    createdAt: new Date(),
    updatedAt: new Date(),
    food,
    ...entryOver,
  };
}

const START = new Date("2026-06-07T12:00:00Z");
const startMs = START.getTime();

describe("computeSessionFuelling — start instant known", () => {
  const workout = { date: "2026-06-07", startedAt: START };

  it("splits entries into pre/post windows and flags usedStartTime", () => {
    const rows = [
      makeRow({ id: "pre", loggedAt: new Date(startMs - 2 * 60 * 60 * 1000) }), // 2h before
      makeRow({ id: "post", loggedAt: new Date(startMs + 1 * 60 * 60 * 1000) }), // 1h after
    ];
    const result = computeSessionFuelling(workout, rows);

    expect(result.usedStartTime).toBe(true);
    expect(result.pre.map((e) => e.id)).toEqual(["pre"]);
    expect(result.post.map((e) => e.id)).toEqual(["post"]);
    expect(result.preTotals.calories).toBe(100);
    expect(result.postTotals.protein).toBe(10);
  });

  it("includes the boundary entries at start−PRE and start+POST but excludes just outside", () => {
    const rows = [
      makeRow({ id: "pre-edge", loggedAt: new Date(startMs - PRE_WINDOW_MS) }), // inclusive lower
      makeRow({ id: "pre-out", loggedAt: new Date(startMs - PRE_WINDOW_MS - 1000) }), // just before
      makeRow({ id: "at-start", loggedAt: new Date(startMs) }), // start → counts as post
      makeRow({ id: "post-edge", loggedAt: new Date(startMs + POST_WINDOW_MS) }), // inclusive upper
      makeRow({ id: "post-out", loggedAt: new Date(startMs + POST_WINDOW_MS + 1000) }), // just after
    ];
    const result = computeSessionFuelling(workout, rows);

    expect(result.pre.map((e) => e.id)).toEqual(["pre-edge"]);
    // Insertion order: "at-start" (== start) precedes "post-edge" (start+POST).
    expect(result.post.map((e) => e.id)).toEqual(["at-start", "post-edge"]);
  });

  it("treats an entry exactly at the start instant as post, not pre", () => {
    const rows = [makeRow({ id: "boundary", loggedAt: START })];
    const result = computeSessionFuelling(workout, rows);
    expect(result.pre).toHaveLength(0);
    expect(result.post.map((e) => e.id)).toEqual(["boundary"]);
  });

  it("accepts a string startedAt (ISO instant)", () => {
    const rows = [makeRow({ id: "pre", loggedAt: new Date(startMs - 60_000) })];
    const result = computeSessionFuelling({ date: "2026-06-07", startedAt: START.toISOString() }, rows);
    expect(result.usedStartTime).toBe(true);
    expect(result.pre.map((e) => e.id)).toEqual(["pre"]);
  });

  it("attributes a same-day post_workout tag outside the window (back-logged noon stamp)", () => {
    // Session at 17:00; recovery meal eaten that evening but logged the next
    // day, so it carries the synthetic local-noon stamp — before the pre-window
    // even opens. The tag names this session; it must count as post.
    const eveningStart = new Date("2026-06-07T17:00:00Z");
    const rows = [
      makeRow({
        id: "backlogged-post",
        mealType: "post_workout",
        loggedAt: new Date("2026-06-07T12:00:00Z"),
      }),
    ];
    const result = computeSessionFuelling({ date: "2026-06-07", startedAt: eveningStart }, rows);

    expect(result.usedStartTime).toBe(true);
    expect(result.post.map((e) => e.id)).toEqual(["backlogged-post"]);
    expect(result.pre).toHaveLength(0);
  });

  it("lets a same-day tag outrank the clock window", () => {
    // Tagged pre_workout but stamped inside the post window: explicit intent wins.
    const rows = [
      makeRow({
        id: "tagged-pre",
        mealType: "pre_workout",
        loggedAt: new Date(startMs + 60 * 60 * 1000),
      }),
    ];
    const result = computeSessionFuelling(workout, rows);

    expect(result.pre.map((e) => e.id)).toEqual(["tagged-pre"]);
    expect(result.post).toHaveLength(0);
  });

  it("keeps window attribution for a pre/post tag from a different day", () => {
    // Yesterday's post-workout meal falling inside this session's pre window
    // (late meal before an after-midnight session): its tag names yesterday's
    // session, so the clock rules here.
    const nightStart = new Date("2026-06-08T00:30:00Z");
    const rows = [
      makeRow({
        id: "yesterdays-post",
        mealType: "post_workout",
        logDate: "2026-06-07",
        loggedAt: new Date("2026-06-07T22:00:00Z"),
      }),
    ];
    const result = computeSessionFuelling({ date: "2026-06-08", startedAt: nightStart }, rows);

    expect(result.pre.map((e) => e.id)).toEqual(["yesterdays-post"]);
    expect(result.post).toHaveLength(0);
  });
});

describe("computeSessionFuelling — fallback to meal tags", () => {
  const workout = { date: "2026-06-07", startedAt: null };

  it("splits by pre_workout / post_workout tags and flags usedStartTime false", () => {
    const rows = [
      makeRow({ id: "pre", mealType: "pre_workout" }),
      makeRow({ id: "post", mealType: "post_workout" }),
      makeRow({ id: "lunch", mealType: "lunch" }), // ignored in fallback
    ];
    const result = computeSessionFuelling(workout, rows);

    expect(result.usedStartTime).toBe(false);
    expect(result.pre.map((e) => e.id)).toEqual(["pre"]);
    expect(result.post.map((e) => e.id)).toEqual(["post"]);
  });

  it("falls back when startedAt is an unparseable string", () => {
    const rows = [makeRow({ id: "pre", mealType: "pre_workout" })];
    const result = computeSessionFuelling({ date: "2026-06-07", startedAt: "not-a-date" }, rows);
    expect(result.usedStartTime).toBe(false);
    expect(result.pre.map((e) => e.id)).toEqual(["pre"]);
  });
});

describe("computeSessionFuelling — empty", () => {
  it("returns empty groups and zero totals (start known)", () => {
    const result = computeSessionFuelling({ date: "2026-06-07", startedAt: START }, []);
    expect(result.pre).toEqual([]);
    expect(result.post).toEqual([]);
    expect(result.preTotals).toEqual({ calories: 0, protein: 0, carb: 0, fat: 0, fiber: 0 });
    expect(result.postTotals).toEqual({ calories: 0, protein: 0, carb: 0, fat: 0, fiber: 0 });
  });

  it("returns empty groups and zero totals (fallback)", () => {
    const result = computeSessionFuelling({ date: "2026-06-07", startedAt: null }, []);
    expect(result.usedStartTime).toBe(false);
    expect(result.pre).toEqual([]);
    expect(result.postTotals.calories).toBe(0);
  });
});
