/**
 * Time-of-day helpers shared by the workout fuelling surfaces. They convert
 * between minutes-from-midnight (how a session's local start time is stored,
 * 0–1439) and the "HH:MM" string an `<input type="time">` reads and writes.
 */

/** Minutes-from-midnight → the "HH:MM" value an `<input type="time">` uses. */
export function minutesToHhmm(min: number | null | undefined): string {
  if (min == null) return "";
  return `${String(Math.floor(min / 60)).padStart(2, "0")}:${String(min % 60).padStart(2, "0")}`;
}

/** "HH:MM" from an `<input type="time">` → minutes-from-midnight, or null when empty/invalid. */
export function hhmmToMinutes(value: string): number | null {
  if (!value) return null;
  const [h, m] = value.split(":").map(Number);
  if (Number.isNaN(h) || Number.isNaN(m)) return null;
  return h * 60 + m;
}
