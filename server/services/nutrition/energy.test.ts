import { beforeEach, describe, expect, it, vi } from "vitest";

import { storage } from "../../storage";
import { resolveDayEnergy } from "./energy";

vi.mock("../../storage", () => ({
  storage: {
    users: { getUser: vi.fn() },
    analytics: { getWorkoutLogsByDateRange: vi.fn() },
  },
}));

// Male 75kg / 180cm / 30y → BMR 1730 (see shared/energyBalance.test.ts).
function makeUser(overrides: Record<string, unknown> = {}) {
  return {
    bodyweightKg: 75,
    heightCm: 180,
    age: 30,
    gender: "male",
    activityLevel: "moderate",
    ...overrides,
  } as never;
}

describe("resolveDayEnergy", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(storage.users.getUser).mockResolvedValue(makeUser());
    vi.mocked(storage.analytics.getWorkoutLogsByDateRange).mockResolvedValue([]);
  });

  it("sums the day's measured workout calories and uses the measured path", async () => {
    vi.mocked(storage.analytics.getWorkoutLogsByDateRange).mockResolvedValue([
      { calories: 400 },
      { calories: 250 },
      { calories: null },
    ] as never);

    const out = await resolveDayEnergy("u1", "2026-06-11", 2500);

    expect(storage.analytics.getWorkoutLogsByDateRange).toHaveBeenCalledWith(
      "u1",
      "2026-06-11",
      "2026-06-11",
    );
    expect(out).toMatchObject({ basis: "measured", activeKcal: 650, inKcal: 2500 });
  });

  it("falls back to the static estimate when no workout carries calories", async () => {
    vi.mocked(storage.analytics.getWorkoutLogsByDateRange).mockResolvedValue([
      { calories: 0 },
      { calories: null },
    ] as never);

    const out = await resolveDayEnergy("u1", "2026-06-11", 2000);

    expect(out?.basis).toBe("estimated");
  });

  it("returns null when the user is missing or lacks BMR inputs", async () => {
    vi.mocked(storage.users.getUser).mockResolvedValue(undefined);
    expect(await resolveDayEnergy("u1", "2026-06-11", 2000)).toBeNull();

    vi.mocked(storage.users.getUser).mockResolvedValue(makeUser({ heightCm: null }));
    expect(await resolveDayEnergy("u1", "2026-06-11", 2000)).toBeNull();
  });

  it("ignores an unknown activity level rather than crashing the multiplier", async () => {
    vi.mocked(storage.users.getUser).mockResolvedValue(makeUser({ activityLevel: "bogus" }));

    const out = await resolveDayEnergy("u1", "2026-06-11", 2000);

    expect(out?.basis).toBe("estimated");
    expect(out?.reasonCodes).toContain("assumed_moderate_activity");
  });
});
