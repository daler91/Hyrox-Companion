import { parseCoachNotes, splitCoachCueLabel } from "@shared/coachNotes";
import type { TimelineCoachNotes, TimelineEntry } from "@shared/schema";

/**
 * A day's notes split the way the web's timeline card shows them
 * (WorkoutNotes.tsx): the athlete's own text, then each coach cue once, with
 * its leading "Label: " apart. Null when the notes hold neither.
 */
export function timelineCoachNotes(notes: string | null | undefined): TimelineCoachNotes | null {
  const { athleteText, cues } = parseCoachNotes(notes);
  if (!athleteText && cues.length === 0) return null;
  return { athleteText, cues: cues.map(splitCoachCueLabel) };
}

/**
 * Adds `coachNotes` to each entry with notes, so the app shows the athlete's
 * text and the coach's cues as the web does without porting the parser: it
 * reads a format only the server writes (appendCoachCue), and its patterns
 * depend on JavaScript's whitespace rules (docs/mobile-shared-logic.md, API
 * field 6). `notes` itself is unchanged.
 */
export function withCoachNotes(entries: TimelineEntry[]): TimelineEntry[] {
  return entries.map((entry) => {
    const coachNotes = timelineCoachNotes(entry.notes);
    return coachNotes ? { ...entry, coachNotes } : entry;
  });
}
