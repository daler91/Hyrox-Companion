import { describe, expect, it } from "vitest";

import { inChunks, inSequence } from "./inSequence";

describe("inSequence", () => {
  it("runs each step after the one before it has finished, and keeps the results in order", async () => {
    const events: string[] = [];
    const results = await inSequence([30, 10, 20], async (ms) => {
      events.push(`start ${ms}`);
      await new Promise((resolve) => setTimeout(resolve, ms)); // DevSkim: ignore DS172411
      events.push(`end ${ms}`);
      return ms * 2;
    });

    expect(results).toEqual([60, 20, 40]);
    expect(events).toEqual(["start 30", "end 30", "start 10", "end 10", "start 20", "end 20"]);
  });

  it("hands each step its item's position", async () => {
    const results = await inSequence(
      ["a", "b", "c"],
      async (item, index) => await Promise.resolve(`${index}:${item}`),
    );

    expect(results).toEqual(["0:a", "1:b", "2:c"]);
  });

  it("stops at the first step that rejects, and rejects with its error", async () => {
    const ran: number[] = [];
    const run = inSequence([1, 2, 3], async (n) => {
      ran.push(n);
      if (n === 2) throw new Error("step 2 failed");
      return await Promise.resolve(n);
    });

    await expect(run).rejects.toThrow("step 2 failed");
    expect(ran).toEqual([1, 2]);
  });

  it("resolves to nothing for nothing", async () => {
    await expect(inSequence([], async () => await Promise.resolve(1))).resolves.toEqual([]);
  });
});

describe("inChunks", () => {
  it("cuts the items into runs of the given size, the last one holding the rest", () => {
    expect(inChunks([1, 2, 3, 4, 5], 2)).toEqual([[1, 2], [3, 4], [5]]);
  });

  it("keeps a list no longer than the size in one run", () => {
    expect(inChunks([1, 2, 3], 3)).toEqual([[1, 2, 3]]);
  });

  it("has no runs for no items", () => {
    expect(inChunks([], 500)).toEqual([]);
  });

  it("refuses a size that could never make progress", () => {
    expect(() => inChunks([1], 0)).toThrow(RangeError);
    expect(() => inChunks([1], 1.5)).toThrow(RangeError);
  });
});
