import crypto from "node:crypto";

import { env } from "./env";
import { logger } from "./logger";

const ALGORITHM = "aes-256-gcm";

// Ensure the key is exactly 32 bytes for AES-256
const getValidatedKey = () => {
  if (!env.ENCRYPTION_KEY) {
    throw new Error(
      "ENCRYPTION_KEY environment variable is required for encrypting tokens at rest",
    );
  }
  const ENCRYPTION_KEY = env.ENCRYPTION_KEY;

  const keyBuffer = Buffer.from(ENCRYPTION_KEY, "hex");
  if (keyBuffer.length !== 32) {
    // If not hex or wrong length, try to create a 32-byte hash from the string
    return crypto.createHash("sha256").update(String(ENCRYPTION_KEY)).digest();
  }
  return keyBuffer;
};

// We lazy-load the key so the server can boot in CI environments without the key
// provided it doesn't need to perform cryptographic operations immediately
let cachedKey: Buffer | null = null;
const getKey = () => {
  if (!cachedKey) {
    cachedKey = getValidatedKey();
  }
  return cachedKey;
};

/** Current encryption version tag. */
const CURRENT_VERSION = "v1";

export function encryptToken(text: string): string {
  if (!text) return text;

  const key = getKey();
  const iv = crypto.randomBytes(12); // 12 bytes is recommended for GCM
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);

  let encrypted = cipher.update(text, "utf8", "hex");
  encrypted += cipher.final("hex");

  const authTag = cipher.getAuthTag().toString("hex");

  // Format: v1:iv:authTag:encryptedText
  return `${CURRENT_VERSION}:${iv.toString("hex")}:${authTag}:${encrypted}`;
}

/**
 * Decrypt a ciphertext produced by encryptToken.
 *
 * Supports both the current versioned format (v1:iv:authTag:ciphertext) and
 * the legacy unversioned format (iv:authTag:ciphertext) for backward
 * compatibility during the migration window. Plaintext fallback has been
 * removed — malformed data now throws.
 */
export function decryptToken(encryptedData: string): string {
  if (!encryptedData) return encryptedData;

  const parts = encryptedData.split(":");

  let ivHex: string;
  let authTagHex: string;
  let encryptedText: string;

  if (parts.length === 4 && parts[0] === CURRENT_VERSION) {
    // Versioned format: v1:iv:authTag:ciphertext
    [, ivHex, authTagHex, encryptedText] = parts;
  } else if (parts.length === 3) {
    // Legacy unversioned format: iv:authTag:ciphertext
    [ivHex, authTagHex, encryptedText] = parts;
  } else {
    throw new Error("Malformed encrypted data — expected v1:iv:authTag:ciphertext or iv:authTag:ciphertext");
  }

  try {
    const key = getKey();
    const iv = Buffer.from(ivHex, "hex");
    const authTag = Buffer.from(authTagHex, "hex");

    const decipher = crypto.createDecipheriv(ALGORITHM, key, iv, { authTagLength: 16 });
    decipher.setAuthTag(authTag);

    let decrypted = decipher.update(encryptedText, "hex", "utf8");
    decrypted += decipher.final("utf8");

    return decrypted;
  } catch (error) {
    logger.error({ err: error }, "Failed to decrypt token");
    throw new Error("Failed to decrypt token");
  }
}
