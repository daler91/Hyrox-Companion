import type { CoachMissedSessionHold, TimelineEntry } from "@shared/schema";
import { format, isValid, parseISO } from "date-fns";
import { History } from "lucide-react";

import { describeProgressionChange } from "./CoachNote";

/** A long list of lifts names the first few; the coach's note has the rest. */
const MAX_CHANGES_SHOWN = 3;

/**
 * Why the session reads lighter than the plan first had it. A day inside an
 * absence the athlete declared is never called a miss (shared/absence.ts).
 */
export function describeHoldReason(hold: CoachMissedSessionHold): string {
  const date = parseISO(hold.date);
  const on = isValid(date) ? ` on ${format(date, "EEE d MMM")}` : "";
  if (hold.kind === "skipped") return `Adjusted after the session you skipped${on}`;
  if (hold.kind === "excused") return `Adjusted for the session not done${on}`;
  return `Adjusted after the session you missed${on}`;
}

/**
 * The line a session carries while its loads are held for a session before it
 * that never happened: which session, and what moved. Always visible — the
 * coach's note that explains it is collapsed by default, and a load that
 * changed without a word is the plan seeming not to have noticed the miss.
 *
 * Only on a session still to come: once it is logged, what was planned for it
 * is history.
 */
export function MissedSessionHoldNote({ entry }: Readonly<{ entry: TimelineEntry }>) {
  const hold = entry.aiInputsUsed?.missedSessionHold;
  if (entry.status !== "planned" || !hold || hold.changes.length === 0) return null;
  const shown = hold.changes.slice(0, MAX_CHANGES_SHOWN).map(describeProgressionChange);
  const more = hold.changes.length - shown.length;
  return (
    <p
      className="mt-2 flex gap-1.5 text-xs text-muted-foreground"
      data-testid={`missed-session-hold-${entry.id}`}
    >
      <History className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
      <span>
        <span className="font-medium text-foreground/80">{describeHoldReason(hold)}</span>
        {" · "}
        {shown.join(" · ")}
        {more > 0 ? ` · and ${more} more` : ""}
      </span>
    </p>
  );
}
