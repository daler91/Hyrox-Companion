import { RACE_DAY_FOCUS } from "@shared/raceDay";
import type { PersonalRecord } from "@shared/schema";
import { CheckCircle2, Clock, Flag, SkipForward, XCircle } from "lucide-react";

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

export function getStatusBadge(status: string, focus?: string | null) {
  if (isRaceDayEntry(focus)) {
    return (
      <Badge
        className="bg-amber-500/15 text-amber-700 dark:text-amber-300"
        data-testid="badge-race-day"
      >
        <Flag className="h-3 w-3 mr-1" />
        Race Day
      </Badge>
    );
  }
  switch (status) {
    case "completed":
      return (
        <Badge className="bg-success/10 text-success">
          <CheckCircle2 className="h-3 w-3 mr-1" />
          Completed
        </Badge>
      );
    case "planned":
      return (
        <Badge className="bg-blue-500/10 text-blue-600 dark:text-blue-400">
          <Clock className="h-3 w-3 mr-1" />
          Planned
        </Badge>
      );
    case "missed":
      return (
        <Badge className="bg-red-500/10 text-red-600 dark:text-red-400">
          <XCircle className="h-3 w-3 mr-1" />
          Missed
        </Badge>
      );
    case "skipped":
      return (
        <Badge className="bg-yellow-500/10 text-yellow-600 dark:text-yellow-400">
          <SkipForward className="h-3 w-3 mr-1" />
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
) {
  if (isBeingCombined) return "border-primary ring-2 ring-primary/30";
  if (canBeCombinedWith) return "border-primary/50 hover:border-primary";
  if (isRaceDayEntry(focus)) return "border-amber-500/40 bg-amber-500/10";
  if (status === "completed") return "border-success/20 bg-success/5";
  if (status === "missed") return "border-red-500/20 bg-red-500/5";
  if (status === "skipped") return "border-yellow-500/20 bg-yellow-500/5";
  return "";
}
