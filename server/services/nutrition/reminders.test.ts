import type { User } from "@shared/schema";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { IStorage } from "../../storage";
import {
  buildRefuelPush,
  processLoggingReminder,
  processRefuelReminder,
  runNutritionReminderCron,
} from "./reminders";

const { isPushEnabledMock, sendPushMock } = vi.hoisted(() => ({
  isPushEnabledMock: vi.fn(() => true),
  sendPushMock: vi.fn(async () => 1),
}));
vi.mock("../../pushNotifications", () => ({
  isPushEnabled: isPushEnabledMock,
  sendPushToUser: sendPushMock,
}));

// 2026-06-07 15:00 UTC. The refuel workout starts at 12:00 and runs 60min,
// so its window (end+45min .. end+3h) spans 13:45–16:00 — "now" is inside it.
const NOW = new Date("2026-06-07T15:00:00Z");
const WORKOUT_START = new Date("2026-06-07T12:00:00Z");

function makeUser(over: Partial<User> = {}): User {
  return {
    id: "u1",
    userTimezone: "UTC",
    pushRefuelReminder: true,
    pushLoggingReminder: true,
    bodyweightKg: null,
    ...over,
  } as User;
}

interface FakeData {
  latestWorkout?: { id: string; date: string; startedAt: Date | null; duration: number | null; rpe: number | null } | undefined;
  windowEntries?: unknown[];
  dayEntries?: unknown[];
  hasEntriesToday?: boolean;
  hasEntriesRecently?: boolean;
  refuelClaimWins?: boolean;
  loggingClaimWins?: boolean;
  optedInUsers?: User[];
}

function makeStorage(data: FakeData) {
  const storage = {
    users: {
      getUser: vi.fn(async (id: string) =>
        (data.optedInUsers ?? [makeUser()]).find((u) => u.id === id),
      ),
      getUsers: vi.fn(async (ids: string[]) =>
        (data.optedInUsers ?? [makeUser()]).filter((u) => ids.includes(u.id)),
      ),
      getUsersWithNutritionPushReminders: vi.fn(async () => data.optedInUsers ?? [makeUser()]),
      claimRefuelReminder: vi.fn(async () => data.refuelClaimWins ?? true),
      claimLoggingReminder: vi.fn(async () => data.loggingClaimWins ?? true),
    },
    workouts: {
      getLatestStartedWorkout: vi.fn(async () => data.latestWorkout),
    },
    nutrition: {
      listEntriesWithFoodInWindow: vi.fn(async () => data.windowEntries ?? []),
      listEntriesWithFoodForDate: vi.fn(async () => data.dayEntries ?? []),
      hasEntriesOnDate: vi.fn(async () => data.hasEntriesToday ?? false),
      hasEntriesSince: vi.fn(async () => data.hasEntriesRecently ?? true),
    },
  };
  return storage as unknown as IStorage & typeof storage;
}

const REFUEL_WORKOUT = {
  id: "w1",
  date: "2026-06-07",
  startedAt: WORKOUT_START,
  duration: 60,
  rpe: null,
};

describe("buildRefuelPush", () => {
  it("names both remaining macros and deep-links with the post_workout meal", () => {
    const push = buildRefuelPush({ postCarbG: 60.4, postProteinG: 25 }, "2026-06-07");
    expect(push.title).toBe("Refuel window open");
    expect(push.body).toContain("60g carbs");
    expect(push.body).toContain("25g protein");
    expect(push.url).toBe("/nutrition?date=2026-06-07&meal=post_workout");
  });

  it("drops a macro that is already covered", () => {
    const push = buildRefuelPush({ postCarbG: 0, postProteinG: 20 }, "2026-06-07");
    expect(push.body).not.toContain("carbs");
    expect(push.body).toContain("20g protein");
  });
});

describe("processRefuelReminder", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    sendPushMock.mockResolvedValue(1);
  });

  it("sends the nudge when the session's post gap is unmet inside the window", async () => {
    const storage = makeStorage({ latestWorkout: REFUEL_WORKOUT });
    const sent = await processRefuelReminder(storage, makeUser(), NOW);

    expect(sent).toBe(true);
    expect(storage.users.claimRefuelReminder).toHaveBeenCalled();
    // No bodyweight → the general 60g carb / 25g protein default gap.
    expect(sendPushMock).toHaveBeenCalledWith(
      "u1",
      expect.objectContaining({ url: "/nutrition?date=2026-06-07&meal=post_workout" }),
    );
  });

  it("does nothing for a user who has not opted in", async () => {
    const storage = makeStorage({ latestWorkout: REFUEL_WORKOUT });
    const sent = await processRefuelReminder(
      storage,
      makeUser({ pushRefuelReminder: false }),
      NOW,
    );
    expect(sent).toBe(false);
    expect(storage.workouts.getLatestStartedWorkout).not.toHaveBeenCalled();
  });

  it("does nothing without a recent device-timed workout", async () => {
    const storage = makeStorage({ latestWorkout: undefined });
    expect(await processRefuelReminder(storage, makeUser(), NOW)).toBe(false);
    expect(sendPushMock).not.toHaveBeenCalled();
  });

  it("stays quiet outside the refuel window (too soon, then too late)", async () => {
    const storage = makeStorage({ latestWorkout: REFUEL_WORKOUT });
    // Session ends 13:00; min nudge time is 13:45.
    expect(
      await processRefuelReminder(storage, makeUser(), new Date("2026-06-07T13:30:00Z")),
    ).toBe(false);
    // Max nudge time is 16:00.
    expect(
      await processRefuelReminder(storage, makeUser(), new Date("2026-06-07T16:30:00Z")),
    ).toBe(false);
    expect(sendPushMock).not.toHaveBeenCalled();
  });

  it("stays quiet when the recovery gap is already covered", async () => {
    const food = {
      id: "f1", caloriesPer100g: 100, proteinPer100g: 30, carbPer100g: 70, fatPer100g: 5, fiberPer100g: 2,
    };
    // A big tagged recovery meal on the session's day: 100g carbs, 43g protein.
    const recoveryMeal = {
      id: "e1", foodId: "f1", userId: "u1", quantityG: 143, mealType: "post_workout",
      logDate: "2026-06-07", loggedAt: new Date("2026-06-07T13:15:00Z"),
      entryMethod: "manual", food,
    };
    const storage = makeStorage({ latestWorkout: REFUEL_WORKOUT, dayEntries: [recoveryMeal] });

    expect(await processRefuelReminder(storage, makeUser(), NOW)).toBe(false);
    expect(storage.users.claimRefuelReminder).not.toHaveBeenCalled();
    expect(sendPushMock).not.toHaveBeenCalled();
  });

  it("does not push when another tick already claimed the window", async () => {
    const storage = makeStorage({ latestWorkout: REFUEL_WORKOUT, refuelClaimWins: false });
    expect(await processRefuelReminder(storage, makeUser(), NOW)).toBe(false);
    expect(sendPushMock).not.toHaveBeenCalled();
  });
});

