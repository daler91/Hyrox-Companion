import { describe, it, expect, vi, beforeEach } from 'vitest';
import { UserStorage } from './users';
import { db } from '../db';
import { users } from '@shared/schema';

vi.mock('../db', () => ({
  db: {
    select: vi.fn(),
    insert: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
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
      (db.select as any).mockReturnValue({ from: fromMock });

      const result = await userStorage.getUser('user-1');

      expect(result).toEqual(mockUser);
      expect(db.select).toHaveBeenCalled();
      expect(fromMock).toHaveBeenCalledWith(users);
    });

    it('should return undefined when user is not found', async () => {
      const whereMock = vi.fn().mockResolvedValue([]);
      const fromMock = vi.fn().mockReturnValue({ where: whereMock });
      (db.select as any).mockReturnValue({ from: fromMock });

      const result = await userStorage.getUser('nonexistent-user');

      expect(result).toBeUndefined();
      expect(db.select).toHaveBeenCalled();
      expect(fromMock).toHaveBeenCalledWith(users);
    });

    it('should propagate database errors', async () => {
      const dbError = new Error('Database connection failed');
      const whereMock = vi.fn().mockRejectedValue(dbError);
      const fromMock = vi.fn().mockReturnValue({ where: whereMock });
      (db.select as any).mockReturnValue({ from: fromMock });

      await expect(userStorage.getUser('user-1')).rejects.toThrow('Database connection failed');
      expect(db.select).toHaveBeenCalled();
      expect(fromMock).toHaveBeenCalledWith(users);
    });
  });
});
