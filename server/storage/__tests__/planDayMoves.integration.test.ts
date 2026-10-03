import { planDayMoves, planDays, trainingPlans } from "@shared/schema";
import { asc, eq } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it } from "vitest";

import { db } from "../../db";
import { storage } from "../index";
import { PLAN_DAY_MOVE_MERGE_MS } from "../planDayMoves";
import { resetIntegrationDb, seedUser } from "./integrationDb";

/**
 * The athlete's own plan-day moves (plan_day_moves) against the REAL schema:
 * a quick correction merges into the move it corrects, the record reads each
 * session's current name newest first, and old or deleted days' moves go.
 */
describe("plan day moves (real Postgres)", () => {
  const ATHLETE = "moves-athlete";
  const OTHER = "moves-other";
  const NOW = new Date("2026-10-02T10:00:00.000Z");
  const later = (ms: number) => new Date(NOW.getTime() + ms);

  beforeEach(async () => {
    await resetIntegrationDb();
    await seedUser(ATHLETE);
    await seedUser(OTHER);
  });

  afterAll(async () => {
    await resetIntegrationDb();
  });

  async function seedDay(userId: string, id: string, focus: string) {
    const [plan] = await db
      .insert(trainingPlans)
      .values({ userId, name: `${id} plan`, totalWeeks: 6, startDate: "2026-08-31", endDate: null })
      .returning();
    await db
      .insert(planDays)
      .values({ id, planId: plan.id, weekNumber: 6, dayName: "Monday", focus, mainWorkout: "x", scheduledDate: "2026-10-05" });
    return id;
  }

  const moveOf = (planDayId: string, fromDate: string, toDate: string, kind: "moved" | "folded" = "moved") => ({
    userId: ATHLETE,
    planDayId,
    fromDate,
    toDate,
    kind,
  });

  async function rows() {
    return await db
      .select({ fromDate: planDayMoves.fromDate, toDate: planDayMoves.toDate, kind: planDayMoves.kind })
      .from(planDayMoves)
      .orderBy(asc(planDayMoves.movedAt));
  }

  it("lists the athlete's moves newest first under each session's current name, and no one else's", async () => {
    const longRun = await seedDay(ATHLETE, "moves-long", "Long Run");
    const tempo = await seedDay(ATHLETE, "moves-tempo", "Tempo Run");
    const theirs = await seedDay(OTHER, "moves-theirs", "Their Run");
    await storage.planDayMoves.record(moveOf(longRun, "2026-10-05", "2026-10-04"), NOW);
    await storage.planDayMoves.record(moveOf(tempo, "2026-10-01", "2026-10-06", "folded"), later(PLAN_DAY_MOVE_MERGE_MS * 2));
    await storage.planDayMoves.record({ ...moveOf(theirs, "2026-10-05", "2026-10-07"), userId: OTHER }, NOW);
    await db.update(planDays).set({ focus: "Long Run (easy)" }).where(eq(planDays.id, longRun));

    const recent = await storage.planDayMoves.listRecent(ATHLETE, later(-60_000), 10);

    expect(recent).toEqual([
      { planDayId: tempo, focus: "Tempo Run", fromDate: "2026-10-01", toDate: "2026-10-06", kind: "folded", movedAt: later(PLAN_DAY_MOVE_MERGE_MS * 2) },
      { planDayId: longRun, focus: "Long Run (easy)", fromDate: "2026-10-05", toDate: "2026-10-04", kind: "moved", movedAt: NOW },
    ]);
    expect(await storage.planDayMoves.listRecent(ATHLETE, later(1), 10)).toHaveLength(1);
  });

  it("merges a drag corrected within minutes into the move it corrects, and drops one put straight back", async () => {
    const day = await seedDay(ATHLETE, "moves-drag", "Intervals");

    await storage.planDayMoves.record(moveOf(day, "2026-10-05", "2026-10-07"), NOW);
    await storage.planDayMoves.record(moveOf(day, "2026-10-07", "2026-10-06"), later(60_000));
    expect(await rows()).toEqual([{ fromDate: "2026-10-05", toDate: "2026-10-06", kind: "moved" }]);

    await storage.planDayMoves.record(moveOf(day, "2026-10-06", "2026-10-05"), later(120_000));
    expect(await rows()).toEqual([]);
  });

  it("keeps separate moves once the window has passed, and never merges a missed-session reschedule", async () => {
    const day = await seedDay(ATHLETE, "moves-separate", "Bike");

    await storage.planDayMoves.record(moveOf(day, "2026-10-05", "2026-10-07"), NOW);
    await storage.planDayMoves.record(moveOf(day, "2026-10-07", "2026-10-06"), later(PLAN_DAY_MOVE_MERGE_MS + 1));
    await storage.planDayMoves.record(moveOf(day, "2026-10-06", "2026-10-08", "folded"), later(PLAN_DAY_MOVE_MERGE_MS + 2));
    await storage.planDayMoves.record(moveOf(day, "2026-10-08", "2026-10-09"), later(PLAN_DAY_MOVE_MERGE_MS + 3));

    expect(await rows()).toEqual([
      { fromDate: "2026-10-05", toDate: "2026-10-07", kind: "moved" },
      { fromDate: "2026-10-07", toDate: "2026-10-06", kind: "moved" },
      { fromDate: "2026-10-06", toDate: "2026-10-08", kind: "folded" },
      { fromDate: "2026-10-08", toDate: "2026-10-09", kind: "moved" },
    ]);
  });

  it("prunes moves made before the cutoff, and a deleted session's moves go with it", async () => {
    const kept = await seedDay(ATHLETE, "moves-kept", "Row");
    const deleted = await seedDay(ATHLETE, "moves-deleted", "Ski");
    await storage.planDayMoves.record(moveOf(kept, "2026-10-05", "2026-10-06"), new Date("2026-08-01T10:00:00.000Z"));
    await storage.planDayMoves.record(moveOf(kept, "2026-10-06", "2026-10-07"), NOW);
    await storage.planDayMoves.record(moveOf(deleted, "2026-10-05", "2026-10-03"), NOW);

    expect(await storage.planDayMoves.deleteBefore(new Date("2026-09-02T00:00:00.000Z"))).toBe(1);
    await db.delete(planDays).where(eq(planDays.id, deleted));

    expect(await rows()).toEqual([{ fromDate: "2026-10-06", toDate: "2026-10-07", kind: "moved" }]);
  });

  it("refuses a move to the same day", async () => {
    const day = await seedDay(ATHLETE, "moves-same", "Swim");

    await expect(storage.planDayMoves.record(moveOf(day, "2026-10-05", "2026-10-05"), NOW)).rejects.toThrow();
  });
});
