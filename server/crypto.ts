import crypto from "node:crypto";

import { env } from "./env";
import { logger } from "./logger";

const ALGORITHM = "aes-256-gcm";

// Coerce an env-provided secret into a 32-byte AES-256 key. A 64-char hex
// string is used directly; anything else is hashed to a 32-byte key so a long
// passphrase still yields a valid key length.
function deriveKey(secret: string): Buffer {
  const keyBuffer = Buffer.from(secret, "hex");
  if (keyBuffer.length === 32) {
    return keyBuffer;
  }
  return crypto.createHash("sha256").update(String(secret)).digest();
}

// Versioned keyring (W6). Every ciphertext is tagged with the version of the
// key that produced it (`v1:iv:authTag:ciphertext`), so multiple keys can
// coexist: the active key encrypts new data while a retired key stays available
// to decrypt old data during a rotation.
//
// Rotation procedure (zero-downtime):
//   1. Generate a new 32-byte key, set ENCRYPTION_KEY_V2 to it (leave
//      ENCRYPTION_KEY — the v1 key — in place). Deploy. New writes are now
//      tagged v2; existing v1/legacy ciphertext still decrypts via the v1 key.
//   2. Run the re-encrypt job (reencryptToken on every stored credential) to
//      migrate v1/legacy ciphertext forward to v2.
//   3. Once nothing references v1, the v1 key may be retired. Keep both keys
//      configured until the migration is verified complete.
type KeyVersion = "v1" | "v2";

const VERSIONS: readonly KeyVersion[] = ["v1", "v2"];

// Lazily-derived keys, cached so we don't re-hash on every call. We lazy-load
// so the server can boot in CI without performing crypto immediately.
const keyringCache = new Map<KeyVersion, Buffer>();

function secretForVersion(version: KeyVersion): string | undefined {
  switch (version) {
    case "v1": {
      return env.ENCRYPTION_KEY;
    }
    case "v2": {
      return env.ENCRYPTION_KEY_V2;
    }
  }
}

function getKey(version: KeyVersion): Buffer {
  const cached = keyringCache.get(version);
  if (cached) {
    return cached;
  }
  const secret = secretForVersion(version);
  if (!secret) {
    throw new Error(
      `No encryption key configured for version ${version} — set the matching ENCRYPTION_KEY env var`,
    );
  }
  const key = deriveKey(secret);
  keyringCache.set(version, key);
  return key;
}

/** The version new ciphertext is tagged with: the newest configured key. */
export function currentKeyVersion(): KeyVersion {
  return env.ENCRYPTION_KEY_V2 ? "v2" : "v1";
}

export function encryptToken(text: string): string {
  if (!text) return text;

  const version = currentKeyVersion();
  const key = getKey(version);
  const iv = crypto.randomBytes(12); // 12 bytes is recommended for GCM
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);

  let encrypted = cipher.update(text, "utf8", "hex");
  encrypted += cipher.final("hex");

  const authTag = cipher.getAuthTag().toString("hex");

  // Format: <version>:iv:authTag:encryptedText
  return `${version}:${iv.toString("hex")}:${authTag}:${encrypted}`;
}

interface ParsedCiphertext {
  version: KeyVersion;
  ivHex: string;
  authTagHex: string;
  encryptedText: string;
}

function isKnownVersion(value: string): value is KeyVersion {
  return (VERSIONS as readonly string[]).includes(value);
}

function parseCiphertext(encryptedData: string): ParsedCiphertext {
  const parts = encryptedData.split(":");

  if (parts.length === 4 && isKnownVersion(parts[0])) {
    // Versioned format: <version>:iv:authTag:ciphertext
    return { version: parts[0], ivHex: parts[1], authTagHex: parts[2], encryptedText: parts[3] };
  }
  if (parts.length === 3) {
    // Legacy unversioned format predates the version tag; it was written with
    // the original key, which now lives in the v1 slot.
    return { version: "v1", ivHex: parts[0], authTagHex: parts[1], encryptedText: parts[2] };
  }
  throw new Error(
    "Malformed encrypted data — expected <version>:iv:authTag:ciphertext or iv:authTag:ciphertext",
  );
}

/**
 * Decrypt a ciphertext produced by encryptToken.
 *
 * Supports the current versioned format (`<version>:iv:authTag:ciphertext`) for
 * every configured key version, plus the legacy unversioned format
 * (`iv:authTag:ciphertext`) for backward compatibility. Plaintext fallback has
 * been removed — malformed data throws.
 */
export function decryptToken(encryptedData: string): string {
  if (!encryptedData) return encryptedData;

  const { version, ivHex, authTagHex, encryptedText } = parseCiphertext(encryptedData);

  try {
    const key = getKey(version);
    const iv = Buffer.from(ivHex, "hex");
    const authTag = Buffer.from(authTagHex, "hex");

    // Reject truncated/padded auth tags — GCM is 128-bit and a shorter tag
    // weakens forgery resistance (NIST SP 800-38D §5.2.1.2).
    if (authTag.length !== 16) {
      throw new Error("Invalid auth tag length — expected 16 bytes");
    }

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

/**
 * True when the ciphertext is not tagged with the active key version (legacy or
 * an older key), i.e. re-encrypting would migrate it forward. Malformed input
 * returns false so callers leave it untouched for a human to investigate.
 */
export function needsReencryption(encryptedData: string): boolean {
  if (!encryptedData) return false;
  try {
    return parseCiphertext(encryptedData).version !== currentKeyVersion();
  } catch {
    return false;
  }
}

/**
 * Decrypt then re-encrypt under the active key. Returns the input unchanged
 * when it is already current (or empty/malformed), so callers can write the
 * result back unconditionally during a rotation sweep.
 */
export function reencryptToken(encryptedData: string): string {
  if (!encryptedData || !needsReencryption(encryptedData)) {
    return encryptedData;
  }
  return encryptToken(decryptToken(encryptedData));
}

/** Reset the derived-key cache. Exposed for tests that swap env mid-suite. */
export function __resetKeyringForTests(): void {
  keyringCache.clear();
}
