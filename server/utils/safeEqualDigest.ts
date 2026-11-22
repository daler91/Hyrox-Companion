import crypto from "node:crypto";

/**
 * Constant-time string equality for secrets, signatures and cookie bindings.
 * Both sides are hashed to SHA-256 digests first, so `timingSafeEqual` always
 * gets two 32-byte buffers: it never throws on inputs of different lengths,
 * and the compare does not leak the expected value's length. Seven call sites
 * wrote this by hand (R6, REFACTORING_REVIEW 2026-09-23).
 */
export function safeEqualDigest(a: string, b: string): boolean {
  const aHash = crypto.createHash("sha256").update(a).digest();
  const bHash = crypto.createHash("sha256").update(b).digest();
  return crypto.timingSafeEqual(aHash, bHash);
}
