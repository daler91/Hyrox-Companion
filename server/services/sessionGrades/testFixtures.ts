/**
 * Shared builders for session-grading tests: synthetic 1 Hz Strava streams
 * and ready-made 15 s bucket series. Kept in one place so the grader, segment
 * and service tests describe runs the same way (and SonarCloud's duplication
 * gate stays quiet).
 */
import type { SessionGrade } from "@shared/schema";
import type { SessionStreamSamples } from "@shared/schema/sessionStream";

import type { StravaStreamSet } from "./downsample";

/** One stretch of a run: how long, how fast, at what heart rate. */
export interface Stretch {
  seconds: number;
  /** Pace in seconds per km; omit for a stop (standing still). */
  paceSecPerKm?: number;
  /** HR at the start of the stretch; ramps linearly to `hrEnd` when given. */
  hr?: number;
  hrEnd?: number;
}

/** A 1 Hz stream built from stretches, as Strava's `/streams` would return it. */
export function streamFromStretches(stretches: readonly Stretch[], opts: { hr?: boolean } = {}): StravaStreamSet {
  const time: number[] = [];
  const heartrate: number[] = [];
  const velocity: number[] = [];
  const distance: number[] = [];
  const moving: boolean[] = [];
  let t = 0;
  let d = 0;
  for (const stretch of stretches) {
    const speed = stretch.paceSecPerKm ? 1000 / stretch.paceSecPerKm : 0;
    for (let i = 0; i < stretch.seconds; i++) {
      const hrStart = stretch.hr ?? 0;
      const hrEnd = stretch.hrEnd ?? hrStart;
      const hr = hrStart + ((hrEnd - hrStart) * i) / Math.max(1, stretch.seconds - 1);
      time.push(t);
      heartrate.push(Math.round(hr));
      velocity.push(speed);
      distance.push(d);
      moving.push(speed > 0);
      t += 1;
      d += speed;
    }
  }
  const set: StravaStreamSet = { time, velocity_smooth: velocity, distance, moving };
  if (opts.hr !== false) set.heartrate = heartrate;
  return set;
}

/** 15 s buckets straight from stretches, without going through a stream. */
export function bucketsFromStretches(
  stretches: readonly Stretch[],
  opts: { hr?: boolean; distance?: boolean } = {},
): SessionStreamSamples {
  const hr: (number | null)[] = [];
  const dist: number[] = [];
  const mov: number[] = [];
  for (const stretch of stretches) {
    const count = Math.round(stretch.seconds / 15);
    for (let i = 0; i < count; i++) {
      const hrStart = stretch.hr ?? null;
      const hrEnd = stretch.hrEnd ?? hrStart;
      const moving = stretch.paceSecPerKm ? 15 : 0;
      dist.push(stretch.paceSecPerKm ? Math.round((15 * 1000) / stretch.paceSecPerKm) : 0);
      mov.push(moving);
      if (opts.hr === false || hrStart === null || hrEnd === null) hr.push(null);
      else hr.push(Math.round(hrStart + ((hrEnd - hrStart) * i) / Math.max(1, count - 1)));
    }
  }
  const withDistance = opts.distance !== false;
  return {
    v: 1,
    bucketSeconds: 15,
    hr,
    dist: withDistance ? dist : dist.map(() => 0),
    mov,
    has: { hr: opts.hr !== false, distance: withDistance },
    elapsedSeconds: mov.length * 15,
    truncated: false,
  };
}

const MIN = 60;

/** The engine's threshold session: 15 min easy, 3 × 10 min work with 2 min jogs, 10 min easy. */
export function thresholdSession(work: { pace: number; hrStart: number; hrEnd: number; driftPerRep?: number }): Stretch[] {
  const drift = work.driftPerRep ?? 0;
  const rep = (n: number): Stretch => ({
    seconds: 10 * MIN,
    paceSecPerKm: work.pace,
    hr: work.hrStart + n * drift,
    hrEnd: work.hrEnd + n * drift,
  });
  const jog: Stretch = { seconds: 2 * MIN, paceSecPerKm: 390, hr: 140, hrEnd: 135 };
  return [
    { seconds: 15 * MIN, paceSecPerKm: 380, hr: 125, hrEnd: 138 },
    rep(0),
    jog,
    rep(1),
    jog,
    rep(2),
    { seconds: 10 * MIN, paceSecPerKm: 390, hr: 140, hrEnd: 130 },
  ];
}

/** An athlete whose Karvonen zones are round numbers: rest 50, max 190 (reserve 140). */
export const ATHLETE = { age: 35, restingHr: 50, maxHr: 190 } as const;
// Zone floors for ATHLETE: Z2 134, Z3 148, Z4 162, Z5 176.

/** A finished grade, for rollup/route/UI tests that do not care how it was reached. */
export function makeGrade(overrides: Partial<SessionGrade> = {}): SessionGrade {
  return {
    workoutLogId: "log-1",
    planDayId: `day-${overrides.workoutLogId ?? "1"}`,
    planId: "plan-1",
    date: "2026-09-22",
    weekNumber: 1,
    title: "Easy Run",
    intent: "easy",
    purpose: "easy",
    intentReason: "The plan day is titled for it",
    verdict: "on_target",
    headline: "Stayed easy",
    evidence: ["HR averaged 140 bpm, under your easy ceiling of 148 bpm."],
    confidence: "high",
    dataSource: "stream",
    streamStatus: "ok",
    ungradeableReason: null,
    targets: {
      easyCeilingHr: 148,
      thresholdHr: { min: 162, max: 176 },
      z5FloorHr: 176,
      hrBasis: "measured",
      easyPace: { fast: 360, slow: 400 },
      thresholdPace: null,
      paceSource: "plan",
    },
    easy: null,
    threshold: null,
    countsInRollup: true,
    ...overrides,
  };
}
