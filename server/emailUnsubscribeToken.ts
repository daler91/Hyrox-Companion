import crypto from "node:crypto";

import { env } from "./env";

/**
 * Signed, login-free unsubscribe links for every outbound email.
 *
 * Every email carries a `List-Unsubscribe` header and a footer link that
 * resolve to `GET|POST /api/v1/emails/unsubscribe?token=…`. The token is the
 * athlete's id plus an HMAC over it, so the endpoint can act without a session
 * cookie (mail clients POST the header URL with no credentials — RFC 8058) and
 * a forged link cannot turn someone else's email off.
 *
 * The HMAC key is derived from the app's encryption key under a fixed label
 * (the same trick `stravaWebhook.ts` uses for its verify token), so there is
 * no extra secret to configure. Tokens have no expiry: an unsubscribe link in
 * an email from three months ago must still work, and the only thing the
 * capability grants is turning email off. Key rotation (ENCRYPTION_KEY_V2)
 * signs with the new key while links signed with the old one keep verifying
 * until the old key is dropped; after that the confirm page reports the link
 * as no longer valid and points at Settings.
 */

const KEY_LABEL = "email-unsubscribe-v1";
const UNSUBSCRIBE_PATH = "/api/v1/emails/unsubscribe";

function deriveKey(secret: string): Buffer {
  return crypto.createHmac("sha256", secret).update(KEY_LABEL).digest();
}

// Derived lazily: `env` is mocked without an encryption key in several test
// files that never mint a token, and a module-load derivation would throw there.
function verificationKeys(): Buffer[] {
  const keys = [env.ENCRYPTION_KEY_V2, env.ENCRYPTION_KEY].filter(
    (secret): secret is string => typeof secret === "string" && secret.length > 0,
  );
  if (keys.length === 0) {
    throw new Error("ENCRYPTION_KEY is required to sign email unsubscribe links");
  }
  return keys.map(deriveKey);
}

function sign(userId: string, key: Buffer): string {
  return crypto.createHmac("sha256", key).update(userId).digest("hex");
}

export function getAppUrl(): string {
  return env.APP_URL || "https://fitai.coach";
}

export function createUnsubscribeToken(userId: string): string {
  const [signingKey] = verificationKeys();
  return `${Buffer.from(userId, "utf8").toString("base64url")}.${sign(userId, signingKey)}`;
}

/**
 * The athlete a token was minted for, or null when it was not minted by this
 * app (or by a key that has since been retired).
 */
export function verifyUnsubscribeToken(token: unknown): { userId: string } | null {
  if (typeof token !== "string" || token.length === 0 || token.length > 512) return null;
  const parts = token.split(".");
  if (parts.length !== 2) return null;
  const [encodedUserId, signature] = parts;
  if (!encodedUserId || !signature) return null;

  const userId = Buffer.from(encodedUserId, "base64url").toString("utf8");
  if (userId.length === 0) return null;

  // Hash both sides so timingSafeEqual sees equal lengths whatever the input
  // (same shape as verifySignedState in strava.ts).
  const providedHash = crypto.createHash("sha256").update(signature).digest();
  for (const key of verificationKeys()) {
    const expectedHash = crypto.createHash("sha256").update(sign(userId, key)).digest();
    if (crypto.timingSafeEqual(providedHash, expectedHash)) return { userId };
  }
  return null;
}

export function buildUnsubscribeUrl(userId: string): string {
  return `${getAppUrl()}${UNSUBSCRIBE_PATH}?token=${encodeURIComponent(createUnsubscribeToken(userId))}`;
}

/**
 * Headers that let mail clients offer their own unsubscribe affordance and
 * that Gmail/Yahoo require of bulk senders (RFC 2369 + RFC 8058 one-click).
 */
export function buildListUnsubscribeHeaders(userId: string): Record<string, string> {
  return {
    "List-Unsubscribe": `<${buildUnsubscribeUrl(userId)}>`,
    "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
  };
}
