import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createSignedState, verifySignedState } from './strava';
import crypto from 'crypto';

describe('strava service state signing', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(1700000000000)); // Nov 14 2023
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  describe('createSignedState', () => {
    it('generates a deterministically verifiable state', () => {
      // Mock crypto.randomBytes just for this test so we know the nonce
      const randomBytesSpy = vi.spyOn(crypto, 'randomBytes').mockImplementation((size: number) => {
        return Buffer.alloc(size, 'a'); // Fill with 'a' chars, 8 bytes
      });

      const userId = 'user_123';
      const state = createSignedState(userId);

      // Restore to allow normal verify function execution
      randomBytesSpy.mockRestore();

      // State format should be `userId:timestamp:nonce:signature`
      const parts = state.split(':');
      expect(parts.length).toBe(4);
      expect(parts[0]).toBe('user_123');

      // 1700000000000 in base36 is 'lo6z9d8g'
      expect(parts[1]).toBe((1700000000000).toString(36));

      // The nonce is 8 bytes of 'a' -> 16 hex chars
      expect(parts[2]).toBe('6161616161616161');

      // verifySignedState should be able to decode it correctly
      const verified = verifySignedState(state);
      expect(verified).toStrictEqual({ userId: 'user_123' });
    });

    it('generates unique states for different times and nonces', () => {
      const state1 = createSignedState('user_123');

      vi.advanceTimersByTime(1000); // advance 1 second

      const state2 = createSignedState('user_123');

      expect(state1).not.toBe(state2);

      const parts1 = state1.split(':');
      const parts2 = state2.split(':');

      // Timestamps or nonces should differ
      expect(parts1[1] !== parts2[1] || parts1[2] !== parts2[2]).toBe(true);
    });
  });

  describe('verifySignedState', () => {
    it('returns user ID for a valid state', () => {
      const state = createSignedState('user_123');
      const verified = verifySignedState(state);
      expect(verified).toStrictEqual({ userId: 'user_123' });
    });

    it('returns null if state is missing parts', () => {
      // Missing signature
      expect(verifySignedState('user_123:timestamp:nonce')).toBeNull();
      // Only user ID
      expect(verifySignedState('user_123')).toBeNull();
      // Empty string
      expect(verifySignedState('')).toBeNull();
    });

    it('returns null if signature is invalid', () => {
      const state = createSignedState('user_123');
      // Tamper with the signature by changing the last character (to maintain length)
      const tamperedState = state.slice(0, -1) + (state.endsWith('a') ? 'b' : 'a');
      expect(verifySignedState(tamperedState)).toBeNull();

      // Tamper with the user ID
      const parts = state.split(':');
      parts[0] = 'user_999';
      expect(verifySignedState(parts.join(':'))).toBeNull();
    });

    it('returns null if state is expired', () => {
      // STATE_MAX_AGE_MS is 10 * 60 * 1000 = 600,000ms
      const state = createSignedState('user_123');

      // Advance time by 10 minutes and 1 millisecond
      vi.advanceTimersByTime(10 * 60 * 1000 + 1);

      expect(verifySignedState(state)).toBeNull();
    });

    it('returns user ID if state is barely valid', () => {
      const state = createSignedState('user_123');

      // Advance time by exactly 10 minutes (still valid)
      vi.advanceTimersByTime(10 * 60 * 1000);

      expect(verifySignedState(state)).toStrictEqual({ userId: 'user_123' });
    });
  });
});
