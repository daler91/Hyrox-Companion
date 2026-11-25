import { addDaysToISODate } from "@shared/dateUtils";
import { planDays, trainingPlans, users } from "@shared/schema";
import { eq } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it } from "vitest";

import { db } from "../../db";
import { getLocalDateStrSafe } from "../../timezone";
import { storage } from "../index";
import { PlanStorage } from "../plans";
import { resetIntegrationDb, seedExerciseSet, seedUser, seedWorkoutLog } from "./integrationDb";

/**
 * The two reads behind "the plan follows a session that never happened",
 * against the REAL schema: which plan days the workout engine is told were not
 * done (getPlanDaysForMissAdaptation), and which athletes the coach looks at
 * again after the nightly sweep (takeAthletesToCoachAfterMiss).
 */
describe("missed-session adaptation reads (real Postgres)", () => {
  const USER = "miss-user";

  async function seedPlan(userId = USER) {
    const [plan] = await db
      .insert(trainingPlans)
      .values({ userId, name: "Block", totalWeeks: 8 })
      .returning();
    return plan;
  }

  async function seedDay(
    planId: string,
    scheduledDate: string,
    overrides: Partial<typeof planDays.$inferInsert> = {},
  ) {
    const [day] = await db
      .insert(planDays)
      .values({
        planId,
        weekNumber: 1,
        dayName: "Monday",
        focus: "Lower Strength",
        mainWorkout: "A) Back Squat 5x5 @ 100 kg",
        status: "planned",
        scheduledDate,
        ...overrides,
      })
      .returning();
    return day;
  }

  beforeEach(async () => {
    await resetIntegrationDb();
    await seedUser(USER);
  });

  afterAll(async () => {
    await resetIntegrationDb();
  });

  describe("getPlanDaysForMissAdaptation", () => {
    const TODAY = "2026-10-14";
    const window = { from: "2026-09-30", today: TODAY, until: "2026-11-04", alsoIds: [] };

    it("returns the sessions that are not happening on their day, with their sets", async () => {
      const plan = await seedPlan();
      const missed = await seedDay(plan.id, "2026-10-09", { status: "missed" });
      const skippedPast = await seedDay(plan.id, "2026-10-10", { status: "skipped" });
      // The sweep has not reached it: still planned, its date gone.
      const unswept = await seedDay(plan.id, "2026-10-13");
      // Skipped in advance: the sessions after it are held too.
      const skippedAhead = await seedDay(plan.id, "2026-10-20", { status: "skipped" });
      await seedExerciseSet({
        planDayId: missed.id,
        exerciseName: "back_squat",
        category: "strength",
        setNumber: 1,
        reps: 5,
        weight: 100,
        sortOrder: 0,
      });

      // Sessions still: today's and a later one, and one that was done.
      await seedDay(plan.id, TODAY);
      await seedDay(plan.id, "2026-10-16");
      await seedDay(plan.id, "2026-10-08", { status: "completed" });
      // Outside the window either side.
      await seedDay(plan.id, "2026-09-29", { status: "missed" });
      await seedDay(plan.id, "2026-11-05", { status: "skipped" });
      // Unscheduled, and another plan's.
      await seedDay(plan.id, "2026-10-09", { status: "missed", scheduledDate: null });
      const other = await seedPlan();
      await seedDay(other.id, "2026-10-09", { status: "missed" });

      const rows = await storage.plans.getPlanDaysForMissAdaptation(plan.id, window);

      expect(rows.map((row) => row.id)).toEqual([
        missed.id,
        skippedPast.id,
        unswept.id,
        skippedAhead.id,
      ]);
      expect(rows[0]?.sets.map((set) => [set.exerciseName, set.reps, set.weight])).toEqual([
        ["back_squat", 5, 100],
      ]);
      expect(rows[1]?.sets).toEqual([]);
    });

    it("returns the days the engine holds a change for, whatever became of them", async () => {
      const plan = await seedPlan();
      // Folded to a day still ahead, logged late, and missed long ago.
      const folded = await seedDay(plan.id, "2026-10-17");
      const loggedLate = await seedDay(plan.id, "2026-10-09", { status: "completed" });
      const old = await seedDay(plan.id, "2026-09-20", { status: "missed" });
      const other = await seedPlan();
      const notThisPlans = await seedDay(other.id, "2026-10-09", { status: "missed" });

      const rows = await storage.plans.getPlanDaysForMissAdaptation(plan.id, {
        ...window,
        alsoIds: [folded.id, loggedLate.id, old.id, notThisPlans.id, "no-such-day"],
      });

      expect(rows.map((row) => row.id)).toEqual([old.id, loggedLate.id, folded.id]);
      expect(rows.map((row) => row.status)).toEqual(["missed", "completed", "planned"]);
    });
  });

  describe("the sweep's athletes to coach", () => {
    // The sweep judges each athlete's own date; these all sit in UTC.
    const today = getLocalDateStrSafe(new Date(), "UTC");
    const yesterday = addDaysToISODate(today, -1);

    async function seedAthlete(
      id: string,
      options: { coach: boolean; lastLogged: string | null },
    ): Promise<string> {
      await seedUser(id);
      await db.update(users).set({ aiCoachEnabled: options.coach }).where(eq(users.id, id));
      if (options.lastLogged) await seedWorkoutLog(id, options.lastLogged);
      const plan = await seedPlan(id);
      return plan.id;
    }

    it("hands over athletes with the coach on who are still training, once", async () => {
      const active = await seedAthlete("miss-active", {
        coach: true,
        lastLogged: addDaysToISODate(today, -3),
      });
      const coachOff = await seedAthlete("miss-coach-off", {
        coach: false,
        lastLogged: addDaysToISODate(today, -3),
      });
      // Walked away from the plan: it misses a session every night.
      const stopped = await seedAthlete("miss-stopped", {
        coach: true,
        lastLogged: addDaysToISODate(today, -40),
      });
      const neverLogged = await seedAthlete("miss-never", { coach: true, lastLogged: null });
      // Only an optional session and a rest day went by.
      const nothingLost = await seedAthlete("miss-optional", {
        coach: true,
        lastLogged: addDaysToISODate(today, -3),
      });
      for (const planId of [active, coachOff, stopped, neverLogged]) {
        await seedDay(planId, yesterday);
      }
      await seedDay(nothingLost, yesterday, { priority: "optional" });
      await seedDay(nothingLost, yesterday, { focus: "Rest", mainWorkout: "Rest day" });

      const plans = new PlanStorage();
      expect(await plans.markMissedPlanDays()).toBe(6);

      expect(await plans.takeAthletesToCoachAfterMiss()).toEqual(["miss-active"]);
      expect(await plans.takeAthletesToCoachAfterMiss()).toEqual([]);
    });

    it("has nobody to hand over when the sweep marked nothing", async () => {
      const planId = await seedAthlete("miss-active", { coach: true, lastLogged: today });
      await seedDay(planId, today);

      const plans = new PlanStorage();
      expect(await plans.markMissedPlanDays()).toBe(0);
      expect(await plans.takeAthletesToCoachAfterMiss()).toEqual([]);
    });
  });
});
