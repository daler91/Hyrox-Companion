import React, { useMemo } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  CheckCircle2,
  Clock,
  XCircle,
  SkipForward,
  Flame,
  Zap,
  Activity,
  TrendingUp,
  Circle,
  BookOpen,
  HelpCircle,
  Trophy,
} from "lucide-react";
import { SiStrava } from "react-icons/si";
import { type TimelineEntry, type ExerciseSet, EXERCISE_DEFINITIONS, type ExerciseName, type PersonalRecord } from "@shared/schema";
import { useUnitPreferences } from "@/hooks/useUnitPreferences";
import { formatSpeed } from "@shared/unitConversion";
import { categoryChipColors, groupExerciseSets, formatExerciseSummary, type GroupedExercise } from "@/lib/exerciseUtils";

interface TimelineWorkoutCardProps {
  readonly entry: TimelineEntry;
  readonly onMarkComplete: (entry: TimelineEntry) => void;
  readonly onClick: (entry: TimelineEntry) => void;
  readonly onCombineSelect?: (entry: TimelineEntry) => void;
  readonly isCombining?: boolean;
  readonly combiningEntryId?: string | null;
  readonly combiningEntryDate?: string | null;
  readonly personalRecords?: Record<string, PersonalRecord>;
}


function hasPRInWorkout(group: GroupedExercise, workoutLogId: string | undefined, prs?: Record<string, PersonalRecord>): boolean {
  if (!prs || !workoutLogId) return false;
  const prKey = group.exerciseName === "custom" && group.customLabel
    ? `custom:${group.customLabel}`
    : group.exerciseName;
  const pr = prs[prKey];
  if (!pr) return false;
  return (
    (pr.maxWeight?.workoutLogId === workoutLogId) ||
    (pr.maxDistance?.workoutLogId === workoutLogId) ||
    (pr.bestTime?.workoutLogId === workoutLogId)
  );
}

