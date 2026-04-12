import { describe, expect, it, vi } from 'vitest';

import { decryptToken,encryptToken } from './crypto';

// We need to mock env since it requires ENCRYPTION_KEY
vi.mock('./env', () => {
  return {
    env: {
      ENCRYPTION_KEY: '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef' // 64 hex chars = 32 bytes
    }
  };
});

describe('crypto utilities', () => {
  describe('encryptToken', () => {
    it('should return empty string if empty string is passed', () => {
      expect(encryptToken('')).toBe('');
    });

    it('should correctly format encrypted string as v1:iv:authTag:encryptedText', () => {
      const text = 'my-secret-token';
      const encrypted = encryptToken(text);

      const parts = encrypted.split(':');
      expect(parts.length).toBe(4);

      const [version, iv, authTag, encryptedText] = parts;
      expect(version).toBe('v1');
      expect(iv.length).toBe(24); // 12 bytes in hex = 24 chars
      expect(authTag.length).toBe(32); // 16 bytes in hex = 32 chars
      expect(encryptedText.length).toBeGreaterThan(0);
    });
  });

  describe('decryptToken', () => {
    it('should return empty string if empty string is passed', () => {
      expect(decryptToken('')).toBe('');
    });

    it('should throw on malformed data (plaintext fallback removed)', () => {
      const legacyText = 'some-legacy-token-without-colons';
      expect(() => decryptToken(legacyText)).toThrow('Malformed encrypted data');
    });

    it('should successfully decrypt valid encrypted text', () => {
      const text = 'my-secret-token';
      const encrypted = encryptToken(text);

      const decrypted = decryptToken(encrypted);
      expect(decrypted).toBe(text);
    });

    it('should throw an error on corrupted data', () => {
      const text = 'my-secret-token';
      const encrypted = encryptToken(text);

      // Corrupt the encrypted text (index 3 in v1:iv:authTag:ciphertext)
      const parts = encrypted.split(':');
      parts[3] = '0000000000000000';
      const corrupted = parts.join(':');

      expect(() => decryptToken(corrupted)).toThrow('Failed to decrypt token');
    });

    it('should throw an error if auth tag is modified', () => {
      const text = 'my-secret-token';
      const encrypted = encryptToken(text);

      // Corrupt the auth tag (index 2 in v1:iv:authTag:ciphertext)
      const parts = encrypted.split(':');
      parts[2] = '00000000000000000000000000000000'; // 16 bytes
      const corrupted = parts.join(':');

      expect(() => decryptToken(corrupted)).toThrow('Failed to decrypt token');
    });
  });
});
