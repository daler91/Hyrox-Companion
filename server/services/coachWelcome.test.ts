import { beforeEach, describe, expect, it, vi } from "vitest";

import type { TrainingContext } from "../gemini/types";
import { storage } from "../storage";
import { buildTrainingContext } from "./ai";
import { buildCoachWelcome, daysUntilRace, getCoachWelcome } from "./coachWelcome";
import { getCachedTrainingContext } from "./trainingContextCache";

vi.mock("../storage", () => ({
  storage: { users: { getUser: vi.fn() }, plans: { getActivePlan: vi.fn() } },
}));
vi.mock("./ai", () => ({ buildTrainingContext: vi.fn() }));
vi.mock("./trainingContextCache", () => ({ getCachedTrainingContext: vi.fn() }));

const TODAY = "2026-10-01"; // a Thursday

type Upcoming = NonNullable<TrainingContext["upcomingWorkouts"]>[number];

function context(overrides: Partial<TrainingContext> = {}): TrainingContext {
  return {
    totalWorkouts: 40,
    completedWorkouts: 30,
    plannedWorkouts: 10,
    missedWorkouts: 0,
    skippedWorkouts: 0,
    completionRate: 90,
    currentStreak: 3,
    currentDate: TODAY,
    recentWorkouts: [],
    upcomingWorkouts: [],
    exerciseBreakdown: {},
    activePlan: { name: "Spring block", totalWeeks: 12, currentWeek: 6, goal: "Sub-75 Hyrox" },
    ...overrides,
  };
}

function session(date: string, focus: string, extra: Partial<Upcoming> = {}): Upcoming {
  return { date, focus, mainWorkout: "", ...extra };
}

type CoachingInsights = NonNullable<TrainingContext["coachingInsights"]>;

function insights(overrides: Partial<CoachingInsights>): CoachingInsights {
  return {
    rpeTrend: "stable",
    fatigueFlag: false,
    undertrainingFlag: false,
    stationGaps: [],
    progressionFlags: [],
    ...overrides,
  };
}

const ids = (welcome: ReturnType<typeof buildCoachWelcome>) => welcome.quickActions.map((action) => action.id);

