import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { processMafTestReminder, runEmailCronJob } from './emailScheduler';
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

describe('processMafTestReminder', () => {
  const now = new Date('2026-06-01T12:00:00Z');
  const dueAt = new Date('2026-05-30T12:00:00Z'); // in the past → due

  beforeEach(() => vi.clearAllMocks());

  function storageFor(user: Record<string, unknown>, claimed = true): IStorage {
    return {
      users: {
        getUser: vi.fn().mockResolvedValue(user),
        claimMafBaselineTest: vi.fn().mockResolvedValue(claimed),
      },
    } as unknown as IStorage;
  }

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
