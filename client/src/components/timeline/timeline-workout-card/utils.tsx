import type { PersonalRecord } from "@shared/schema";
import { CheckCircle2, Clock, SkipForward,XCircle } from "lucide-react";

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

export function getStatusBadge(status: string) {
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
) {
  if (isBeingCombined) return "border-primary ring-2 ring-primary/30";
  if (canBeCombinedWith) return "border-primary/50 hover:border-primary";
  if (status === "completed") return "border-success/20 bg-success/5";
  if (status === "missed") return "border-red-500/20 bg-red-500/5";
  if (status === "skipped") return "border-yellow-500/20 bg-yellow-500/5";
  return "";
}
