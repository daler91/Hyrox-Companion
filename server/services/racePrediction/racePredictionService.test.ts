import { getRaceReference, RACE_SEGMENTS } from "@shared/raceSpec";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { MIN_PERSONAL_FRACTION } from "./featureBuilder";
import { generateRacePrediction } from "./racePredictionService";

const envState = vi.hoisted(() => ({ AI_FEATURES_ENABLED: "true" }));

vi.mock("../../env", () => ({ env: envState }));
vi.mock("../../logger", () => ({
  logger: { warn: vi.fn(), error: vi.fn(), info: vi.fn() },
}));
vi.mock("../../storage", () => ({
  storage: {
    users: { getUser: vi.fn() },
    analytics: {
      getAllExerciseSetsWithDates: vi.fn(),
      getWorkoutLogsByDateRange: vi.fn(),
      getExerciseLoadTags: vi.fn(),
    },
  },
}));
vi.mock("../../ai/providers", () => ({ generateJsonText: vi.fn() }));
vi.mock("../aiUsageService", () => ({ checkAiBudget: vi.fn() }));

import { generateJsonText } from "../../ai/providers";
import { storage } from "../../storage";
import { checkAiBudget } from "../aiUsageService";
import { computeRaceReadiness } from "./racePredictionService";

const getUser = vi.mocked(storage.users.getUser);
const getSets = vi.mocked(storage.analytics.getAllExerciseSetsWithDates);
const getWorkoutLogs = vi.mocked(storage.analytics.getWorkoutLogsByDateRange);
const getLoadTags = vi.mocked(storage.analytics.getExerciseLoadTags);
const mockGenerate = vi.mocked(generateJsonText);
const mockBudget = vi.mocked(checkAiBudget);

function isoDaysAgo(n: number): string {
  return new Date(Date.now() - n * 24 * 60 * 60 * 1000).toISOString().split("T")[0];
}

/** `count` steady daily cardio logs ending today — yields a stable TSB ≈ 0. */
function steadyWorkoutLogs(count: number) {
  return Array.from({ length: count }, (_, i) => ({
    id: `wl-${i}`,
    userId: "u1",
    date: isoDaysAgo(i),
    duration: 60,
    focus: "Run",
    mainWorkout: "Steady run",
  }));
}

function mockUser(overrides: Record<string, unknown> = {}) {
  getUser.mockResolvedValue({
    id: "u1",
    aiCoachEnabled: true,
    division: "open",
    gender: "male",
    weightUnit: "kg",
    ...overrides,
  });
}

function validAiPayload(totalFinishSeconds = 3500): string {
  return JSON.stringify({
    segments: RACE_SEGMENTS.map((s) => ({
      index: s.index,
      estimatedSeconds: 200,
      confidence: "medium",
      basis: "logged",
    })),
    totalFinishSeconds,
    overallConfidence: "medium",
    narrative: "Steady pacing — hold back early & finish strong.",
  });
}