describe("processLoggingReminder", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    sendPushMock.mockResolvedValue(1);
  });

  // 20:00 UTC for a UTC-timezone user — the reminder's local slot.
  const EVENING = new Date("2026-06-07T20:15:00Z");

  it("nudges an active user with nothing logged today at 20:00 local", async () => {
    const storage = makeStorage({ hasEntriesToday: false, hasEntriesRecently: true });
    expect(await processLoggingReminder(storage, makeUser(), EVENING)).toBe(true);
    expect(storage.users.claimLoggingReminder).toHaveBeenCalled();
    expect(sendPushMock).toHaveBeenCalledWith(
      "u1",
      expect.objectContaining({ url: "/nutrition" }),
    );
  });

  it("stays quiet outside the 20:00 local hour", async () => {
    const storage = makeStorage({});
    expect(await processLoggingReminder(storage, makeUser(), NOW)).toBe(false);
    expect(sendPushMock).not.toHaveBeenCalled();
  });

  it("respects the athlete's timezone for the evening slot", async () => {
    // 20:15 in Berlin (UTC+2 in June) is 18:15 UTC.
    const berlinEvening = new Date("2026-06-07T18:15:00Z");
    const storage = makeStorage({});
    const berliner = makeUser({ userTimezone: "Europe/Berlin" });
    expect(await processLoggingReminder(storage, berliner, berlinEvening)).toBe(true);
    // And 20:15 UTC is 22:15 Berlin — outside the slot.
    expect(await processLoggingReminder(makeStorage({}), berliner, EVENING)).toBe(false);
  });

  it("stays quiet when something was already logged today", async () => {
    const storage = makeStorage({ hasEntriesToday: true });
    expect(await processLoggingReminder(storage, makeUser(), EVENING)).toBe(false);
    expect(sendPushMock).not.toHaveBeenCalled();
  });

  it("never nags a user with no recent logging history", async () => {
    const storage = makeStorage({ hasEntriesRecently: false });
    expect(await processLoggingReminder(storage, makeUser(), EVENING)).toBe(false);
    expect(storage.users.claimLoggingReminder).not.toHaveBeenCalled();
  });

  it("does nothing for a user who has not opted in", async () => {
    const storage = makeStorage({});
    expect(
      await processLoggingReminder(storage, makeUser({ pushLoggingReminder: false }), EVENING),
    ).toBe(false);
  });
});

describe("runNutritionReminderCron", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    sendPushMock.mockResolvedValue(1);
    isPushEnabledMock.mockReturnValue(true);
  });

  it("no-ops entirely when push is not configured", async () => {
    isPushEnabledMock.mockReturnValue(false);
    const storage = makeStorage({});
    const result = await runNutritionReminderCron(storage);
    expect(result).toEqual({ usersChecked: 0, remindersSent: 0 });
    expect(storage.users.getUsersWithNutritionPushReminders).not.toHaveBeenCalled();
  });

  it("re-fetches all users in one batched call and counts sent reminders", async () => {
    const user = makeUser();
    const storage = makeStorage({ latestWorkout: REFUEL_WORKOUT, optedInUsers: [user] });
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    try {
      const result = await runNutritionReminderCron(storage);
      expect(result.usersChecked).toBe(1);
      // Refuel fires (inside window, gap unmet); evening slot doesn't (15:00).
      expect(result.remindersSent).toBe(1);
      expect(storage.users.getUsers).toHaveBeenCalledWith(["u1"]);
      expect(storage.users.getUser).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it("keeps processing the rest after one user's processing throws", async () => {
    const users = [makeUser({ id: "boom" }), makeUser({ id: "u1" })];
    const storage = makeStorage({ latestWorkout: REFUEL_WORKOUT, optedInUsers: users });
    vi.mocked(storage.workouts.getLatestStartedWorkout).mockImplementation(async (userId) => {
      if (userId === "boom") throw new Error("db down");
      return REFUEL_WORKOUT;
    });
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    try {
      const result = await runNutritionReminderCron(storage);
      expect(result.usersChecked).toBe(2);
      expect(result.remindersSent).toBe(1);
    } finally {
      vi.useRealTimers();
    }
  });
});
