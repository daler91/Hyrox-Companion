import type { TimelineEntry } from "@shared/schema";
import { format, parseISO } from "date-fns";
import { CornerDownRight, Scissors, Star } from "lucide-react";

import { Badge } from "@/components/ui/badge";

/**
 * The session's tier on its card. Key and optional sessions are marked;
 * supporting — the everyday middle — stays unmarked so the calendar doesn't
 * turn into a wall of chips. A completed or skipped day is past deciding.
 */
export function SessionPriorityBadge({ entry }: Readonly<{ entry: TimelineEntry }>) {
  if (!entry.planDayId || entry.status === "completed" || entry.status === "skipped") return null;
  if (entry.priority === "key") {
    return (
      <Badge className="bg-primary/10 text-primary" data-testid={`badge-priority-key-${entry.id}`}>
        <Star className="mr-1 h-3 w-3" aria-hidden="true" />
        Key
      </Badge>
    );
  }
  if (entry.priority === "optional") {
    return (
      <Badge variant="outline" className="text-muted-foreground" data-testid={`badge-priority-optional-${entry.id}`}>
        Optional
      </Badge>
    );
  }
  return null;
}

/**
 * Where a recovered session came from: folded or shortened after it was
 * missed. Missed again, the card's recovery prompt says so instead.
 */
export function RecoveryOriginBadge({ entry }: Readonly<{ entry: TimelineEntry }>) {
  if (!entry.missedOn || entry.status === "missed") return null;
  if (entry.recovery !== "folded" && entry.recovery !== "shortened") return null;
  const day = format(parseISO(entry.missedOn), "EEE d MMM");
  const Icon = entry.recovery === "folded" ? CornerDownRight : Scissors;
  return (
    <Badge variant="outline" className="text-muted-foreground" data-testid={`badge-recovered-${entry.id}`}>
      <Icon className="mr-1 h-3 w-3" aria-hidden="true" />
      {entry.recovery === "folded" ? `Moved from ${day}` : `Shortened · missed ${day}`}
    </Badge>
  );
}
