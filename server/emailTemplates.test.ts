import type { User } from "@shared/schema";
import { afterEach,describe, expect, it } from "vitest";

import {
  buildMissedWorkoutEmail,
  buildWeeklySummaryEmail,
  getAppUrl,
  MissedWorkoutData,
  WeeklySummaryData,
} from "./emailTemplates";
import { env } from "./env";

describe("email generation", () => {
  const baseUser: User = {
    id: 1,
    email: "test@example.com",
    firstName: "John",
    lastName: "Doe",
    password: "dummy_hash_value",
    role: "user",
    unitPreference: "metric",
    targetRaceId: null,
    createdAt: new Date(),
    currentStreak: 0,
    highestStreak: 0,
    lastWorkoutDate: null,
  };

  const baseData: WeeklySummaryData = {
    completedCount: 3,
    // The rate is now plan days completed / plan days due, from one table
    // (audit H6): 3 of 4 due = 75%, the same figure this fixture always
    // asserted but no longer arrived at by dividing workout_logs by plan_days.
    planCompletedCount: 3,
    dueCount: 4,
    plannedCount: 0,
    missedCount: 1,
    skippedCount: 0,
    excusedCount: 0,
    completionRate: 75,
    currentStreak: 2,
    prsThisWeek: 1,
    totalDuration: 125, // 2h 5m
    weekStartDate: "Oct 1",
    weekEndDate: "Oct 7",
  };

  describe("getAppUrl", () => {
    const originalAppUrl = env.APP_URL;

    afterEach(() => {
      env.APP_URL = originalAppUrl;
    });

    it("returns env.APP_URL when present", () => {
      env.APP_URL = "https://custom-url.com";
      expect(getAppUrl()).toBe("https://custom-url.com");
    });

    it("returns default URL when env.APP_URL is undefined", () => {
      env.APP_URL = undefined;
      expect(getAppUrl()).toBe("https://fitai.coach");
    });

    it("returns default URL when env.APP_URL is an empty string", () => {
      env.APP_URL = "";
      expect(getAppUrl()).toBe("https://fitai.coach");
    });
  });

  describe("buildWeeklySummaryEmail — no plan means no completion rate (audit H6)", () => {
    const noPlanData: WeeklySummaryData = {
      ...baseData,
      // Trained three times off-plan; nothing was ever scheduled.
      completedCount: 3,
      planCompletedCount: 0,
      dueCount: 0,
      plannedCount: 0,
      missedCount: 0,
      skippedCount: 0,
      completionRate: null,
    };

    it("omits the completion-rate card entirely rather than showing 100%", () => {
      const { html } = buildWeeklySummaryEmail(baseUser, noPlanData);
      expect(html).not.toContain("Completion Rate");
      // Not a bare "100%" search: the stylesheet legitimately contains
      // `width:100%`. This targets the stat-value slot the rate renders into.
      expect(html).not.toMatch(/stat-value">\s*\d+%/);
    });

    it("does not claim the athlete completed N of N planned sessions", () => {
      const { html } = buildWeeklySummaryEmail(baseUser, noPlanData);
      expect(html).not.toContain("planned sessions");
    });

    it("still reports the workouts they actually logged", () => {
      const { subject } = buildWeeklySummaryEmail(baseUser, noPlanData);
      expect(subject).toContain("3 workouts completed");
    });

    it("counts the caption from plan days on both sides, not from logged workouts", () => {
      // An athlete who trains off-plan logs more than the plan asked for. The
      // caption must still read against the plan, never exceed it.
      const offPlan: WeeklySummaryData = {
        ...baseData,
        completedCount: 9,
        planCompletedCount: 2,
        dueCount: 4,
        plannedCount: 0,
        missedCount: 2,
        completionRate: 50,
      };
      const { html } = buildWeeklySummaryEmail(baseUser, offPlan);
      expect(html).toContain("2 of 4 planned sessions");
      expect(html).not.toContain("9 of");
    });
  });

  describe("buildWeeklySummaryEmail", () => {
    it("generates HTML snapshot correctly", () => {
      const { html, subject } = buildWeeklySummaryEmail(baseUser, baseData);
      expect(subject).toBe("Your Week in Review: 3 workouts completed");
      expect(html).toMatchSnapshot();
    });

    it("uses the user firstName if available", () => {
      const { html } = buildWeeklySummaryEmail(baseUser, baseData);
      expect(html).toContain("Hey John, here's how your week went:");
    });

    it("sends the CTA to the review for the week it summarises", () => {
      // The old CTA landed on the timeline root, which shows the week ahead
      // rather than the one the email is about. Production always passes a
      // YYYY-MM-DD weekStartDate (the shared fixture's "Oct 1" is a display
      // string), and that is what the link has to carry.
      const data = { ...baseData, weekStartDate: "2026-07-13", weekEndDate: "2026-07-19" };
      const { html } = buildWeeklySummaryEmail(baseUser, data);
      expect(html).toContain("/review?week=2026-07-13");
      expect(html).toContain("See your week in review");
    });

    it("uses the email prefix if firstName is missing", () => {
      const user = { ...baseUser, firstName: null };
      const { html } = buildWeeklySummaryEmail(user, baseData);
      expect(html).toContain("Hey test, here's how your week went:");
    });

    it("uses Athlete if neither firstName nor email are present", () => {
      const user = { ...baseUser, firstName: null, email: "" };
      const { html } = buildWeeklySummaryEmail(user, baseData);
      expect(html).toContain("Hey Athlete, here's how your week went:");
    });

    it("formats subject with plural workouts", () => {
      const { subject } = buildWeeklySummaryEmail(baseUser, baseData);
      expect(subject).toBe("Your Week in Review: 3 workouts completed");
    });

    it("formats subject with singular workout", () => {
      const data = { ...baseData, completedCount: 1 };
      const { subject } = buildWeeklySummaryEmail(baseUser, data);
      expect(subject).toBe("Your Week in Review: 1 workout completed");
    });

    it("formats duration with hours and minutes correctly", () => {
      const { html } = buildWeeklySummaryEmail(baseUser, baseData);
      expect(html).toContain('<div class="stat-value">2h 5m</div>');
      expect(html).toContain('<div class="stat-label">Total Time</div>');
    });

    it("formats duration with only minutes correctly", () => {
      const data = { ...baseData, totalDuration: 45 };
      const { html } = buildWeeklySummaryEmail(baseUser, data);
      expect(html).toContain('<div class="stat-value">45m</div>');
      expect(html).toContain('<div class="stat-label">Total Time</div>');
    });

    it("shows perfect week message when missedCount is 0", () => {
      const data = { ...baseData, missedCount: 0 };
      const { html } = buildWeeklySummaryEmail(baseUser, data);
      expect(html).toContain("Perfect week — no missed sessions! Keep it up!");
      expect(html).not.toContain("You missed");
    });

    it("does NOT cheer 'perfect week' at an athlete whose week was an absence", () => {
      // Zero missed only because an injury window held the days out of the
      // count — celebrating that reads as not having listened.
      const data = { ...baseData, missedCount: 0, excusedCount: 3 };
      const { html } = buildWeeklySummaryEmail(baseUser, data);
      expect(html).not.toContain("Perfect week");
      expect(html).not.toContain("You missed");
      expect(html).toContain(
        "3 planned sessions fell inside an injury, illness, travel or rest window you logged — not counted as missed.",
      );
    });

    it("notes the excused sessions alongside real misses, singular", () => {
      const data = { ...baseData, missedCount: 1, excusedCount: 1 };
      const { html } = buildWeeklySummaryEmail(baseUser, data);
      expect(html).toContain("You missed 1 session this week. Don't worry");
      expect(html).toContain("1 planned session fell inside an injury, illness, travel or rest window");
    });

    it("shows missed message when missedCount > 0", () => {
      const { html } = buildWeeklySummaryEmail(baseUser, baseData);
      expect(html).toContain("You missed 1 session this week. Don't worry");
    });

    it("shows plural missed message", () => {
      const data = { ...baseData, missedCount: 2 };
      const { html } = buildWeeklySummaryEmail(baseUser, data);
      expect(html).toContain("You missed 2 sessions this week.");
    });

    it("hides streak section when currentStreak is 0", () => {
      const data = { ...baseData, currentStreak: 0, prsThisWeek: 0 };
      const { html } = buildWeeklySummaryEmail(baseUser, data);
      expect(html).not.toContain("Day Streak");
      expect(html).not.toContain("New PRs");
    });

    it("shows PRs when > 0", () => {
      const { html } = buildWeeklySummaryEmail(baseUser, baseData);
      expect(html).toContain("Day Streak");
      expect(html).toContain("New PRs");
    });

    it("hides PRs when 0 but streak is > 0", () => {
      const data = { ...baseData, prsThisWeek: 0 };
      const { html } = buildWeeklySummaryEmail(baseUser, data);
      expect(html).toContain("Day Streak");
      expect(html).not.toContain("New PRs");
    });
  });

  describe("buildMissedWorkoutEmail", () => {
    const missedWorkouts: MissedWorkoutData[] = [
      {
        date: "Oct 3",
        focus: "Strength",
        mainWorkout: "Squats, Deadlifts, Bench",
        planName: "Hyrox Base",
      },
    ];

    it("generates HTML snapshot correctly", () => {
      const { html, subject } = buildMissedWorkoutEmail(
        baseUser,
        missedWorkouts,
      );
      expect(subject).toBe("1 missed workout — get back on track");
      expect(html).toMatchSnapshot();
    });

    it("formats subject correctly for singular workout", () => {
      const { subject } = buildMissedWorkoutEmail(baseUser, missedWorkouts);
      expect(subject).toBe("1 missed workout — get back on track");
    });

    it("formats subject correctly for plural workouts", () => {
      const missed = [
        ...missedWorkouts,
        { date: "Oct 4", focus: "Run", mainWorkout: "5k easy pace" },
      ];
      const { subject } = buildMissedWorkoutEmail(baseUser, missed);
      expect(subject).toBe("2 missed workouts — get back on track");
    });

    it("includes workout details in html", () => {
      const { html } = buildMissedWorkoutEmail(baseUser, missedWorkouts);
      expect(html).toContain("Strength");
      expect(html).toContain("Squats, Deadlifts, Bench");
      expect(html).toContain("Oct 3");
    });

    it("truncates long workout details", () => {
      const longWorkout = "A".repeat(150);
      const missed = [
        { ...missedWorkouts[0], mainWorkout: longWorkout, planName: undefined },
      ];
      const { html } = buildMissedWorkoutEmail(baseUser, missed);
      expect(html).toContain("A".repeat(120) + "...");
    });

    it("handles missing plan name", () => {
      const missed = [{ ...missedWorkouts[0], planName: undefined }];
      const { html } = buildMissedWorkoutEmail(baseUser, missed);
      expect(html).toContain("Oct 3");
      expect(html).not.toContain("·");
    });
  });
});
