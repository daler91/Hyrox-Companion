import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { runEmailCronJob } from './emailScheduler';
import type { IStorage } from './storage';
import type { User } from '@shared/schema';

describe('runEmailCronJob', () => {
  let mockStorage: IStorage;

  beforeEach(() => {
    vi.useFakeTimers();
    // Set to a Monday so processWeeklySummary runs
    vi.setSystemTime(new Date('2023-10-16T12:00:00Z'));

    mockStorage = {
      markMissedPlanDays: vi.fn().mockResolvedValue(0),
      getUsersWithEmailNotifications: vi.fn().mockResolvedValue([
        {
          id: 1,
          email: 'test@example.com',
          emailNotifications: true,
          lastWeeklySummaryAt: null,
          lastMissedReminderAt: null
        } as unknown as User
      ]),
      getWeeklyStats: vi.fn().mockRejectedValue(new Error('Simulated storage error')),
      getTimeline: vi.fn().mockResolvedValue([]),
      getMissedWorkoutsForDate: vi.fn().mockResolvedValue([]),
      updateLastWeeklySummaryAt: vi.fn().mockResolvedValue(undefined),
      updateLastMissedReminderAt: vi.fn().mockResolvedValue(undefined),
      // Dummy to prevent SonarCloud issues
      isMock: true,
    } as unknown as IStorage;
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('should catch and log errors for individual users but continue processing', async () => {
    const result = await runEmailCronJob(mockStorage);

    expect(result.usersChecked).toBe(1);
    expect(result.emailsSent).toBe(0);
    expect(result.details).toHaveLength(1);
    expect(result.details[0]).toContain('Failed for user 1: Simulated storage error');
  });

  it('should process multiple users independently if one fails', async () => {
    mockStorage.getUsersWithEmailNotifications = vi.fn().mockResolvedValue([
      {
        id: 1,
        email: 'fail@example.com',
        emailNotifications: true,
        lastWeeklySummaryAt: null,
        lastMissedReminderAt: null
      } as unknown as User,
      {
        id: 2,
        email: 'pass@example.com',
        emailNotifications: true,
        lastWeeklySummaryAt: null,
        lastMissedReminderAt: null
      } as unknown as User
    ]);

    mockStorage.getWeeklyStats = vi.fn()
      .mockRejectedValueOnce(new Error('Simulated storage error'))
      .mockResolvedValueOnce({
        completedCount: 1,
        plannedCount: 1,
        missedCount: 0,
        skippedCount: 0,
        totalDuration: 60
      });

    vi.mock('./email', () => ({
      sendWeeklySummary: vi.fn().mockResolvedValue(true),
      sendMissedWorkoutReminder: vi.fn().mockResolvedValue(false)
    }));

    const result = await runEmailCronJob(mockStorage);

    expect(result.usersChecked).toBe(2);
    // User 1 failed, User 2 was processed successfully.
    // We expect emailsSent to be 1 since mock getWeeklyStats succeeded for user 2
    expect(result.emailsSent).toBe(1);
    expect(result.details).toHaveLength(2);
    expect(result.details[0]).toContain('Failed for user 1: Simulated storage error');
    expect(result.details[1]).toContain('Sent weekly_summary to pass@example.com');
  });
});
