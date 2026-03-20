import type { TimelineEntry, PersonalRecord } from "@shared/schema";
import type { GroupedExercise } from "@/lib/exerciseUtils";

export interface TimelineWorkoutCardProps {
  readonly entry: TimelineEntry;
  readonly onMarkComplete: (entry: TimelineEntry) => void;
  readonly onClick: (entry: TimelineEntry) => void;
  readonly onCombineSelect?: (entry: TimelineEntry) => void;
  readonly isCombining?: boolean;
  readonly combiningEntryId?: string | null;
  readonly combiningEntryDate?: string | null;
  readonly personalRecords?: Record<string, PersonalRecord>;
  readonly isAutoCoaching?: boolean;
}

export interface WorkoutStravaStatsProps {
  readonly entry: TimelineEntry;
  readonly distanceUnit: string;
}

export interface ExerciseChipsProps {
  readonly entryId: string;
  readonly groupedExercises: GroupedExercise[];
  readonly workoutLogId: string | undefined;
  readonly personalRecords?: Record<string, PersonalRecord>;
  readonly weightLabel: string;
  readonly distanceUnit: string;
}
