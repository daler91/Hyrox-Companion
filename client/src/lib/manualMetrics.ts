import { userDistanceToMeters } from "@shared/unitConversion";

// Mirror the server bounds (insertWorkoutLogSchema and the MAF-test metrics
// schema) so out-of-range manual metrics are caught before we mutate or queue a
// save — otherwise online users only see a generic failure after the request,
// and offline users get a queued-success toast for a save that will be rejected
// on replay.
export const MIN_HEART_RATE = 20;
export const MAX_HEART_RATE = 250;
export const MAX_DISTANCE_METERS = 1_000_000;

/**
 * Parse an optional integer field (e.g. heart rate) from a form string.
 * Blank, non-numeric, or fractional input means "not entered" → null. Using
 * Number (not parseInt) avoids silently truncating a value like "145.9" → 145,
 * and we never coerce an empty field to a meaningful 0 bpm.
 */
export function parseOptionalInt(value: string | undefined): number | null {
  if (value == null) return null;
  const trimmed = value.trim();
  if (trimmed === "") return null;
  const parsed = Number(trimmed);
  return Number.isInteger(parsed) ? parsed : null;
}

/**
 * Convert an optional distance field — entered in the user's display unit — into
 * SI meters for the `distance_meters` column (which stores canonical meters, the
 * same unit Strava/Garmin sync writes). Blank, non-numeric, or negative input
 * means "not entered" → null. Uses Number (not parseFloat) so the whole string
 * must be numeric — consistent with the heart-rate fields and rejecting partial
 * parses like "5xyz".
 */
export function parseOptionalDistanceMeters(
  value: string | undefined,
  distanceUnit: string,
): number | null {
  if (value == null) return null;
  const trimmed = value.trim();
  if (trimmed === "") return null;
  const userValue = Number(trimmed);
  if (!Number.isFinite(userValue) || userValue < 0) return null;
  return Math.round(userDistanceToMeters(userValue, distanceUnit));
}

/**
 * Validate manually-entered distance + heart-rate fields, returning a
 * user-facing error string or null when everything is in range. Shared by the
 * manual workout form and the MAF-test form so both enforce the same bounds the
 * server does.
 */
export function validateManualMetrics(
  distance: string | undefined,
  avgHeartrate: string | undefined,
  maxHeartrate: string | undefined,
  distanceUnit: string,
): string | null {
  const distanceMeters = parseOptionalDistanceMeters(distance, distanceUnit);
  if (distanceMeters != null && distanceMeters > MAX_DISTANCE_METERS) {
    return "That distance looks too large — please double-check it.";
  }
  for (const [raw, label] of [
    [avgHeartrate, "Average"],
    [maxHeartrate, "Max"],
  ] as const) {
    if (raw == null || raw.trim() === "") continue;
    const parsed = Number(raw.trim());
    // Reject fractional/non-numeric input rather than letting it be silently
    // truncated (e.g. 145.9 -> 145), which would persist a value the user
    // never entered.
    if (!Number.isInteger(parsed)) {
      return `${label} heart rate must be a whole number.`;
    }
    if (parsed < MIN_HEART_RATE || parsed > MAX_HEART_RATE) {
      return `${label} heart rate must be between ${MIN_HEART_RATE} and ${MAX_HEART_RATE} bpm.`;
    }
  }
  const avg = parseOptionalInt(avgHeartrate);
  const max = parseOptionalInt(maxHeartrate);
  if (avg != null && max != null && max < avg) {
    return "Max heart rate can't be lower than average heart rate.";
  }
  return null;
}
