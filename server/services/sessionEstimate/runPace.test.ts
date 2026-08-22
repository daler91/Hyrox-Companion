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

  it("keeps a beginner's runs instead of discarding them (audit M4)", async () => {
    // 1.754 m/s ≈ 9:30/km. The plausibility floor was 1.8 m/s (9:15/km), so
    // every one of these was dropped, the athlete never reached MIN_SAMPLES,
    // and they were pinned to the generic 5:45/km — with more logging making no
    // difference, because the new runs were filtered out too.
    const beginner = Array.from({ length: 3 }, () => run({ avgSpeed: 1.754 }));
    logsMock.mockResolvedValue(beginner);
    expect(await getRunPaceRatio("u1")).not.toBe(1);
  });

  it("lets a well-evidenced slow runner past the generic band", async () => {
    // Three runs stay grounded to the generic band...
    logsMock.mockResolvedValue(Array.from({ length: 3 }, () => run({ avgSpeed: 1.754 })));
    expect(await getRunPaceRatio("u1")).toBe(1.25);

    // ...but eight say something real about how this athlete runs.
    logsMock.mockResolvedValue(Array.from({ length: 8 }, () => run({ avgSpeed: 1.754 })));
    const evidenced = await getRunPaceRatio("u1");
    expect(evidenced).toBeGreaterThan(1.25);
    expect(evidenced).toBeLessThanOrEqual(2.2);
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
