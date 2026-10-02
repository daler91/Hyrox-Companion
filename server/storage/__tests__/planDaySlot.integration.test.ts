import { readFileSync } from "node:fs";
import path from "node:path";

import { planDays, trainingPlans } from "@shared/schema";
import { asc, eq, sql } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it } from "vitest";

import { db } from "../../db";
import { storage } from "../index";
import { resetIntegrationDb, seedUser } from "./integrationDb";

/**
 * A moved plan day takes the week and weekday of its new date (planSlot.ts),
 * against the REAL schema: the missed-session recovery write here (the coach
 * apply and undo are in planProposalUndo.integration.test.ts), and migration
 * 0117, which repairs the days moved before moves did that.
 */
describe("plan day week and weekday follow the date (real Postgres)", () => {
  const ATHLETE = "slot-athlete";

  beforeEach(async () => {
    await resetIntegrationDb();
    await seedUser(ATHLETE);
  });

  afterAll(async () => {
    await resetIntegrationDb();
  });

  async function seedPlan(startDate: string | null) {
    const [plan] = await db
      .insert(trainingPlans)
      .values({ userId: ATHLETE, name: "10k block", totalWeeks: 6, startDate, endDate: null })
      .returning();
    return plan;
  }

  it("files a missed session folded into the next week under that week", async () => {
    // Week 1 starts Monday Aug 3; the missed Thursday goes to the next Tuesday.
    const plan = await seedPlan("2026-08-03");
    const [day] = await db
      .insert(planDays)
      .values({ planId: plan.id, weekNumber: 1, dayName: "Thursday", focus: "Tempo Run", mainWorkout: "40min tempo", scheduledDate: "2026-08-06", status: "missed" })
      .returning();

    const outcome = await storage.plans.applyPlanDayRecovery(day.id, ATHLETE, {
      guard: { statuses: ["missed"], scheduledDate: "2026-08-06", recovery: null },
      update: { scheduledDate: "2026-08-11", status: "planned", recovery: "folded", missedOn: "2026-08-06" },
    });

    expect(outcome).toMatchObject({ outcome: "applied", day: { scheduledDate: "2026-08-11", weekNumber: 2, dayName: "Tuesday" } });
  });

  it("migration 0117 puts days moved before the fix back in step with their dates, once", async () => {
    // Week 1 starts Monday Aug 31: week 5 runs Sep 28 to Oct 4, week 6 from Oct 5.
    // Strength and Wall Balls (laid out on week 6's Monday) and Rest (week 5's
    // Sunday) swapped dates without their slots, as in the athlete's report.
    const plan = await seedPlan("2026-08-31");
    const unscheduledPlan = await seedPlan(null);
    await db.insert(planDays).values([
      { id: "slot-long", planId: plan.id, weekNumber: 5, dayName: "Saturday", focus: "Long Run", mainWorkout: "14km", scheduledDate: "2026-10-03" },
      { id: "slot-swb", planId: plan.id, weekNumber: 6, dayName: "Monday", focus: "Strength and Wall Balls", mainWorkout: "Bench", scheduledDate: "2026-10-04" },
      { id: "slot-rest", planId: plan.id, weekNumber: 5, dayName: "Sunday", focus: "Rest", mainWorkout: "Rest", scheduledDate: "2026-10-05" },
      { id: "slot-week1", planId: plan.id, weekNumber: 1, dayName: "Monday", focus: "Easy Run", mainWorkout: "5km", scheduledDate: "2026-08-31" },
      { id: "slot-lower", planId: plan.id, weekNumber: 6, dayName: "tuesday", focus: "Intervals", mainWorkout: "6x800", scheduledDate: "2026-10-06" },
      { id: "slot-early", planId: plan.id, weekNumber: 1, dayName: "Monday", focus: "Before week 1", mainWorkout: "x", scheduledDate: "2026-08-20" },
      { id: "slot-undated", planId: plan.id, weekNumber: 3, dayName: "Wednesday", focus: "Unscheduled", mainWorkout: "x", scheduledDate: null },
      { id: "slot-no-start", planId: unscheduledPlan.id, weekNumber: 2, dayName: "Friday", focus: "No plan start", mainWorkout: "x", scheduledDate: "2026-09-07" },
    ]);
    const repair = sql.raw(readFileSync(path.resolve(process.cwd(), "migrations/0117_plan_day_slot_repair.sql"), "utf8"));

    await db.execute(repair);

    const slots = await db
      .select({ id: planDays.id, weekNumber: planDays.weekNumber, dayName: planDays.dayName })
      .from(planDays)
      .orderBy(asc(planDays.id));
    expect(slots).toEqual([
      { id: "slot-early", weekNumber: 1, dayName: "Monday" },
      { id: "slot-long", weekNumber: 5, dayName: "Saturday" },
      { id: "slot-lower", weekNumber: 6, dayName: "tuesday" },
      { id: "slot-no-start", weekNumber: 2, dayName: "Friday" },
      { id: "slot-rest", weekNumber: 6, dayName: "Monday" },
      { id: "slot-swb", weekNumber: 5, dayName: "Sunday" },
      { id: "slot-undated", weekNumber: 3, dayName: "Wednesday" },
      { id: "slot-week1", weekNumber: 1, dayName: "Monday" },
    ]);

    const second = await db.execute(repair);
    expect(second.rowCount).toBe(0);
    expect(await db.select({ dayName: planDays.dayName }).from(planDays).where(eq(planDays.id, "slot-swb"))).toEqual([{ dayName: "Sunday" }]);
  });
});
