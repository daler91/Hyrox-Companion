import { env } from "./env";
import crypto from "node:crypto";

const ALGORITHM = "aes-256-gcm";

// Ensure the key is exactly 32 bytes for AES-256
const getValidatedKey = () => {
  if (!env.ENCRYPTION_KEY) {
    throw new Error(
      "ENCRYPTION_KEY environment variable is required for encrypting tokens at rest",
    );
  }
  const ENCRYPTION_KEY = env.ENCRYPTION_KEY;

  let keyBuffer = Buffer.from(ENCRYPTION_KEY, "hex");
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

export function encryptToken(text: string): string {
  if (!text) return text;

  const key = getKey();
  const iv = crypto.randomBytes(12); // 12 bytes is recommended for GCM
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);

  let encrypted = cipher.update(text, "utf8", "hex");
  encrypted += cipher.final("hex");

  const authTag = cipher.getAuthTag().toString("hex");

  // Format: iv:authTag:encryptedText
  return `${iv.toString("hex")}:${authTag}:${encrypted}`;
}

export function decryptToken(encryptedData: string): string {
  if (!encryptedData) return encryptedData;

  // If the data doesn't match our format (e.g., legacy plain text), return as is
  // This allows for a graceful migration
  const parts = encryptedData.split(":");
  if (parts.length !== 3) {
    return encryptedData;
  }

  try {
    const key = getKey();
    const [ivHex, authTagHex, encryptedText] = parts;
    const iv = Buffer.from(ivHex, "hex");
    const authTag = Buffer.from(authTagHex, "hex");

    const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
    decipher.setAuthTag(authTag);

    let decrypted = decipher.update(encryptedText, "hex", "utf8");
    decrypted += decipher.final("utf8");

    return decrypted;
  } catch (error) {
    console.error("Failed to decrypt token:", error);
    // If decryption fails, it might be corrupted or we lost the key
    // For safety, return empty string or throw depending on requirements
    // Returning the original string might be dangerous if it's partially matched
    throw new Error("Failed to decrypt token");
  }
}
