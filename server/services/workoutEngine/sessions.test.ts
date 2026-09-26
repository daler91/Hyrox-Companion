import { describe, expect, it } from "vitest";

import type { RunPaceZones } from "./running";
import { describePaceZones, describeSession, type SessionContext } from "./sessions";
import type { SkeletonSession } from "./weekSkeleton";

const ZONES: RunPaceZones = {
  vdot: 50,
  basis: { date: "2026-09-06", meters: 5000, seconds: 1200 },
  easy: { fast: 306, slow: 338 },
  steady: 271,
  threshold: 255,
  interval: 235,
  repetition: 220,
};

function session(kind: SkeletonSession["kind"], day = "Tuesday"): SkeletonSession {
  return { day: day as SkeletonSession["day"], kind, label: kind, lifts: [], runFinisher: false, priority: "key" };
}

function ctx(overrides: Partial<SessionContext> = {}): SessionContext {
  return {
    lens: "running",
    phase: "build",
    deload: false,
    paces: ZONES,
    volume: { week: 5, phase: "build", deload: false, weeklyKm: 40, longRunKm: 14 },
    distanceUnit: "km",
    weekSessions: [
      session("threshold_run", "Tuesday"),
      session("easy_run", "Wednesday"),
      session("easy_run", "Friday"),
      session("long_run", "Sunday"),
    ],
    ...overrides,
  };
}

describe("describePaceZones", () => {
  it("lists every zone in the athlete's unit, fast end of the easy range first", () => {
    expect(describePaceZones(ZONES, "km")).toBe(
      "easy 5:06-5:38/km · steady 4:31/km · threshold 4:15/km · intervals 3:55/km · reps 3:40/km",
    );
    expect(describePaceZones(ZONES, "miles")).toContain("threshold 6:50/mi");
  });
});

describe("describeSession", () => {
  it("writes a threshold run at the athlete's threshold pace", () => {
    expect(describeSession("threshold_run", ctx())).toBe(
      "15 min easy, 3 x 10 min @ 4:15/km with 2 min jog, 10 min easy (~10 km)",
    );
  });

  it("falls back to effort when there are no paces", () => {
    expect(describeSession("threshold_run", ctx({ paces: null }))).toContain(
      "@ threshold effort (RPE 7-8, comfortably hard)",
    );
    expect(describeSession("easy_run", ctx({ paces: null }))).toContain("conversational");
  });

  it("halves a quality session's reps in a deload week", () => {
    expect(describeSession("threshold_run", ctx({ deload: true }))).toContain("2 x 10 min");
  });

  it("splits what the long run and quality work leave between the easy runs", () => {
    // 40 km - 14 km long - ~10 km threshold = ~16 km over two easy runs.
    expect(describeSession("easy_run", ctx())).toBe("8 km easy @ 5:06-5:38/km");
  });

  it("gives the long run its week's distance and a steady finish in a running peak", () => {
    expect(describeSession("long_run", ctx())).toBe("14 km easy @ 5:06-5:38/km");
    expect(describeSession("long_run", ctx({ phase: "peak" }))).toContain("last 15 min @ 4:31/km");
  });

  it("rehearses the race in HYROX intervals and simulations", () => {
    const hyrox = ctx({ lens: "hyrox", phase: "peak" });
    expect(describeSession("interval_run", hyrox)).toContain("8 x 1000 m @ 4:31/km");
    expect(describeSession("simulation", hyrox)).toMatch(/^half simulation/);
    expect(describeSession("simulation", { ...hyrox, fullSimulation: true })).toMatch(
      /^FULL race simulation/,
    );
  });

  it("leaves strength sessions to the lift targets", () => {
    expect(describeSession("strength", ctx())).toBeNull();
  });
});
