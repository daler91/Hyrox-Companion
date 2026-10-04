import { act, renderHook } from "@testing-library/react";
import { useRef } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { ParseWorkoutStructureResponse } from "@/lib/api";
import type { StructuredExercise } from "@/lib/structuredExercise";

import { useAutoParse } from "./useAutoParse";

const mocks = vi.hoisted(() => ({
  parseStructured: vi.fn(),
}));

vi.mock("@/lib/api", () => ({
  api: { exercises: { parseStructured: mocks.parseStructured } },
}));

const PARSED: ParseWorkoutStructureResponse = {
  exercises: [{ exerciseName: "back_squat", category: "strength", sets: [{ setNumber: 1, reps: 10 }] }],
  structureBlocks: [],
  warnings: [],
};

interface PendingParse {
  readonly resolve: (value: ParseWorkoutStructureResponse) => void;
  readonly reject: (error: unknown) => void;
}

/**
 * Each parse stays pending until the test settles it; an abort rejects it the
 * way fetch does, on a later microtask.
 */
function queueParses(): PendingParse[] {
  const pending: PendingParse[] = [];
  mocks.parseStructured.mockImplementation(
    (_text: string, options: { signal: AbortSignal }) =>
      new Promise<ParseWorkoutStructureResponse>((resolve, reject) => {
        options.signal.addEventListener("abort", () => {
          reject(new DOMException("The operation was aborted.", "AbortError"));
        });
        pending.push({ resolve, reject });
      }),
  );
  return pending;
}

const noopApply = vi.fn();

function renderAutoParse() {
  return renderHook(() => {
    const blockCounterRef = useRef(0);
    const blocksRef = useRef<string[]>([]);
    const dataRef = useRef<Record<string, StructuredExercise>>({});
    return useAutoParse({ blockCounterRef, blocksRef, dataRef, onApply: noopApply });
  });
}

describe("useAutoParse spinner ownership (CL25)", () => {
  beforeEach(() => {
    mocks.parseStructured.mockReset();
    noopApply.mockReset();
  });

  it("keeps autoParsing true while a newer parse runs after an older one is aborted", async () => {
    const pending = queueParses();
    const { result } = renderAutoParse();

    act(() => {
      result.current.parseNow("3x10 back squat");
    });
    expect(result.current.autoParsing).toBe(true);

    // Continue re-parses the edited text: the first run is aborted and its
    // late `finally` must not clear the flag the second run owns.
    await act(async () => {
      result.current.parseNow("3x10 back squat, 5x5 deadlift");
      await Promise.resolve();
    });

    expect(mocks.parseStructured).toHaveBeenCalledTimes(2);
    expect(result.current.autoParsing).toBe(true);

    await act(async () => {
      pending[1].resolve(PARSED);
      await Promise.resolve();
    });

    expect(result.current.autoParsing).toBe(false);
    expect(noopApply).toHaveBeenCalledTimes(1);
  });

  it("never shows an idle, error-free state between the aborted parse and the newer one failing", async () => {
    const pending = queueParses();
    const { result } = renderAutoParse();

    act(() => {
      result.current.parseNow("3x10 back squat");
    });
    await act(async () => {
      result.current.parseNow("3x10 back squat, 5x5 deadlift");
      await Promise.resolve();
    });

    // The stepper commits the parsed-text checkpoint on exactly that state, so
    // a failure after it would never be re-parsed by Back/Next.
    expect(result.current.autoParsing || result.current.autoParseError).toBe(true);

    await act(async () => {
      pending[1].reject(new Error("AI service temporarily unavailable"));
      await Promise.resolve();
    });

    expect(result.current.autoParsing).toBe(false);
    expect(result.current.autoParseError).toBe(true);
  });

  it("still clears the flag when an aborted parse is followed by a call that does not run", async () => {
    queueParses();
    const { result } = renderAutoParse();

    act(() => {
      result.current.parseNow("3x10 back squat");
    });
    // Under the minimum length: aborts the first run and starts nothing.
    await act(async () => {
      result.current.parseNow("3x10");
      await Promise.resolve();
    });

    expect(mocks.parseStructured).toHaveBeenCalledTimes(1);
    expect(result.current.autoParsing).toBe(false);
  });
});
