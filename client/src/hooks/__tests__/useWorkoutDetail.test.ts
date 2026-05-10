import type { StructureBlockInput } from "@shared/schema";
import { describe, expect, it } from "vitest";

import { isLatestMutationSequence, mergeServerStructureBlock } from "../useWorkoutDetail";

function block(
  id: string,
  score: StructureBlockInput["score"],
): StructureBlockInput {
  return {
    id,
    sectionType: "main",
    formatType: "amrap",
    timeCapMinutes: 10,
    score,
    steps: [{ stepNumber: 1, stepType: "work", exerciseName: "rowing" }],
  };
}

describe("isLatestMutationSequence", () => {
  it("accepts only the latest submitted sequence", () => {
    expect(isLatestMutationSequence(3, 3)).toBe(true);
    expect(isLatestMutationSequence(2, 3)).toBe(false);
  });
});

describe("mergeServerStructureBlock", () => {
  it("updates only the score block returned by the server", () => {
    const current = [
      block("block-1", { type: "amrap", rounds: 3, reps: 5 }),
      block("block-2", { type: "amrap", rounds: 8, reps: 0 }),
    ];
    const olderServerResponse = [
      block("block-1", { type: "amrap", rounds: 4, reps: 0 }),
      block("block-2", { type: "amrap", rounds: 1, reps: 0 }),
    ];

    const merged = mergeServerStructureBlock(current, olderServerResponse, "block-1");

    expect(merged).toEqual([
      olderServerResponse[0],
      current[1],
    ]);
  });

  it("falls back to the server list when the current cache does not contain the block", () => {
    const serverBlocks = [block("block-1", { type: "amrap", rounds: 4 })];

    expect(mergeServerStructureBlock([], serverBlocks, "block-1")).toEqual(serverBlocks);
  });
});
