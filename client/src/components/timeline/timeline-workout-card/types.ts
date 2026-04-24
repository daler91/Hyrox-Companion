import type { PersonalRecord,TimelineEntry } from "@shared/schema";
import type { DistanceUnit } from "@shared/unitConversion";

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
  /**
   * Opens a date picker that moves the workout to a chosen day. Undefined
   * when the parent doesn't wire up rescheduling (e.g. tests), and also
   * suppressed on completed entries that the timeline treats as immutable.
   */
  readonly onMove?: (entry: TimelineEntry, newDate: string) => void;
  /** Whether a reschedule mutation is currently in flight for this user. */
  readonly isMoving?: boolean;
}

export interface WorkoutStravaStatsProps {
  readonly entry: TimelineEntry;
  readonly distanceUnit: DistanceUnit;
}

export interface ExerciseChipsProps {
  readonly entryId: string;
  readonly groupedExercises: GroupedExercise[];
  readonly workoutLogId: string | undefined;
  readonly personalRecords?: Record<string, PersonalRecord>;
  readonly weightLabel: string;
  readonly distanceUnit: string;
}
