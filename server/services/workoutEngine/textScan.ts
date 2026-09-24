/**
 * Linear scanning for the engine's rewrites of model-written session text.
 *
 * A prescription has optional parts — a decimal, a range's upper end, a unit
 * word — and one regex covering all of them needs quantified groups nested
 * inside each other, which is how a regex backtracks super-linearly. Here each
 * pattern is flat, and the optional parts are read one step at a time with
 * sticky patterns matched exactly at a position.
 */

/** A sticky `pattern`'s match exactly at `from`, or null. */
export function matchAt(pattern: RegExp, text: string, from: number): RegExpExecArray | null {
  pattern.lastIndex = from;
  return pattern.exec(text);
}

const DIGITS = /\d+/y;
const FRACTION = /\.\d+/y;
const DASH = /\s*[-–]\s*/y;

/** Where a number ("8", "82.5") that starts at `from` ends, or -1 when none starts there. */
export function numberEnd(text: string, from: number): number {
  const whole = matchAt(DIGITS, text, from);
  if (!whole) return -1;
  const end = from + whole[0].length;
  const fraction = matchAt(FRACTION, text, end);
  return fraction ? end + fraction[0].length : end;
}

/** Where a number or a range ("8", "8-10", "80 – 82.5") that starts at `from` ends, or -1. */
export function valueEnd(text: string, from: number): number {
  const first = numberEnd(text, from);
  if (first < 0) return -1;
  const dash = matchAt(DASH, text, first);
  if (!dash) return first;
  const second = numberEnd(text, first + dash[0].length);
  return second < 0 ? first : second;
}

/**
 * `text` with its first `head` + value (+ `tail`) replaced, or unchanged when
 * there is none. `head` must be global and marks where a value starts; `tail`,
 * when given, must be sticky and follow the value directly.
 */
export function replaceFirstValue(
  text: string,
  head: RegExp,
  replacement: string,
  tail?: RegExp,
): string {
  for (const match of text.matchAll(head)) {
    const end = valueEnd(text, match.index + match[0].length);
    if (end < 0) continue;
    const closing = tail ? matchAt(tail, text, end) : null;
    if (tail && !closing) continue;
    return text.slice(0, match.index) + replacement + text.slice(end + (closing?.[0].length ?? 0));
  }
  return text;
}
