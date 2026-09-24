/**
 * Re-pace a plan's written run sessions when the athlete's running fitness
 * changes.
 *
 * Every pace the engine writes is a fraction of the athlete's VDOT (see
 * running.ts), and the model copies those paces into the session text. So a
 * pace in the text can be read back as "this fraction of the old VDOT" and
 * written forward as the same fraction of the new one — threshold stays
 * threshold, easy stays easy, and a pace the model wrote between two zones
 * moves by exactly as much as its neighbours. No zone labels need to survive
 * in the text for this to work, only the numbers.
 *
 * Paces outside the plausible zone band (a 9:00/km walk, a 2:50/km typo) are
 * left alone: they were not written against the athlete's VDOT.
 */
import { paceAtFraction } from "./running";

const KM_PER_MILE = 1.609344;
/** The band of VDOT fractions an engine zone can sit at, with margin. */
const MIN_FRACTION = 0.55;
const MAX_FRACTION = 1.15;

// "5:04/km", "5:04 /km", "5:04 min/km", "5:04 per mile", and ranges
// "6:05-6:42/km" where one unit closes both clocks.
const PACE =
  /\b(\d{1,2}):([0-5]\d)(?:\s*[-–]\s*(\d{1,2}):([0-5]\d))?\s*(?:min\s*)?(?:\/|per\s+)\s*(km|mi|mile)\b/gi;

function vo2AtVelocity(metersPerMin: number): number {
  return -4.6 + 0.182258 * metersPerMin + 0.000104 * metersPerMin * metersPerMin;
}

function secondsPerKm(clockSeconds: number, unit: string): number {
  return unit.toLowerCase() === "km" ? clockSeconds : clockSeconds / KM_PER_MILE;
}

function clock(secondsPerKmValue: number, unit: string): string {
  const perUnit = unit.toLowerCase() === "km" ? secondsPerKmValue : secondsPerKmValue * KM_PER_MILE;
  const total = Math.round(perUnit);
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, "0")}`;
}

/** The same fraction of the new VDOT, or null when the pace was never one of the old one's. */
function repace(
  clockSeconds: number,
  unit: string,
  fromVdot: number,
  toVdot: number,
): string | null {
  const perKm = secondsPerKm(clockSeconds, unit);
  const fraction = vo2AtVelocity(60_000 / perKm) / fromVdot;
  if (fraction < MIN_FRACTION || fraction > MAX_FRACTION) return null;
  return clock(paceAtFraction(toVdot, fraction), unit);
}

/**
 * `text` with every zone pace moved from `fromVdot` to `toVdot`, and whether
 * anything changed. A range moves only when both of its ends are zone paces.
 */
export function rescalePaces(
  text: string,
  fromVdot: number,
  toVdot: number,
): { text: string; changed: boolean } {
  let changed = false;
  const next = text.replace(
    PACE,
    (
      match,
      m1: string,
      s1: string,
      m2: string | undefined,
      s2: string | undefined,
      unit: string,
    ) => {
      const first = repace(Number(m1) * 60 + Number(s1), unit, fromVdot, toVdot);
      if (!first) return match;
      let second: string | null = null;
      if (m2 != null && s2 != null) {
        second = repace(Number(m2) * 60 + Number(s2), unit, fromVdot, toVdot);
        if (!second) return match;
      }
      const suffixStart = match.search(/\s*(?:min\s*)?(?:\/|per\s+)/i);
      const suffix = match.slice(suffixStart);
      const rewritten = second ? `${first}-${second}${suffix}` : `${first}${suffix}`;
      if (rewritten !== match) changed = true;
      return rewritten;
    },
  );
  return { text: next, changed };
}