describe("buildCoachWelcome", () => {
  it("greets the athlete by name and leads with today's run, offering pacing", () => {
    const welcome = buildCoachWelcome({
      firstName: "Sam",
      daysToRace: null,
      context: context({ upcomingWorkouts: [session(TODAY, "Intervals", { mainWorkout: "6x800m @ 4:05/km" })] }),
    });

    expect(welcome.greeting).toBe("Hi Sam! Today: Intervals. What would you like to work on?");
    expect(welcome.quickActions[0]).toEqual({
      id: "today-session",
      label: "Pacing for today's Intervals",
      message: "How should I pace today's Intervals?",
    });
  });

  it("offers cues for a strength session, read from its exercise table", () => {
    const welcome = buildCoachWelcome({
      firstName: null,
      daysToRace: null,
      context: context({
        upcomingWorkouts: [
          session(TODAY, "Lower body", { exerciseDetails: [{ exerciseName: "back_squat", category: "strength" }] }),
        ],
      }),
    });

    expect(welcome.greeting.startsWith("Hi! Today: Lower body.")).toBe(true);
    expect(welcome.quickActions[0]).toMatchObject({ label: "Cues for today's Lower body" });
  });

  it("names the next session when there is none today", () => {
    const welcome = buildCoachWelcome({
      firstName: "Sam",
      daysToRace: null,
      context: context({ upcomingWorkouts: [session("2026-10-03", "Long Run")] }),
    });

    expect(welcome.greeting).toContain("Next up: Long Run on Saturday.");
    expect(ids(welcome)).not.toContain("today-session");
  });

  it("leads with a race in the next three weeks, and offers race prep", () => {
    const welcome = buildCoachWelcome({ firstName: "Sam", daysToRace: 9, context: context() });

    expect(welcome.greeting).toContain("Race day is 9 days away.");
    expect(ids(welcome)[0]).toBe("race-prep");
  });

  it("says nothing of a race further out", () => {
    const welcome = buildCoachWelcome({ firstName: "Sam", daysToRace: 60, context: context() });

    expect(welcome.greeting).not.toContain("Race day");
    expect(ids(welcome)).not.toContain("race-prep");
  });

  it("flags a load spike and asks whether to ease off", () => {
    const welcome = buildCoachWelcome({
      firstName: "Sam",
      daysToRace: null,
      context: context({ coachingInsights: insights({ loadGovernor: { zone: "danger" } as never }) }),
    });

    expect(welcome.greeting).toContain("recovery matters this week");
    expect(ids(welcome)).toContain("ease-off");
  });

  it("celebrates new bests, and asks after today's finished session and a missed one", () => {
    const welcome = buildCoachWelcome({
      firstName: "Sam",
      daysToRace: null,
      context: context({
        recentWorkouts: [{ date: TODAY, focus: "Tempo Run", mainWorkout: "", status: "completed" }],
        coachingInsights: insights({
          prsThisWeek: 2,
          recentMisses: [{ date: "2026-09-29", focus: "Sled work", priority: "key", decision: "undecided" }],
        }),
      }),
    });

    expect(welcome.greeting).toBe(
      "Hi Sam! Nice work on today's Tempo Run. You've set 2 personal bests this week. What would you like to work on?",
    );
    expect(ids(welcome)).toEqual(["review-today", "missed-session", "new-bests", "suggestions"]);
  });

  it("fills the row with the standing chips, at most four", () => {
    const welcome = buildCoachWelcome({ firstName: "Sam", daysToRace: null, context: context() });

    expect(ids(welcome)).toEqual(["suggestions", "tomorrow", "weekly-review", "on-track"]);
  });

  it("gives a new athlete chips for getting started", () => {
    const welcome = buildCoachWelcome({
      firstName: "Sam",
      daysToRace: null,
      context: context({ totalWorkouts: 0, activePlan: undefined }),
    });

    expect(welcome.greeting).toBe("Hi Sam! What would you like to work on?");
    expect(ids(welcome)).toEqual(["suggestions", "analyze", "getting-started"]);
  });

  it("shortens a long session name on a chip", () => {
    const welcome = buildCoachWelcome({
      firstName: "Sam",
      daysToRace: null,
      context: context({ upcomingWorkouts: [session(TODAY, "Station practice: wall balls, sled push and farmers carry")] }),
    });

    // "sled" makes it a strength session; the name is cut to 40 characters.
    expect(welcome.quickActions[0].label).toBe("Cues for today's Station practice: wall balls, sled push…");
  });
});

describe("daysUntilRace", () => {
  it("counts the days to a race still ahead", () => {
    expect(daysUntilRace("2026-10-10", TODAY)).toBe(9);
    expect(daysUntilRace(TODAY, TODAY)).toBe(0);
  });

  it("is null without a race, or for one already past", () => {
    expect(daysUntilRace(null, TODAY)).toBeNull();
    expect(daysUntilRace("2026-09-20", TODAY)).toBeNull();
  });
});

describe("getCoachWelcome", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("builds the welcome from the athlete, their plan's race and the chat's cached context", async () => {
    vi.mocked(storage.users.getUser).mockResolvedValue({ firstName: "Sam" } as never);
    vi.mocked(storage.plans.getActivePlan).mockResolvedValue({ raceDate: "2026-10-04" } as never);
    vi.mocked(getCachedTrainingContext).mockResolvedValue(context());

    const welcome = await getCoachWelcome("user-1");

    expect(getCachedTrainingContext).toHaveBeenCalledWith("user-1", buildTrainingContext);
    expect(welcome.greeting).toContain("Hi Sam! Race day is 3 days away.");
  });
});
