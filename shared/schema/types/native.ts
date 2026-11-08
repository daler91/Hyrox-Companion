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

/** Health Connect allows a session at most this long; anything longer is not a workout. */
const MAX_HEALTH_SESSION_MS = 24 * 60 * 60 * 1000;

/**
 * One Health Connect exercise session, as the app reads it: the record's id,
 * when it ran, its sport (mapped by the app onto Strava's sport-type names,
 * which shared/deviceSportTypes.ts and the matcher already understand), and
 * the totals the app aggregated over the session's span from the heart-rate,
 * distance and active-calories records.
 */
export const healthConnectSessionSchema = z
  .object({
    id: z.string().min(1).max(255),
    startTime: z.string().datetime({ offset: true }),
    endTime: z.string().datetime({ offset: true }),
    /** The session's UTC offset where it was recorded, which fixes its calendar date. */
    zoneOffsetMinutes: z.number().int().min(-18 * 60).max(18 * 60).optional(),
    sportType: z.string().min(1).max(64),
    title: z.string().max(200).optional(),
    distanceMeters: z.number().nonnegative().max(1_000_000).optional(),
    activeCalories: z.number().nonnegative().max(20_000).optional(),
    avgHeartRate: z.number().int().min(20).max(250).optional(),
    maxHeartRate: z.number().int().min(20).max(250).optional(),
    /** The package of the app that wrote the session (e.g. com.strava). */
    dataOrigin: z.string().max(255).optional(),
  })
  .refine(
    (session) => {
      const span = Date.parse(session.endTime) - Date.parse(session.startTime);
      return span > 0 && span <= MAX_HEALTH_SESSION_MS;
    },
    { message: "endTime must be after startTime, at most 24 hours later", path: ["endTime"] },
  );
export type HealthConnectSessionInput = z.infer<typeof healthConnectSessionSchema>;

/** POST /api/v1/health-connect/sync */
export const healthConnectSyncSchema = z.object({
  sessions: z.array(healthConnectSessionSchema).max(100),
  /** Sessions deleted in Health Connect since the last sync. */
  deletedIds: z.array(z.string().min(1).max(255)).max(500).default([]),
});
export type HealthConnectSyncInput = z.infer<typeof healthConnectSyncSchema>;
