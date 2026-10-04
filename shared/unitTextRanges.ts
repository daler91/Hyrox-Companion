/**
 * Reading workout text for `normalizeWorkoutTextUnits` (unitConversion.ts):
 * numbers, the words around them, and the low bound of a range, so both
 * halves of "60 – 70 kg" convert together. unitConversion.ts keeps the
 * conversion itself. C23 (CODEBASE_ANALYSIS_2026-10-03)
 */

export interface NumberToken {
  readonly value: number;
  readonly end: number;
}

export function isDigit(char: string | undefined): boolean {
  return char != null && char >= "0" && char <= "9";
}

export function isWhitespace(char: string | undefined): boolean {
  return char === " " || char === "\t" || char === "\n" || char === "\r" || char === "\f" || char === "\v";
}

export function isWordChar(char: string | undefined): boolean {
  if (char == null) return false;
  return (
    (char >= "a" && char <= "z") ||
    (char >= "A" && char <= "Z") ||
    (char >= "0" && char <= "9") ||
    char === "_"
  );
}

export function parseNumberToken(text: string, start: number): NumberToken | null {
  let index = start;
  if (text.charAt(index) === "-") {
    // A dash straight after a digit separates a range ("60-80kg"), it is not
    // a sign. Reading it as one made the scanner tokenize "-90" out of
    // "80-90kg" and convert only that half, so the low bound kept its source
    // magnitude while the label flipped: "80-90kg" came out as "80-198 lbs".
    if (start > 0 && isDigit(text.charAt(start - 1))) return null;
    if (!isDigit(text.charAt(index + 1))) return null;
    index += 1;
  }
  if (!isDigit(text.charAt(index))) return null;
  while (isDigit(text.charAt(index))) index += 1;
  // Thousands separators: "1,000m" is one number. Without this the scanner
  // read "1", then "000" as a separate zero, and "Row 1,000m" converted to
  // "Row 1,0 ft". Only an exact 3-digit group counts, so an ambiguous
  // decimal comma ("7,5kg") is left for the guard in the main loop.
  while (
    text.charAt(index) === "," &&
    isDigit(text.charAt(index + 1)) &&
    isDigit(text.charAt(index + 2)) &&
    isDigit(text.charAt(index + 3)) &&
    !isDigit(text.charAt(index + 4))
  ) {
    index += 4;
  }
  if (text.charAt(index) === "." && isDigit(text.charAt(index + 1))) {
    index += 1;
    while (isDigit(text.charAt(index))) index += 1;
  }
  const value = Number.parseFloat(text.slice(start, index).replaceAll(",", ""));
  return Number.isFinite(value) ? { value, end: index } : null;
}

export function readPreviousWord(text: string, start: number): string | null {
  let index = start - 1;
  while (index >= 0 && isWhitespace(text.charAt(index))) index -= 1;
  const wordEnd = index + 1;
  while (index >= 0 && isWordChar(text.charAt(index))) index -= 1;
  return wordEnd > index + 1 ? text.slice(index + 1, wordEnd) : null;
}

export function isPaceOrRatioUnit(previousChar: string): boolean {
  return previousChar === "/" || previousChar === ":";
}

/** Hyphen, en dash and em dash all show up as range separators in plans. */
const RANGE_SEPARATORS = new Set(["-", "\u2013", "\u2014"]);

/** The low bound of a range; the separator, as written, runs from `end` to the high bound. */
type RangeLowBound = NumberToken & { readonly start: number };

/**
 * Spaces and tabs, typeset ones (no-break, thin) included, but never a line
 * break: a range never spans lines, and reading across one paired the "3" of
 * "Superset x 3" with a "- 20kg" bullet on the next line (C23, CODEBASE_ANALYSIS_2026-10-03).
 */
function isInlineSpace(char: string): boolean {
  return char === " " || char === "\t" || char === "\u00a0" || char === "\u2009" || char === "\u202f";
}

function skipInlineSpaceBackward(text: string, end: number): number {
  let index = end;
  while (index > 0 && isInlineSpace(text.charAt(index - 1))) index -= 1;
  return index;
}

/** Whether the dash at `index` is a bullet: first on its line, then a space ("- 60 - 70 kg"). */
function isBulletDash(text: string, index: number): boolean {
  const lineStart = skipInlineSpaceBackward(text, index);
  const lineBreak = text.charAt(lineStart - 1);
  return (lineStart === 0 || lineBreak === "\n" || lineBreak === "\r") && isInlineSpace(text.charAt(index + 1));
}

/** Where the dash, or the spaced "to", that ends at `separatorEnd` starts; null if neither does. */
function findRangeSeparatorStart(lowerText: string, separatorEnd: number, numberStart: number): number | null {
  if (RANGE_SEPARATORS.has(lowerText.charAt(separatorEnd - 1))) return separatorEnd - 1;
  const spaced = separatorEnd < numberStart && isInlineSpace(lowerText.charAt(separatorEnd - 3));
  return spaced && lowerText.slice(separatorEnd - 2, separatorEnd) === "to" ? separatorEnd - 2 : null;
}

