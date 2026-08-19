import type { ExerciseSet } from "@shared/schema";
import { History, TrendingUp } from "lucide-react";
import { type ReactNode, useMemo } from "react";

import { Button } from "@/components/ui/button";
import { useExerciseHistory } from "@/hooks/useExerciseHistory";
import type { PatchExerciseSetPayload } from "@/lib/api";

import { formatPrescription, type Prescription } from "../../exercise-row/formatPrescription";
import { buildUseLastPatches, pickLastSession, summariseLastSession } from "./lastSession";
import { buildUseNextPatches, type NextTarget, suggestNextTarget } from "./nextTarget";

/**
 * "Last time: 4 × 8 reps · 80 kg" under the exercise's current prescription,
 * with a one-tap fill — and, where the estimated-1RM maths has footing, a
 * "Next: 4 × 9 reps · 80 kg" suggestion with its own fill.
 *
 * The endpoint behind this has existed, tested and rate-limited, with zero call
 * sites — so progressive overload got no assistance at the exact moment the
 * decision is made, at the rack. It sits on the collapsed header rather than
 * inside the expanded editor for the same reason: needing a tap to see last
 * week's numbers defeats the point. The suggestion line closes the remaining
 * gap: showing last time and stopping still left the actual decision — what to
 * put on the bar — entirely to the athlete.
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

  const nextTarget = useMemo(
    () => (lastSession ? suggestNextTarget(lastSession.sets, { category, weightUnit }) : null),
    [lastSession, category, weightUnit],
  );

  if (!lastSession || !prescription) return null;

  const handleUseLast = () => {
    for (const { setId, patch } of buildUseLastPatches(currentSets, lastSession.sets)) {
      onUpdateSet(setId, patch);
    }
  };

  const handleUseNext = () => {
    if (!nextTarget) return;
    for (const { setId, patch } of buildUseNextPatches(currentSets, nextTarget)) {
      onUpdateSet(setId, patch);
    }
  };

  // Both fills write into the set editor, so both wait for the row to be open.
  const fillable = showUseLast && currentSets.length > 0;

  return (
    <div className="flex flex-col gap-1 px-3 pb-2 sm:px-4">
      <PrescriptionLine
        icon={<History className="h-3 w-3 shrink-0" aria-hidden />}
        label="Last time"
        prescription={prescription}
        srText={`Last time: ${prescription.aria}`}
        testId={`last-time-${exerciseName}`}
        action={
          fillable
            ? { label: "Use last", testId: `use-last-${exerciseName}`, onClick: handleUseLast }
            : undefined
        }
      />
      {nextTarget && (
        <NextTargetLine
          exerciseName={exerciseName}
          target={nextTarget}
          weightUnit={weightUnit}
          action={
            fillable
              ? { label: "Use next", testId: `use-next-${exerciseName}`, onClick: handleUseNext }
              : undefined
          }
        />
      )}
    </div>
  );
}

function NextTargetLine({
  exerciseName,
  target,
  weightUnit,
  action,
}: {
  readonly exerciseName: string;
  readonly target: NextTarget;
  readonly weightUnit: "kg" | "lb";
  readonly action?: LineAction;
}) {
  const prescription = formatPrescription({
    setCount: target.setCount,
    metricValue: target.reps,
    metricSuffix: "reps",
    metricVaries: false,
    weightValue: target.weight,
    weightUnit,
    weightVaries: false,
    hasWeight: true,
  });
  const stepUnit = target.step.field === "reps" ? "rep" : weightUnit;
  const stepText = `+${target.step.amount} ${stepUnit}`;

  return (
    <PrescriptionLine
      icon={<TrendingUp className="h-3 w-3 shrink-0" aria-hidden />}
      label="Next"
      prescription={prescription}
      badge={stepText}
      srText={`Suggested next: ${prescription.aria}, up ${target.step.amount} ${stepUnit} on last time`}
      testId={`next-target-${exerciseName}`}
      action={action}
    />
  );
}

interface LineAction {
  readonly label: string;
  readonly testId: string;
  readonly onClick: () => void;
}

function PrescriptionLine({
  icon,
  label,
  prescription,
  badge,
  srText,
  testId,
  action,
}: {
  readonly icon: ReactNode;
  readonly label: string;
  readonly prescription: Prescription;
  readonly badge?: string;
  readonly srText: string;
  readonly testId: string;
  readonly action?: LineAction;
}) {
  return (
    <div className="flex items-center gap-2 text-xs text-muted-foreground" data-testid={testId}>
      {icon}
      {/* The glyphs are decorative; the grammatical form goes to screen readers. */}
      <span aria-hidden className="min-w-0 truncate tabular-nums">
        {label}:{" "}
        {prescription.visual.map((segment, index) => (
          <span key={segment.separator ?? `sets-${index}`}>
            {segment.separator === "times" ? " × " : null}
            {segment.separator === "dot" ? " · " : null}
            {segment.text}
          </span>
        ))}
      </span>
      {badge && (
        <span
          aria-hidden
          className="shrink-0 rounded-full bg-primary/10 px-2 py-0.5 text-[10px] font-medium text-primary"
        >
          {badge}
        </span>
      )}
      <span className="sr-only">{srText}</span>
      {action && (
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="h-6 shrink-0 px-2 text-xs"
          onClick={action.onClick}
          data-testid={action.testId}
        >
          {action.label}
        </Button>
      )}
    </div>
  );
}
