import { devicePlatformEnum } from "../enums";
import { z } from "../zod";

// Request schemas for endpoints the native mobile app calls. They live here,
// not beside their routes, so the route validation and the OpenAPI document
// (shared/openapiRoutes) are the same object and cannot drift apart.

/**
 * An FCM registration token, as the Firebase SDK hands it to the app. Real
 * tokens are around 160 characters of base64url plus a colon; the bound is
 * generous, the charset is not, so nothing but a token is ever stored.
 */
export const deviceTokenSchema = z
  .string()
  .min(1)
  .max(4096)
  .regex(/^[\w:-]+$/, { message: "Device token must be an FCM registration token" });

/** POST /api/v1/push/devices */
export const registerDeviceTokenSchema = z.object({
  token: deviceTokenSchema,
  platform: z.enum(devicePlatformEnum),
});
export type RegisterDeviceTokenInput = z.infer<typeof registerDeviceTokenSchema>;

/** DELETE /api/v1/push/devices */
export const unregisterDeviceTokenSchema = z.object({ token: deviceTokenSchema });
export type UnregisterDeviceTokenInput = z.infer<typeof unregisterDeviceTokenSchema>;

/**
 * A PKCE-style code challenge: base64url(SHA-256(verifier)), 43 characters
 * with no padding (RFC 7636 §4.2, S256). It never contains a colon, so it can
 * ride in the colon-separated Strava OAuth state.
 */
export const CODE_CHALLENGE_PATTERN = /^[A-Za-z0-9_-]{43}$/;
/** RFC 7636 §4.1 code_verifier: 43–128 unreserved characters. */
export const CODE_VERIFIER_PATTERN = /^[A-Za-z0-9._~-]{43,128}$/;

/** POST /api/v1/strava/native/complete */
export const stravaNativeCompleteSchema = z.object({
  code: z.string().min(1).max(512),
  state: z.string().min(1).max(1024),
  verifier: z.string().regex(CODE_VERIFIER_PATTERN, { message: "verifier must be an RFC 7636 code verifier" }),
});
export type StravaNativeCompleteInput = z.infer<typeof stravaNativeCompleteSchema>;
