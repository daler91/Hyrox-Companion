import type { TimelineEntry } from "@shared/schema";
import { format, parseISO } from "date-fns";
import { createContext, type ReactNode, useContext, useMemo } from "react";

import { getTodayString } from "@/lib/dateUtils";

import { describeProgressionChange } from "../timeline-workout-card/CoachNote";
import { buildMissedAftermath, type HeldSession, type MissedAftermath } from "./missedAftermath";

const NONE: ReadonlyMap<string, MissedAftermath> = new Map();

/**
 * The aftermath of each recent miss, for its card. A context rather than one
 * more prop through the timeline's layers: only a missed card reads it, and it
 * is worked out from every entry on the page, not from the card's own day.
 */
const MissedAftermathContext = createContext<ReadonlyMap<string, MissedAftermath>>(NONE);

interface MissedAftermathProviderProps {
  /** The entries the timeline is showing: the upcoming ones are where a miss leaves its mark. */
  readonly entries: readonly TimelineEntry[];
  readonly children: ReactNode;
}

export function MissedAftermathProvider({ entries, children }: Readonly<MissedAftermathProviderProps>) {
  const today = getTodayString();
  const aftermath = useMemo(() => buildMissedAftermath(entries, today), [entries, today]);
  return <MissedAftermathContext.Provider value={aftermath}>{children}</MissedAftermathContext.Provider>;
}

/** A long list names the first few sessions; each of them says so on its own card too. */
const MAX_HELD_SHOWN = 3;

function plural(count: number, one: string, many: string): string {
  return `${count} ${count === 1 ? one : many}`;
}

/** "1 adjusted, 3 kept as planned", leaving out a part that is zero. */
function reviewCounts(reviewed: NonNullable<MissedAftermath["reviewed"]>): string {
  return [
    reviewed.adjusted > 0 ? `${reviewed.adjusted} adjusted` : null,
    reviewed.kept > 0 ? `${reviewed.kept} kept as planned` : null,
  ]
    .filter(Boolean)
    .join(", ");
}

function describeReviewed(aftermath: MissedAftermath): string | null {
  const { reviewed } = aftermath;
  if (!reviewed) return null;
  const sessions = reviewed.adjusted + reviewed.kept;
  const counts = reviewCounts(reviewed);
  return aftermath.held.length > 0
    ? `Your coach also went over ${plural(sessions, "more upcoming session", "more upcoming sessions")}: ${counts}.`
    : `Since then your coach has gone over ${plural(sessions, "upcoming session", "upcoming sessions")}: ${counts}.`;
}

function HeldLine({ session }: Readonly<{ session: HeldSession }>) {
  const day = format(parseISO(session.date), "EEE d MMM");
  const changes = session.changes.map(describeProgressionChange).join(", ");
  // "Long Run — Long Run: 10 → 9 km": a session named for its one exercise says it once.
  const namedForIt = changes.toLowerCase().startsWith(`${session.focus.trim().toLowerCase()}:`);
  return (
    <li>
      <span className="font-medium text-foreground/80">{namedForIt ? day : `${day} · ${session.focus}`}</span>
      {namedForIt ? " · " : " — "}
      {changes}
    </li>
  );
}

/**
 * On a missed or skipped session's card: what the plan did about it. The
 * sessions it changed say so themselves, further down the page; this is the
 * answer in the place the athlete is looking when they wonder whether the
 * plan noticed.
 */
export function MissedAftermathNote({ entry }: Readonly<{ entry: TimelineEntry }>) {
  const aftermath = useContext(MissedAftermathContext).get(entry.id);
  if (!aftermath) return null;
  const shown = aftermath.held.slice(0, MAX_HELD_SHOWN);
  const more = aftermath.held.length - shown.length;
  const reviewed = describeReviewed(aftermath);
  return (
    <div
      className="mt-2 space-y-1 border-l-2 border-l-border pl-2 text-xs text-muted-foreground"
      data-testid={`missed-aftermath-${entry.id}`}
    >
      {shown.length > 0 ? (
        <>
          <p className="font-medium text-foreground/80">What your plan changed after this</p>
          <ul className="space-y-0.5">
            {shown.map((session) => (
              <HeldLine key={session.id} session={session} />
            ))}
            {more > 0 ? <li>and {plural(more, "more session", "more sessions")}</li> : null}
          </ul>
        </>
      ) : null}
      {reviewed ? <p>{reviewed}</p> : null}
    </div>
  );
}
