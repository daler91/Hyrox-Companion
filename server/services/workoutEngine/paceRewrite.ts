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
import { matchAt } from "./textScan";

const KM_PER_MILE = 1.609344;
/** The band of VDOT fractions an engine zone can sit at, with margin. */
const MIN_FRACTION = 0.55;
const MAX_FRACTION = 1.15;

// A pace is a clock closed by a unit — "5:04/km", "5:04 /km", "5:04 min/km",
// "5:04 per mile" — or a range, "6:05-6:42/km", where one unit closes both
// clocks. Read a step at a time (textScan.ts) so no pattern backtracks.
const CLOCK = /\b(\d{1,2}):([0-5]\d)\b/g;
const RANGE_END = /\s*[-–]\s*(\d{1,2}):([0-5]\d)\b/y;
const MIN_WORD = /\s*min\b/iy;
const PER_UNIT = /\s*(?:\/|per)\s*(km|mi|mile)\b/iy;

interface WrittenPace {
  readonly start: number;
  readonly end: number;
  /** One clock, or a range's two, in seconds per unit. */
  readonly clocks: readonly number[];
  readonly unit: string;
  /** Everything after the last clock, as written: " min/km", " per mile". */
  readonly suffix: string;
}

function clockSeconds(minutes: string, seconds: string): number {
  return Number(minutes) * 60 + Number(seconds);
}

/** The pace written at `clock`, or null when no unit closes it. */
function paceAt(text: string, clock: RegExpExecArray): WrittenPace | null {
  const [, minutes, seconds] = clock;
  const clocks = [clockSeconds(minutes, seconds)];
  let end = clock.index + clock[0].length;
  const range = matchAt(RANGE_END, text, end);
  if (range) {
    const [, toMinutes, toSeconds] = range;
    clocks.push(clockSeconds(toMinutes, toSeconds));
    end += range[0].length;
  }
  const suffixStart = end;
  const minWord = matchAt(MIN_WORD, text, end);
  if (minWord) end += minWord[0].length;
  const perUnit = matchAt(PER_UNIT, text, end);
  if (!perUnit) return null;
  end += perUnit[0].length;
  const [, unit] = perUnit;
  return { start: clock.index, end, clocks, unit, suffix: text.slice(suffixStart, end) };
}

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

/** Every pace written in `text`, in order. A range's second clock belongs to the pace already read. */
function* writtenPaces(text: string): Generator<WrittenPace> {
  let scanned = 0;
  for (const clock of text.matchAll(CLOCK)) {
    if (clock.index < scanned) continue;
    const pace = paceAt(text, clock);
    if (!pace) continue;
    scanned = pace.end;
    yield pace;
  }
}

/**
 * The paces written in a prescription, each as seconds per km (a range as its
 * two ends, fast first as written). Session grading reads the plan's own
 * target from these before falling back to the athlete's fitted zones.
 */
export function readWrittenPaces(text: string): number[][] {
  return [...writtenPaces(text)].map((pace) =>
    pace.clocks.map((seconds) => secondsPerKm(seconds, pace.unit)),
  );
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
  let next = "";
  let copied = 0;
  for (const pace of writtenPaces(text)) {
    const moved = pace.clocks.map((seconds) => repace(seconds, pace.unit, fromVdot, toVdot));
    if (!moved.every((value): value is string => value != null)) continue;
    next += `${text.slice(copied, pace.start)}${moved.join("-")}${pace.suffix}`;
    copied = pace.end;
  }
  next += text.slice(copied);
  return { text: next, changed: next !== text };
}
