/**
 * A workout's free-text notes hold two kinds of content: what the athlete (or
 * their plan) wrote, and one-line cues the coach appended, each marked with
 * `[AI Coach]`. Auto-coach runs repeatedly, so appending blindly stacked the
 * same cue once per run and left a wall of repeated text on the day.
 *
 * This module is the single place that reads and writes that format: the
 * server appends through `appendCoachCue` (which dedupes), and the timeline
 * card renders through `parseCoachNotes` (which also cleans up notes written
 * before deduping existed).
 */

export const COACH_CUE_MARKER = "[AI Coach]";

// The manual "apply suggestion" path used to write this prefix instead of the
// marker. Only honoured at the start of a line, where that path put it, so an
// athlete's own sentence mentioning an "AI suggestion:" stays theirs.
const LEGACY_CUE_PREFIX = /^\s*AI suggestion:\s*/i;

// The load governor's cue describes the day's current restriction, not a tip
// that accumulates: a newer governor cue replaces any older one (an on-ramp
// that escalates to a reduction must not leave both instructions behind).
export const LOAD_GOVERNOR_CUE_PREFIX = "Load governor";
const LOAD_GOVERNOR_CUE = /^load governor\b/i;

// A short leading "Label: " on a cue, e.g. "Load governor on-ramp: trim …" or
// "Pacing: hold …". Letters, spaces, hyphens and apostrophes only, so a clock
// time or a sentence that happens to contain a colon is never split.
const CUE_LABEL = /^([A-Z][A-Za-z' -]{1,30}):\s+(\S.*)$/;

export interface ParsedCoachNotes {
  /** Everything that isn't a coach cue, in its original order. */
  readonly athleteText: string;
  /** Unique coach cues, oldest first, each collapsed to one line. */
  readonly cues: readonly string[];
}

export interface CoachCueParts {
  readonly label: string | null;
  readonly text: string;
}

function collapseWhitespace(text: string): string {
  return text.replaceAll(/\s+/g, " ").trim();
}

// Case and trailing punctuation don't make a cue different. `cue` is already
// whitespace-collapsed, so only "." and "!" can trail it.
function cueKey(cue: string): string {
  let end = cue.length;
  while (end > 0 && (cue[end - 1] === "." || cue[end - 1] === "!")) end -= 1;
  return cue.slice(0, end).toLowerCase();
}

function isLoadGovernorCue(cue: string): boolean {
  return LOAD_GOVERNOR_CUE.test(cue);
}

/**
 * Add a cue, dropping any earlier copy of it (and, for a load-governor cue,
 * any earlier governor cue). The survivor moves to the end so the list reads
 * oldest to newest.
 */
function pushCue(cues: string[], raw: string): void {
  const cue = collapseWhitespace(raw);
  if (!cue) return;
  const key = cueKey(cue);
  const governor = isLoadGovernorCue(cue);
  const kept = cues.filter(
    (existing) => cueKey(existing) !== key && !(governor && isLoadGovernorCue(existing)),
  );
  cues.splice(0, cues.length, ...kept, cue);
}

export function parseCoachNotes(notes: string | null | undefined): ParsedCoachNotes {
  const athleteLines: string[] = [];
  const cues: string[] = [];
  for (const line of (notes ?? "").split(/\r?\n/)) {
    const legacy = LEGACY_CUE_PREFIX.exec(line);
    if (legacy) {
      pushCue(cues, line.slice(legacy[0].length));
      continue;
    }
    const [head = "", ...segments] = line.split(COACH_CUE_MARKER);
    if (segments.length === 0) {
      athleteLines.push(line);
      continue;
    }
    if (head.trim()) athleteLines.push(head.trim());
    for (const segment of segments) pushCue(cues, segment);
  }
  return { athleteText: athleteLines.join("\n").trim(), cues };
}

export function formatCoachNotes({ athleteText, cues }: ParsedCoachNotes): string {
  return [athleteText, ...cues.map((cue) => `${COACH_CUE_MARKER} ${cue}`)]
    .filter(Boolean)
    .join("\n");
}

/**
 * Append a coach cue to a day's notes. Re-running the coach with the same cue
 * leaves the notes unchanged, a newer load-governor cue replaces the old one,
 * and any duplicates already in the notes are cleaned up on the way through.
 * The athlete's own text always comes first, followed by one cue per line.
 */
export function appendCoachCue(existing: string | null | undefined, cue: string): string {
  const parsed = parseCoachNotes(existing);
  const cues = [...parsed.cues];
  pushCue(cues, cue);
  return formatCoachNotes({ athleteText: parsed.athleteText, cues });
}

function lineKeys(text: string): string[] {
  return text
    .split(/\r?\n/)
    .map((line) => cueKey(collapseWhitespace(line)))
    .filter(Boolean);
}

function containsRun(haystack: readonly string[], needle: readonly string[]): boolean {
  for (let start = 0; start + needle.length <= haystack.length; start += 1) {
    if (needle.every((line, offset) => haystack[start + offset] === line)) return true;
  }
  return false;
}

/**
 * Append coach-added work to a mainWorkout/accessory prescription. Unlike a
 * notes cue, the recommendation's line breaks are kept (one exercise per
 * line), so the whole block is matched line by line — ignoring case, spacing
 * and trailing punctuation — and not re-added when it is already there.
 */
export function appendCoachBlock(
  existing: string | null | undefined,
  recommendation: string,
): string {
  const base = (existing ?? "").trim();
  const block = `${COACH_CUE_MARKER} ${recommendation.trim()}`;
  if (!recommendation.trim() || containsRun(lineKeys(base), lineKeys(block))) return base;
  return base ? `${base}\n${block}` : block;
}

/** Split a cue's leading "Label: " off so the card can emphasise it. */
export function splitCoachCueLabel(cue: string): CoachCueParts {
  const match = CUE_LABEL.exec(cue);
  if (!match?.[1] || !match[2]) return { label: null, text: cue };
  return { label: match[1], text: match[2] };
}
