import { describe, it, expect, vi, beforeEach } from 'vitest';
import { encryptToken, decryptToken } from './crypto';
import { logger } from './logger';

// We need to mock env since it requires ENCRYPTION_KEY
vi.mock('./env', () => {
  return {
    env: {
      ENCRYPTION_KEY: '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef' // 64 hex chars = 32 bytes
    }
  };
});

// Mock the logger to verify error logging
vi.mock('./logger', () => ({
  logger: {
    error: vi.fn(),
    info: vi.fn()
  }
}));

describe('crypto utilities', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('encryptToken', () => {
    it('should return empty string if empty string is passed', () => {
      expect(encryptToken('')).toBe('');
    });

    it('should correctly format encrypted string as iv:authTag:encryptedText', () => {
      const text = 'my-secret-token';
      const encrypted = encryptToken(text);

      const parts = encrypted.split(':');
      expect(parts.length).toBe(3);

      const [iv, authTag, encryptedText] = parts;
      expect(iv.length).toBe(24); // 12 bytes in hex = 24 chars
      expect(authTag.length).toBe(32); // 16 bytes in hex = 32 chars
      expect(encryptedText.length).toBeGreaterThan(0);
    });
  });

  describe('decryptToken', () => {
    it('should return empty string if empty string is passed', () => {
      expect(decryptToken('')).toBe('');
    });

    it('should return legacy plain text as is (graceful migration)', () => {
      const legacyText = 'some-legacy-token-without-colons';
      expect(decryptToken(legacyText)).toBe(legacyText);
    });

    it('should successfully decrypt valid encrypted text', () => {
      const text = 'my-secret-token';
      const encrypted = encryptToken(text);

      const decrypted = decryptToken(encrypted);
      expect(decrypted).toBe(text);
    });

    it('should throw an error and log it on corrupted data', () => {
      const text = 'my-secret-token';
      const encrypted = encryptToken(text);

      // Corrupt the encrypted text
      const parts = encrypted.split(':');
      parts[2] = '0000000000000000'; // Replace actual encrypted text with invalid data
      const corrupted = parts.join(':');

      expect(() => decryptToken(corrupted)).toThrow('Failed to decrypt token');
      expect(logger.error).toHaveBeenCalled();
    });

    it('should throw an error and log it if auth tag is modified', () => {
      const text = 'my-secret-token';
      const encrypted = encryptToken(text);

      // Corrupt the auth tag
      const parts = encrypted.split(':');
      parts[1] = '00000000000000000000000000000000'; // 16 bytes
      const corrupted = parts.join(':');

      expect(() => decryptToken(corrupted)).toThrow('Failed to decrypt token');
      expect(logger.error).toHaveBeenCalled();
    });

    it('should throw an error and log it if IV length is invalid', () => {
      const text = 'my-secret-token';
      const encrypted = encryptToken(text);

      // Corrupt the IV length
      const parts = encrypted.split(':');
      parts[0] = '00'; // Invalid IV length
      const corrupted = parts.join(':');

      expect(() => decryptToken(corrupted)).toThrow('Failed to decrypt token');
      expect(logger.error).toHaveBeenCalled();
    });

    it('should throw an error and log it if data contains non-hex characters', () => {
      const corrupted = 'zzzzzzzz:zzzzzzzz:zzzzzzzz';

      expect(() => decryptToken(corrupted)).toThrow('Failed to decrypt token');
      expect(logger.error).toHaveBeenCalled();
    });

    it('should throw an error and log it for a 3-part string with empty components', () => {
      const corrupted = '::';

      expect(() => decryptToken(corrupted)).toThrow('Failed to decrypt token');
      expect(logger.error).toHaveBeenCalled();
    });
  });
});
