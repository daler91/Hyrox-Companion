import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { generateJsonText } from "../../ai/providers";
import { env } from "../../env";
import { getRuntimeCache, setRuntimeCache } from "../../sharedRuntimeState";
import { storage } from "../../storage";
import { checkAiBudget } from "../aiUsageService";
import { getPlannedSessionEstimate } from "./plannedSessionEstimate";
import { getRunPaceRatio } from "./runPace";

vi.mock("../../logger", () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));
vi.mock("../../ai/providers", () => ({ generateJsonText: vi.fn() }));
vi.mock("../../env", () => ({ env: { AI_FEATURES_ENABLED: "true" } }));
vi.mock("../../sharedRuntimeState", () => ({
  getRuntimeCache: vi.fn(() => Promise.resolve(undefined)),
  setRuntimeCache: vi.fn(() => Promise.resolve()),
  runtimeCacheKey: (scope: string, value: string) => `${scope}:${value}`,
}));
vi.mock("../aiUsageService", () => ({ checkAiBudget: vi.fn() }));
vi.mock("./runPace", () => ({ getRunPaceRatio: vi.fn() }));
vi.mock("../../storage", () => ({
  storage: {
    plans: { getPlanDay: vi.fn() },
    workouts: { getExerciseSetsByPlanDay: vi.fn(), getWorkoutStructureByPlanDay: vi.fn() },
    users: { getUser: vi.fn() },
  },
}));

const genMock = vi.mocked(generateJsonText);
const cacheGetMock = vi.mocked(getRuntimeCache);
const budgetMock = vi.mocked(checkAiBudget);
const paceMock = vi.mocked(getRunPaceRatio);
const getPlanDayMock = vi.mocked(storage.plans.getPlanDay);
const getSetsMock = vi.mocked(storage.workouts.getExerciseSetsByPlanDay);
const getStructureMock = vi.mocked(storage.workouts.getWorkoutStructureByPlanDay);
const getUserMock = vi.mocked(storage.users.getUser);

beforeEach(() => {
  getPlanDayMock.mockResolvedValue({ id: "pd-1", focus: "Recovery Run" } as never);
  // A distance-only 9000 m recovery run → deterministic base ≈ 54 min, RPE 2.
  getSetsMock.mockResolvedValue([{ exerciseName: "recovery_run", plannedDistance: 9000 }] as never);
  getStructureMock.mockResolvedValue([] as never);
  getUserMock.mockResolvedValue({ distanceUnit: "km" } as never);
  paceMock.mockResolvedValue(1);
  cacheGetMock.mockResolvedValue(undefined);
  budgetMock.mockResolvedValue({ allowed: true } as never);
  env.AI_FEATURES_ENABLED = "true";
});

afterEach(() => vi.clearAllMocks());

describe("getPlannedSessionEstimate", () => {
  it("returns null when the plan day is missing or unowned", async () => {
    getPlanDayMock.mockResolvedValue(undefined);
    expect(await getPlannedSessionEstimate("pd-x", "u1")).toBeNull();
  });

  it("returns the deterministic estimate when AI is disabled", async () => {
    env.AI_FEATURES_ENABLED = "false";
    const r = await getPlannedSessionEstimate("pd-1", "u1");
    expect(r?.durationMin).toBeGreaterThanOrEqual(50);
    expect(r?.durationMin).toBeLessThanOrEqual(58);
    expect(r?.rpe).toBe(2);
    expect(r?.refined).toBe(false);
    expect(genMock).not.toHaveBeenCalled();
  });

  it("falls back to the deterministic estimate when over budget", async () => {
    budgetMock.mockResolvedValue({ allowed: false } as never);
    const r = await getPlannedSessionEstimate("pd-1", "u1");
    expect(r?.refined).toBe(false);
    expect(genMock).not.toHaveBeenCalled();
  });

  it("grounds an out-of-band AI response to a band around the base", async () => {
    genMock.mockResolvedValue({
      text: JSON.stringify({ durationMin: 500, rpe: 10, rationale: "much longer" }),
    } as never);
    const r = await getPlannedSessionEstimate("pd-1", "u1");
    // base ~54 → duration capped at +20% (~65); RPE base 2 → capped at +2 (4)
    expect(r?.durationMin).toBeGreaterThan(54);
    expect(r?.durationMin).toBeLessThanOrEqual(66);
    expect(r?.rpe).toBe(4);
    expect(r?.refined).toBe(true);
    expect(r?.rationale).toBe("much longer");
  });

  it("uses an in-band AI response as-is", async () => {
    genMock.mockResolvedValue({ text: JSON.stringify({ durationMin: 58, rpe: 3 }) } as never);
    const r = await getPlannedSessionEstimate("pd-1", "u1");
    expect(r?.durationMin).toBe(58);
    expect(r?.rpe).toBe(3);
    expect(r?.refined).toBe(true);
  });

  it("degrades to the deterministic estimate on an AI parse error", async () => {
    genMock.mockResolvedValue({ text: "not json at all" } as never);
    const r = await getPlannedSessionEstimate("pd-1", "u1");
    expect(r?.refined).toBe(false);
    expect(r?.rpe).toBe(2);
  });

  it("returns a cached estimate without calling AI", async () => {
    cacheGetMock.mockResolvedValue({
      planDayId: "pd-1",
      durationMin: 99,
      rpe: 7,
      rationale: "cached",
      source: "sets",
      refined: true,
    });
    const r = await getPlannedSessionEstimate("pd-1", "u1");
    expect(r?.durationMin).toBe(99);
    expect(genMock).not.toHaveBeenCalled();
  });

  it("caches a freshly computed estimate", async () => {
    genMock.mockResolvedValue({ text: JSON.stringify({ durationMin: 56, rpe: 3 }) } as never);
    await getPlannedSessionEstimate("pd-1", "u1");
    expect(setRuntimeCache).toHaveBeenCalled();
  });
});
