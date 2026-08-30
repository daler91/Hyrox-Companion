import { calculateMafHr } from '@shared/maf';
import { type InsertStravaConnection, type UpdateUserPreferences, type User,users } from '@shared/schema';
import { beforeEach,describe, expect, it, vi } from 'vitest';

import * as crypto from '../crypto';
import { db } from '../db';
import { UserStorage } from './users';

vi.mock('../crypto', () => ({
  encryptToken: vi.fn((t) => `encrypted-${t}`),
  decryptToken: vi.fn((t) => t.replace('encrypted-', '')),
}));

vi.mock('../db', () => ({
  db: {
    select: vi.fn(),
    insert: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
  },
}));

vi.mock('../logger', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

vi.mock('drizzle-orm', async (importOriginal) => {
  const actual = await importOriginal<typeof import('drizzle-orm')>();
  return {
    ...actual,
    eq: vi.fn(),
    and: vi.fn(),
    isNotNull: vi.fn(),
  };
});

describe('UserStorage', () => {
  let userStorage: UserStorage;

  beforeEach(() => {
    vi.clearAllMocks();
    userStorage = new UserStorage();
  });

  describe('getUser', () => {
    it('should return a user when found', async () => {
      const mockUser = { id: 'user-1', username: 'testuser' };

      const whereMock = vi.fn().mockResolvedValue([mockUser]);
      const fromMock = vi.fn().mockReturnValue({ where: whereMock });
      vi.mocked(db.select).mockReturnValue({ from: fromMock });

      const result = await userStorage.getUser('user-1');

      expect(result).toEqual(mockUser);
      expect(db.select).toHaveBeenCalled();
      expect(fromMock).toHaveBeenCalledWith(users);
    });

    it('should return undefined when user is not found', async () => {
      const whereMock = vi.fn().mockResolvedValue([]);
      const fromMock = vi.fn().mockReturnValue({ where: whereMock });
      vi.mocked(db.select).mockReturnValue({ from: fromMock });

      const result = await userStorage.getUser('nonexistent-user');

      expect(result).toBeUndefined();
      expect(db.select).toHaveBeenCalled();
      expect(fromMock).toHaveBeenCalledWith(users);
    });

    it('should propagate database errors', async () => {
      const dbError = new Error('Database connection failed');
      const whereMock = vi.fn().mockRejectedValue(dbError);
      const fromMock = vi.fn().mockReturnValue({ where: whereMock });
      vi.mocked(db.select).mockReturnValue({ from: fromMock });

      await expect(userStorage.getUser('user-1')).rejects.toThrow('Database connection failed');
      expect(db.select).toHaveBeenCalled();
      expect(fromMock).toHaveBeenCalledWith(users);
    });
  });

  describe('Strava Connections', () => {
    describe('getStravaConnection', () => {
      it('should decrypt tokens when returning connection', async () => {
        const mockConnection = {
          userId: 'user-1',
          accessToken: 'encrypted-access123',
          refreshToken: 'encrypted-refresh456',
        };

        const whereMock = vi.fn().mockResolvedValue([mockConnection]);
        const fromMock = vi.fn().mockReturnValue({ where: whereMock });
        vi.mocked(db.select).mockReturnValue({ from: fromMock });

        const result = await userStorage.getStravaConnection('user-1');

        expect(result).toBeDefined();
        expect(result?.accessToken).toBe('access123');
        expect(result?.refreshToken).toBe('refresh456');
        expect(crypto.decryptToken).toHaveBeenCalledWith('encrypted-access123');
        expect(crypto.decryptToken).toHaveBeenCalledWith('encrypted-refresh456');
      });

      it('should return undefined when connection not found', async () => {
        const whereMock = vi.fn().mockResolvedValue([]);
        const fromMock = vi.fn().mockReturnValue({ where: whereMock });
        vi.mocked(db.select).mockReturnValue({ from: fromMock });

        const result = await userStorage.getStravaConnection('nonexistent');
        expect(result).toBeUndefined();
      });
    });

    describe('upsertStravaConnection', () => {
      // Wires the insert → values → onConflictDoUpdate → returning chain around
      // a canonical raw-token payload, returning the mocks each test asserts on.
      function mockStravaUpsert() {
        const inputData: InsertStravaConnection = {
          userId: 'user-1',
          stravaAthleteId: 'athlete-1',
          accessToken: 'raw-access',
          refreshToken: 'raw-refresh',
          expiresAt: new Date(),
          scope: 'activity:read_all',
        };

        const returningMock = vi.fn().mockResolvedValue([{
          ...inputData,
          accessToken: 'encrypted-raw-access',
          refreshToken: 'encrypted-raw-refresh',
        }]);
        const onConflictDoUpdateMock = vi.fn().mockReturnValue({ returning: returningMock });
        const valuesMock = vi.fn().mockReturnValue({ onConflictDoUpdate: onConflictDoUpdateMock });
        vi.mocked(db.insert).mockReturnValue({ values: valuesMock });
        return { inputData, valuesMock, onConflictDoUpdateMock };
      }

      it('should encrypt tokens before inserting/updating', async () => {
        const { inputData, valuesMock } = mockStravaUpsert();

        const result = await userStorage.upsertStravaConnection(inputData);

        expect(crypto.encryptToken).toHaveBeenCalledWith('raw-access');
        expect(crypto.encryptToken).toHaveBeenCalledWith('raw-refresh');

        // Assert we passed encrypted data to db
        expect(valuesMock).toHaveBeenCalledWith(expect.objectContaining({
          accessToken: 'encrypted-raw-access',
          refreshToken: 'encrypted-raw-refresh',
        }));

        // Method returns decrypted output based on what was saved
        expect(result.accessToken).toBe('raw-access');
        expect(result.refreshToken).toBe('raw-refresh');
      });

      it('clears the requires_reauth tombstone on the conflict-update path (reconnect)', async () => {
        const { inputData, onConflictDoUpdateMock } = mockStravaUpsert();

        await userStorage.upsertStravaConnection(inputData);

        expect(onConflictDoUpdateMock).toHaveBeenCalledWith(expect.objectContaining({
          set: expect.objectContaining({ requiresReauth: false }),
        }));
      });
    });

    describe('updateStravaTokens', () => {
      it('encrypts the rotated tokens, clears requiresReauth, and never touches lastSyncedAt', async () => {
        const setMock = vi.fn().mockReturnValue({ where: vi.fn().mockResolvedValue(undefined) });
        vi.mocked(db.update).mockReturnValue({ set: setMock });

        const expiresAt = new Date('2026-07-15T12:00:00Z');
        await userStorage.updateStravaTokens('user-1', {
          accessToken: 'new-access',
          refreshToken: 'new-refresh',
          expiresAt,
        });

        expect(crypto.encryptToken).toHaveBeenCalledWith('new-access');
        expect(crypto.encryptToken).toHaveBeenCalledWith('new-refresh');
        expect(setMock).toHaveBeenCalledWith({
          accessToken: 'encrypted-new-access',
          refreshToken: 'encrypted-new-refresh',
          expiresAt,
          requiresReauth: false,
        });
        // The refresh path must not clobber the incremental-sync cursor.
        expect(setMock.mock.calls[0][0]).not.toHaveProperty('lastSyncedAt');
      });
    });

    describe('setStravaReauthRequired', () => {
      it('flags the connection as needing re-authorization', async () => {
        const setMock = vi.fn().mockReturnValue({ where: vi.fn().mockResolvedValue(undefined) });
        vi.mocked(db.update).mockReturnValue({ set: setMock });

        await userStorage.setStravaReauthRequired('user-1');

        expect(setMock).toHaveBeenCalledWith({ requiresReauth: true });
      });
    });

    describe('updateStravaLastSync', () => {
      it('advances the cursor to the provided syncedThrough date (capped sync)', async () => {
        const setMock = vi.fn().mockReturnValue({ where: vi.fn().mockResolvedValue(undefined) });
        vi.mocked(db.update).mockReturnValue({ set: setMock });

        const syncedThrough = new Date('2026-07-10T08:30:00Z');
        await userStorage.updateStravaLastSync('user-1', syncedThrough);

        expect(setMock).toHaveBeenCalledWith({ lastSyncedAt: syncedThrough });
      });

      it('defaults the cursor to now for a complete sync', async () => {
        const setMock = vi.fn().mockReturnValue({ where: vi.fn().mockResolvedValue(undefined) });
        vi.mocked(db.update).mockReturnValue({ set: setMock });

        const before = Date.now();
        await userStorage.updateStravaLastSync('user-1');
        const after = Date.now();

        const setArg = setMock.mock.calls[0][0] as { lastSyncedAt: Date };
        expect(setArg.lastSyncedAt.getTime()).toBeGreaterThanOrEqual(before);
        expect(setArg.lastSyncedAt.getTime()).toBeLessThanOrEqual(after);
      });
    });
  });

  describe('upsertUser', () => {
    it('retries without email when the email unique constraint is hit', async () => {
      const duplicateEmailError = Object.assign(new Error('duplicate email'), {
        code: '23505',
        constraint: 'users_email_unique',
      });
      const savedUser = { id: 'user-1', email: null, firstName: 'Test' };

      const firstReturningMock = vi.fn().mockRejectedValue(duplicateEmailError);
      const firstOnConflictMock = vi.fn().mockReturnValue({ returning: firstReturningMock });
      const firstValuesMock = vi.fn().mockReturnValue({ onConflictDoUpdate: firstOnConflictMock });

      const secondReturningMock = vi.fn().mockResolvedValue([savedUser]);
      const secondOnConflictMock = vi.fn().mockReturnValue({ returning: secondReturningMock });
      const secondValuesMock = vi.fn().mockReturnValue({ onConflictDoUpdate: secondOnConflictMock });

      vi.mocked(db.insert)
        .mockReturnValueOnce({ values: firstValuesMock })
        .mockReturnValueOnce({ values: secondValuesMock });

      const result = await userStorage.upsertUser({
        id: 'user-1',
        email: 'test@example.com',
        firstName: 'Test',
      });

      expect(result).toEqual(savedUser);
      expect(firstValuesMock).toHaveBeenCalledWith(expect.objectContaining({
        id: 'user-1',
        email: 'test@example.com',
      }));
      expect(secondValuesMock).toHaveBeenCalledWith(expect.objectContaining({
        id: 'user-1',
        firstName: 'Test',
      }));
      expect(secondValuesMock.mock.calls[0][0]).not.toHaveProperty('email');
    });
  });

  describe('updateUserPreferences MAF snapshot (S4)', () => {
    const mafUser = {
      id: 'user-1',
      trainingStyleId: 'maf_method',
      mafAge: 30,
      mafConsistency: 'high',
      mafTrend: 'improving',
      mafInjuryIllnessMedication: false,
      trainingStyleChangedAt: null,
    } as unknown as User;

    const prefs = { trainingStyleId: 'maf_method' } as unknown as UpdateUserPreferences;
    const expectedMaf = calculateMafHr({ age: 30, injuryIllnessMedication: false, consistency: 'high', trend: 'improving' });

    // getUser() + the UPDATE both resolve to mafUser; the snapshot SELECT is
    // wired per-test. db.select is called twice (getUser, then latest snapshot).
    function wireBaseMocks(latestSnapshotRows: unknown[]) {
      const getUserFrom = vi.fn().mockReturnValue({ where: vi.fn().mockResolvedValue([mafUser]) });
      const snapshotFrom = vi.fn().mockReturnValue({
        where: vi.fn().mockReturnValue({
          orderBy: vi.fn().mockReturnValue({ limit: vi.fn().mockResolvedValue(latestSnapshotRows) }),
        }),
      });
      vi.mocked(db.select)
        .mockReturnValueOnce({ from: getUserFrom } as never) // NOSONAR partial Drizzle query-builder mock
        .mockReturnValueOnce({ from: snapshotFrom } as never); // NOSONAR partial Drizzle query-builder mock

      const returningMock = vi.fn().mockResolvedValue([mafUser]);
      vi.mocked(db.update).mockReturnValue({ // NOSONAR partial Drizzle query-builder mock
        set: vi.fn().mockReturnValue({ where: vi.fn().mockReturnValue({ returning: returningMock }) }),
      } as never);

      const insertValues = vi.fn().mockResolvedValue(undefined);
      vi.mocked(db.insert).mockReturnValue({ values: insertValues } as never); // NOSONAR partial Drizzle query-builder mock
      return insertValues;
    }

    it('does not insert a new snapshot when MAF inputs are unchanged', async () => {
      const reason = JSON.stringify({
        reasonCodes: expectedMaf.reasonCodes,
        explanation: expectedMaf.explanation,
        warning: expectedMaf.warning,
      });
      const insertValues = wireBaseMocks([
        { baseHr: expectedMaf.base, adjustment: expectedMaf.adjustment, finalHr: expectedMaf.ceiling, reason },
      ]);

      await userStorage.updateUserPreferences('user-1', prefs);

      expect(insertValues).not.toHaveBeenCalled();
    });

    it('inserts a snapshot when none exists yet', async () => {
      const insertValues = wireBaseMocks([]);

      await userStorage.updateUserPreferences('user-1', prefs);

      expect(insertValues).toHaveBeenCalledWith(
        expect.objectContaining({ userId: 'user-1', finalHr: expectedMaf.ceiling }),
      );
    });
  });

  describe('claimRefuelReminder', () => {
    it('wins the claim and stamps lastRefuelReminderAt when the row updates', async () => {
      const now = new Date('2026-08-06T12:00:00Z');
      const returningMock = vi.fn().mockResolvedValue([{ id: 'user-1' }]);
      const whereMock = vi.fn().mockReturnValue({ returning: returningMock });
      const setMock = vi.fn().mockReturnValue({ where: whereMock });
      vi.mocked(db.update).mockReturnValue({ set: setMock });

      const result = await userStorage.claimRefuelReminder(
        'user-1',
        new Date('2026-08-06T00:00:00Z'),
        now,
      );

      expect(result).toBe(true);
      expect(setMock).toHaveBeenCalledWith({ lastRefuelReminderAt: now });
    });

    it('loses the claim when no row matched (already claimed within the window)', async () => {
      const returningMock = vi.fn().mockResolvedValue([]);
      const whereMock = vi.fn().mockReturnValue({ returning: returningMock });
      const setMock = vi.fn().mockReturnValue({ where: whereMock });
      vi.mocked(db.update).mockReturnValue({ set: setMock });

      const result = await userStorage.claimRefuelReminder(
        'user-1',
        new Date('2026-08-06T00:00:00Z'),
      );

      expect(result).toBe(false);
    });
  });

  describe('claimLoggingReminder', () => {
    it('wins the claim and stamps lastLoggingReminderAt when the row updates', async () => {
      const now = new Date('2026-08-06T20:00:00Z');
      const returningMock = vi.fn().mockResolvedValue([{ id: 'user-1' }]);
      const whereMock = vi.fn().mockReturnValue({ returning: returningMock });
      const setMock = vi.fn().mockReturnValue({ where: whereMock });
      vi.mocked(db.update).mockReturnValue({ set: setMock });

      const result = await userStorage.claimLoggingReminder(
        'user-1',
        new Date('2026-08-06T00:00:00Z'),
        now,
      );

      expect(result).toBe(true);
      expect(setMock).toHaveBeenCalledWith({ lastLoggingReminderAt: now });
    });

    it('loses the claim when no row matched (already claimed within the window)', async () => {
      const returningMock = vi.fn().mockResolvedValue([]);
      const whereMock = vi.fn().mockReturnValue({ returning: returningMock });
      const setMock = vi.fn().mockReturnValue({ where: whereMock });
      vi.mocked(db.update).mockReturnValue({ set: setMock });

      const result = await userStorage.claimLoggingReminder(
        'user-1',
        new Date('2026-08-06T00:00:00Z'),
      );

      expect(result).toBe(false);
    });
  });

  describe('getUsersWithNutritionPushReminders', () => {
    it('returns users opted into either nutrition push reminder', async () => {
      const optedInUsers = [{ id: 'user-1' }, { id: 'user-2' }];
      const whereMock = vi.fn().mockResolvedValue(optedInUsers);
      const fromMock = vi.fn().mockReturnValue({ where: whereMock });
      vi.mocked(db.select).mockReturnValue({ from: fromMock });

      const result = await userStorage.getUsersWithNutritionPushReminders();

      expect(result).toEqual(optedInUsers);
      expect(fromMock).toHaveBeenCalledWith(users);
    });

    it('returns an empty list when no one has opted in', async () => {
      const whereMock = vi.fn().mockResolvedValue([]);
      const fromMock = vi.fn().mockReturnValue({ where: whereMock });
      vi.mocked(db.select).mockReturnValue({ from: fromMock });

      const result = await userStorage.getUsersWithNutritionPushReminders();

      expect(result).toEqual([]);
    });
  });
});
