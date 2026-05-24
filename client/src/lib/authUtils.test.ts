import { describe, expect, it } from 'vitest';

import { isUnauthorizedError } from './authUtils';

describe('authUtils', () => {
  describe('isUnauthorizedError', () => {
    it.each([
      'Unauthorized',
      'Error: 401 Unauthorized',
      '401: custom message',
    ])('returns true for %s', (message) => {
      expect(isUnauthorizedError(new Error(message))).toBe(true);
    });

    it.each([
      '404: Not Found',
      'unauthorized',
      'Unexpected authentication failure',
      'Something went wrong',
    ])('returns false for %s', (message) => {
      expect(isUnauthorizedError(new Error(message))).toBe(false);
    });
  });
});
