import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../storage", () => ({ storage: { analyticsResults: { get: vi.fn() } } }));

import { storage } from "../../storage";
import { readStoredAnalysis } from "./storedAnalysis";

const getRow = vi.mocked(storage.analyticsResults.get);

describe("readStoredAnalysis", () => {
  const getAnchor = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    getAnchor.mockResolvedValue({ latestDate: "2026-06-01", entryCount: 10 });
  });

  it("returns null when nothing is stored, having read the anchor alongside", async () => {
    getRow.mockResolvedValue(undefined);

    await expect(readStoredAnalysis("user-1", "coach_insights", getAnchor)).resolves.toBeNull();
    expect(getRow).toHaveBeenCalledWith("user-1", "coach_insights");
    expect(getAnchor).toHaveBeenCalledWith("user-1");
  });

  it("returns the payload, then the row's generatedAt and the stale flag", async () => {
    getRow.mockResolvedValue({
      payload: { insights: "# Notes", generatedAt: "stale-copy", ragInfo: null },
      generatedAt: new Date("2026-06-01T00:00:00.000Z"),
      lastWorkoutDateAtGeneration: "2026-06-01",
      entryCountAtGeneration: 9,
    } as never);

    const stored = await readStoredAnalysis("user-1", "coach_insights", getAnchor);

    // The payload's own generatedAt keeps its place and takes the row's value,
    // so the JSON body is what the routes sent before the helper existed.
    expect(JSON.stringify(stored)).toBe(
      '{"insights":"# Notes","generatedAt":"2026-06-01T00:00:00.000Z","ragInfo":null,"stale":true}',
    );
  });
});