function getStatusBadge(status: string) {
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




interface WorkoutStravaStatsProps {
  readonly entry: TimelineEntry;
  readonly distanceUnit: string;
}

function WorkoutStravaStats({ entry, distanceUnit }: Readonly<WorkoutStravaStatsProps>) {
  if (entry.source !== "strava") return null;

  const hasStravaStats =
    entry.calories ||
    entry.avgWatts ||
    entry.sufferScore ||
    entry.avgCadence ||
    entry.avgSpeed;

  if (!hasStravaStats) return null;

  return (
    <div className="flex flex-wrap gap-3 mt-2 pt-2 border-t border-border/50">
      {entry.calories && (
        <div className="flex items-center gap-1 text-xs text-muted-foreground" data-testid={`text-calories-${entry.id}`}>
          <Flame className="h-3 w-3 text-orange-500" />
          <span>{entry.calories} cal</span>
        </div>
      )}
      {entry.avgWatts && (
        <div className="flex items-center gap-1 text-xs text-muted-foreground" data-testid={`text-power-${entry.id}`}>
          <Zap className="h-3 w-3 text-yellow-500" />
          <span>{entry.avgWatts}W</span>
        </div>
      )}
      {entry.avgCadence && (
        <div className="flex items-center gap-1 text-xs text-muted-foreground" data-testid={`text-cadence-${entry.id}`}>
          <Activity className="h-3 w-3 text-blue-500" />
          <span>{Math.round(entry.avgCadence)} spm</span>
        </div>
      )}
      {entry.avgSpeed && entry.avgSpeed > 0 && (
        <div className="flex items-center gap-1 text-xs text-muted-foreground" data-testid={`text-speed-${entry.id}`}>
          <TrendingUp className="h-3 w-3 text-green-500" />
          <span>{formatSpeed(entry.avgSpeed, distanceUnit as any)}</span>
        </div>
      )}
      {entry.sufferScore && (
        <div className="flex items-center gap-1 text-xs text-muted-foreground" data-testid={`text-effort-${entry.id}`}>
          <TrendingUp className="h-3 w-3 text-purple-500" />
          <span>Effort: {entry.sufferScore}</span>
        </div>
      )}
    </div>
  );
}

function ExerciseChips({
  entryId,
  groupedExercises,
  workoutLogId,
  personalRecords,
  weightLabel,
  distanceUnit,
}: Readonly<{
  readonly entryId: string;
  readonly groupedExercises: GroupedExercise[];
  readonly workoutLogId: string | undefined;
  readonly personalRecords?: Record<string, PersonalRecord>;
  readonly weightLabel: string;
  readonly distanceUnit: string;
}>) {
  return (
    <div className="flex flex-wrap gap-1.5 mb-1" data-testid={`exercise-chips-${entryId}`}>
      {groupedExercises.map((group, idx) => {
        const isCustom = group.exerciseName === "custom";
        const isPR = hasPRInWorkout(group, workoutLogId, personalRecords);
        const conf = group.confidence;
        const showConfidence = conf != null && conf < 90;
        let confColor = "";
        if (conf != null) {
          if (conf >= 80) {
            confColor = "text-green-500";
          } else if (conf >= 60) {
            confColor = "text-yellow-500";
          } else {
            confColor = "text-red-500";
          }
        }
        return (
          <Badge
            key={`${group.exerciseName}-${idx}`}
            variant="secondary"
            className={`text-xs font-normal ${categoryChipColors[group.category] || ""} ${isPR ? "ring-1 ring-yellow-500/50" : ""}`}
            data-testid={isPR ? `badge-pr-${entryId}-${idx}` : `badge-exercise-${entryId}-${idx}`}
          >
            {isPR && <Trophy className="h-3 w-3 mr-0.5 text-yellow-500" />}
            {formatExerciseSummary(group, weightLabel, distanceUnit)}
            {showConfidence && (
              <span className={`ml-1 text-[10px] font-medium ${confColor}`} data-testid={`confidence-score-${entryId}-${idx}`}>
                {conf}%
              </span>
            )}
            {isCustom && <HelpCircle className="h-3 w-3 ml-0.5 text-muted-foreground/60" />}
          </Badge>
        );
      })}
    </div>
  );
}

function getCardClasses(isBeingCombined: boolean | undefined, canBeCombinedWith: boolean | undefined, status: string) {
  if (isBeingCombined) return "border-primary ring-2 ring-primary/30";
  if (canBeCombinedWith) return "border-primary/50 hover:border-primary";
  if (status === "completed") return "border-success/20 bg-success/5";
  if (status === "missed") return "border-red-500/20 bg-red-500/5";
  if (status === "skipped") return "border-yellow-500/20 bg-yellow-500/5";
  return "";
}

const TimelineWorkoutCard = React.memo(function TimelineWorkoutCard({
  entry,
  onMarkComplete,
  onClick,
  onCombineSelect,
  isCombining,
  combiningEntryId,
  combiningEntryDate,
  personalRecords,
}: Readonly<TimelineWorkoutCardProps>) {
  const { distanceUnit, weightLabel } = useUnitPreferences();
  
  const isBeingCombined = combiningEntryId === entry.id;
  const isSameDate = combiningEntryDate === entry.date;
  const canBeCombinedWith = isCombining && !isBeingCombined && isSameDate;
  const isPlanned = entry.status === "planned" && entry.planDayId;

  const handleCardClick = (e: React.MouseEvent) => {
    if (canBeCombinedWith) {
      onCombineSelect?.(entry);
    } else {
      onClick(entry);
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

  return (
    <Card
      className={`cursor-pointer transition-colors hover-elevate ${getCardClasses(isBeingCombined, canBeCombinedWith, entry.status)}`}
      onClick={handleCardClick}
      data-testid={`card-timeline-entry-${entry.id}`}
    >
      <CardContent className="p-4">
        <div className="flex items-start gap-3">
          {isPlanned && (
            <Button
              size="icon"
              variant="ghost"
              className="shrink-0 mt-0.5 text-muted-foreground hover:text-success"
              onClick={handleCompleteClick}
              data-testid={`button-complete-${entry.id}`}
              aria-label={`Mark ${entry.focus} as complete`}
              title={`Mark ${entry.focus} as complete`}
            >
              <Circle className="h-5 w-5" />
            </Button>
          )}
          
          {entry.status === "completed" && (
            <div className="shrink-0 mt-0.5 text-success">
              <CheckCircle2 className="h-5 w-5" />
            </div>
          )}

          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-2 flex-wrap">
              {getStatusBadge(entry.status)}
              {entry.source === "strava" && (
                <Badge className="bg-[#FC4C02]/10 text-[#FC4C02]">
                  <SiStrava className="h-3 w-3 mr-1" />
                  Strava
                </Badge>
              )}
              {entry.planName && (
                <Badge variant="outline" className="text-muted-foreground" data-testid={`badge-plan-${entry.id}`}>
                  <BookOpen className="h-3 w-3 mr-1" />
                  {entry.planName}
                </Badge>
              )}
              {entry.dayName && (
                <Badge variant="secondary">{entry.dayName}</Badge>
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
              <p className="text-sm text-muted-foreground mb-1">
                {entry.mainWorkout}
              </p>
            )}
            {entry.accessory && (
              <p className="text-sm text-muted-foreground/70 mb-1">
                {entry.accessory}
              </p>
            )}
            {entry.notes && (
              <p className="text-xs text-muted-foreground italic mt-2">
                {entry.notes}
              </p>
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
