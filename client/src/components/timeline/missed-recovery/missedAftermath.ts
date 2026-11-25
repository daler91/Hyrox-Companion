import { addDaysToISODate } from "@shared/dateUtils";
import type { ProgressionChangeRecord, TimelineEntry } from "@shared/schema";

import { toISODateString } from "@/lib/dateUtils";

/**
 * What the plan did after a session that never happened, worked out from the
 * timeline the page already holds: which upcoming sessions had their loads
 * held for it, and how many the coach has gone over since.
 *
 * It exists because each of those lives on a different card, most of it inside
 * a coach's note that is collapsed by default. A missed session that changed
 * three sessions ahead looked, on its own card, as if nothing had happened.
 */

/** An upcoming session whose loads are held for the missed one. */
export interface HeldSession {
  readonly id: string;
  readonly date: string;
  readonly focus: string;
  readonly changes: readonly ProgressionChangeRecord[];
}

export interface MissedAftermath {
  /** Sessions ahead that repeat a step the missed one never did, soonest first. */
  readonly held: readonly HeldSession[];
  /**
   * The other sessions in the week ahead the coach has gone over since the
   * miss: how many it changed and how many it kept. Only on the latest miss —
   * two misses in a week would otherwise each claim the same reviews.
   */
  readonly reviewed: { readonly adjusted: number; readonly kept: number } | null;
}

/** How far back a miss still gets a say on its card: within the week, so its weekday names it. */
const AFTERMATH_DAYS = 6;
/** The coach looks a week ahead (getUpcomingPlannedDays), so that is where its reviews are. */
const REVIEW_AHEAD_DAYS = 7;

/** Sources that mean the session was changed, not just read and left alone. */
const CHANGED_SOURCES: ReadonlySet<string> = new Set(["rag", "legacy", "load_governor", "progression"]);

function isFollowedMiss(entry: TimelineEntry, today: string): boolean {
  if (!entry.planDayId || entry.excused) return false;
  if (entry.priority !== "key" && entry.priority !== "supporting") return false;
  if (entry.status !== "missed" && entry.status !== "skipped") return false;
  return entry.date >= addDaysToISODate(today, -AFTERMATH_DAYS) && entry.date <= today;
}

function isUpcoming(entry: TimelineEntry, today: string): boolean {
  return entry.status === "planned" && Boolean(entry.planDayId) && entry.date >= today;
}

function heldFor(miss: TimelineEntry, upcoming: readonly TimelineEntry[]): HeldSession[] {
  return upcoming.flatMap((entry) => {
    const hold = entry.aiInputsUsed?.missedSessionHold;
    if (hold?.date !== miss.date || hold.changes.length === 0) return [];
    return [{ id: entry.id, date: entry.date, focus: entry.focus, changes: hold.changes }];
  });
}

/** The athlete's own calendar day the coach last wrote on a session, or null. */
function noteDay(entry: TimelineEntry): string | null {
  if (!entry.aiNoteUpdatedAt) return null;
  const at = new Date(entry.aiNoteUpdatedAt);
  return Number.isNaN(at.getTime()) ? null : toISODateString(at);
}

function reviewedSince(
  miss: TimelineEntry,
  upcoming: readonly TimelineEntry[],
  today: string,
): MissedAftermath["reviewed"] {
  const until = addDaysToISODate(today, REVIEW_AHEAD_DAYS);
  let adjusted = 0;
  let kept = 0;
  for (const entry of upcoming) {
    // A session held for a miss, this one or another, is listed under that miss.
    if (entry.date > until || entry.aiInputsUsed?.missedSessionHold) continue;
    const day = noteDay(entry);
    // Written after the day of the miss: the coach has seen the plan without it.
    if (day === null || day <= miss.date) continue;
    if (entry.aiSource === "review") kept += 1;
    else if (entry.aiSource && CHANGED_SOURCES.has(entry.aiSource)) adjusted += 1;
  }
  return adjusted + kept > 0 ? { adjusted, kept } : null;
}

/**
 * The aftermath of each recent missed or skipped session that has one, by the
 * entry's id. A miss with nothing to report is left out.
 */
export function buildMissedAftermath(
  entries: readonly TimelineEntry[],
  today: string,
): Map<string, MissedAftermath> {
  const upcoming = entries
    .filter((entry) => isUpcoming(entry, today))
    .sort((a, b) => a.date.localeCompare(b.date));
  const misses = entries
    .filter((entry) => isFollowedMiss(entry, today))
    .sort((a, b) => b.date.localeCompare(a.date) || a.id.localeCompare(b.id));
  const latest = misses.at(0);

  const result = new Map<string, MissedAftermath>();
  for (const miss of misses) {
    const held = heldFor(miss, upcoming);
    const reviewed = miss === latest ? reviewedSince(miss, upcoming, today) : null;
    if (held.length > 0 || reviewed) result.set(miss.id, { held, reviewed });
  }
  return result;
}
