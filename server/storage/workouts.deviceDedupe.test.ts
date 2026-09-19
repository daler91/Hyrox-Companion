import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../db", () => ({
  db: { select: vi.fn(), transaction: vi.fn() },
}));

import { db } from "../db";
import { WorkoutStorage } from "./workouts";

/**
 * The device sync's dedupe must count a workout sitting in the recycle bin as
 * already imported — otherwise Strava's 7-day overlap re-scan (and Garmin's
 * latest-N listing) would re-create the workout the athlete just deleted, and
 * restore would then collide with the copy.
 */
describe("WorkoutStorage device-activity dedupe is recycle-bin aware", () => {
  const storage = new WorkoutStorage();

  function mockSelectSequence(...results: unknown[][]) {
    const whereMock = vi.fn();
    for (const rows of results) whereMock.mockResolvedValueOnce(rows);
    const fromMock = vi.fn().mockReturnValue({ where: whereMock });
    vi.mocked(db.select).mockReturnValue({ from: fromMock } as never); // NOSONAR partial Drizzle query-builder mock
    return { whereMock };
  }

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns nothing without querying for an empty id list", async () => {
    expect(await storage.getExistingStravaActivityIds("u1", [])).toEqual([]);
    expect(await storage.getExistingGarminActivityIds("u1", [])).toEqual([]);
    expect(db.select).not.toHaveBeenCalled();
  });

  it("unions live workout ids with non-expired recycle-bin ids (Strava)", async () => {
    const { whereMock } = mockSelectSequence(
      [{ activityId: "live-1" }], // workout_logs
      [{ activityId: "binned-1" }, { activityId: "live-1" }], // recycle_bin_items (expiry filter is in the SQL)
    );

    const result = await storage.getExistingStravaActivityIds("u1", [
      "live-1",
      "binned-1",
      "fresh-1",
    ]);

    expect(result.sort()).toEqual(["binned-1", "live-1"]);
    expect(whereMock).toHaveBeenCalledTimes(2);
  });

  it("unions live workout ids with non-expired recycle-bin ids (Garmin)", async () => {
    mockSelectSequence([], [{ activityId: "binned-9" }]);
    expect(await storage.getExistingGarminActivityIds("u1", ["binned-9", "fresh-9"])).toEqual([
      "binned-9",
    ]);
  });

  it("drops null activity ids defensively", async () => {
    mockSelectSequence([{ activityId: null }], [{ activityId: null }]);
    expect(await storage.getExistingStravaActivityIds("u1", ["x"])).toEqual([]);
  });
});
