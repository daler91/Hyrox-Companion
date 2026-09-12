/**
 * Stopped time: the gap `workout_logs.duration` deliberately drops.
 *
 * The numbers here are real activities from a linked Strava account, because
 * the shape of this data is the whole argument for the duration column being
 * moving time: outdoor runs carry a gap, and non-GPS sports never do.
 */

import { describe, expect, it } from "vitest";

import {
  type DeviceActivitySnapshot,
  stoppedSecondsFor,
  type StravaActivitySummary,
} from "./deviceActivity";

function snapshot(raw: Partial<StravaActivitySummary>): DeviceActivitySnapshot {
  return {
    provider: "strava",
    raw: { moving_time: 0, elapsed_time: 0, ...raw } as StravaActivitySummary,
    filledColumns: [],
    linkedAt: "2026-09-12T00:00:00.000Z",
  };
}

describe("stoppedSecondsFor", () => {
  it("reports the stop on a run whose clocks disagree", () => {
    // A real 16.1 km run: 98m 42s moving, 2h 09m elapsed — half an hour stood
    // still. This is the case the duration tile would otherwise hide.
    expect(stoppedSecondsFor(snapshot({ moving_time: 5922, elapsed_time: 7738 }))).toBe(1816);
  });

  it("reports no stop for a sport the provider times with one clock", () => {
    // Real weight-training row. Without GPS there is nothing to call "moving",
    // so Strava sets both fields equal — which is exactly why switching
    // duration to elapsed would do nothing for gym work.
    expect(stoppedSecondsFor(snapshot({ moving_time: 926, elapsed_time: 926 }))).toBe(0);
  });

  it("reports the small gaps too, leaving the judgement to the display", () => {
    // 1 second on a real lunch run. The helper does not editorialise; the
    // summary header is what decides a stop is too small to mention.
    expect(stoppedSecondsFor(snapshot({ moving_time: 1266, elapsed_time: 1267 }))).toBe(1);
  });

  it("returns null when there is no snapshot to read", () => {
    expect(stoppedSecondsFor(null)).toBeNull();
    expect(stoppedSecondsFor(undefined)).toBeNull();
  });

  it("returns null rather than NaN for a malformed snapshot", () => {
    // NaN fails every comparison, so an unguarded subtraction would put NaN on
    // the entry and "NaN stopped" in front of the athlete.
    expect(stoppedSecondsFor(snapshot({ moving_time: Number.NaN, elapsed_time: 900 }))).toBeNull();
    expect(stoppedSecondsFor(snapshot({ moving_time: 900, elapsed_time: Number.NaN }))).toBeNull();
  });

  it("never reports a negative stop", () => {
    // A moving time above elapsed describes something this cannot interpret.
    expect(stoppedSecondsFor(snapshot({ moving_time: 900, elapsed_time: 600 }))).toBe(0);
  });

  it("reports whole seconds", () => {
    expect(stoppedSecondsFor(snapshot({ moving_time: 100.4, elapsed_time: 900.9 }))).toBe(801);
  });
});
