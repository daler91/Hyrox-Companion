import { afterEach, describe, expect, it, vi } from "vitest";

import { createMockMissedWorkout, createMockUser, createMockWeeklySummary } from "../test/factories";
import {
  type AnalysisDigestData,
  buildAnalysisDigestEmail,
  buildMafTestReminderEmail,
  buildMissedWorkoutEmail,
  buildTodaySessionEmail,
  buildWeeklyReviewReminderEmail,
  buildWeeklySummaryEmail,
  getAppUrl,
  MissedWorkoutData,
  type TodaySessionData,
  type WeeklyReviewReminderData,
  WeeklySummaryData,
} from "./emailTemplates";
import { env } from "./env";

// The real footer link carries a 64-hex HMAC that secret scanners flag in the
// committed snapshots. Stand in a readable token here; the token module has
// its own tests and email.test.ts asserts the real headers on the wire.
vi.mock("./emailUnsubscribeToken", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./emailUnsubscribeToken")>();
  return {
    ...actual,
    buildUnsubscribeUrl: (userId: string) =>
      `${actual.getAppUrl()}/api/v1/emails/unsubscribe?token=test-unsubscribe-token-${userId}`,
  };
});

describe("email generation", () => {
  const baseUser = createMockUser({ email: "test@example.com" });

  // The rate is plan days completed / plan days due, from one table (audit
  // H6): 3 of 4 due = 75%, the same figure this fixture always asserted but
  // no longer arrived at by dividing workout_logs by plan_days.
  const baseData = createMockWeeklySummary();

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

  describe("buildWeeklyReviewReminderEmail", () => {
    const reviewData: WeeklyReviewReminderData = {
      weekStart: "2026-07-13",
      weekEnd: "2026-07-19",
      weeklyGoal: 4,
      sessionsLogged: 3,
      sessionsPlanned: 4,
      plannedCompleted: 3,
      missed: 1,
      totalDurationMin: 150,
      avgRpe: 6.5,
      personalRecords: [{ exerciseName: "Back squat", metric: "maxWeight" }],
      previousIntent: "get three runs in",
    };

    it("generates HTML snapshot correctly", () => {
      expect(buildWeeklyReviewReminderEmail(baseUser, reviewData).html).toMatchSnapshot();
    });

    it("counts the sessions so far in the subject", () => {
      expect(buildWeeklyReviewReminderEmail(baseUser, reviewData).subject).toBe(
        "Your week is wrapping up — 3 sessions so far",
      );
      expect(buildWeeklyReviewReminderEmail(baseUser, { ...reviewData, sessionsLogged: 1 }).subject).toBe(
        "Your week is wrapping up — 1 session so far",
      );
    });

    it("links into the review for the week that is closing", () => {
      expect(buildWeeklyReviewReminderEmail(baseUser, reviewData).html).toContain(
        `${getAppUrl()}/review?week=2026-07-13`,
      );
    });

    it("shows last week's intent back, escaped, and names the PRs", () => {
      const { html } = buildWeeklyReviewReminderEmail(baseUser, {
        ...reviewData,
        previousIntent: "<b>three</b> runs",
      });
      expect(html).toContain("Last week you said");
      expect(html).toContain("&lt;b&gt;three&lt;/b&gt; runs");
      expect(html).not.toContain("<b>three</b>");
      expect(html).toContain("Back squat — heaviest lift");
    });

    it("drops the plan tiles and the missed note for a planless athlete", () => {
      const { html } = buildWeeklyReviewReminderEmail(baseUser, {
        ...reviewData,
        sessionsPlanned: 0,
        plannedCompleted: 0,
        missed: 0,
        previousIntent: null,
        personalRecords: [],
        avgRpe: null,
      });
      expect(html).not.toContain("Plan days done");
      expect(html).not.toContain("didn't happen");
      expect(html).not.toContain("Last week you said");
      expect(html).not.toContain("Avg RPE");
      expect(html).toContain("Take two minutes");
    });
  });

  describe("buildTodaySessionEmail", () => {
    const session = {
      planDayId: "pd-1",
      focus: "Threshold intervals",
      mainWorkout: "6x800m at 5k pace with 2 min jog recovery",
      expectedDurationMin: 55,
      expectedRpe: 7,
      plannedTimeOfDayMin: 390,
      planName: "12-week build",
    };
    const todayData: TodaySessionData = { date: "2026-07-21", isTomorrow: false, sessions: [session] };

    it("generates HTML snapshot correctly", () => {
      expect(buildTodaySessionEmail(baseUser, todayData).html).toMatchSnapshot();
    });

    it("names the session in the subject and deep-links to it", () => {
      const { subject, html } = buildTodaySessionEmail(baseUser, todayData);
      expect(subject).toBe("Today: Threshold intervals");
      expect(html).toContain(`${getAppUrl()}/?workout=pd-1`);
      expect(html).toContain("~55 min · RPE 7 · 06:30 · 12-week build");
    });

    it("switches to tomorrow wording for an evening brief", () => {
      const { subject, html } = buildTodaySessionEmail(baseUser, { ...todayData, isTomorrow: true });
      expect(subject).toBe("Tomorrow: Threshold intervals");
      expect(html).toContain("on the plan for tomorrow");
    });

    it("counts several sessions and lands on the timeline root", () => {
      const { subject, html } = buildTodaySessionEmail(baseUser, {
        ...todayData,
        sessions: [session, { ...session, planDayId: "pd-2", focus: "Mobility" }],
      });
      expect(subject).toBe("Today: 2 sessions");
      expect(html).toContain(`href="${getAppUrl()}/"`);
      expect(html).not.toContain("?workout=");
    });

    it("omits absent metadata and escapes free text", () => {
      const { html } = buildTodaySessionEmail(baseUser, {
        ...todayData,
        sessions: [{ ...session, focus: "Run <fast>", expectedDurationMin: null, expectedRpe: null, plannedTimeOfDayMin: null, planName: null }],
      });
      expect(html).toContain("Run &lt;fast&gt;");
      expect(html).not.toContain('class="workout-meta"');
      expect(html).not.toContain("RPE");
    });

    it("truncates a long prescription", () => {
      const long = "a".repeat(260);
      const { html } = buildTodaySessionEmail(baseUser, { ...todayData, sessions: [{ ...session, mainWorkout: long }] });
      expect(html).toContain(`${"a".repeat(200)}…`);
      expect(html).not.toContain("a".repeat(201));
    });
  });

  describe("buildAnalysisDigestEmail", () => {
    const digestData: AnalysisDigestData = {
      racePrediction: {
        totalFinishSeconds: 5400,
        overallConfidence: "medium",
        percentile: { fasterThanPct: 62, cohortLabel: "Open Men 35-39", cohortSize: 1200 },
        raceReadiness: { status: "fresh", guidance: "Hold the taper; one sharpener mid-week." },
        generatedAt: "2026-07-19T00:05:00.000Z",
      },
      coachInsightsMarkdown: [
        "1. **Goal Progress** — Six weeks out, 82% completion.",
        "2. **Watch Outs** — Sled push untouched for 24 days.",
      ].join("\n"),
      coachInsightsGeneratedAt: "2026-07-20T00:05:00.000Z",
    };

    it("generates HTML snapshot correctly", () => {
      expect(buildAnalysisDigestEmail(baseUser, digestData).html).toMatchSnapshot();
    });

    it("quotes the predicted finish in the subject and headline", () => {
      const { subject, html } = buildAnalysisDigestEmail(baseUser, digestData);
      expect(subject).toBe("Your training analysis: predicted finish 1:30:00");
      expect(html).toContain("1:30:00");
      expect(html).toContain("Medium confidence");
      expect(html).toContain("Faster than <strong>62%</strong> of Open Men 35-39 · 1,200 results");
      expect(html).toContain("Readiness: Fresh");
      expect(html).toContain("Prediction updated 2026-07-19");
      expect(html).toContain("Insights updated 2026-07-20");
      expect(html).toContain(`${getAppUrl()}/analytics`);
    });

    it("renders the coach markdown as HTML with the model output escaped", () => {
      const { html } = buildAnalysisDigestEmail(baseUser, {
        ...digestData,
        coachInsightsMarkdown: "1. **Goal Progress** — <script>x</script>",
      });
      expect(html).toContain("<ol>");
      expect(html).toContain("<strong>Goal Progress</strong>");
      expect(html).toContain("&lt;script&gt;x&lt;/script&gt;");
      expect(html).not.toContain("<script>");
    });

    it("falls back to an insights-only subject without a prediction", () => {
      const { subject, html } = buildAnalysisDigestEmail(baseUser, { ...digestData, racePrediction: null });
      expect(subject).toBe("Your coach insights are ready");
      expect(html).not.toContain('<div class="section-title">Race prediction</div>');
      expect(html).toContain('<div class="section-title">Coach insights</div>');
    });

    it("omits the percentile and readiness rows when they are missing", () => {
      const { html } = buildAnalysisDigestEmail(baseUser, {
        ...digestData,
        coachInsightsMarkdown: null,
        coachInsightsGeneratedAt: null,
        racePrediction: {
          totalFinishSeconds: 5400,
          overallConfidence: "low",
          percentile: null,
          raceReadiness: null,
          generatedAt: "not a date",
        },
      });
      expect(html).not.toContain("Faster than");
      expect(html).not.toContain("Readiness:");
      expect(html).not.toContain("Prediction updated");
      expect(html).not.toContain('<div class="section-title">Coach insights</div>');
    });
  });

  describe("footer", () => {
    it("links every template to preferences and to the login-free unsubscribe endpoint", () => {
      const htmls = [
        buildWeeklySummaryEmail(baseUser, baseData).html,
        buildMissedWorkoutEmail(baseUser, [createMockMissedWorkout()]).html,
        buildMafTestReminderEmail(baseUser).html,
        buildAnalysisDigestEmail(baseUser, { racePrediction: null, coachInsightsMarkdown: "hi", coachInsightsGeneratedAt: null }).html,
      ];
      for (const html of htmls) {
        expect(html).toContain(`${getAppUrl()}/settings`);
        expect(html).toContain(`${getAppUrl()}/api/v1/emails/unsubscribe?token=`);
      }
    });
  });

  describe("buildMissedWorkoutEmail", () => {
    const missedWorkouts = [createMockMissedWorkout()];

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
        { planDayId: "plan-day-2", date: "Oct 4", focus: "Run", mainWorkout: "5k easy pace" },
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
