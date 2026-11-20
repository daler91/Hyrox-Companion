import { afterAll, beforeEach, describe, expect, it } from "vitest";

import { storage } from "../index";
import { resetIntegrationDb, seedUser, seedWorkoutLog } from "./integrationDb";

/**
 * Tech debt #45: listWorkoutLogs ordered by date alone, so among logs on the
 * same day the order was whatever Postgres returned: `GET /workouts/latest`
 * could name either session, and a page boundary could repeat one and skip
 * another. It now breaks ties the way the timeline does: start time, then id.
 */
describe("listWorkoutLogs ordering (real Postgres)", () => {
  const USER = "workout-list-order";

  beforeEach(async () => {
    await resetIntegrationDb();
    await seedUser(USER);
  });

  afterAll(async () => {
    await resetIntegrationDb();
  });

  it("orders same-day logs by start time, then id, newest first", async () => {
    const morning = await seedWorkoutLog(USER, "2026-11-10", {
      id: "b-morning",
      startedAt: new Date("2026-11-10T07:00:00Z"),
    });
    const evening = await seedWorkoutLog(USER, "2026-11-10", {
      id: "a-evening",
      startedAt: new Date("2026-11-10T19:00:00Z"),
    });
    const earlierDay = await seedWorkoutLog(USER, "2026-11-09", { id: "z-earlier-day" });

    const ids = (await storage.workouts.listWorkoutLogs(USER)).map((log) => log.id);

    expect(ids).toEqual([evening.id, morning.id, earlierDay.id]);
  });

  it("pages through same-day logs without repeating or skipping one", async () => {
    for (const id of ["log-c", "log-a", "log-d", "log-b"]) {
      await seedWorkoutLog(USER, "2026-11-10", { id });
    }

    const pages = [];
    for (let offset = 0; offset < 4; offset++) {
      const [log] = await storage.workouts.listWorkoutLogs(USER, 1, offset);
      pages.push(log?.id);
    }

    expect(pages).toEqual(["log-d", "log-c", "log-b", "log-a"]);
  });
});
