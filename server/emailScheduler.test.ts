import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { checkAndSendEmailsForUser, runEmailCronJob } from './emailScheduler';
import type { IStorage } from './storage';
import type { User, TimelineEntry, MissedWorkoutQuery } from '@shared/schema';
import * as emailModule from './email';

// Mock dependencies
vi.mock('./email', () => ({
  sendWeeklySummary: vi.fn(),
  sendMissedWorkoutReminder: vi.fn(),
}));

describe('emailScheduler', () => {
  let mockStorage: Partial<IStorage>;
  let baseUser: User;

  beforeEach(() => {
    vi.useFakeTimers();
    // Monday, October 16, 2023, 12:00:00 PM UTC
    vi.setSystemTime(new Date('2023-10-16T12:00:00Z'));

    baseUser = {
      id: 1,
      email: 'test@example.com',
      emailNotifications: true,
      firstName: 'John',
      lastName: 'Doe',
      password: 'dummy_hash_value',
      role: 'user',
      unitPreference: 'metric',
      targetRaceId: null,
      createdAt: new Date(),
      currentStreak: 0,
      highestStreak: 0,
      lastWorkoutDate: null,
      lastWeeklySummaryAt: null,
      lastMissedReminderAt: null,
    };

    mockStorage = {
      getWeeklyStats: vi.fn().mockResolvedValue({
        completedCount: 3,
        plannedCount: 4,
        missedCount: 1,
        skippedCount: 0,
        totalDuration: 120,
      }),
      getTimeline: vi.fn().mockResolvedValue([] as TimelineEntry[]),
      updateLastWeeklySummaryAt: vi.fn().mockResolvedValue(undefined),
      getMissedWorkoutsForDate: vi.fn().mockResolvedValue([] as MissedWorkoutQuery[]),
      updateLastMissedReminderAt: vi.fn().mockResolvedValue(undefined),
      markMissedPlanDays: vi.fn().mockResolvedValue(0),
      getUsersWithEmailNotifications: vi.fn().mockResolvedValue([]),
    };

    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('checkAndSendEmailsForUser', () => {
    it('should return empty array if user has no email', async () => {
      const user = { ...baseUser, email: null };
      const result = await checkAndSendEmailsForUser(mockStorage as IStorage, user);
      expect(result).toEqual([]);
      expect(emailModule.sendWeeklySummary).not.toHaveBeenCalled();
      expect(emailModule.sendMissedWorkoutReminder).not.toHaveBeenCalled();
    });

    it('should return empty array if user has email notifications disabled', async () => {
      const user = { ...baseUser, emailNotifications: false };
      const result = await checkAndSendEmailsForUser(mockStorage as IStorage, user);
      expect(result).toEqual([]);
      expect(emailModule.sendWeeklySummary).not.toHaveBeenCalled();
      expect(emailModule.sendMissedWorkoutReminder).not.toHaveBeenCalled();
    });

    describe('Weekly Summary', () => {
      it('should not send weekly summary if it is not Monday', async () => {
        // Tuesday
        vi.setSystemTime(new Date('2023-10-17T12:00:00Z'));
        const result = await checkAndSendEmailsForUser(mockStorage as IStorage, baseUser);
        expect(result).not.toContain('weekly_summary');
        expect(emailModule.sendWeeklySummary).not.toHaveBeenCalled();
      });

      it('should not send weekly summary if already sent within last 7 days', async () => {
        const user = { ...baseUser, lastWeeklySummaryAt: new Date('2023-10-15T12:00:00Z') };
        const result = await checkAndSendEmailsForUser(mockStorage as IStorage, user);
        expect(result).not.toContain('weekly_summary');
        expect(emailModule.sendWeeklySummary).not.toHaveBeenCalled();
      });

      it('should send weekly summary if it is Monday and not recently sent', async () => {
        vi.mocked(emailModule.sendWeeklySummary).mockResolvedValue(true);
        const result = await checkAndSendEmailsForUser(mockStorage as IStorage, baseUser);

        expect(result).toContain('weekly_summary');
        expect(emailModule.sendWeeklySummary).toHaveBeenCalledWith(baseUser, expect.any(Object));
        expect(mockStorage.updateLastWeeklySummaryAt).toHaveBeenCalledWith(baseUser.id);
      });

      it('should not mark weekly summary as sent if email sending fails', async () => {
        vi.mocked(emailModule.sendWeeklySummary).mockResolvedValue(false);
        const result = await checkAndSendEmailsForUser(mockStorage as IStorage, baseUser);

        expect(result).not.toContain('weekly_summary');
        expect(emailModule.sendWeeklySummary).toHaveBeenCalled();
        expect(mockStorage.updateLastWeeklySummaryAt).not.toHaveBeenCalled();
      });
    });

    describe('Missed Workout Reminder', () => {
      it('should not send missed reminder if already sent within last 24 hours', async () => {
        const user = { ...baseUser, lastMissedReminderAt: new Date('2023-10-16T10:00:00Z') };
        // We set up a missed workout to ensure it doesn't get sent anyway
        vi.mocked(mockStorage.getMissedWorkoutsForDate!).mockResolvedValue([
          { date: '2023-10-15', focus: 'Legs', mainWorkout: 'Squats', planName: 'Strength Plan' } as MissedWorkoutQuery
        ]);

        const result = await checkAndSendEmailsForUser(mockStorage as IStorage, user);
        expect(result).not.toContain('missed_reminder');
        expect(emailModule.sendMissedWorkoutReminder).not.toHaveBeenCalled();
      });

      it('should not send missed reminder if there are no missed workouts yesterday', async () => {
        vi.mocked(mockStorage.getMissedWorkoutsForDate!).mockResolvedValue([]);
        const result = await checkAndSendEmailsForUser(mockStorage as IStorage, baseUser);

        expect(result).not.toContain('missed_reminder');
        expect(emailModule.sendMissedWorkoutReminder).not.toHaveBeenCalled();
      });

      it('should send missed reminder if there are missed workouts and not recently sent', async () => {
        vi.mocked(mockStorage.getMissedWorkoutsForDate!).mockResolvedValue([
          { date: '2023-10-15', focus: 'Legs', mainWorkout: 'Squats', planName: 'Strength Plan' } as MissedWorkoutQuery
        ]);
        vi.mocked(emailModule.sendMissedWorkoutReminder).mockResolvedValue(true);

        const result = await checkAndSendEmailsForUser(mockStorage as IStorage, baseUser);

        expect(result).toContain('missed_reminder');
        expect(emailModule.sendMissedWorkoutReminder).toHaveBeenCalledWith(baseUser, expect.any(Array));
        expect(mockStorage.updateLastMissedReminderAt).toHaveBeenCalledWith(baseUser.id);
      });

      it('should not mark missed reminder as sent if email sending fails', async () => {
        vi.mocked(mockStorage.getMissedWorkoutsForDate!).mockResolvedValue([
          { date: '2023-10-15', focus: 'Legs', mainWorkout: 'Squats', planName: 'Strength Plan' } as MissedWorkoutQuery
        ]);
        vi.mocked(emailModule.sendMissedWorkoutReminder).mockResolvedValue(false);

        const result = await checkAndSendEmailsForUser(mockStorage as IStorage, baseUser);

        expect(result).not.toContain('missed_reminder');
        expect(emailModule.sendMissedWorkoutReminder).toHaveBeenCalled();
        expect(mockStorage.updateLastMissedReminderAt).not.toHaveBeenCalled();
      });
    });

    it('should handle both weekly summary and missed reminder at once', async () => {
      vi.mocked(emailModule.sendWeeklySummary).mockResolvedValue(true);

      vi.mocked(mockStorage.getMissedWorkoutsForDate!).mockResolvedValue([
        { date: '2023-10-15', focus: 'Legs', mainWorkout: 'Squats', planName: 'Strength Plan' } as MissedWorkoutQuery
      ]);
      vi.mocked(emailModule.sendMissedWorkoutReminder).mockResolvedValue(true);

      const result = await checkAndSendEmailsForUser(mockStorage as IStorage, baseUser);

      expect(result).toContain('weekly_summary');
      expect(result).toContain('missed_reminder');
      expect(result.length).toBe(2);
      expect(emailModule.sendWeeklySummary).toHaveBeenCalled();
      expect(emailModule.sendMissedWorkoutReminder).toHaveBeenCalled();
      expect(mockStorage.updateLastWeeklySummaryAt).toHaveBeenCalled();
      expect(mockStorage.updateLastMissedReminderAt).toHaveBeenCalled();
    });
  });

  describe('runEmailCronJob', () => {
    it('should return early if no users have email notifications enabled', async () => {
      vi.mocked(mockStorage.getUsersWithEmailNotifications!).mockResolvedValue([]);

      const result = await runEmailCronJob(mockStorage as IStorage);

      expect(result.usersChecked).toBe(0);
      expect(result.emailsSent).toBe(0);
      expect(mockStorage.markMissedPlanDays).toHaveBeenCalled();
    });

    it('should process users and count sent emails successfully', async () => {
      // Mock two users
      const user2 = { ...baseUser, id: 2, email: 'test2@example.com' };
      vi.mocked(mockStorage.getUsersWithEmailNotifications!).mockResolvedValue([baseUser, user2]);

      // User 1 gets weekly summary
      vi.mocked(emailModule.sendWeeklySummary).mockResolvedValue(true);
      // Ensure only user 1 gets weekly summary (mocking sendWeeklySummary to be true for both but we'll mock storage stats differently if needed, here both get it)

      const result = await runEmailCronJob(mockStorage as IStorage);

      expect(result.usersChecked).toBe(2);
      expect(result.emailsSent).toBe(2); // Each got 1 weekly summary
      expect(mockStorage.markMissedPlanDays).toHaveBeenCalled();
    });

    it('should continue processing other users if one user fails', async () => {
      const user2 = { ...baseUser, id: 2, email: 'test2@example.com' };
      vi.mocked(mockStorage.getUsersWithEmailNotifications!).mockResolvedValue([baseUser, user2]);

      // Make getWeeklyStats fail for first user
      vi.mocked(mockStorage.getWeeklyStats!)
        .mockRejectedValueOnce(new Error('Database error'))
        .mockResolvedValueOnce({
          completedCount: 3,
          plannedCount: 4,
          missedCount: 1,
          skippedCount: 0,
          totalDuration: 120,
        });

      vi.mocked(emailModule.sendWeeklySummary).mockResolvedValue(true);

      const result = await runEmailCronJob(mockStorage as IStorage);

      expect(result.usersChecked).toBe(2);
      expect(result.emailsSent).toBe(1); // Second user still gets processed
      expect(result.details.some(d => d.includes('Failed for user 1'))).toBe(true);
    });
  });
});