/**
 * Headings that make the number after them a label or a count, not a low
 * bound: "Station 7 - 20kg", "Rounds 1 - 5km", "Reps 10 - 20kg", "Session 2
 * - 8km".
 */
const SPACED_RANGE_LABELS = new Set([
  "block",
  "day",
  "days",
  "level",
  "part",
  "phase",
  "reps",
  "round",
  "rounds",
  "session",
  "set",
  "sets",
  "station",
  "stations",
  "step",
  "week",
  "weeks",
  "workout",
]);

/**
 * Plurals that, after a count, make the next number reps or a round's
 * distance in any case: "3 sets 10 - 20kg" is 10 reps at 20kg, and reading it
 * as a range saved 10 reps as "22 lbs" (C23, CODEBASE_ANALYSIS_2026-10-03).
 * Known limit: "3 sets 60 - 70 kg" reads that way too and converts its high
 * bound alone, as before C23.
 */
const COUNTED_HEADINGS = new Set(["rounds", "sets"]);

const WHOLE_NUMBER = /^\d+$/;

/** "x", "5x" or "×" before the number: sets x reps, "5 x 8 - 60kg". */
const SETS_TIMES = /^(?:\d*[xX]|\u00d7)$/;

/**
 * Time-domain formats whose number is minutes: "EMOM 10 - 12kg", "E2MOM 8 -
 * 20kg", "AMRAP 12 - 16kg". Not the rest of the minute-shorthand words
 * ("run", "tempo", "easy"): "Run 5 - 6 km" is a distance range.
 */
const INTERVAL_FORMAT = /^(?:amrap|e\d*mom)$/;

function skipWhitespaceBackward(text: string, end: number): number {
  let index = end;
  while (index > 0 && isWhitespace(text.charAt(index - 1))) index -= 1;
  return index;
}

/** Where the word before `start` begins, reading back over whitespace as readPreviousWord does. */
function previousWordStart(text: string, start: number): number {
  let index = skipWhitespaceBackward(text, start);
  while (index > 0 && isWordChar(text.charAt(index - 1))) index -= 1;
  return index;
}

/**
 * Where the label or count before the number at `numberStart` ends, read past
 * one ":" or "," or an "of" between them: "Sets: 3 - 20kg", "EMOM: 10 -
 * 12kg", "3 sets, 8 - 60kg" and "4 sets of 8 - 60kg" are "Sets 3", "EMOM 10",
 * "3 sets 8" and "4 sets 8". Reading only the word right before the number
 * saved those reps and counts as loads: "Sets: 3 - 20kg" became "Sets: 7 - 44
 * lbs" (C23, CODEBASE_ANALYSIS_2026-10-03). "Set 1: 60 - 70kg" and "a pair of
 * 24 - 32kg" read "1" and "pair", so they stay ranges.
 */
function leadInEnd(text: string, numberStart: number): number {
  const end = skipWhitespaceBackward(text, numberStart);
  const connector = text.charAt(end - 1);
  if (connector === ":" || connector === ",") return end - 1;
  const wordStart = previousWordStart(text, numberStart);
  return text.slice(wordStart, end).toLowerCase() === "of" ? wordStart : numberStart;
}

/** Whether `word`, ending at `wordEnd` before the low bound, makes that number a label or a count. */
function isLabelOrCountWord(text: string, wordEnd: number, word: string): boolean {
  const lower = word.toLowerCase();
  // A heart-rate zone in any case ("zone 2 - 8km easy"); not "Z2", which
  // comes before the range it labels ("Z2 5 - 8km").
  if (SETS_TIMES.test(word) || INTERVAL_FORMAT.test(lower) || lower === "zone") return true;
  // A heading is capitalised ("Set 1 - 5kg"); "main set 5 - 6 km" and
  // "8 reps 20 - 24kg" are still ranges.
  if (/^[A-Z]/.test(word) && SPACED_RANGE_LABELS.has(lower)) return true;
  if (!COUNTED_HEADINGS.has(lower)) return false;
  return WHOLE_NUMBER.test(readPreviousWord(text, previousWordStart(text, wordEnd)) ?? "");
}

/**
 * A spaced separator also reads as a label ("Round 1 - 500m", "Zone 2 -
 * 8km") or a count ("EMOM 10 - 12kg", "3 sets 10 - 20kg", "Wall balls 20 -
 * 9kg"), so there the low bound must be a number of its own (not the tail of
 * "1:30", "3x5", "5 x 8", "5 × 8" or a dash chain, nor a numbered heading,
 * zone, counted set or interval) and the pair must run as a prescription
 * does: low to high, within SPACED_RANGE_MAX_RATIO. Equal ends ("20 - 20kg")
 * or a descending pair are reps then a load. Otherwise the high bound converts
 * alone, as it did before C23 (CODEBASE_ANALYSIS_2026-10-03). Known limits: a
 * wider range ("Run 1 to 15 km", "Run 3 - 8 km") or one after a dash mid-line
 * ("Back squat - 60 - 70 kg") is read that way too and keeps its low bound
 * unconverted.
 */
