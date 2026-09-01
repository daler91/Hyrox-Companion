import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  processMafTestReminder,
  processMissedWorkoutReminder,
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

vi.mock('./email', () => ({
  sendMafTestReminder: vi.fn().mockResolvedValue(true),
  sendWeeklySummary: vi.fn().mockResolvedValue(true),
  sendMissedWorkoutReminder: vi.fn().mockResolvedValue(true),
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
  emailNotifications?: boolean;
  emailWeeklySummary?: boolean | null;
  emailMissedReminder?: boolean | null;
  lastWeeklySummaryAt?: Date | null;
  lastMissedReminderAt?: Date | null;
};

function makeMockUser(overrides: SchedulerUserOverrides) {
  return {
    userTimezone: 'UTC',
    emailNotifications: true,
    emailWeeklySummary: true,
    emailMissedReminder: true,
    lastWeeklySummaryAt: null,
    lastMissedReminderAt: null,
    ...overrides,
  };
}

describe('runEmailCronJob', () => {
  let mockStorage: IStorage;

  beforeEach(() => {
    vi.useFakeTimers();
    // Set to a Monday so weekly summary jobs are enqueued
    vi.setSystemTime(new Date('2023-10-16T12:00:00Z'));

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
    // Set to a Tuesday
    vi.setSystemTime(new Date('2023-10-17T12:00:00Z'));

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
      vi.setSystemTime(new Date('2026-05-31T23:00:00Z'));

      mockStorage.users.getUsersWithEmailNotifications = vi.fn().mockResolvedValue([
        makeMockUser({ id: 'sydney-user', email: 'sydney@example.com', userTimezone: 'Australia/Sydney', emailMissedReminder: false }),
        makeMockUser({ id: 'utc-user', email: 'utc@example.com', emailMissedReminder: false }),
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
      // 2026-06-02 Tuesday 06:00 UTC = 2026-06-01 Monday 20:00 in Pacific/Honolulu (UTC-10).
      vi.setSystemTime(new Date('2026-06-02T06:00:00Z'));

      mockStorage.users.getUsersWithEmailNotifications = vi.fn().mockResolvedValue([
        makeMockUser({ id: 'hawaii-user', email: 'hi@example.com', userTimezone: 'Pacific/Honolulu', emailMissedReminder: false }),
      ]);

      const result = await runEmailCronJob(mockStorage);

      expect(result.usersChecked).toBe(1);
      expect(result.emailsSent).toBe(1);
      expect(sendJobNoRetry).toHaveBeenCalledWith('send-weekly-summary', { userId: 'hawaii-user' });
    });
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
