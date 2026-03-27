import { vi, describe, it, expect, afterEach } from "vitest";
import {
  getAppUrl,
  buildWeeklySummaryEmail,
  buildMissedWorkoutEmail,
  WeeklySummaryData,
  MissedWorkoutData,
} from "./emailTemplates";
import type { User } from "@shared/schema";

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
    plannedCount: 4,
    missedCount: 1,
    skippedCount: 0,
    completionRate: 75,
    currentStreak: 2,
    prsThisWeek: 1,
    totalDuration: 125, // 2h 5m
    weekStartDate: "Oct 1",
    weekEndDate: "Oct 7",
  };

  describe("getAppUrl", () => {
    afterEach(() => {
      vi.unstubAllEnvs();
    });

    it("returns process.env.APP_URL when present", () => {
      vi.stubEnv("APP_URL", "https://custom-url.com");
      expect(getAppUrl()).toBe("https://custom-url.com");
    });

    it("returns default URL when process.env.APP_URL is undefined", () => {
      // Vitest's stubEnv handles undefined/empty strings when unstubAllEnvs is called
      // Since it's not set, it should fall back to the default
      vi.unstubAllEnvs();
      // explicitly delete it just in case the real env has it
      delete process.env.APP_URL;
      expect(getAppUrl()).toBe("https://fitai.coach");
    });

    it("returns default URL when process.env.APP_URL is an empty string", () => {
      vi.stubEnv("APP_URL", "");
      expect(getAppUrl()).toBe("https://fitai.coach");
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
