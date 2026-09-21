/**
 * Clock-style duration formatting shared by the client and the server.
 *
 * A leaf module (no `@shared/schema` import) so the browser bundle stays free
 * of the drizzle graph — the invariant `script/bundle-check.ts` protects.
 */

/** Format a duration in seconds as "H:MM:SS" (e.g. 4530 → "1:15:30"). */
export function formatSecondsToClock(totalSeconds: number): string {
  if (!Number.isFinite(totalSeconds)) return "0:00:00";
  const safe = Math.max(0, Math.round(totalSeconds));
  const hours = Math.floor(safe / 3600);
  const minutes = Math.floor((safe % 3600) / 60);
  const seconds = safe % 60;
  const mm = String(minutes).padStart(2, "0");
  const ss = String(seconds).padStart(2, "0");
  return `${hours}:${mm}:${ss}`;
}
