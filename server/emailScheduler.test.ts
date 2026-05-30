import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { runEmailCronJob } from './emailScheduler';
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
          {
            id: 1,
            email: 'test@example.com',
            userTimezone: 'UTC',
            emailNotifications: true,
            emailWeeklySummary: true,
            emailMissedReminder: true,
            lastWeeklySummaryAt: null,
            lastMissedReminderAt: null,
          },
        ]),
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

  it('should enqueue jobs for multiple users independently', async () => {
    const { sendJobNoRetry } = await import('./queue');

    mockStorage.users.getUsersWithEmailNotifications = vi.fn().mockResolvedValue([
      {
        id: 1,
        email: 'user1@example.com',
        userTimezone: 'UTC',
        emailNotifications: true,
        emailWeeklySummary: true,
        emailMissedReminder: true,
        lastWeeklySummaryAt: null,
        lastMissedReminderAt: null,
      },
      {
        id: 2,
        email: 'user2@example.com',
        userTimezone: 'UTC',
        emailNotifications: true,
        emailWeeklySummary: true,
        emailMissedReminder: true,
        lastWeeklySummaryAt: null,
        lastMissedReminderAt: null,
      },
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

  it('should return early when no users have notifications', async () => {
    mockStorage.users.getUsersWithEmailNotifications = vi.fn().mockResolvedValue([]);

    const result = await runEmailCronJob(mockStorage);

    expect(result.usersChecked).toBe(0);
    expect(result.emailsSent).toBe(0);
    expect(result.details).toContain('No users with email notifications enabled');
  });

  it('skips the weekly summary when the user has opted out via emailWeeklySummary=false', async () => {
    const { sendJobNoRetry } = await import('./queue');
    mockStorage.users.getUsersWithEmailNotifications = vi.fn().mockResolvedValue([
      {
        id: 'user-weekly-off',
        email: 'weekly-off@example.com',
        userTimezone: 'UTC',
        emailNotifications: true,
        emailWeeklySummary: false,
        emailMissedReminder: true,
        lastWeeklySummaryAt: null,
        lastMissedReminderAt: null,
      },
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
      {
        id: 'user-missed-off',
        email: 'missed-off@example.com',
        userTimezone: 'UTC',
        emailNotifications: true,
        emailWeeklySummary: true,
        emailMissedReminder: false,
        lastWeeklySummaryAt: null,
        lastMissedReminderAt: null,
      },
    ]);

    const result = await runEmailCronJob(mockStorage);

    expect(result.usersChecked).toBe(1);
    expect(result.emailsSent).toBe(1);
    expect(sendJobNoRetry).toHaveBeenCalledWith('send-weekly-summary', { userId: 'user-missed-off' });
    expect(sendJobNoRetry).not.toHaveBeenCalledWith('send-missed-reminder', expect.anything());
  });

  it('enqueues nothing for a user with both per-type flags off even if master is on', async () => {
    mockStorage.users.getUsersWithEmailNotifications = vi.fn().mockResolvedValue([
      {
        id: 'user-both-off',
        email: 'both-off@example.com',
        userTimezone: 'UTC',
        emailNotifications: true,
        emailWeeklySummary: false,
        emailMissedReminder: false,
        lastWeeklySummaryAt: null,
        lastMissedReminderAt: null,
      },
    ]);

    const result = await runEmailCronJob(mockStorage);

    expect(result.usersChecked).toBe(1);
    expect(result.emailsSent).toBe(0);
  });

  it('treats null per-type email flags as not opted in', async () => {
    mockStorage.users.getUsersWithEmailNotifications = vi.fn().mockResolvedValue([
      {
        id: 'user-null-flags',
        email: 'null-flags@example.com',
        userTimezone: 'UTC',
        emailNotifications: true,
        emailWeeklySummary: null,
        emailMissedReminder: null,
        lastWeeklySummaryAt: null,
        lastMissedReminderAt: null,
      },
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
        {
          id: 'sydney-user',
          email: 'sydney@example.com',
          userTimezone: 'Australia/Sydney',
          emailNotifications: true,
          emailWeeklySummary: true,
          emailMissedReminder: false,
          lastWeeklySummaryAt: null,
          lastMissedReminderAt: null,
        },
        {
          id: 'utc-user',
          email: 'utc@example.com',
          userTimezone: 'UTC',
          emailNotifications: true,
          emailWeeklySummary: true,
          emailMissedReminder: false,
          lastWeeklySummaryAt: null,
          lastMissedReminderAt: null,
        },
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
        {
          id: 'hawaii-user',
          email: 'hi@example.com',
          userTimezone: 'Pacific/Honolulu',
          emailNotifications: true,
          emailWeeklySummary: true,
          emailMissedReminder: false,
          lastWeeklySummaryAt: null,
          lastMissedReminderAt: null,
        },
      ]);

      const result = await runEmailCronJob(mockStorage);

      expect(result.usersChecked).toBe(1);
      expect(result.emailsSent).toBe(1);
      expect(sendJobNoRetry).toHaveBeenCalledWith('send-weekly-summary', { userId: 'hawaii-user' });
    });
  });
});
