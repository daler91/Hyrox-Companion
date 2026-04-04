import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { runEmailCronJob } from './emailScheduler';
import type { IStorage } from './storage';
import type { User } from '@shared/schema';

vi.mock('./queue', () => ({
  queue: {
    send: vi.fn().mockResolvedValue(undefined),
  },
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
      markMissedPlanDays: vi.fn().mockResolvedValue(0),
      getUsersWithEmailNotifications: vi.fn().mockResolvedValue([
        {
          id: 1,
          email: 'test@example.com',
          emailNotifications: true,
          lastWeeklySummaryAt: null,
          lastMissedReminderAt: null,
        } as unknown as User,
      ]),
    } as unknown as IStorage;
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  it('should enqueue email jobs for users with notifications', async () => {
    const { queue } = await import('./queue');
    const result = await runEmailCronJob(mockStorage);

    expect(result.usersChecked).toBe(1);
    // On Monday: 1 weekly summary + 1 missed reminder = 2 jobs
    expect(result.emailsSent).toBe(2);
    expect(queue.send).toHaveBeenCalledWith('send-weekly-summary', { userId: 1 });
    expect(queue.send).toHaveBeenCalledWith('send-missed-reminder', { userId: 1 });
  });

  it('should enqueue jobs for multiple users independently', async () => {
    const { queue } = await import('./queue');

    mockStorage.getUsersWithEmailNotifications = vi.fn().mockResolvedValue([
      {
        id: 1,
        email: 'user1@example.com',
        emailNotifications: true,
        lastWeeklySummaryAt: null,
        lastMissedReminderAt: null,
      } as unknown as User,
      {
        id: 2,
        email: 'user2@example.com',
        emailNotifications: true,
        lastWeeklySummaryAt: null,
        lastMissedReminderAt: null,
      } as unknown as User,
    ]);

    const result = await runEmailCronJob(mockStorage);

    expect(result.usersChecked).toBe(2);
    // On Monday: 2 weekly summary + 2 missed reminder = 4 jobs
    expect(result.emailsSent).toBe(4);
    expect(queue.send).toHaveBeenCalledTimes(4);
  });

  it('should only enqueue missed-reminder jobs on non-Monday', async () => {
    const { queue } = await import('./queue');
    // Set to a Tuesday
    vi.setSystemTime(new Date('2023-10-17T12:00:00Z'));

    const result = await runEmailCronJob(mockStorage);

    expect(result.usersChecked).toBe(1);
    // Not Monday: only 1 missed reminder
    expect(result.emailsSent).toBe(1);
    expect(queue.send).toHaveBeenCalledWith('send-missed-reminder', { userId: 1 });
    expect(queue.send).not.toHaveBeenCalledWith('send-weekly-summary', expect.anything());
  });

  it('should return early when no users have notifications', async () => {
    mockStorage.getUsersWithEmailNotifications = vi.fn().mockResolvedValue([]);

    const result = await runEmailCronJob(mockStorage);

    expect(result.usersChecked).toBe(0);
    expect(result.emailsSent).toBe(0);
    expect(result.details).toContain('No users with email notifications enabled');
  });
});
