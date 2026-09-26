import { RACE_DAY_FOCUS } from "@shared/raceDay";
import type { PersonalRecord, PlanDayRecovery } from "@shared/schema";
import { CalendarOff,CheckCircle2, Clock, Feather, Flag, Moon, SkipForward, XCircle } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import type { GroupedExercise } from "@/lib/exerciseUtils";

export function hasPRInWorkout(
  group: GroupedExercise,
  workoutLogId: string | undefined,
  prs?: Record<string, PersonalRecord>,
): boolean {
  if (!prs || !workoutLogId) return false;
  const prKey =
    group.exerciseName === "custom" && group.customLabel
      ? `custom:${group.customLabel}`
      : group.exerciseName;
  const pr = prs[prKey];
  if (!pr) return false;
  return (
    pr.maxWeight?.workoutLogId === workoutLogId ||
    pr.maxDistance?.workoutLogId === workoutLogId ||
    pr.bestTime?.workoutLogId === workoutLogId
  );
}

// Exact, case-insensitive match against the server's race-day marker so it never
// collides with workout focuses like "Race Pace" or "Race Simulation".
export function isRaceDayEntry(focus: string | null | undefined): boolean {
  return (focus ?? "").trim().toLowerCase() === RACE_DAY_FOCUS.toLowerCase();
}

/** What sets a missed day apart from one still waiting on a decision. */
export interface MissedDetail {
  /** The athlete's decision about it; `let_go` ends the question. */
  readonly recovery?: PlanDayRecovery;
  /** A rest day: when it goes by there was nothing to miss. */
  readonly restDay?: boolean;
}

/** A missed day nobody needs to act on: let go, or a rest day that simply went by. */
function isSettledMiss(status: string, detail: MissedDetail): boolean {
  return status === "missed" && (detail.recovery === "let_go" || Boolean(detail.restDay));
}

export function getStatusBadge(
  status: string,
  focus?: string | null,
  excused?: boolean,
  detail: MissedDetail = {},
) {
  if (isRaceDayEntry(focus)) {
    return (
      <Badge
        className="bg-amber-500/15 text-amber-700 dark:text-amber-300"
        data-testid="badge-race-day"
      >
        <Flag className="h-3 w-3 mr-1" aria-hidden="true" />
        Race Day
      </Badge>
    );
  }
  // The athlete logged an injury/illness/travel/rest range over this date. The
  // annotation card sitting directly above says which, so this only has to say
  // that the session isn't being counted against them — a past day reading a
  // plain "Planned" would look like the app had simply lost track.
  if (excused) {
    return (
      <Badge
        className="bg-muted text-muted-foreground"
        data-testid="badge-excused"
      >
        <CalendarOff className="h-3 w-3 mr-1" aria-hidden="true" />
        Not counted
      </Badge>
    );
  }
  if (status === "missed" && detail.restDay) {
    return (
      <Badge className="bg-muted text-muted-foreground" data-testid="badge-rest-day">
        <Moon className="h-3 w-3 mr-1" aria-hidden="true" />
        Rest day
      </Badge>
    );
  }
  if (status === "missed" && detail.recovery === "let_go") {
    return (
      <Badge className="bg-muted text-muted-foreground" data-testid="badge-let-go">
        <Feather className="h-3 w-3 mr-1" aria-hidden="true" />
        Let go
      </Badge>
    );
  }
  switch (status) {
    case "completed":
      return (
        <Badge className="bg-success/10 text-success">
          <CheckCircle2 className="h-3 w-3 mr-1" aria-hidden="true" />
          Completed
        </Badge>
      );
    case "planned":
      return (
        <Badge className="bg-blue-500/10 text-blue-600 dark:text-blue-400">
          <Clock className="h-3 w-3 mr-1" aria-hidden="true" />
          Planned
        </Badge>
      );
    case "missed":
      // The warning tone, not red: a missed session is a decision waiting to
      // be made (the card offers fold / shorten / let go), not a verdict.
      return (
        <Badge className="bg-warning/10 text-warning" data-testid="badge-missed">
          <XCircle className="h-3 w-3 mr-1" aria-hidden="true" />
          Missed
        </Badge>
      );
    case "skipped":
      return (
        <Badge className="bg-yellow-500/10 text-yellow-600 dark:text-yellow-400">
          <SkipForward className="h-3 w-3 mr-1" aria-hidden="true" />
          Skipped
        </Badge>
      );
    default:
      return null;
  }
}

export function getCardClasses(
  isBeingCombined: boolean | undefined,
  canBeCombinedWith: boolean | undefined,
  status: string,
  focus?: string | null,
  detail: MissedDetail = {},
) {
  if (isBeingCombined) return "border-primary ring-2 ring-primary/30";
  if (canBeCombinedWith) return "border-primary/50 hover:border-primary";
  if (isRaceDayEntry(focus)) return "border-amber-500/40 bg-amber-500/10";
  if (status === "completed") return "border-success/20 bg-success/5";
  if (isSettledMiss(status, detail)) return "";
  if (status === "missed") return "border-warning/30 bg-warning/5";
  if (status === "skipped") return "border-yellow-500/20 bg-yellow-500/5";
  return "";
}
