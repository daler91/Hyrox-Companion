import type { ExerciseSet } from "@shared/schema";
import { History } from "lucide-react";
import { useMemo } from "react";

import { Button } from "@/components/ui/button";
import { useExerciseHistory } from "@/hooks/useExerciseHistory";
import type { PatchExerciseSetPayload } from "@/lib/api";

import { buildUseLastPatches, pickLastSession, summariseLastSession } from "./lastSession";

/**
 * "Last time: 4 × 8 reps · 80 kg" under the exercise's current prescription,
 * with a one-tap fill.
 *
 * The endpoint behind this has existed, tested and rate-limited, with zero call
 * sites — so progressive overload got no assistance at the exact moment the
 * decision is made, at the rack. It sits on the collapsed header rather than
 * inside the expanded editor for the same reason: needing a tap to see last
 * week's numbers defeats the point.
 *
 * Renders nothing while loading and nothing when there's no history. No
 * skeleton: a placeholder flickering on every row of every session is worse
 * than a line that simply appears.
 */
export function LastTimeRow({
  exerciseName,
  category,
  currentSets,
  weightUnit,
  distanceUnit,
  currentWorkoutLogId,
  onUpdateSet,
  showUseLast,
}: {
  readonly exerciseName: string;
  readonly category: string;
  readonly currentSets: readonly ExerciseSet[];
  readonly weightUnit: "kg" | "lb";
  readonly distanceUnit: "km" | "miles";
  readonly currentWorkoutLogId?: string | null;
  readonly onUpdateSet: (setId: string, data: PatchExerciseSetPayload) => void;
  readonly showUseLast: boolean;
}) {
  const { data: history } = useExerciseHistory(exerciseName);

  const lastSession = useMemo(
    () => (history ? pickLastSession(history, currentWorkoutLogId) : null),
    [history, currentWorkoutLogId],
  );

  const prescription = useMemo(
    () =>
      lastSession
        ? summariseLastSession(lastSession, { exerciseName, category, weightUnit, distanceUnit })
        : null,
    [lastSession, exerciseName, category, weightUnit, distanceUnit],
  );

  if (!lastSession || !prescription) return null;

  const handleUseLast = () => {
    for (const { setId, patch } of buildUseLastPatches(currentSets, lastSession.sets)) {
      onUpdateSet(setId, patch);
    }
  };

  return (
    <div
      className="flex items-center gap-2 px-3 pb-2 text-xs text-muted-foreground sm:px-4"
      data-testid={`last-time-${exerciseName}`}
    >
      <History className="h-3 w-3 shrink-0" aria-hidden />
      {/* The glyphs are decorative; the grammatical form goes to screen readers. */}
      <span aria-hidden className="min-w-0 truncate tabular-nums">
        Last time:{" "}
        {prescription.visual.map((segment, index) => (
          <span key={segment.separator ?? `sets-${index}`}>
            {segment.separator === "times" ? " × " : null}
            {segment.separator === "dot" ? " · " : null}
            {segment.text}
          </span>
        ))}
      </span>
      <span className="sr-only">Last time: {prescription.aria}</span>
      {showUseLast && currentSets.length > 0 && (
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="h-6 shrink-0 px-2 text-xs"
          onClick={handleUseLast}
          data-testid={`use-last-${exerciseName}`}
        >
          Use last
        </Button>
      )}
    </div>
  );
}