// Wall balls is the final station (segment index 16).
function aiPayloadWithWallBalls(wallBallsSeconds: number): string {
  return JSON.stringify({
    segments: RACE_SEGMENTS.map((s) => ({
      index: s.index,
      estimatedSeconds: s.index === 16 ? wallBallsSeconds : 200,
      confidence: "medium",
      basis: "benchmark",
    })),
    totalFinishSeconds: 4000,
    overallConfidence: "medium",
    narrative: "ok",
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  envState.AI_FEATURES_ENABLED = "true";
  getSets.mockResolvedValue([]);
  getWorkoutLogs.mockResolvedValue([]);
  getLoadTags.mockResolvedValue([]);
  mockBudget.mockResolvedValue({ allowed: true });
});

describe("generateRacePrediction — graceful degradation", () => {
  it("returns the deterministic baseline (no AI call) when consent is off", async () => {
    mockUser({ aiCoachEnabled: false });

    const result = await generateRacePrediction("u1");

    expect(mockGenerate).not.toHaveBeenCalled();
    expect(result.aiUsed).toBe(false);
    expect(result.aiUnavailableReason).toBe("ai_consent_off");
    expect(result.narrative).toBeNull();
    expect(result.segments).toHaveLength(16);
  });

  it("returns ai_disabled when the kill switch is off", async () => {
    envState.AI_FEATURES_ENABLED = "false";
    mockUser();

    const result = await generateRacePrediction("u1");

    expect(mockGenerate).not.toHaveBeenCalled();
    expect(result.aiUnavailableReason).toBe("ai_disabled");
    expect(result.aiUsed).toBe(false);
  });

  it("returns ai_budget_exceeded when over budget", async () => {
    mockUser();
    mockBudget.mockResolvedValue({ allowed: false });

    const result = await generateRacePrediction("u1");

    expect(mockGenerate).not.toHaveBeenCalled();
    expect(result.aiUnavailableReason).toBe("ai_budget_exceeded");
  });

  it("propagates the stored gender and genderAssumed flag", async () => {
    mockUser({ gender: null });

    const result = await generateRacePrediction("u1");

    expect(result.gender).toBeNull();
    expect(result.genderAssumed).toBe(true);
  });
});

describe("generateRacePrediction — AI path", () => {
  it("uses the AI estimate when consent + budget allow", async () => {
    mockUser();
    mockGenerate.mockResolvedValue({ text: validAiPayload(3500) });

    const result = await generateRacePrediction("u1");

    expect(mockGenerate).toHaveBeenCalledOnce();
    const callArg = mockGenerate.mock.calls[0][0];
    expect(callArg.feature).toBe("race-predictor");
    expect(callArg.modelRole).toBe("reasoning");
    expect(result.aiUsed).toBe(true);
    expect(result.aiUnavailableReason).toBeNull();
    expect(result.narrative).toContain("Steady pacing");
    expect(result.segments).toHaveLength(16);
    // 16 segments * 200s = 3200 sum; total clamped to [sum, sum*1.4].
    expect(result.totalFinishSeconds).toBeGreaterThanOrEqual(3200);
    expect(result.totalFinishSeconds).toBeLessThanOrEqual(Math.round(3200 * 1.4));
  });

  it("never lets the headline drop below the sum of segment splits", async () => {
    mockUser();
    mockGenerate.mockResolvedValue({ text: validAiPayload(100) }); // absurdly low

    const result = await generateRacePrediction("u1");
    const segmentSum = result.segments.reduce((t, s) => t + s.estimatedSeconds, 0);
    expect(result.totalFinishSeconds).toBeGreaterThanOrEqual(segmentSum);
  });

  it("falls back to deterministic on invalid AI JSON", async () => {
    mockUser();
    mockGenerate.mockResolvedValue({ text: "not json" });

    const result = await generateRacePrediction("u1");

    expect(result.aiUsed).toBe(false);
    expect(result.aiUnavailableReason).toBe("ai_error");
    expect(result.segments).toHaveLength(16);
  });

  it("falls back to deterministic when the AI call throws", async () => {
    mockUser();
    mockGenerate.mockRejectedValue(new Error("provider down"));

    const result = await generateRacePrediction("u1");

    expect(result.aiUsed).toBe(false);
    expect(result.aiUnavailableReason).toBe("ai_error");
  });

  it("falls back when AI output fails schema validation", async () => {
    mockUser();
    mockGenerate.mockResolvedValue({
      text: JSON.stringify({ segments: [{ index: 1 }], totalFinishSeconds: -5 }),
    });

    const result = await generateRacePrediction("u1");

    expect(result.aiUsed).toBe(false);
    expect(result.aiUnavailableReason).toBe("ai_error");
  });
});

describe("generateRacePrediction — transition & ranking", () => {
  it("includes a transition allowance that reconciles the headline with the breakdown", async () => {
    mockUser();
    mockGenerate.mockResolvedValue({ text: validAiPayload(3500) });

    const result = await generateRacePrediction("u1");

    expect(result.transitionSeconds).toBeGreaterThan(0);
    const segmentSum = result.segments.reduce((t, s) => t + s.estimatedSeconds, 0);
    expect(result.totalFinishSeconds).toBe(segmentSum + result.transitionSeconds);

    expect(result.percentile).not.toBeNull();
    expect(result.percentile!.fasterThanPct).toBeGreaterThanOrEqual(1);
    expect(result.percentile!.fasterThanPct).toBeLessThanOrEqual(99);
    expect(result.percentile!.cohortLabel).toContain("Open Men");
  });

  it("omits the percentile (and assumes age) when gender is withheld", async () => {
    mockUser({ gender: null });
    mockGenerate.mockRejectedValue(new Error("no ai"));

    const result = await generateRacePrediction("u1");

    expect(result.percentile).toBeNull();
    expect(result.ageGroupAssumed).toBe(true);
    expect(result.transitionSeconds).toBeGreaterThan(0);
  });

  it("ranks against the athlete's age-group cohort when MAF age is set", async () => {
    mockUser({ mafAge: 32 });
    mockGenerate.mockResolvedValue({ text: validAiPayload(3500) });

    const result = await generateRacePrediction("u1");

    expect(result.ageGroup).toBe("30-34");
    expect(result.ageGroupAssumed).toBe(false);
    expect(result.percentile?.basis).toBe("age_group");
    expect(result.percentile?.cohortLabel).toContain("30-34");
  });

  it("derives the cohort from the general age field for non-MAF athletes (W17)", async () => {
    mockUser({ age: 40, mafAge: null });
    mockGenerate.mockResolvedValue({ text: validAiPayload(3500) });

    const result = await generateRacePrediction("u1");

    expect(result.ageGroup).toBe("40-44");
    expect(result.ageGroupAssumed).toBe(false);
  });

  it("prefers the general age field over MAF age (W17)", async () => {
    mockUser({ age: 40, mafAge: 32 });
    mockGenerate.mockResolvedValue({ text: validAiPayload(3500) });

    const result = await generateRacePrediction("u1");

    expect(result.ageGroup).toBe("40-44");
  });
});

describe("generateRacePrediction — AI clamp guardrail", () => {
  it("clamps an implausibly fast AI split up to the cohort-relative floor, not 2:30", async () => {
    mockUser(); // open male, no logged data → wall balls uses the cohort benchmark
    const benchmark = getRaceReference("open", "male").stations.wall_balls.benchmarkSeconds;
    const expectedFloor = Math.max(150, Math.round(MIN_PERSONAL_FRACTION * benchmark));
    mockGenerate.mockResolvedValue({ text: aiPayloadWithWallBalls(60) }); // absurd 1:00

    const result = await generateRacePrediction("u1");

    const wallBalls = result.segments.find((s) => s.index === 16)!;
    expect(wallBalls.estimatedSeconds).toBe(expectedFloor);
    expect(wallBalls.estimatedSeconds).toBeGreaterThan(150); // not the world-class floor
  });

  it("passes a plausible AI split through unchanged", async () => {
    mockUser();
    mockGenerate.mockResolvedValue({ text: aiPayloadWithWallBalls(350) });

    const result = await generateRacePrediction("u1");

    expect(result.segments.find((s) => s.index === 16)!.estimatedSeconds).toBe(350);
  });
});

describe("computeRaceReadiness", () => {
  it("returns insufficient_data with null TSB when form is unknown", () => {
    const r = computeRaceReadiness(null);
    expect(r.status).toBe("insufficient_data");
    expect(r.tsb).toBeNull();
    expect(r.guidance).toBeTruthy();
  });

  it("classifies TSB into taper bands and rounds the value", () => {
    expect(computeRaceReadiness(20).status).toBe("peaked");
    expect(computeRaceReadiness(10).status).toBe("fresh");
    expect(computeRaceReadiness(0).status).toBe("neutral");
    expect(computeRaceReadiness(-5).status).toBe("neutral");
    expect(computeRaceReadiness(-18).status).toBe("fatigued");
    expect(computeRaceReadiness(-40).status).toBe("very_fatigued");
    // Boundaries (>= thresholds) and rounding.
    expect(computeRaceReadiness(5).status).toBe("fresh");
    expect(computeRaceReadiness(15).status).toBe("peaked");
    expect(computeRaceReadiness(-10).status).toBe("neutral");
    expect(computeRaceReadiness(-25).status).toBe("fatigued");
    expect(computeRaceReadiness(12.6).tsb).toBe(13);
  });
});

describe("generateRacePrediction — race readiness (Form)", () => {
  it("reports insufficient_data readiness when there is no recent training load", async () => {
    mockUser();
    mockGenerate.mockResolvedValue({ text: validAiPayload(3500) });

    const result = await generateRacePrediction("u1");

    expect(result.raceReadiness).toBeDefined();
    expect(result.raceReadiness?.status).toBe("insufficient_data");
    expect(result.raceReadiness?.tsb).toBeNull();
  });

  it("derives readiness from recent training load (steady block ⇒ race-ready/neutral)", async () => {
    mockUser();
    getWorkoutLogs.mockResolvedValue(steadyWorkoutLogs(21));
    mockGenerate.mockResolvedValue({ text: validAiPayload(3500) });

    const result = await generateRacePrediction("u1");

    expect(result.raceReadiness?.status).toBe("neutral");
    expect(result.raceReadiness?.tsb).toBe(0);
  });

  it("still includes readiness on the deterministic (AI-off) path", async () => {
    mockUser({ aiCoachEnabled: false });
    getWorkoutLogs.mockResolvedValue(steadyWorkoutLogs(21));

    const result = await generateRacePrediction("u1");

    expect(result.aiUsed).toBe(false);
    expect(result.raceReadiness?.status).toBe("neutral");
  });
});
