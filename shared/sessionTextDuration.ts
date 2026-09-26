/**
 * A session's length read from how it is written: "40 min easy", "Long run
 * 1h30", "15 min easy, 3 x 8 min @ 5:04/km with 2 min jog, 10 min easy".
 *
 * For a plan day with no exercise table or saved duration to go on, where the
 * alternative is assuming an hour. Deliberately cautious: the text is only
 * read when it says how long everything takes. A distance ("5 x 1 km", "8 km
 * easy") or a count ("3x5 back squat", "100 wall balls") has no minutes of its
 * own without a pace or a rate, so a text with one is not read — a guess from
 * "the rest of it" would read "6 x 800 m with 2 min jog" as a 12-minute
 * session. A timed format (EMOM, AMRAP, "every 2 min") is the exception: its
 * clock is the session, whatever is done inside it.
 *
 * A leaf module — no imports — so the client can use it too. Whitespace is
 * collapsed before anything is matched, so the patterns use single optional
 * spaces and never backtrack over runs of them.
 */

/** Below this, the text named rests or strides, not the session. */
const MIN_READ_MIN = 10;
/** Above this, something was misread: no plan day runs five hours. */
const MAX_READ_MIN = 300;

/*
 * Every pattern that starts at a number starts with `(?<![\d.])`: it can only
 * begin where a number does, never part-way through one. Without it, a run of
 * digits that fails to match is retried from each of its digits in turn. A
 * decimal is `\d[\d.]*` rather than `\d+(?:\.\d+)?`, whose quantifier nested
 * in a quantified group is the classic shape of catastrophic backtracking;
 * `Number()` reads the rare "1.2.3" as NaN, which fails the plausibility check.
 */

/** Numbers that are not amounts of work: paces, targets, loads, labels. */
const NOT_WORK: readonly RegExp[] = [
  // Paces: "5:04/km", "2:05 /500m", "4:30 per km".
  /(?<![\d.:])\d+:\d\d ?(?:\/|per) ?(?:k|km|mi|miles?|\d+ ?m)\b/g,
  // "7 min/mile", "6 min per km".
  /(?<![\d.])\d+ ?(?:min|mins|minutes)? ?(?:\/|per) ?(?:k|km|mi|miles?)\b/g,
  // Race-pace references: "5k pace", "10 km race effort".
  /(?<![\d.])\d[\d.]* ?(?:k|km|mi|miles?)[ -]?(?:race )?(?:pace|effort)/g,
  /\b(?:z|zone ?)\d\b/g,
  /\brpe ?\d[\d.]* ?- ?\d[\d.]*/g,
  /\brpe ?\d[\d.]*/g,
  /(?<![\d.])\d[\d.]* ?\/ ?10\b/g,
  /(?<![\d.])\d[\d.]* ?%/g,
  /(?<![\d.])\d+ ?(?:bpm|spm|w|watts|rpm|kcal|cals?)\b/g,
  /(?<![\d.])\d[\d.]* ?(?:kg|kgs|lbs?)\b/g,
  /\b(?:week|wk|day|phase|block) ?\d+/g,
];

/** "45-60", "45 to 60": a range, read as its middle before any unit is. */
const RANGE = /(?<![\d.])(\d[\d.]*) ?(?:-|to) ?(\d[\d.]*)(?![\d.])/g;

/** Timed formats: their clock is the session's length whatever is inside. */
const TIMED_FORMAT = /\b(?:amrap|emom|e\d+mom|for time|time cap|tabata|every)\b/;

/** "Every 2 min": the interval of an EMOM-style block, not a length on its own. */
const EVERY_INTERVAL = /\bevery (\d[\d.]*) ?(mins?|minutes?|s|secs?|seconds?)\b/;

