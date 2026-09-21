import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  planEmailJobsForUser,
  processAnalysisDigest,
  processMafTestReminder,
  processMissedWorkoutReminder,
  processTodaySessionBrief,
  processWeeklyReviewReminder,
  processWeeklySummary,
  runEmailCronJob,
} from './emailScheduler';
import type { IStorage } from './storage';

vi.mock('./queue', () => ({
  queue: {
    send: vi.fn().mockResolvedValue(undefined),
  },
  sendJob: vi.fn().mockResolvedValue(undefined),
  sendJobNoRetry: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('./logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

vi.mock('./email', async () => {
  const templates = await import('./emailTemplates');
  return {
    todaySessionDeepLink: templates.todaySessionDeepLink,
    sendMafTestReminder: vi.fn().mockResolvedValue(true),
    sendWeeklySummary: vi.fn().mockResolvedValue(true),
    sendMissedWorkoutReminder: vi.fn().mockResolvedValue(true),
    sendWeeklyReviewReminder: vi.fn().mockResolvedValue(true),
    sendTodaySessionBrief: vi.fn().mockResolvedValue(true),
    sendAnalysisDigest: vi.fn().mockResolvedValue(true),
  };
});

vi.mock('./services/weeklyReviewService', () => ({
  buildWeeklyReview: vi.fn(),
}));

vi.mock('./pushNotifications', () => ({
  sendPushToUser: vi.fn().mockResolvedValue(0),
}));

// Shared scheduler-fixture defaults. Tests pass only the fields they actually
// care about (id, email, userTimezone overrides, flag toggles); everything
// else falls through to the defaults below. Factored to keep the duplication
// detector happy and to make per-test intent obvious.
type SchedulerUserOverrides = {
  id: string | number;
  email: string;
  userTimezone?: string;
  notifyHour?: number | null;
  notifyHourWeeklySummary?: number | null;
  notifyHourMissedReminder?: number | null;
  notifyHourWeeklyReviewReminder?: number | null;
  notifyHourTodaySession?: number | null;
  notifyHourAnalysisDigest?: number | null;
  emailNotifications?: boolean;
  emailWeeklySummary?: boolean | null;
  emailMissedReminder?: boolean | null;
  emailWeeklyReviewReminder?: boolean | null;
  emailTodaySession?: boolean | null;
  emailAnalysisDigest?: boolean | null;
  lastWeeklySummaryAt?: Date | null;
  lastMissedReminderAt?: Date | null;
  lastWeeklyReviewReminderAt?: Date | null;
  lastTodaySessionAt?: Date | null;
  lastAnalysisDigestAt?: Date | null;
};

function makeMockUser(overrides: SchedulerUserOverrides) {
  return {
    userTimezone: 'UTC',
    notifyHour: 7,
    notifyHourWeeklySummary: null,
    notifyHourMissedReminder: null,
    notifyHourWeeklyReviewReminder: null,
    notifyHourTodaySession: null,
    notifyHourAnalysisDigest: null,
    emailNotifications: true,
    emailWeeklySummary: true,
    emailMissedReminder: true,
    emailWeeklyReviewReminder: false,
    emailTodaySession: false,
    emailAnalysisDigest: false,
    lastWeeklySummaryAt: null,
    lastMissedReminderAt: null,
    lastWeeklyReviewReminderAt: null,
    lastTodaySessionAt: null,
    lastAnalysisDigestAt: null,
    ...overrides,
  };
}

describe('runEmailCronJob', () => {
  let mockStorage: IStorage;

  beforeEach(() => {
    vi.useFakeTimers();
    // A Monday at 07:00 UTC — the default notify hour for these UTC fixtures —
    // so both the weekly summary and the missed reminder are due.
    vi.setSystemTime(new Date('2023-10-16T07:00:00Z'));

    mockStorage = {
      plans: { markMissedPlanDays: vi.fn().mockResolvedValue(0) },
      users: {
        getUsersWithEmailNotifications: vi.fn().mockResolvedValue([
          makeMockUser({ id: 1, email: 'test@example.com' }),
        ]),
        getUsersWithDueMafBaselineTest: vi.fn().mockResolvedValue([]),
      },
    } as unknown as IStorage;
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  it('should enqueue email jobs for users with notifications', async () => {
    const { sendJobNoRetry } = await import('./queue');
    const result = await runEmailCronJob(mockStorage);

    expect(result.usersChecked).toBe(1);
    // On Monday: 1 weekly summary + 1 missed reminder = 2 jobs
    expect(result.emailsSent).toBe(2);
    expect(sendJobNoRetry).toHaveBeenCalledWith('send-weekly-summary', { userId: 1 });
    expect(sendJobNoRetry).toHaveBeenCalledWith('send-missed-reminder', { userId: 1 });
  });

  it('enqueues a MAF test reminder for users whose baseline test is due', async () => {
    const { sendJobNoRetry } = await import('./queue');
    mockStorage.users.getUsersWithDueMafBaselineTest = vi
      .fn()
      .mockResolvedValue([makeMockUser({ id: 7, email: 'maf@example.com' })]);

    await runEmailCronJob(mockStorage);

    expect(sendJobNoRetry).toHaveBeenCalledWith('send-maf-test-reminder', { userId: 7 });
  });

  it('should enqueue jobs for multiple users independently', async () => {
    const { sendJobNoRetry } = await import('./queue');

    mockStorage.users.getUsersWithEmailNotifications = vi.fn().mockResolvedValue([
      makeMockUser({ id: 1, email: 'user1@example.com' }),
      makeMockUser({ id: 2, email: 'user2@example.com' }),
    ]);

    const result = await runEmailCronJob(mockStorage);

    expect(result.usersChecked).toBe(2);
    // On Monday: 2 weekly summary + 2 missed reminder = 4 jobs
    expect(result.emailsSent).toBe(4);
    expect(sendJobNoRetry).toHaveBeenCalledTimes(4);
  });

  it('should only enqueue missed-reminder jobs on non-Monday', async () => {
    const { sendJobNoRetry } = await import('./queue');
    // Set to a Tuesday (still at the notify hour)
    vi.setSystemTime(new Date('2023-10-17T07:00:00Z'));

    const result = await runEmailCronJob(mockStorage);

    expect(result.usersChecked).toBe(1);
    // Not Monday: only 1 missed reminder
    expect(result.emailsSent).toBe(1);
    expect(sendJobNoRetry).toHaveBeenCalledWith('send-missed-reminder', { userId: 1 });
    expect(sendJobNoRetry).not.toHaveBeenCalledWith('send-weekly-summary', expect.anything());
  });

  it('should return early when no users have notifications or due MAF tests', async () => {
    mockStorage.users.getUsersWithEmailNotifications = vi.fn().mockResolvedValue([]);
    mockStorage.users.getUsersWithDueMafBaselineTest = vi.fn().mockResolvedValue([]);

    const result = await runEmailCronJob(mockStorage);

    expect(result.usersChecked).toBe(0);
    expect(result.emailsSent).toBe(0);
    expect(result.details).toContain('No users with email notifications or due MAF tests');
  });

  it('skips the weekly summary when the user has opted out via emailWeeklySummary=false', async () => {
    const { sendJobNoRetry } = await import('./queue');
    mockStorage.users.getUsersWithEmailNotifications = vi.fn().mockResolvedValue([
      makeMockUser({ id: 'user-weekly-off', email: 'weekly-off@example.com', emailWeeklySummary: false }),
    ]);

    const result = await runEmailCronJob(mockStorage);

    // Monday, but the weekly summary is opted out → only 1 job enqueued.
    expect(result.usersChecked).toBe(1);
    expect(result.emailsSent).toBe(1);
    expect(sendJobNoRetry).toHaveBeenCalledWith('send-missed-reminder', { userId: 'user-weekly-off' });
    expect(sendJobNoRetry).not.toHaveBeenCalledWith('send-weekly-summary', expect.anything());
  });

  it('skips the missed reminder when the user has opted out via emailMissedReminder=false', async () => {
    const { sendJobNoRetry } = await import('./queue');
    mockStorage.users.getUsersWithEmailNotifications = vi.fn().mockResolvedValue([
      makeMockUser({ id: 'user-missed-off', email: 'missed-off@example.com', emailMissedReminder: false }),
    ]);

    const result = await runEmailCronJob(mockStorage);

    expect(result.usersChecked).toBe(1);
    expect(result.emailsSent).toBe(1);
    expect(sendJobNoRetry).toHaveBeenCalledWith('send-weekly-summary', { userId: 'user-missed-off' });
    expect(sendJobNoRetry).not.toHaveBeenCalledWith('send-missed-reminder', expect.anything());
  });

  it('enqueues nothing for a user with both per-type flags off even if master is on', async () => {
    mockStorage.users.getUsersWithEmailNotifications = vi.fn().mockResolvedValue([
      makeMockUser({ id: 'user-both-off', email: 'both-off@example.com', emailWeeklySummary: false, emailMissedReminder: false }),
    ]);

    const result = await runEmailCronJob(mockStorage);

    expect(result.usersChecked).toBe(1);
    expect(result.emailsSent).toBe(0);
  });

  it('treats null per-type email flags as not opted in', async () => {
    mockStorage.users.getUsersWithEmailNotifications = vi.fn().mockResolvedValue([
      makeMockUser({ id: 'user-null-flags', email: 'null-flags@example.com', emailWeeklySummary: null, emailMissedReminder: null }),
    ]);

    const result = await runEmailCronJob(mockStorage);

    expect(result.usersChecked).toBe(1);
    expect(result.emailsSent).toBe(0);
  });

  describe('per-user timezone (C10)', () => {
    it('enqueues the weekly summary for a Sydney user when it is Monday in Sydney but still Sunday in UTC', async () => {
      const { sendJobNoRetry } = await import('./queue');
      // 2026-05-31 Sunday 23:00 UTC = 2026-06-01 Monday 09:00 in Australia/Sydney.
      // Both athletes have 09:00 as their notify hour, so only the weekday differs.
      vi.setSystemTime(new Date('2026-05-31T23:00:00Z'));

      mockStorage.users.getUsersWithEmailNotifications = vi.fn().mockResolvedValue([
        makeMockUser({ id: 'sydney-user', email: 'sydney@example.com', userTimezone: 'Australia/Sydney', notifyHour: 9, emailMissedReminder: false }),
        makeMockUser({ id: 'utc-user', email: 'utc@example.com', notifyHour: 23, emailMissedReminder: false }),
      ]);

      const result = await runEmailCronJob(mockStorage);

      expect(result.usersChecked).toBe(2);
      // Sydney is on Monday → weekly enqueued. UTC user is still on Sunday → not.
      expect(result.emailsSent).toBe(1);
      expect(sendJobNoRetry).toHaveBeenCalledWith('send-weekly-summary', { userId: 'sydney-user' });
      expect(sendJobNoRetry).not.toHaveBeenCalledWith('send-weekly-summary', { userId: 'utc-user' });
    });

    it('still enqueues the weekly summary for a Hawaii user when it is Monday in Hawaii but already Tuesday in UTC', async () => {
      const { sendJobNoRetry } = await import('./queue');
      // 2026-06-02 Tuesday 06:00 UTC = 2026-06-01 Monday 20:00 in Pacific/Honolulu (UTC-10),
      // an evening notify hour.
      vi.setSystemTime(new Date('2026-06-02T06:00:00Z'));

      mockStorage.users.getUsersWithEmailNotifications = vi.fn().mockResolvedValue([
        makeMockUser({ id: 'hawaii-user', email: 'hi@example.com', userTimezone: 'Pacific/Honolulu', notifyHour: 20, emailMissedReminder: false }),
      ]);

      const result = await runEmailCronJob(mockStorage);

      expect(result.usersChecked).toBe(1);
      expect(result.emailsSent).toBe(1);
      expect(sendJobNoRetry).toHaveBeenCalledWith('send-weekly-summary', { userId: 'hawaii-user' });
    });
  });
});

describe('planEmailJobsForUser (notify hour gate)', () => {
  const user = (overrides: Partial<SchedulerUserOverrides> = {}) =>
    makeMockUser({ id: 'u1', email: 'u1@example.com', ...overrides }) as never;

  it('plans nothing outside the notify hour and both daily jobs at it', () => {
    // Monday 06:00 UTC vs 07:00 UTC for a UTC athlete on the default hour.
    expect(planEmailJobsForUser(user(), new Date('2026-07-20T06:00:00Z'))).toEqual([]);
    expect(planEmailJobsForUser(user(), new Date('2026-07-20T07:00:00Z'))).toEqual([
      'send-weekly-summary',
      'send-missed-reminder',
    ]);
  });

  it('honours a chosen notify hour in the athlete\'s own timezone', () => {
    // Tuesday 18:00 in Los Angeles is 01:00 UTC on Wednesday.
    const la = user({ userTimezone: 'America/Los_Angeles', notifyHour: 18 });
    expect(planEmailJobsForUser(la, new Date('2026-07-22T01:00:00Z'))).toEqual(['send-missed-reminder']);
    expect(planEmailJobsForUser(la, new Date('2026-07-21T14:00:00Z'))).toEqual([]);
  });

  it('falls back to 07:00 when no notify hour is stored', () => {
    expect(planEmailJobsForUser(user({ notifyHour: null }), new Date('2026-07-21T07:00:00Z'))).toEqual([
      'send-missed-reminder',
    ]);
  });

  it('only plans the weekly summary on the local Monday', () => {
    expect(planEmailJobsForUser(user(), new Date('2026-07-21T07:00:00Z'))).toEqual(['send-missed-reminder']);
  });

  it('throws on an unusable timezone so the scan can skip just that athlete', () => {
    expect(() => planEmailJobsForUser(user({ userTimezone: 'Not/AZone' }), new Date())).toThrow();
  });

  it('adds the brief and the digest at the notify hour when opted in', () => {
    const optedIn = user({ emailTodaySession: true, emailAnalysisDigest: true, emailWeeklySummary: false });
    // Tuesday 07:00 UTC.
    expect(planEmailJobsForUser(optedIn, new Date('2026-07-21T07:00:00Z'))).toEqual([
      'send-missed-reminder',
      'send-today-session',
      'send-analysis-digest',
    ]);
  });

  it('plans the weekly review reminder on Sunday at 17:00 local regardless of the notify hour', () => {
    // Sunday 2026-07-19, 17:00 in Sydney = 07:00 UTC.
    const sydney = user({ userTimezone: 'Australia/Sydney', notifyHour: 7, emailWeeklyReviewReminder: true, emailMissedReminder: false });
    expect(planEmailJobsForUser(sydney, new Date('2026-07-19T07:00:00Z'))).toEqual(['send-weekly-review-reminder']);
    // Sunday 07:00 local (Saturday 21:00 UTC) is the notify hour, not the review hour.
    expect(planEmailJobsForUser(sydney, new Date('2026-07-18T21:00:00Z'))).toEqual([]);
    // Monday 17:00 local is not Sunday.
    expect(planEmailJobsForUser(sydney, new Date('2026-07-20T07:00:00Z'))).toEqual([]);
  });

  it('never plans a category the athlete has not opted into', () => {
    const none = user({ emailWeeklySummary: false, emailMissedReminder: false });
    expect(planEmailJobsForUser(none, new Date('2026-07-19T17:00:00Z'))).toEqual([]);
    expect(planEmailJobsForUser(none, new Date('2026-07-20T07:00:00Z'))).toEqual([]);
  });

  it('sends each email at its own hour when the athlete has set them apart', () => {
    const split = user({
      emailTodaySession: true,
      notifyHourWeeklySummary: 9,
      notifyHourTodaySession: 19,
    });
    // Monday 07:00 UTC: only the missed reminder, still on the default hour.
    expect(planEmailJobsForUser(split, new Date('2026-07-20T07:00:00Z'))).toEqual([
      'send-missed-reminder',
    ]);
    expect(planEmailJobsForUser(split, new Date('2026-07-20T09:00:00Z'))).toEqual([
      'send-weekly-summary',
    ]);
    expect(planEmailJobsForUser(split, new Date('2026-07-20T19:00:00Z'))).toEqual([
      'send-today-session',
    ]);
  });

  it('resolves a per-email hour in the athlete\'s own timezone', () => {
    // 20:00 Monday in Los Angeles is 03:00 UTC on Tuesday — still Monday local,
    // so the weekly summary is due then and not at 20:00 UTC.
    const la = user({ userTimezone: 'America/Los_Angeles', notifyHourWeeklySummary: 20, emailMissedReminder: false });
    expect(planEmailJobsForUser(la, new Date('2026-07-21T03:00:00Z'))).toEqual(['send-weekly-summary']);
    expect(planEmailJobsForUser(la, new Date('2026-07-20T20:00:00Z'))).toEqual([]);
  });

  it('moves the review reminder off Sunday evening when it has an hour of its own', () => {
    const early = user({
      emailWeeklyReviewReminder: true,
      notifyHourWeeklyReviewReminder: 9,
      emailMissedReminder: false,
      emailWeeklySummary: false,
    });
    // Sunday 2026-07-19: 09:00 instead of the 17:00 default.
    expect(planEmailJobsForUser(early, new Date('2026-07-19T09:00:00Z'))).toEqual([
      'send-weekly-review-reminder',
    ]);
    expect(planEmailJobsForUser(early, new Date('2026-07-19T17:00:00Z'))).toEqual([]);
    // Still Sunday-only: the day gate is not what the hour overrides.
    expect(planEmailJobsForUser(early, new Date('2026-07-20T09:00:00Z'))).toEqual([]);
  });

  it('leaves an email on the default send time when it has no hour of its own', () => {
    // A default hour of 9 moves every email that has not been given its own.
    const moved = user({ notifyHour: 9, emailTodaySession: true, notifyHourTodaySession: 19 });
    expect(planEmailJobsForUser(moved, new Date('2026-07-20T09:00:00Z'))).toEqual([
      'send-weekly-summary',
      'send-missed-reminder',
    ]);
    expect(planEmailJobsForUser(moved, new Date('2026-07-20T19:00:00Z'))).toEqual([
      'send-today-session',
    ]);
  });
});

describe('processWeeklyReviewReminder', () => {
  // Sunday 2026-07-19 17:00 UTC.
  const sundayEvening = new Date('2026-07-19T17:00:00Z');

  function reviewStorage(user: Record<string, unknown>, { hasRow = false, claims = [true] } = {}) {
    const queue = [...claims];
    const claim = vi.fn().mockImplementation(() => Promise.resolve(queue.shift() ?? false));
    const getIntents = vi.fn().mockImplementation((_id: string, weeks: string[]) =>
      Promise.resolve(new Map(hasRow ? weeks.map((w) => [w, null]) : [])),
    );
    return {
      storage: {
        users: { getUser: vi.fn().mockResolvedValue(user), claimWeeklyReviewReminder: claim },
        weeklyReviews: { getIntents },
      } as unknown as IStorage,
      claim,
      getIntents,
    };
  }

  const review = {
    weekStart: '2026-07-13',
    weekEnd: '2026-07-19',
    weeklyGoal: 4,
    current: { sessionsLogged: 3, sessionsPlanned: 4, plannedCompleted: 3, missed: 1, totalDurationMin: 150, avgRpe: 6.5 },
    personalRecords: [{ exerciseName: 'Back squat', metric: 'maxWeight' }],
    previousIntent: 'get three runs in',
  };

  beforeEach(async () => {
    vi.clearAllMocks();
    const { buildWeeklyReview } = await import('./services/weeklyReviewService');
    vi.mocked(buildWeeklyReview).mockResolvedValue(review as never);
  });

  it('does nothing outside Sunday', async () => {
    const user = makeMockUser({ id: 'u1', email: 'a@example.com', emailWeeklyReviewReminder: true });
    const { storage, claim } = reviewStorage(user);

    expect(await processWeeklyReviewReminder(storage, user as never, new Date('2026-07-20T17:00:00Z'))).toBe(false);
    expect(claim).not.toHaveBeenCalled();
  });

  it('does nothing when the athlete has not opted in', async () => {
    const user = makeMockUser({ id: 'u1', email: 'a@example.com', emailWeeklyReviewReminder: false });
    const { storage, claim } = reviewStorage(user);

    expect(await processWeeklyReviewReminder(storage, user as never, sundayEvening)).toBe(false);
    expect(claim).not.toHaveBeenCalled();
  });

  it('skips without claiming when this week already has a review row', async () => {
    const user = makeMockUser({ id: 'u1', email: 'a@example.com', emailWeeklyReviewReminder: true });
    const { storage, claim, getIntents } = reviewStorage(user, { hasRow: true });

    expect(await processWeeklyReviewReminder(storage, user as never, sundayEvening)).toBe(false);
    expect(getIntents).toHaveBeenCalledWith('u1', ['2026-07-13']);
    expect(claim).not.toHaveBeenCalled();
  });

  it('claims, builds the in-progress week and emails plus pushes a link to the review', async () => {
    const { sendWeeklyReviewReminder } = await import('./email');
    const { sendPushToUser } = await import('./pushNotifications');
    const { buildWeeklyReview } = await import('./services/weeklyReviewService');
    const user = makeMockUser({ id: 'u1', email: 'a@example.com', emailWeeklyReviewReminder: true });
    const { storage, claim } = reviewStorage(user);

    expect(await processWeeklyReviewReminder(storage, user as never, sundayEvening)).toBe(true);

    expect(claim.mock.invocationCallOrder[0]).toBeLessThan(vi.mocked(sendWeeklyReviewReminder).mock.invocationCallOrder[0]);
    const windowMs = sundayEvening.getTime() - (claim.mock.calls[0][1] as Date).getTime();
    expect(windowMs).toBeGreaterThan(24 * 60 * 60 * 1000);
    expect(windowMs).toBeLessThan(7 * 24 * 60 * 60 * 1000);
    expect(buildWeeklyReview).toHaveBeenCalledWith(storage, 'u1', { now: sundayEvening, week: '2026-07-19' });
    const [, data] = vi.mocked(sendWeeklyReviewReminder).mock.calls[0];
    expect(data).toMatchObject({ weekStart: '2026-07-13', sessionsLogged: 3, previousIntent: 'get three runs in' });
    expect(data.personalRecords).toEqual([{ exerciseName: 'Back squat', metric: 'maxWeight' }]);
    expect(vi.mocked(sendPushToUser).mock.calls[0][1].url).toBe('/review?week=2026-07-13');
  });

  it('resolves the week in the athlete\'s own timezone', async () => {
    const { buildWeeklyReview } = await import('./services/weeklyReviewService');
    // Sunday 2026-07-19 17:00 in Sydney is 07:00 UTC the same day.
    const user = makeMockUser({ id: 'u1', email: 'a@example.com', userTimezone: 'Australia/Sydney', emailWeeklyReviewReminder: true });
    const { storage, getIntents } = reviewStorage(user);

    await processWeeklyReviewReminder(storage, user as never, new Date('2026-07-19T07:00:00Z'));

    expect(getIntents).toHaveBeenCalledWith('u1', ['2026-07-13']);
    expect(buildWeeklyReview).toHaveBeenCalledWith(storage, 'u1', expect.objectContaining({ week: '2026-07-19' }));
  });

  it('sends once when two producers race', async () => {
    const { sendWeeklyReviewReminder } = await import('./email');
    const user = makeMockUser({ id: 'u1', email: 'a@example.com', emailWeeklyReviewReminder: true });
    const { storage } = reviewStorage(user, { claims: [true, false] });

    const results = await Promise.all([
      processWeeklyReviewReminder(storage, user as never, sundayEvening),
      processWeeklyReviewReminder(storage, user as never, sundayEvening),
    ]);

    expect(results.filter(Boolean)).toHaveLength(1);
    expect(sendWeeklyReviewReminder).toHaveBeenCalledTimes(1);
  });
});

describe('processTodaySessionBrief', () => {
  // Tuesday 2026-07-21 07:00 UTC.
  const morning = new Date('2026-07-21T07:00:00Z');
  const session = {
    planDayId: 'pd-1',
    focus: 'Threshold intervals',
    mainWorkout: '6x800m at 5k pace',
    expectedDurationMin: 55,
    expectedRpe: 7,
    plannedTimeOfDayMin: 390,
    planName: 'Build',
  };

  function briefStorage(user: Record<string, unknown>, sessions: unknown[], claims = [true]) {
    const queue = [...claims];
    const claim = vi.fn().mockImplementation(() => Promise.resolve(queue.shift() ?? false));
    const getPlannedSessionsForDate = vi.fn().mockResolvedValue(sessions);
    return {
      storage: {
        users: { getUser: vi.fn().mockResolvedValue(user), claimTodaySession: claim },
        analytics: { getPlannedSessionsForDate },
      } as unknown as IStorage,
      claim,
      getPlannedSessionsForDate,
    };
  }

  beforeEach(() => vi.clearAllMocks());

  it('does not claim when nothing is planned', async () => {
    const user = makeMockUser({ id: 'u1', email: 'a@example.com', emailTodaySession: true });
    const { storage, claim, getPlannedSessionsForDate } = briefStorage(user, []);

    expect(await processTodaySessionBrief(storage, user as never, morning)).toBe(false);
    expect(getPlannedSessionsForDate).toHaveBeenCalledWith('u1', '2026-07-21');
    expect(claim).not.toHaveBeenCalled();
  });

  it('treats a rest-like plan day as nothing planned', async () => {
    const user = makeMockUser({ id: 'u1', email: 'a@example.com', emailTodaySession: true });
    const { storage, claim } = briefStorage(user, [{ ...session, focus: 'Rest', mainWorkout: 'Complete rest or light walk' }]);

    expect(await processTodaySessionBrief(storage, user as never, morning)).toBe(false);
    expect(claim).not.toHaveBeenCalled();
  });

  it('claims, emails and pushes a deep link to the single session', async () => {
    const { sendTodaySessionBrief } = await import('./email');
    const { sendPushToUser } = await import('./pushNotifications');
    const user = makeMockUser({ id: 'u1', email: 'a@example.com', emailTodaySession: true });
    const { storage, claim } = briefStorage(user, [session]);

    expect(await processTodaySessionBrief(storage, user as never, morning)).toBe(true);

    expect(claim.mock.invocationCallOrder[0]).toBeLessThan(vi.mocked(sendTodaySessionBrief).mock.invocationCallOrder[0]);
    const windowMs = morning.getTime() - (claim.mock.calls[0][1] as Date).getTime();
    expect(windowMs).toBeGreaterThan(12 * 60 * 60 * 1000);
    expect(windowMs).toBeLessThan(24 * 60 * 60 * 1000);
    const [, data] = vi.mocked(sendTodaySessionBrief).mock.calls[0];
    expect(data).toEqual({ date: '2026-07-21', isTomorrow: false, sessions: [session] });
    const push = vi.mocked(sendPushToUser).mock.calls[0][1];
    expect(push).toEqual({ title: 'Today: Threshold intervals', body: '~55 min · RPE 7', url: '/?workout=pd-1' });
  });

  it('falls back to the timeline root when several sessions are planned', async () => {
    const { sendPushToUser } = await import('./pushNotifications');
    const user = makeMockUser({ id: 'u1', email: 'a@example.com', emailTodaySession: true });
    const { storage } = briefStorage(user, [session, { ...session, planDayId: 'pd-2', focus: 'Mobility' }]);

    await processTodaySessionBrief(storage, user as never, morning);

    const push = vi.mocked(sendPushToUser).mock.calls[0][1];
    expect(push.title).toBe('Today: 2 sessions');
    expect(push.url).toBe('/');
  });

  it('briefs tomorrow for an afternoon or evening notify hour', async () => {
    const { sendTodaySessionBrief } = await import('./email');
    // 18:00 in Los Angeles on Tuesday 2026-07-21 = 01:00 UTC Wednesday.
    const user = makeMockUser({ id: 'u1', email: 'a@example.com', userTimezone: 'America/Los_Angeles', notifyHour: 18, emailTodaySession: true });
    const { storage, getPlannedSessionsForDate } = briefStorage(user, [session]);

    await processTodaySessionBrief(storage, user as never, new Date('2026-07-22T01:00:00Z'));

    expect(getPlannedSessionsForDate).toHaveBeenCalledWith('u1', '2026-07-22');
    const [, data] = vi.mocked(sendTodaySessionBrief).mock.calls[0];
    expect(data.isTomorrow).toBe(true);
    expect(data.date).toBe('2026-07-22');
  });

  it("briefs tomorrow off the brief's own send hour, not the default one", async () => {
    const { sendTodaySessionBrief } = await import('./email');
    // The default send time stays at 07:00; only the brief moved to 18:00.
    const user = makeMockUser({
      id: 'u1',
      email: 'a@example.com',
      userTimezone: 'America/Los_Angeles',
      notifyHour: 7,
      notifyHourTodaySession: 18,
      emailTodaySession: true,
    });
    const { storage, getPlannedSessionsForDate } = briefStorage(user, [session]);

    await processTodaySessionBrief(storage, user as never, new Date('2026-07-22T01:00:00Z'));

    expect(getPlannedSessionsForDate).toHaveBeenCalledWith('u1', '2026-07-22');
    const [, data] = vi.mocked(sendTodaySessionBrief).mock.calls[0];
    expect(data.isTomorrow).toBe(true);
  });

  it('survives a rejected push send', async () => {
    const { sendPushToUser } = await import('./pushNotifications');
    vi.mocked(sendPushToUser).mockRejectedValueOnce(new Error('push down'));
    const user = makeMockUser({ id: 'u1', email: 'a@example.com', emailTodaySession: true });
    const { storage } = briefStorage(user, [session]);

    await expect(processTodaySessionBrief(storage, user as never, morning)).resolves.toBe(true);
    await Promise.resolve();
  });
});

describe('processAnalysisDigest', () => {
  const now = new Date('2026-07-21T07:00:00Z');
  const coachRow = {
    feature: 'coach_insights',
    generatedAt: new Date('2026-07-20T00:05:00Z'),
    payload: { insights: '1. **Goal Progress** — on track', generatedAt: '2026-07-20T00:05:00Z' },
  };
  const raceRow = {
    feature: 'race_prediction',
    generatedAt: new Date('2026-07-19T00:05:00Z'),
    payload: {
      totalFinishSeconds: 5400,
      overallConfidence: 'medium',
      percentile: { fasterThanPct: 62, cohortLabel: 'Open Men 35-39', cohortSize: 1200, basis: 'age_group' },
      raceReadiness: { tsb: 4, status: 'fresh', guidance: 'Keep the taper.' },
    },
  };

  function digestStorage(user: Record<string, unknown>, rows: unknown[], claims = [true]) {
    const queue = [...claims];
    const claim = vi.fn().mockImplementation(() => Promise.resolve(queue.shift() ?? false));
    return {
      storage: {
        users: { getUser: vi.fn().mockResolvedValue(user), claimAnalysisDigest: claim },
        analyticsResults: { getMany: vi.fn().mockResolvedValue(rows) },
      } as unknown as IStorage,
      claim,
    };
  }

  beforeEach(() => vi.clearAllMocks());

  it('does not claim when the athlete has no stored analysis', async () => {
    const user = makeMockUser({ id: 'u1', email: 'a@example.com', emailAnalysisDigest: true });
    const { storage, claim } = digestStorage(user, []);

    expect(await processAnalysisDigest(storage, user as never, now)).toBe(false);
    expect(claim).not.toHaveBeenCalled();
  });

  it('does not claim when nothing is newer than the last digest', async () => {
    const user = makeMockUser({ id: 'u1', email: 'a@example.com', emailAnalysisDigest: true, lastAnalysisDigestAt: new Date('2026-07-20T07:00:00Z') });
    const { storage, claim } = digestStorage(user, [coachRow, raceRow]);

    expect(await processAnalysisDigest(storage, user as never, now)).toBe(false);
    expect(claim).not.toHaveBeenCalled();
  });

  it('sends the first digest ever and passes both analyses through', async () => {
    const { sendAnalysisDigest } = await import('./email');
    const { sendPushToUser } = await import('./pushNotifications');
    const user = makeMockUser({ id: 'u1', email: 'a@example.com', emailAnalysisDigest: true, lastAnalysisDigestAt: null });
    const { storage, claim } = digestStorage(user, [coachRow, raceRow]);

    expect(await processAnalysisDigest(storage, user as never, now)).toBe(true);

    expect(claim.mock.invocationCallOrder[0]).toBeLessThan(vi.mocked(sendAnalysisDigest).mock.invocationCallOrder[0]);
    const windowMs = now.getTime() - (claim.mock.calls[0][1] as Date).getTime();
    expect(windowMs).toBeGreaterThan(24 * 60 * 60 * 1000);
    expect(windowMs).toBeLessThan(7 * 24 * 60 * 60 * 1000);
    const [, data] = vi.mocked(sendAnalysisDigest).mock.calls[0];
    expect(data.coachInsightsMarkdown).toBe('1. **Goal Progress** — on track');
    expect(data.coachInsightsGeneratedAt).toBe('2026-07-20T00:05:00.000Z');
    expect(data.racePrediction).toEqual({
      totalFinishSeconds: 5400,
      overallConfidence: 'medium',
      percentile: { fasterThanPct: 62, cohortLabel: 'Open Men 35-39', cohortSize: 1200 },
      raceReadiness: { status: 'fresh', guidance: 'Keep the taper.' },
      generatedAt: '2026-07-19T00:05:00.000Z',
    });
    const push = vi.mocked(sendPushToUser).mock.calls[0][1];
    expect(push.url).toBe('/analytics');
    expect(push.body).toBe('Predicted finish 1:30:00 · new coach insights');
  });

  it('sends when only one analysis is newer than the last digest', async () => {
    const { sendAnalysisDigest } = await import('./email');
    // Digest went out after the race prediction but before the coach insights.
    const user = makeMockUser({ id: 'u1', email: 'a@example.com', emailAnalysisDigest: true, lastAnalysisDigestAt: new Date('2026-07-19T07:00:00Z') });
    const { storage } = digestStorage(user, [coachRow, raceRow]);

    expect(await processAnalysisDigest(storage, user as never, now)).toBe(true);
    expect(sendAnalysisDigest).toHaveBeenCalledTimes(1);
  });

  it('ignores malformed rows and never lets them count as new', async () => {
    const { sendAnalysisDigest } = await import('./email');
    const user = makeMockUser({ id: 'u1', email: 'a@example.com', emailAnalysisDigest: true, lastAnalysisDigestAt: new Date('2026-07-19T12:00:00Z') });
    const brokenCoach = { ...coachRow, payload: { insights: 42 } };
    const { storage, claim } = digestStorage(user, [brokenCoach, raceRow]);

    // The only valid row (race, 19th 00:05) predates the last digest.
    expect(await processAnalysisDigest(storage, user as never, now)).toBe(false);
    expect(claim).not.toHaveBeenCalled();

    // With no ledger at all the valid row alone is sent, without the broken one.
    const fresh = makeMockUser({ id: 'u1', email: 'a@example.com', emailAnalysisDigest: true, lastAnalysisDigestAt: null });
    const second = digestStorage(fresh, [brokenCoach, raceRow]);
    expect(await processAnalysisDigest(second.storage, fresh as never, now)).toBe(true);
    const [, data] = vi.mocked(sendAnalysisDigest).mock.calls[0];
    expect(data.coachInsightsMarkdown).toBeNull();
    expect(data.racePrediction?.totalFinishSeconds).toBe(5400);
  });

  it('sends once when two producers race', async () => {
    const { sendAnalysisDigest } = await import('./email');
    const user = makeMockUser({ id: 'u1', email: 'a@example.com', emailAnalysisDigest: true, lastAnalysisDigestAt: null });
    const { storage } = digestStorage(user, [coachRow], [true, false]);

    const results = await Promise.all([
      processAnalysisDigest(storage, user as never, now),
      processAnalysisDigest(storage, user as never, now),
    ]);

    expect(results.filter(Boolean)).toHaveLength(1);
    expect(sendAnalysisDigest).toHaveBeenCalledTimes(1);
  });

  it('does nothing when the athlete has not opted in', async () => {
    const user = makeMockUser({ id: 'u1', email: 'a@example.com', emailAnalysisDigest: false });
    const { storage, claim } = digestStorage(user, [coachRow]);

    expect(await processAnalysisDigest(storage, user as never, now)).toBe(false);
    expect(claim).not.toHaveBeenCalled();
  });
});

describe('runEmailCronJob resilience', () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  it('keeps enqueueing for other athletes when one has a broken timezone', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2023-10-17T07:00:00Z'));
    const { sendJobNoRetry } = await import('./queue');
    const storage = {
      plans: { markMissedPlanDays: vi.fn().mockResolvedValue(0) },
      users: {
        getUsersWithEmailNotifications: vi.fn().mockResolvedValue([
          makeMockUser({ id: 'broken', email: 'b@example.com', userTimezone: 'Not/AZone' }),
          makeMockUser({ id: 'fine', email: 'f@example.com' }),
        ]),
        getUsersWithDueMafBaselineTest: vi.fn().mockResolvedValue([]),
      },
    } as unknown as IStorage;

    const result = await runEmailCronJob(storage);

    expect(result.emailsSent).toBe(1);
    expect(sendJobNoRetry).toHaveBeenCalledWith('send-missed-reminder', { userId: 'fine' });
    expect(sendJobNoRetry).not.toHaveBeenCalledWith(expect.anything(), { userId: 'broken' });
  });
});

function storageFor(user: Record<string, unknown>, claimed = true): IStorage {
  return {
    users: {
      getUser: vi.fn().mockResolvedValue(user),
      claimMafBaselineTest: vi.fn().mockResolvedValue(claimed),
    },
  } as unknown as IStorage;
}

describe('processMafTestReminder', () => {
  const now = new Date('2026-06-01T12:00:00Z');
  const dueAt = new Date('2026-05-30T12:00:00Z'); // in the past → due

  beforeEach(() => vi.clearAllMocks());

  it('claims the one-shot schedule and emails when the claim wins + opted in', async () => {
    const { sendMafTestReminder } = await import('./email');
    const storage = storageFor({
      id: 'u1', email: 'a@b.com', trainingStyleId: 'maf_method',
      mafBaselineTestScheduledAt: dueAt, emailNotifications: true,
    });

    const sent = await processMafTestReminder(storage, { id: 'u1' } as never, now);

    expect(storage.users.claimMafBaselineTest).toHaveBeenCalledWith('u1', now);
    expect(sendMafTestReminder).toHaveBeenCalled();
    expect(sent).toBe(true);
  });

  it('does not email when the claim is lost (not due, or already claimed by another run)', async () => {
    const { sendMafTestReminder } = await import('./email');
    const storage = storageFor({
      id: 'u1', email: 'a@b.com', trainingStyleId: 'maf_method',
      mafBaselineTestScheduledAt: new Date('2026-06-10T12:00:00Z'), emailNotifications: true,
    }, false);

    const sent = await processMafTestReminder(storage, { id: 'u1' } as never, now);

    expect(sent).toBe(false);
    expect(storage.users.claimMafBaselineTest).toHaveBeenCalledWith('u1', now);
    expect(sendMafTestReminder).not.toHaveBeenCalled();
  });

  it('returns false without claiming when the user is no longer on MAF', async () => {
    const { sendMafTestReminder } = await import('./email');
    const storage = storageFor({
      id: 'u1', email: 'a@b.com', trainingStyleId: 'hyrox',
      mafBaselineTestScheduledAt: dueAt, emailNotifications: true,
    });

    const sent = await processMafTestReminder(storage, { id: 'u1' } as never, now);

    expect(sent).toBe(false);
    expect(storage.users.claimMafBaselineTest).not.toHaveBeenCalled();
    expect(sendMafTestReminder).not.toHaveBeenCalled();
  });

  it('claims but does not email when the user has opted out of email', async () => {
    const { sendMafTestReminder } = await import('./email');
    const storage = storageFor({
      id: 'u1', email: 'a@b.com', trainingStyleId: 'maf_method',
      mafBaselineTestScheduledAt: dueAt, emailNotifications: false,
    });

    const sent = await processMafTestReminder(storage, { id: 'u1' } as never, now);

    expect(storage.users.claimMafBaselineTest).toHaveBeenCalledWith('u1', now);
    expect(sendMafTestReminder).not.toHaveBeenCalled();
    expect(sent).toBe(false);
  });
});

describe('fire-and-forget push rejection containment', () => {
  // The three `void sendPushToUser(...)` sites carry a load-bearing .catch:
  // sendPushToUser awaits a DB read before its own allSettled guard, and the
  // process-wide unhandledRejection handler exits(1). These tests pin that a
  // rejected push send is swallowed and logged instead of escaping as an
  // unhandled rejection (which would crash the API during the cron burst).
  const now = new Date('2026-06-01T12:00:00Z');

  beforeEach(() => vi.clearAllMocks());

  it('processMafTestReminder survives a rejected push send and still reports the email result', async () => {
    const { sendPushToUser } = await import('./pushNotifications');
    const { logger } = await import('./logger');
    vi.mocked(sendPushToUser).mockRejectedValueOnce(new Error('db pool exhausted'));
    const storage = storageFor({
      id: 'u1', email: 'a@b.com', trainingStyleId: 'maf_method',
      mafBaselineTestScheduledAt: new Date('2026-05-30T12:00:00Z'), emailNotifications: true,
    });

    const sent = await processMafTestReminder(storage, { id: 'u1' } as never, now);

    // Let the detached promise's rejection propagate to the .catch.
    await new Promise((resolve) => setImmediate(resolve));

    expect(sent).toBe(true);
    expect(vi.mocked(logger.error)).toHaveBeenCalledWith(
      expect.objectContaining({ userId: 'u1' }),
      'MAF test push send failed',
    );
  });

  it('processMissedWorkoutReminder survives a rejected push send', async () => {
    const { sendPushToUser } = await import('./pushNotifications');
    const { logger } = await import('./logger');
    vi.mocked(sendPushToUser).mockRejectedValueOnce(new Error('connection reset'));
    const storage = {
      users: {
        getUser: vi.fn().mockResolvedValue(makeMockUser({ id: 'u1', email: 'a@b.com' })),
        claimMissedReminder: vi.fn().mockResolvedValue(true),
      },
      analytics: {
        getMissedWorkoutsForDate: vi.fn().mockResolvedValue([
          { planDayId: 'pd1', date: '2026-05-31', focus: 'Intervals', mainWorkout: '5x800m', planName: 'Base' },
        ]),
      },
    } as unknown as IStorage;

    const sent = await processMissedWorkoutReminder(storage, { id: 'u1' } as never, now);
    await new Promise((resolve) => setImmediate(resolve));

    expect(sent).toBe(true);
    expect(vi.mocked(logger.error)).toHaveBeenCalledWith(
      expect.objectContaining({ userId: 'u1' }),
      'missed workout push send failed',
    );
  });
});

describe('claim-before-send ledger', () => {
  // A Monday, so the weekly summary's day-of-week gate is open.
  const monday = new Date('2026-07-20T09:00:00Z');

  function emailStorage(user: Record<string, unknown>, claims: boolean[]) {
    const queue = [...claims];
    const claim = vi.fn().mockImplementation(() => Promise.resolve(queue.shift() ?? false));
    return {
      storage: {
        users: {
          getUser: vi.fn().mockResolvedValue(user),
          claimWeeklySummary: claim,
          claimMissedReminder: claim,
        },
        analytics: {
          getWeeklyStats: vi.fn().mockResolvedValue({}),
          getExerciseSetsForPersonalRecords: vi.fn().mockResolvedValue([]),
          getMissedWorkoutsForDate: vi
            .fn()
            .mockResolvedValue([{ planDayId: 'pd-1', date: '2026-07-19', focus: 'Easy Run', mainWorkout: '5k', planName: 'Plan' }]),
        },
        timeline: { getCompletedWorkoutDates: vi.fn().mockResolvedValue(new Set<string>()) },
      } as unknown as IStorage,
      claim,
    };
  }

  beforeEach(() => vi.clearAllMocks());

  it('sends the weekly summary exactly once when two producers race', async () => {
    const { sendWeeklySummary } = await import('./email');
    const user = makeMockUser({ id: 1, email: 'a@example.com' });
    // Two overlapping runs; only the first conditional UPDATE affects a row.
    const { storage, claim } = emailStorage(user, [true, false]);

    const [first, second] = await Promise.all([
      processWeeklySummary(storage, user as never, monday),
      processWeeklySummary(storage, user as never, monday),
    ]);

    expect(claim).toHaveBeenCalledTimes(2);
    expect([first, second].filter(Boolean)).toHaveLength(1);
    expect(sendWeeklySummary).toHaveBeenCalledTimes(1);
  });

  it('claims before handing anything to the mailer', async () => {
    const { sendWeeklySummary } = await import('./email');
    const user = makeMockUser({ id: 1, email: 'a@example.com' });
    const { storage, claim } = emailStorage(user, [true]);

    await processWeeklySummary(storage, user as never, monday);

    // The whole point: the ledger is written first, so a crash or a slow
    // Resend call cannot leave the decision un-recorded.
    expect(claim.mock.invocationCallOrder[0]).toBeLessThan(
      vi.mocked(sendWeeklySummary).mock.invocationCallOrder[0],
    );
  });

  it('claims against a window shorter than the weekly cadence, so consecutive Mondays both send', async () => {
    const user = makeMockUser({ id: 1, email: 'a@example.com' });
    const { storage, claim } = emailStorage(user, [true]);

    await processWeeklySummary(storage, user as never, monday);

    const notBefore = claim.mock.calls[0][1] as Date;
    const windowMs = monday.getTime() - notBefore.getTime();
    // A full 7 days would put next Monday's tick just inside this week's
    // window and skip it — the drift that made the summary fortnightly.
    expect(windowMs).toBeLessThan(7 * 24 * 60 * 60 * 1000);
    // Still long enough that a second run the same day cannot re-claim.
    expect(windowMs).toBeGreaterThan(24 * 60 * 60 * 1000);
  });

  it('does not burn the missed-reminder slot on a day with nothing missed', async () => {
    const user = makeMockUser({ id: 1, email: 'a@example.com' });
    const { storage, claim } = emailStorage(user, [true]);
    vi.mocked(storage.analytics.getMissedWorkoutsForDate).mockResolvedValue([]);

    const sent = await processMissedWorkoutReminder(storage, user as never, monday);

    expect(sent).toBe(false);
    expect(claim).not.toHaveBeenCalled();
  });

  it('names the single missed session and deep links to it', async () => {
    const { sendPushToUser } = await import('./pushNotifications');
    const user = makeMockUser({ id: 1, email: 'a@example.com' });
    const { storage } = emailStorage(user, [true]);

    await processMissedWorkoutReminder(storage, user as never, monday);

    // `?workout=` carries the raw plan_days id, which the timeline matches and
    // routes to the log surface — the whole point of the deep link.
    expect(sendPushToUser).toHaveBeenCalledWith(1, {
      title: 'Missed: Easy Run',
      body: 'Still worth doing — log it, or move it to a day that works.',
      url: '/?workout=pd-1',
    });
  });

  it('falls back to the timeline root when several sessions were missed', async () => {
    const { sendPushToUser } = await import('./pushNotifications');
    const user = makeMockUser({ id: 1, email: 'a@example.com' });
    const { storage } = emailStorage(user, [true]);
    vi.mocked(storage.analytics.getMissedWorkoutsForDate).mockResolvedValue([
      { planDayId: 'pd-1', date: '2026-07-19', focus: 'Easy Run', mainWorkout: '5k', planName: 'Plan' },
      { planDayId: 'pd-2', date: '2026-07-19', focus: 'Sled Push', mainWorkout: '6x25m', planName: 'Plan' },
    ]);

    await processMissedWorkoutReminder(storage, user as never, monday);

    const payload = vi.mocked(sendPushToUser).mock.calls[0][1];
    expect(payload.title).toBe('2 missed sessions');
    expect(payload.body).toContain('Easy Run, Sled Push');
    // No single day to open, so the deep link is deliberately absent.
    expect(payload.url).toBe('/');
  });
});

describe('weekly summary window', () => {
  function windowStorage(user: Record<string, unknown>) {
    const getWeeklyStats = vi.fn().mockResolvedValue({
      completedCount: 3, plannedCount: 4, missedCount: 1, skippedCount: 0, totalDuration: 180,
    });
    return {
      storage: {
        users: {
          getUser: vi.fn().mockResolvedValue(user),
          claimWeeklySummary: vi.fn().mockResolvedValue(true),
        },
        analytics: { getWeeklyStats, getExerciseSetsForPersonalRecords: vi.fn().mockResolvedValue([]) },
        timeline: { getCompletedWorkoutDates: vi.fn().mockResolvedValue(new Set<string>()) },
      } as unknown as IStorage,
      getWeeklyStats,
    };
  }

  beforeEach(() => vi.clearAllMocks());

  // Each instant below is a Monday in the athlete's own timezone but a
  // different UTC calendar day, which is exactly where a UTC-anchored week
  // would report the wrong seven days.
  it.each([
    ['UTC', '2026-07-20T09:00:00Z'],
    ['Australia/Sydney', '2026-07-19T23:30:00Z'],
    ['America/Los_Angeles', '2026-07-20T16:00:00Z'],
    ['Pacific/Honolulu', '2026-07-20T20:00:00Z'],
  ])('summarises the completed local Mon-Sun week for %s', async (tz, instant) => {
    const user = makeMockUser({ id: 1, email: 'a@example.com', userTimezone: tz });
    const { storage, getWeeklyStats } = windowStorage(user);

    const sent = await processWeeklySummary(storage, user as never, new Date(instant));

    expect(sent).toBe(true);
    expect(getWeeklyStats).toHaveBeenCalledWith(1, '2026-07-13', '2026-07-19');
  });

  it('deep-links the push into the review for the week it just summarised', async () => {
    const { sendPushToUser } = await import('./pushNotifications');
    const user = makeMockUser({ id: 1, email: 'a@example.com' });
    const { storage } = windowStorage(user);

    await processWeeklySummary(storage, user as never, new Date('2026-07-20T09:00:00Z'));

    // Not /analytics: that page is scoped to its own range picker, so it shows
    // a different set of numbers than the notification just quoted.
    expect(vi.mocked(sendPushToUser).mock.calls[0][1].url).toBe('/review?week=2026-07-13');
  });

  it('passes the same window to the mailer as it queried', async () => {
    const { sendWeeklySummary } = await import('./email');
    const user = makeMockUser({ id: 1, email: 'a@example.com' });
    const { storage } = windowStorage(user);

    await processWeeklySummary(storage, user as never, new Date('2026-07-20T09:00:00Z'));

    const [, data] = vi.mocked(sendWeeklySummary).mock.calls[0];
    expect(data.weekStartDate).toBe('2026-07-13');
    expect(data.weekEndDate).toBe('2026-07-19');
  });
});
