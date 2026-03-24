import React, { useMemo } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { Circle, BookOpen, Loader2, CheckCircle2, Database, FileText } from "lucide-react";
import { format } from "date-fns";
import { SiStrava } from "react-icons/si";
import { useUnitPreferences } from "@/hooks/useUnitPreferences";
import { groupExerciseSets } from "@/lib/exerciseUtils";
import { getStatusBadge, getCardClasses } from "./utils";
import { WorkoutStravaStats } from "./WorkoutStravaStats";
import { ExerciseChips } from "./ExerciseChips";
import type { TimelineWorkoutCardProps } from "./types";

const TimelineWorkoutCard = React.memo(function TimelineWorkoutCard({
  entry,
  onMarkComplete,
  onClick,
  onCombineSelect,
  isCombining,
  combiningEntryId,
  combiningEntryDate,
  personalRecords,
  isAutoCoaching,
}: Readonly<TimelineWorkoutCardProps>) {
  const { distanceUnit, weightLabel } = useUnitPreferences();

  const isBeingCombined = combiningEntryId === entry.id;
  const isSameDate = combiningEntryDate === entry.date;
  const canBeCombinedWith = isCombining && !isBeingCombined && isSameDate;
  const isPlanned = entry.status === "planned" && entry.planDayId;

  const todayStr = format(new Date(), "yyyy-MM-dd");
  const isTargetedByCoach = isAutoCoaching && isPlanned && entry.date >= todayStr;

  const handleCardClick = (_e: React.MouseEvent) => {
    if (canBeCombinedWith) {
      onCombineSelect?.(entry);
    } else {
      onClick(entry);
    }
  };

  const handleCardKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      if (canBeCombinedWith) {
        onCombineSelect?.(entry);
      } else {
        onClick(entry);
      }
    }
  };

  const handleCompleteClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    onMarkComplete(entry);
  };

  // ⚡ Bolt Performance Optimization:
  // Memoizing the parsed/grouped exercise sets prevents recalculating the sorting
  // and grouping on every re-render (e.g. when expanding panels or scrolling),
  // which is an O(n log n) operation when sortOrder exists.
  const groupedExercises = useMemo(() => {
    if (!entry.exerciseSets || entry.exerciseSets.length === 0) return [];
    return groupExerciseSets(entry.exerciseSets);
  }, [entry.exerciseSets]);

  const baseCardClasses = getCardClasses(isBeingCombined, canBeCombinedWith, entry.status);
  const aiCoachClasses = isTargetedByCoach
    ? "border-primary/60 bg-primary/5 shadow-md shadow-primary/20 transition-all duration-700 relative"
    : "";

  return (
    <Card
      className={`cursor-pointer transition-colors hover-elevate focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 ${baseCardClasses} ${aiCoachClasses}`}
      onClick={handleCardClick}
      onKeyDown={handleCardKeyDown}
      role="button"
      tabIndex={0}
      aria-label={`${entry.focus || "Workout"} on ${entry.date}, ${entry.status}`}
      data-testid={`card-timeline-entry-${entry.id}`}
    >
      {isTargetedByCoach && (
        <Badge
          variant="outline"
          className="absolute -top-3 -right-3 z-30 border-primary border-2 text-primary bg-background shadow-lg shadow-primary/30 animate-pulse px-3 py-1 text-xs font-bold"
          data-testid={`badge-ai-coach-${entry.id}`}
        >
          <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />
          AI Modifying
        </Badge>
      )}
      <CardContent className="p-4 relative">
        <div className="flex items-start gap-3">
          {isPlanned && (
            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    size="icon"
                    variant="ghost"
                    className="shrink-0 mt-0.5 text-muted-foreground hover:text-success"
                    onClick={handleCompleteClick}
                    data-testid={`button-complete-${entry.id}`}
                    aria-label={`Mark ${entry.focus} as complete`}
                  >
                    <Circle className="h-5 w-5" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>
                  <p>Mark {entry.focus} as complete</p>
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>
          )}

          {entry.status === "completed" && (
            <div className="shrink-0 mt-0.5 text-success">
              <CheckCircle2 className="h-5 w-5" />
            </div>
          )}

          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-2 flex-wrap">
              {getStatusBadge(entry.status)}
              {isTargetedByCoach && (
                <Badge
                  variant="outline"
                  className="border-primary text-primary bg-primary/5 animate-pulse"
                  data-testid={`badge-ai-coach-${entry.id}`}
                >
                  <Loader2 className="h-3 w-3 mr-1 animate-spin" />
                  AI Modifying
                </Badge>
              )}
              {entry.source === "strava" && (
                <Badge className="bg-[#FC4C02]/10 text-[#FC4C02]">
                  <SiStrava className="h-3 w-3 mr-1" />
                  Strava
                </Badge>
              )}
              {entry.planName && (
                <Badge
                  variant="outline"
                  className="text-muted-foreground"
                  data-testid={`badge-plan-${entry.id}`}
                >
                  <BookOpen className="h-3 w-3 mr-1" />
                  {entry.planName}
                </Badge>
              )}
              {entry.dayName && <Badge variant="secondary">{entry.dayName}</Badge>}
              {entry.aiSource === "rag" && (
                <Badge
                  variant="outline"
                  className="text-emerald-600 border-emerald-200 bg-emerald-50 dark:text-emerald-400 dark:border-emerald-800 dark:bg-emerald-950 text-[10px]"
                >
                  <Database className="h-2.5 w-2.5 mr-1" />
                  RAG
                </Badge>
              )}
              {entry.aiSource === "legacy" && (
                <Badge
                  variant="outline"
                  className="text-amber-600 border-amber-200 bg-amber-50 dark:text-amber-400 dark:border-amber-800 dark:bg-amber-950 text-[10px]"
                >
                  <FileText className="h-2.5 w-2.5 mr-1" />
                  Legacy
                </Badge>
              )}
              <span className="font-medium">{entry.focus}</span>
            </div>
            {entry.exerciseSets && entry.exerciseSets.length > 0 ? (
              <ExerciseChips
                entryId={entry.id}
                groupedExercises={groupedExercises}
                workoutLogId={entry.workoutLogId ?? undefined}
                personalRecords={personalRecords}
                weightLabel={weightLabel}
                distanceUnit={distanceUnit}
              />
            ) : (
              <p className="text-sm text-muted-foreground mb-1">{entry.mainWorkout}</p>
            )}
            {entry.accessory && (
              <p className="text-sm text-muted-foreground/70 mb-1">{entry.accessory}</p>
            )}
            {entry.notes && (
              <p className="text-xs text-muted-foreground italic mt-2">{entry.notes}</p>
            )}
            {entry.duration && entry.source !== "strava" && (
              <p className="text-xs text-muted-foreground mt-1">
                Duration: {entry.duration} min
                {entry.rpe && ` | RPE: ${entry.rpe}`}
              </p>
            )}
            <WorkoutStravaStats entry={entry} distanceUnit={distanceUnit} />
          </div>
        </div>
      </CardContent>
    </Card>
  );
});

// ⚡ Bolt Performance Optimization:
// Wrap TimelineWorkoutCard in React.memo so the cards aren't re-rendered when
// parent timeline component state changes (unless their specific entry/props change).
// This reduces unnecessary re-renders in a potentially long list.
export default TimelineWorkoutCard;
