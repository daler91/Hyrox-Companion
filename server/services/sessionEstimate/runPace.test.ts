import { afterEach, describe, expect, it, vi } from "vitest";

import { storage } from "../../storage";
import { getRunPaceRatio } from "./runPace";

vi.mock("../../storage", () => ({
  storage: { analytics: { getWorkoutLogsByDateRange: vi.fn() } },
}));

const logsMock = vi.mocked(storage.analytics.getWorkoutLogsByDateRange);

// Minimal run-shaped log; avgSpeed 3 m/s ≈ 5:33/km, a typical recreational pace.
function run(overrides: Record<string, unknown> = {}) {
  return { focus: "Run", avgSpeed: 3, distanceMeters: 5000, duration: 28, ...overrides } as never;
}

afterEach(() => vi.clearAllMocks());

describe("getRunPaceRatio", () => {
  it("returns 1 (generic) when there are too few runs", async () => {
    logsMock.mockResolvedValue([run(), run()]); // 2 < MIN_SAMPLES
    expect(await getRunPaceRatio("u1")).toBe(1);
  });

  it("derives a grounded ratio from the median run pace", async () => {
    logsMock.mockResolvedValue([run(), run(), run()]); // ~0.333 s/m vs 0.345 anchor
    const ratio = await getRunPaceRatio("u1");
    expect(ratio).toBeGreaterThan(0.9);
    expect(ratio).toBeLessThan(1.0);
  });

  it("clamps a fast runner to the lower bound", async () => {
    logsMock.mockResolvedValue([run({ avgSpeed: 4.5 }), run({ avgSpeed: 4.5 }), run({ avgSpeed: 4.5 })]);
    expect(await getRunPaceRatio("u1")).toBe(0.8); // MIN_RUN_PACE_RATIO
  });

  it("clamps a slow runner to the upper bound", async () => {
    logsMock.mockResolvedValue([run({ avgSpeed: 2 }), run({ avgSpeed: 2 }), run({ avgSpeed: 2 })]);
    expect(await getRunPaceRatio("u1")).toBe(1.25); // MAX_RUN_PACE_RATIO
  });

  it("ignores non-run activities and implausible speeds", async () => {
    logsMock.mockResolvedValue([
      run({ focus: "Ride", avgSpeed: 9 }), // cycling, not a run
      run({ avgSpeed: 12 }), // implausible run speed → dropped
      run({ avgSpeed: 3 }), // only 1 valid sample remains → < MIN_SAMPLES
    ]);
    expect(await getRunPaceRatio("u1")).toBe(1);
  });

  it("derives pace from distance/duration when avgSpeed is missing", async () => {
    logsMock.mockResolvedValue([
      run({ avgSpeed: null }),
      run({ avgSpeed: null }),
      run({ avgSpeed: null }),
    ]); // 5000 m / (28*60 s) ≈ 2.98 m/s
    const ratio = await getRunPaceRatio("u1");
    expect(ratio).toBeGreaterThan(0.9);
    expect(ratio).toBeLessThan(1.05);
  });

  it("returns 1 when the history query fails", async () => {
    logsMock.mockRejectedValue(new Error("db down"));
    expect(await getRunPaceRatio("u1")).toBe(1);
  });
});
