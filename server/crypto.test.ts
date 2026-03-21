import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { encryptToken, decryptToken } from "./crypto";
import { logger } from "./logger";
import { env } from "./env";

vi.mock("./logger", () => ({
  logger: {
    error: vi.fn(),
  }
}));

// We need to manipulate env to cover getValidatedKey logic.
vi.mock("./env", () => ({
  env: {
    ENCRYPTION_KEY: "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef"
  }
}));

describe("crypto functions", () => {
  let originalEnvKey: string | undefined;

  beforeEach(() => {
    vi.clearAllMocks();
    originalEnvKey = env.ENCRYPTION_KEY;
  });

  afterEach(() => {
    env.ENCRYPTION_KEY = originalEnvKey;
    vi.resetModules();
  });

  describe("decryptToken edge cases & invalid inputs", () => {
    it("returns falsy values as is", async () => {
      // Need dynamic import to get a fresh module state since vi.resetModules is used
      const { decryptToken } = await import("./crypto");
      expect(decryptToken("")).toBe("");
      expect(decryptToken(undefined as unknown as string)).toBeUndefined();
      expect(decryptToken(null as unknown as string)).toBeNull();
    });

    it("returns the original string if it doesn't match the encrypted format (missing parts)", async () => {
      const { decryptToken } = await import("./crypto");
      const plainText = "this is just a plain text string";
      expect(decryptToken(plainText)).toBe(plainText);
    });

    it("returns the original string if it has too many parts", async () => {
      const { decryptToken } = await import("./crypto");
      const weirdFormat = "part1:part2:part3:part4";
      expect(decryptToken(weirdFormat)).toBe(weirdFormat);
    });
  });

  describe("decryptToken valid decryption scenarios", () => {
    it("decrypts a valid encrypted token with a 32-byte hex key", async () => {
      env.ENCRYPTION_KEY = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";
      const { encryptToken, decryptToken } = await import("./crypto");

      const originalText = "my-secret-token";
      const encrypted = encryptToken(originalText);
      expect(decryptToken(encrypted)).toBe(originalText);
    });

    it("decrypts a valid encrypted token with a short non-hex key (fallback hash)", async () => {
      env.ENCRYPTION_KEY = "short-key";
      const { encryptToken, decryptToken } = await import("./crypto");

      const originalText = "another-secret";
      const encrypted = encryptToken(originalText);
      expect(decryptToken(encrypted)).toBe(originalText);
    });
  });

  describe("decryptToken failures", () => {
    it("throws an error if ENCRYPTION_KEY is missing when encryption is needed", async () => {
      env.ENCRYPTION_KEY = "";
      const { decryptToken } = await import("./crypto");

      const fakeToken = "ivHex:authTagHex:encryptedText";
      expect(() => decryptToken(fakeToken)).toThrow("Failed to decrypt token");
      expect(logger.error).toHaveBeenCalled();
    });

    it("throws an error and logs if decryption fails (corrupted data)", async () => {
      env.ENCRYPTION_KEY = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";
      const { encryptToken, decryptToken } = await import("./crypto");

      const originalText = "my-secret-token";
      const encrypted = encryptToken(originalText);

      // Corrupt the encrypted text part
      const parts = encrypted.split(":");
      parts[2] = "deadbeef";
      const corrupted = parts.join(":");

      expect(() => decryptToken(corrupted)).toThrow("Failed to decrypt token");
      expect(logger.error).toHaveBeenCalled();
    });

    it("throws an error and logs if decryption fails (invalid auth tag)", async () => {
      env.ENCRYPTION_KEY = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";
      const { encryptToken, decryptToken } = await import("./crypto");

      const originalText = "my-secret-token";
      const encrypted = encryptToken(originalText);

      // Corrupt the auth tag part
      const parts = encrypted.split(":");
      parts[1] = "00000000000000000000000000000000";
      const corrupted = parts.join(":");

      expect(() => decryptToken(corrupted)).toThrow("Failed to decrypt token");
      expect(logger.error).toHaveBeenCalled();
    });

    it("throws an error and logs if decryption fails (invalid IV length)", async () => {
      env.ENCRYPTION_KEY = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";
      const { encryptToken, decryptToken } = await import("./crypto");

      const originalText = "my-secret-token";
      const encrypted = encryptToken(originalText);

      // Corrupt the IV part
      const parts = encrypted.split(":");
      parts[0] = "1234"; // Wrong length IV
      const corrupted = parts.join(":");

      expect(() => decryptToken(corrupted)).toThrow("Failed to decrypt token");
      expect(logger.error).toHaveBeenCalled();
    });
  });

  describe("encryptToken edge cases & invalid inputs", () => {
    it("returns falsy values as is", async () => {
      const { encryptToken } = await import("./crypto");
      expect(encryptToken("")).toBe("");
      expect(encryptToken(undefined as unknown as string)).toBeUndefined();
      expect(encryptToken(null as unknown as string)).toBeNull();
    });
  });
});
