export function normalizeDurationMinutes(value: string | number | null | undefined): number | null {
  if (value == null) return null;
  const parsed = typeof value === "number" ? value : Number(value.trim());
  if (!Number.isFinite(parsed) || parsed <= 0) return null;
  return Math.round(parsed);
}

/**
 * Parse a duration entered as "mm:ss" / "h:mm:ss" (or bare minutes) into whole
 * seconds. Pairs with `formatSecondsToMmSs` for prefill. Returns null for blank,
 * malformed, negative, or non-numeric input so callers can treat it as "not
 * entered" — never coercing garbage to 0. Used for MAF-test pace entry, where
 * second-level precision matters (unlike the workout form's minutes input).
 */
export function parseDurationToSeconds(value: string | null | undefined): number | null {
  if (value == null) return null;
  const trimmed = value.trim();
  if (trimmed === "") return null;

  // Bare number → minutes (matches the workout form's minutes convention).
  if (!trimmed.includes(":")) {
    const minutes = Number(trimmed);
    if (!Number.isFinite(minutes) || minutes < 0) return null;
    return Math.round(minutes * 60);
  }

  const parts = trimmed.split(":");
  if (parts.length < 2 || parts.length > 3) return null;
  let total = 0;
  for (const part of parts) {
    if (!/^\d+$/.test(part)) return null;
    total = total * 60 + Number(part);
  }
  // Reject "12:75" style overflow on the smallest unit so a typo isn't silently
  // re-normalized into a different time.
  const smallest = Number(parts[parts.length - 1]);
  if (smallest >= 60) return null;
  if (parts.length === 3 && Number(parts[1]) >= 60) return null;
  return total;
}
