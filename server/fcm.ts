import { createSign } from "node:crypto";

import { PUSH_SEND_TIMEOUT_MS } from "./constants";
import { env } from "./env";
import { type FcmServiceAccount, parseFcmServiceAccount } from "./fcmServiceAccount";
import { logger } from "./logger";
import type { PushPayload } from "./pushNotifications";

/**
 * Native app push through Firebase Cloud Messaging's HTTP v1 API. FCM delivers
 * to Android directly and to iOS through APNs once an APNs key is uploaded to
 * the Firebase project, so this one sender covers both apps.
 *
 * Auth is the service-account flow done by hand (RFC 7523): sign a short JWT
 * with the account's private key, trade it at Google's token endpoint for an
 * hour-long access token, cache that. It is a few lines of node:crypto, which
 * keeps firebase-admin and its dependency tree out of the server.
 *
 * Both hosts are fixed constants. The key file names a token_uri too, but it
 * is not used: nothing in the environment gets to choose where the signed
 * assertion is sent.
 */

const TOKEN_URL = "https://oauth2.googleapis.com/token";
const FCM_SCOPE = "https://www.googleapis.com/auth/firebase.messaging";
const ASSERTION_LIFETIME_SECONDS = 3600;
/** Refresh this long before the access token's stated expiry. */
const ACCESS_TOKEN_REFRESH_MARGIN_MS = 60_000;

export function isFcmConfigured(): boolean {
  return parseFcmServiceAccount(env.FCM_SERVICE_ACCOUNT_JSON) !== null;
}

function base64url(input: string | Buffer): string {
  return Buffer.from(input).toString("base64url");
}

/** The signed JWT-bearer assertion for the service account. Exported for tests. */
export function buildAssertion(account: FcmServiceAccount, nowSeconds: number): string {
  const header = base64url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const claims = base64url(
    JSON.stringify({
      iss: account.clientEmail,
      scope: FCM_SCOPE,
      aud: TOKEN_URL,
      iat: nowSeconds,
      exp: nowSeconds + ASSERTION_LIFETIME_SECONDS,
    }),
  );
  const signature = createSign("RSA-SHA256").update(`${header}.${claims}`).sign(account.privateKey);
  return `${header}.${claims}.${base64url(signature)}`;
}

let cachedAccessToken: { value: string; expiresAt: number } | null = null;
let accessTokenInFlight: Promise<string> | null = null;

/** Forget the cached access token. For tests, and after FCM answers 401. */
export function resetFcmAccessToken(): void {
  cachedAccessToken = null;
  accessTokenInFlight = null;
}

async function fetchAccessToken(account: FcmServiceAccount): Promise<string> {
  const response = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion: buildAssertion(account, Math.floor(Date.now() / 1000)),
    }),
    signal: AbortSignal.timeout(PUSH_SEND_TIMEOUT_MS),
  });
  if (!response.ok) {
    // The body names the reason (invalid_grant for a revoked key, say) and
    // carries no secret; the assertion itself is never logged.
    const detail = await response.text().catch(() => "");
    throw new Error(`FCM access token request failed with ${response.status}: ${detail.slice(0, 200)}`);
  }
  const body = (await response.json()) as { access_token?: unknown; expires_in?: unknown };
  // A typeof check on the response shape, not a comparison against a secret.
  // bearer:disable javascript_lang_observable_timing
  if (typeof body.access_token !== "string") throw new Error("FCM access token response had no access_token");
  const lifetimeMs = (typeof body.expires_in === "number" ? body.expires_in : 3600) * 1000;
  cachedAccessToken = { value: body.access_token, expiresAt: Date.now() + lifetimeMs - ACCESS_TOKEN_REFRESH_MARGIN_MS };
  return body.access_token;
}

/** A valid access token, from the cache while it lasts. Concurrent callers share one fetch. */
async function getAccessToken(account: FcmServiceAccount): Promise<string> {
  if (cachedAccessToken && cachedAccessToken.expiresAt > Date.now()) return cachedAccessToken.value;
  accessTokenInFlight ??= fetchAccessToken(account).finally(() => {
    accessTokenInFlight = null;
  });
  return accessTokenInFlight;
}

