import { type InsertStravaConnection,users } from '@shared/schema';
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
      it('should encrypt tokens before inserting/updating', async () => {
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
});