/**
 * How far apart a spaced pair's ends may be and still read as one range.
 * Prescribed load and distance ranges sit within about +-30% ("60 - 70 kg",
 * "2000 to 3000 m"), while a count before a load usually sits further off
 * ("Squat 8 - 60kg" is 8 reps at 60 kg). When in doubt the high bound converts
 * alone, which never rewrites a count (C23, CODEBASE_ANALYSIS_2026-10-03).
 */
const SPACED_RANGE_MAX_RATIO = 2;

function isSpacedRangeLowBound(text: string, lowStart: number, low: number, high: number): boolean {
  const before = text.charAt(lowStart - 1);
  if (isWordChar(before) || isPaceOrRatioUnit(before)) return false;
  const symbolAt = skipInlineSpaceBackward(text, lowStart) - 1;
  const symbol = text.charAt(symbolAt);
  // The tail of a dash chain: "21-15-9 - 40kg" is a rep scheme and "60 - 70 -
  // 80 kg" a ladder; reading "9 - 40kg" as a range saved the 9 reps as "20".
  if (RANGE_SEPARATORS.has(symbol) && !isBulletDash(text, symbolAt)) return false;
  const wordEnd = leadInEnd(text, lowStart);
  // The word before the low bound, or the symbol when there is none ("5 × 8").
  const word = readPreviousWord(text, wordEnd) ?? symbol;
  if (isLabelOrCountWord(text, wordEnd, word)) return false;
  return low > 0 && low < high && high <= low * SPACED_RANGE_MAX_RATIO;
}

function isNumericBodyChar(char: string): boolean {
  return isDigit(char) || char === "." || char === ",";
}

/**
 * If the number at `numberStart` is the high bound of a range, return the low
 * bound so both halves convert together. The separator is a dash, tight or
 * spaced ("400-800m", "60 – 70 kg"), or "to" ("100 to 110kg"): the H3 fix
 * read only a dash right before the high bound, so "60 – 70 kg" was saved
 * as "60 – 154 lbs" (C23, CODEBASE_ANALYSIS_2026-10-03).
 */
export function findRangeLowBound(
  text: string,
  lowerText: string,
  numberStart: number,
  high: number,
): RangeLowBound | null {
  const separatorEnd = skipInlineSpaceBackward(text, numberStart);
  const separatorStart = findRangeSeparatorStart(lowerText, separatorEnd, numberStart);
  if (separatorStart == null) return null;
  const lowEnd = skipInlineSpaceBackward(text, separatorStart);

  let lowStart = lowEnd;
  while (lowStart > 0 && isNumericBodyChar(text.charAt(lowStart - 1))) lowStart -= 1;
  if (lowStart === lowEnd) return null;

  const low = parseNumberToken(text, lowStart);
  // Must account for the whole span up to the separator, so "Set 3. 80-90kg"
  // reads 80 and a partial match like ".5-90kg" is declined.
  if (low?.end !== lowEnd) return null;
  // A tight dash ("80-90kg") is a range as it stands; a spaced pair has to pass the guard.
  if (lowEnd + 1 !== numberStart && !isSpacedRangeLowBound(text, lowStart, low.value, high)) return null;
  return { value: low.value, start: lowStart, end: lowEnd };
}

/**
 * A negative number whose sign could be the dash of a range: "Squat 60 -70
 * kg" is 60 to 70 kg as readily as 60 reps at -70 kg, so neither conversion
 * is safe. Only a pair that would pass as a spaced range counts; "3x8 -20kg"
 * and "Dips 3 x 10 -10kg" are sets x reps then an assisted load, which
 * converts as the negative it is (C23, CODEBASE_ANALYSIS_2026-10-03).
 */
export function isAmbiguousNegativeLoad(text: string, lowerText: string, numberStart: number, value: number): boolean {
  return value < 0 && findRangeLowBound(text, lowerText, numberStart + 1, -value) !== null;
}

/** Split "176 lbs" into its number and unit halves; null if it has no label. */
function splitConvertedValue(replacement: string): { value: string; unit: string } | null {
  const lastSpace = replacement.lastIndexOf(" ");
  if (lastSpace <= 0) return null;
  return { value: replacement.slice(0, lastSpace), unit: replacement.slice(lastSpace + 1) };
}

/**
 * The low bound stripped of its unit label, for a range whose two bounds
 * converted to the same unit ("176-198 lbs"); null when they differ
 * ("900 m-1.1 km") or either side carries no label, so the caller keeps the
 * low bound as it converted.
 */
export function sharedUnitLowBound(lowReplacement: string, highReplacement: string): string | null {
  const low = splitConvertedValue(lowReplacement);
  const high = splitConvertedValue(highReplacement);
  if (low == null || high == null) return null;
  return low.unit === high.unit ? low.value : null;
}
