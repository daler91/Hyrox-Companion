import { PLAN_WEEKDAYS } from "@shared/dateUtils";
import { planDays, trainingPlans } from "@shared/schema";
import { eq } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it } from "vitest";

import { db } from "../../db";
import { storage } from "../index";
import { resetIntegrationDb, seedUser, seedWorkoutLog } from "./integrationDb";

/**
 * schedulePlan against the REAL schema. Week 1 is the Monday-anchored week of
 * the start date, but no session may land before the start date: a Wednesday
 * start used to put Monday's and Tuesday's sessions in the past, where they
 * read as missed on the athlete's first look at the plan (onboarding audit C3).
 */
describe("PlanStorage.schedulePlan (real Postgres)", () => {
  const USER = "schedule-user";
  // 2026-09-21 is a Monday.
  const MONDAY = "2026-09-21";
  const WEDNESDAY = "2026-09-23";

  async function seedPlan(days: { week: number; day: string; status?: string }[]) {
    const [plan] = await db
      .insert(trainingPlans)
      .values({ userId: USER, name: "Block", totalWeeks: 2 })
      .returning();
    const rows = await db
      .insert(planDays)
      .values(
        days.map((d) => ({
          planId: plan.id,
          weekNumber: d.week,
          dayName: d.day,
          focus: `${d.day} session`,
          mainWorkout: "Work",
          status: d.status ?? "planned",
        })),
      )
      .returning();
    const byKey = new Map(rows.map((r) => [`${r.weekNumber}-${r.dayName}`, r]));
    return { plan, day: (week: number, day: string) => byKey.get(`${week}-${day}`)! };
  }

  async function datesOf(planId: string) {
    const rows = await db.select().from(planDays).where(eq(planDays.planId, planId));
    return new Map(rows.map((r) => [`${r.weekNumber}-${r.dayName}`, r.scheduledDate]));
  }

  const fullWeekOne = PLAN_WEEKDAYS.map((day) => ({ week: 1, day }));

  beforeEach(async () => {
    await resetIntegrationDb();
    await seedUser(USER);
  });

  afterAll(async () => {
    await resetIntegrationDb();
  });

  it("leaves week-1 sessions before a midweek start off the calendar", async () => {
    const { plan } = await seedPlan([...fullWeekOne, { week: 2, day: "Monday" }]);

    expect(await storage.plans.schedulePlan(plan.id, WEDNESDAY, USER)).toBe("scheduled");

    const dates = await datesOf(plan.id);
    expect(dates.get("1-Monday")).toBeNull();
    expect(dates.get("1-Tuesday")).toBeNull();
    expect(dates.get("1-Wednesday")).toBe(WEDNESDAY);
    expect(dates.get("1-Sunday")).toBe("2026-09-27");
    expect(dates.get("2-Monday")).toBe("2026-09-28");

    // The plan still opens on week 1's Monday, so week numbers stay aligned
    // with the days' own weekNumber.
    const [row] = await db.select().from(trainingPlans).where(eq(trainingPlans.id, plan.id));
    expect(row.startDate).toBe(MONDAY);
    expect(row.endDate).toBe("2026-09-28");
  });

  it("keeps every session on a Monday start", async () => {
    const { plan } = await seedPlan(fullWeekOne);

    await storage.plans.schedulePlan(plan.id, MONDAY, USER);

    const dates = await datesOf(plan.id);
    expect([...dates.values()].every((d) => d !== null)).toBe(true);
    expect(dates.get("1-Monday")).toBe(MONDAY);
  });

  it("keeps a date on days the athlete already acted on, so their history stays visible", async () => {
    const { plan, day } = await seedPlan([
      { week: 1, day: "Monday", status: "completed" },
      { week: 1, day: "Tuesday", status: "skipped" },
      { week: 1, day: "Wednesday" },
      { week: 1, day: "Thursday" },
      { week: 1, day: "Friday" },
    ]);
    // A logged workout linked to a day still marked planned counts too: the
    // timeline reads linked logs through their scheduled plan day.
    await seedWorkoutLog(USER, MONDAY, { planDayId: day(1, "Wednesday").id });

    await storage.plans.schedulePlan(plan.id, "2026-09-24", USER);

    const dates = await datesOf(plan.id);
    expect(dates.get("1-Monday")).toBe(MONDAY);
    expect(dates.get("1-Tuesday")).toBe("2026-09-22");
    expect(dates.get("1-Wednesday")).toBe(WEDNESDAY);
    expect(dates.get("1-Thursday")).toBe("2026-09-24");
  });

  it("dates days it had left off when the plan is moved back to a Monday", async () => {
    const { plan } = await seedPlan(fullWeekOne);
    await storage.plans.schedulePlan(plan.id, WEDNESDAY, USER);

    await storage.plans.schedulePlan(plan.id, MONDAY, USER);

    const dates = await datesOf(plan.id);
    expect(dates.get("1-Monday")).toBe(MONDAY);
    expect(dates.get("1-Tuesday")).toBe("2026-09-22");
  });

  it("refuses a start after every session of a one-week plan, changing nothing", async () => {
    const { plan } = await seedPlan([
      { week: 1, day: "Monday" },
      { week: 1, day: "Tuesday" },
    ]);

    expect(await storage.plans.schedulePlan(plan.id, WEDNESDAY, USER)).toBe("nothing_after_start");

    const dates = await datesOf(plan.id);
    expect([...dates.values()]).toEqual([null, null]);
  });

  it("reports a plan that is not the athlete's as not found", async () => {
    const { plan } = await seedPlan(fullWeekOne);
    await seedUser("someone-else");
    expect(await storage.plans.schedulePlan(plan.id, MONDAY, "someone-else")).toBe("not_found");
  });

  it("shows nothing missed on the timeline right after a start today", async () => {
    // Whatever weekday the suite runs on, a plan started today has no session
    // before today, so none can read as missed.
    const today = new Date().toISOString().slice(0, 10);
    const { plan } = await seedPlan([...fullWeekOne, { week: 2, day: "Monday" }]);

    await storage.plans.schedulePlan(plan.id, today, USER);

    const timeline = await storage.timeline.getTimeline(USER);
    expect(timeline.filter((e) => e.planId === plan.id && e.status === "missed")).toEqual([]);
    expect(timeline.filter((e) => e.planId === plan.id && e.date < today)).toEqual([]);
  });
});
