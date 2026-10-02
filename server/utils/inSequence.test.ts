import { describe, expect, it } from "vitest";

import { inSequence } from "./inSequence";

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