/**
 * Android notification channels the app creates, one per kind of
 * notification, so athletes can mute one kind without the others.
 */
export type PushCategory = "training" | "coach" | "nutrition";

/** The FCM v1 message for one device. Exported for tests. */
export function buildFcmMessage(token: string, payload: PushPayload): Record<string, unknown> {
  return {
    message: {
      token,
      notification: { title: payload.title, body: payload.body },
      // FCM data values must be strings. The app routes a tap to `url` after
      // checking it is one of its own paths, as client/public/sw-push.js does.
      data: {
        url: payload.url ?? "/",
        ...(payload.category ? { category: payload.category } : {}),
      },
      android: {
        // High priority is what FCM recommends for a notification the athlete
        // sees and acts on; it is shown promptly even under Doze.
        priority: "high",
        ...(payload.category ? { notification: { channel_id: payload.category } } : {}),
      },
    },
  };
}

interface FcmErrorBody {
  error?: {
    status?: string;
    details?: Array<{ errorCode?: string; fieldViolations?: Array<{ field?: string }> }>;
  };
}

/**
 * Whether an FCM error means the token will never work again, so the row
 * should be pruned: the app was uninstalled or the token rotated
 * (UNREGISTERED), or FCM rejected the token field itself as malformed. These
 * are the two cases Firebase's token-management guidance says to delete on.
 *
 * Deliberately not pruned: SENDER_ID_MISMATCH and a bare 404 or 403. Each is
 * also what every send returns when the server is configured with the wrong
 * Firebase project, and pruning on them would wipe every athlete's token on
 * one bad deploy. Any other INVALID_ARGUMENT is a malformed message, which is
 * this server's bug and not the device's.
 */
export function isStaleTokenError(status: number, body: FcmErrorBody | null): boolean {
  const details = body?.error?.details ?? [];
  if (details.some((detail) => detail.errorCode === "UNREGISTERED")) return true;
  if (status === 400) {
    return details.some((detail) => detail.fieldViolations?.some((violation) => violation.field === "message.token"));
  }
  return false;
}

export type FcmSendResult = "sent" | "stale" | "failed";

/**
 * Send one notification to one app install. Never throws: a failure is logged
 * and reported as `failed`, a dead token as `stale` for the caller to prune.
 * `deviceTokenId` is the row id, logged in place of the token itself.
 */
export async function sendFcmMessage(
  deviceTokenId: string,
  token: string,
  payload: PushPayload,
): Promise<FcmSendResult> {
  const account = parseFcmServiceAccount(env.FCM_SERVICE_ACCOUNT_JSON);
  if (!account) return "failed";

  let accessToken: string;
  try {
    accessToken = await getAccessToken(account);
  } catch (err) {
    // The error carries the token endpoint's status and reason, never the assertion or a token.
    // bearer:disable javascript_lang_logger_leak
    logger.error({ err }, "[push] Could not get an FCM access token");
    return "failed";
  }

  let response: Response;
  try {
    response = await fetch(`https://fcm.googleapis.com/v1/projects/${account.projectId}/messages:send`, {
      method: "POST",
      headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
      body: JSON.stringify(buildFcmMessage(token, payload)),
      signal: AbortSignal.timeout(PUSH_SEND_TIMEOUT_MS),
    });
  } catch (err) {
    // deviceTokenId is the row's uuid, logged in place of the device token.
    // bearer:disable javascript_lang_logger_leak
    logger.error({ err, deviceTokenId }, "[push] FCM send failed");
    return "failed";
  }

  if (response.ok) return "sent";

  const body = (await response.json().catch(() => null)) as FcmErrorBody | null;
  if (isStaleTokenError(response.status, body)) return "stale";
  if (response.status === 401) {
    // The cached access token was revoked or expired early; the next send fetches a fresh one.
    resetFcmAccessToken();
  }
  // The row's uuid and FCM's status codes: no device token, no message content.
  // bearer:disable javascript_lang_logger_leak
  logger.error(
    { deviceTokenId, status: response.status, fcmStatus: body?.error?.status },
    "[push] FCM rejected the notification",
  );
  return "failed";
}
