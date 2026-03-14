import { describe, it, expect } from 'vitest';
import { isUnauthorizedError } from './authUtils';

describe('authUtils', () => {
  describe('isUnauthorizedError', () => {
    it('should return true for "Unauthorized"', () => {
      const error = new Error('Unauthorized');
      expect(isUnauthorizedError(error)).toBe(true);
    });

    it('should return true when message includes "401"', () => {
      const error = new Error('Error: 401 Unauthorized');
      expect(isUnauthorizedError(error)).toBe(true);

      const error2 = new Error('401: custom message');
      expect(isUnauthorizedError(error2)).toBe(true);
    });

    it('should return false for other errors like "404: Not Found"', () => {
      const error = new Error('404: Not Found');
      expect(isUnauthorizedError(error)).toBe(false);
    });

    it('should return false for "unauthorized" (case sensitive)', () => {
      const error = new Error('unauthorized');
      expect(isUnauthorizedError(error)).toBe(false);
    });

    it('should return false for an empty string message', () => {
      const error = new Error('');
      expect(isUnauthorizedError(error)).toBe(false);
    });

    it('should return false for a generic error message', () => {
      const error = new Error('Something went wrong');
      expect(isUnauthorizedError(error)).toBe(false);
    });
  });
});
