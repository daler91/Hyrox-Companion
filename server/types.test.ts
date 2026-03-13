import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { Request } from 'express';
import { getAuth } from '@clerk/express';
import { getUserId, toDateStr } from './types';

vi.mock('@clerk/express', () => ({
  getAuth: vi.fn(),
}));

describe('types.ts utilities', () => {
  describe('getUserId', () => {
    beforeEach(() => {
      vi.resetAllMocks();
    });

    it('returns the userId when authenticated', () => {
      const mockReq = {} as Request;
      vi.mocked(getAuth).mockReturnValue({ userId: 'user_123' } as any);

      const result = getUserId(mockReq);

      expect(getAuth).toHaveBeenCalledWith(mockReq);
      expect(result).toBe('user_123');
    });

    it('throws an error when auth object is missing', () => {
      const mockReq = {} as Request;
      vi.mocked(getAuth).mockReturnValue(undefined as any);

      expect(() => getUserId(mockReq)).toThrow('User not authenticated');
    });

    it('throws an error when userId is missing from auth object', () => {
      const mockReq = {} as Request;
      vi.mocked(getAuth).mockReturnValue({ userId: null } as any);

      expect(() => getUserId(mockReq)).toThrow('User not authenticated');
    });
  });

  describe('toDateStr', () => {
    beforeEach(() => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date('2024-05-15T12:00:00Z'));
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it('returns ISO date string for provided date', () => {
      const date = new Date('2023-10-05T08:30:00Z');
      expect(toDateStr(date)).toBe('2023-10-05');
    });

    it('returns ISO date string for current date when no date is provided', () => {
      expect(toDateStr()).toBe('2024-05-15');
    });
  });
});
