import type { DragEndEvent } from "@dnd-kit/core";
import { renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import type { GroupedExercise } from "@/lib/exerciseUtils";
import { makeExerciseSet } from "@/test/factories/exerciseSetFactory";

import { useExerciseDndHandler } from "../dnd";
import { orderedSetIds } from "../state";

function group(
  exerciseName: string,
  ids: readonly string[],
  firstSortOrder: number,
): GroupedExercise {
  return {
    exerciseName,
    customLabel: null,
    category: "strength",
    confidence: 95,
    sets: ids.map((id, offset) =>
      makeExerciseSet({ id, exerciseName, sortOrder: firstSortOrder + offset }),
    ),
  };
}

const GROUPS = [
  group("back_squat", ["squat-1", "squat-2"], 0),
  group("deadlift", ["dead-1", "dead-2"], 2),
  group("bench_press", ["bench-1"], 4),
];
const ROW_KEYS = GROUPS.map((entry) => entry.sets[0].id);

function dropOn(activeId: string, overId: string): DragEndEvent {
  return { active: { id: activeId }, over: { id: overId } } as unknown as DragEndEvent;
}

describe("useExerciseDndHandler", () => {
  it("saves the whole new order in one call where the table persists (PF5)", () => {
    const onUpdateSet = vi.fn();
    const onSaveOrder = vi.fn();
    const { result } = renderHook(() =>
      useExerciseDndHandler(GROUPS, ROW_KEYS, onUpdateSet, onSaveOrder),
    );

    result.current(dropOn("bench-1", "squat-1"));

    expect(onSaveOrder).toHaveBeenCalledTimes(1);
    expect(onSaveOrder).toHaveBeenCalledWith(["bench-1", "squat-1", "squat-2", "dead-1", "dead-2"]);
    // No per-set PATCH: those snapped the list back and could hit the rate limit.
    expect(onUpdateSet).not.toHaveBeenCalled();
  });

  it("falls back to one update per moved set for a draft table", () => {
    const onUpdateSet = vi.fn();
    const { result } = renderHook(() => useExerciseDndHandler(GROUPS, ROW_KEYS, onUpdateSet));

    result.current(dropOn("bench-1", "dead-1"));

    expect(onUpdateSet.mock.calls).toEqual([
      ["bench-1", { sortOrder: 2 }],
      ["dead-1", { sortOrder: 3 }],
      ["dead-2", { sortOrder: 4 }],
    ]);
  });

  it("saves nothing for a drop back on its own row or outside the list", () => {
    const onUpdateSet = vi.fn();
    const onSaveOrder = vi.fn();
    const { result } = renderHook(() =>
      useExerciseDndHandler(GROUPS, ROW_KEYS, onUpdateSet, onSaveOrder),
    );

    result.current(dropOn("dead-1", "dead-1"));
    result.current({ active: { id: "dead-1" }, over: null } as unknown as DragEndEvent);

    expect(onSaveOrder).not.toHaveBeenCalled();
    expect(onUpdateSet).not.toHaveBeenCalled();
  });
});

describe("orderedSetIds", () => {
  it("lists every set id in display order", () => {
    expect(orderedSetIds(GROUPS)).toEqual(["squat-1", "squat-2", "dead-1", "dead-2", "bench-1"]);
  });
});