/** "1:30:00" (h:mm:ss). */
const CLOCK_HMS = /(?<![\d:])(\d{1,2}):(\d\d):(\d\d)(?![\d:])/g;
/** "45:00" (mm:ss). A one-digit "1:30" could be either, and is left alone. */
const CLOCK_MS = /(?<![\d:])(\d{2,3}):(\d\d)(?![\d:])/g;
/** "1h30". */
const HOURS_THEN_MINUTES = /(?<![\d.])(\d+) ?(?:h|hrs?|hours?)(\d\d)\b/g;
/** "1 h 30 min", "1 hour 15 minutes". */
const HOURS_SPACE_MINUTES = /(?<![\d.])(\d+) ?(?:h|hrs?|hours?) (\d{1,2}) ?(?:m|mins?|minutes?)\b/g;
/** "1h", "1.5 hours". */
const HOURS = /(?<![\d.])(\d[\d.]*) ?(?:h|hrs?|hours?)\b/g;
/** "40 min", "40min", "40 minutes", "40'". Never a bare "m": that is metres. */
const MINUTES = /(?<![\d.])(\d[\d.]*) ?(?:(?:mins?|minutes?)\b|')/g;
/** "90s", "30 sec", "20 seconds", '30"'. */
const SECONDS = /(?<![\d.])(\d[\d.]*) ?(?:(?:s|secs?|seconds?)\b|")/g;

/** "3 x", "3x", "3 rounds", "4 sets", "6 repeats". */
const REPEAT = /(?<![\d.])(\d+) ?(?:x|rounds?|sets?|repeats?|times)(?![a-z])/;
/** "… x 10". */
const REPEAT_AFTER = /\bx ?(\d+)\b/;

type Reader = (match: RegExpMatchArray) => number;

/** Each pattern, in order, and how a match of it reads as minutes. */
const LENGTHS: ReadonlyArray<readonly [RegExp, Reader]> = [
  [CLOCK_HMS, (m) => Number(m[1]) * 60 + Number(m[2]) + Number(m[3]) / 60],
  [CLOCK_MS, (m) => Number(m[1]) + Number(m[2]) / 60],
  [HOURS_THEN_MINUTES, (m) => Number(m[1]) * 60 + Number(m[2])],
  [HOURS_SPACE_MINUTES, (m) => Number(m[1]) * 60 + Number(m[2])],
  [HOURS, (m) => Number(m[1]) * 60],
  [MINUTES, (m) => Number(m[1])],
  [SECONDS, (m) => Number(m[1]) / 60],
];

/** Every length stated in `text`, in minutes, and the text with them taken out. */
function takeLengths(text: string): { minutes: number[]; rest: string } {
  const minutes: number[] = [];
  let rest = text;
  for (const [pattern, read] of LENGTHS) {
    for (const match of rest.matchAll(pattern)) minutes.push(read(match));
    rest = rest.replaceAll(pattern, " ");
  }
  return { minutes, rest };
}

interface SegmentReading {
  /** Minutes the segment states, repeats applied. */
  readonly minutes: number;
  /** A distance or a count the segment gives no time for. */
  readonly untimedWork: boolean;
}

/** One step of the session: its stated minutes, times its repeats. */
function readSegment(segment: string): SegmentReading {
  const every = EVERY_INTERVAL.exec(segment);
  const [, amount, unit = ""] = every ?? [];
  const perMinute = unit.startsWith("m") ? 1 : 60;
  const interval = every ? Number(amount) / perMinute : null;
  const { minutes, rest } = takeLengths(every ? segment.replace(EVERY_INTERVAL, " ") : segment);

  const repeatMatch = REPEAT.exec(rest) ?? REPEAT_AFTER.exec(rest);
  const repeat = repeatMatch ? Number(repeatMatch[1]) : 1;
  const remaining = repeatMatch ? rest.replace(repeatMatch[0], " ") : rest;
  const untimedWork = /\d/.test(remaining);

  const stated = minutes.reduce((sum, value) => sum + value, 0);
  // "Every 2 min for 20 min": the "for" is the length; the interval adds nothing.
  if (stated > 0) return { minutes: interval !== null && !repeatMatch ? stated : stated * repeat, untimedWork };
  // "Every 3 min x 5": five intervals.
  if (interval !== null && repeatMatch) return { minutes: interval * repeat, untimedWork };
  // A bare "3 rounds:" or "x 10" with nothing timed is a count without a time.
  return { minutes: 0, untimedWork: untimedWork || repeatMatch !== null };
}

function normalise(text: string): string {
  let out = text
    .toLowerCase()
    // Line breaks separate steps, like commas.
    .replaceAll(/[\r\n]+/g, ";")
    .replaceAll(/\s+/g, " ")
    .replaceAll(/[–—]/g, "-")
    .replaceAll(/[’′]/g, "'")
    .replaceAll(/[”″]/g, '"')
    .replaceAll(/(\d) ?[×*] ?(?=\d)/g, "$1 x ");
  for (const pattern of NOT_WORK) out = out.replaceAll(pattern, " ");
  return out.replaceAll(RANGE, (_range, low: string, high: string) => String((Number(low) + Number(high)) / 2));
}

/**
 * The minutes one piece of workout text states, or null when it does not say
 * how long everything in it takes (or says something implausible).
 */
export function readWrittenMinutes(text: string | null | undefined): number | null {
  if (!text?.trim()) return null;
  const normalised = normalise(text);
  const timedFormat = TIMED_FORMAT.test(normalised);
  // Steps: list items, sentences, "then" and "+". A repeat reaches only as far as its own step.
  const segments = normalised.split(/[,;+]|\. |\bthen\b|\band\b/);
  let total = 0;
  for (const segment of segments) {
    const reading = readSegment(segment);
    if (reading.untimedWork && !timedFormat) return null;
    total += reading.minutes;
  }
  const rounded = Math.round(total);
  return rounded >= MIN_READ_MIN && rounded <= MAX_READ_MIN ? rounded : null;
}

/** The text fields a plan day or timeline entry carries. */
export interface WrittenSession {
  readonly focus?: string | null;
  readonly mainWorkout?: string | null;
  readonly accessory?: string | null;
}

/**
 * The session's length from its text: the main workout (or, when that says
 * nothing readable, the title — "Long run 90 min"), plus the accessory work
 * when that states its minutes too. Null when the text does not say.
 */
export function readWrittenSessionMinutes(session: WrittenSession): number | null {
  const main = readWrittenMinutes(session.mainWorkout) ?? readWrittenMinutes(session.focus);
  if (main === null) return null;
  const accessory = readWrittenMinutes(session.accessory) ?? 0;
  return Math.min(MAX_READ_MIN, main + accessory);
}
