import type { ExerciseSet } from "@shared/schema";
import { History, RotateCcw, TrendingDown, TrendingUp } from "lucide-react";
import { type ReactNode, useMemo } from "react";

import { Button } from "@/components/ui/button";
import { useExerciseHistory } from "@/hooks/useExerciseHistory";
import type { PatchExerciseSetPayload } from "@/lib/api";
import { toPreferenceScaleAll } from "@/lib/setDisplay";

import { formatPrescription, type Prescription } from "../../exercise-row/formatPrescription";
import { buildUseLastPatches, pickRecentSessions, summariseLastSession } from "./lastSession";
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
  // History rows keep the unit they were logged in. The summary, the
  // suggestion and both fills must all be in the athlete's current unit, so
  // the rows are converted here, before any of that maths runs (finding D2).
  const scaledHistory = useMemo(
    () => (history ? toPreferenceScaleAll(history, { weightUnit, distanceUnit }) : undefined),
    [history, weightUnit, distanceUnit],
  );

  // Two sessions, not one: the second is what lets "Next" tell a first miss
  // (repeat) from the same prescription missed twice (deload). The hook already
  // fetches three sessions; before this, all but the newest were discarded.
  const recentSessions = useMemo(
    () => (scaledHistory ? pickRecentSessions(scaledHistory, currentWorkoutLogId, 2) : []),
    [scaledHistory, currentWorkoutLogId],
  );
  const lastSession = recentSessions[0] ?? null;
  const previousSets = recentSessions[1]?.sets;

  const prescription = useMemo(
    () =>
      lastSession
        ? summariseLastSession(lastSession, { exerciseName, category, weightUnit, distanceUnit })
        : null,
    [lastSession, exerciseName, category, weightUnit, distanceUnit],
  );

  const nextTarget = useMemo(
    () =>
      lastSession
        ? suggestNextTarget(lastSession.sets, { category, weightUnit, previousSets })
        : null,
    [lastSession, previousSets, category, weightUnit],
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
  const { badge, srSuffix } = describeStep(target.step, weightUnit);

  return (
    <PrescriptionLine
      icon={stepIcon(target.step.field)}
      label="Next"
      prescription={prescription}
      badge={badge}
      srText={`Suggested next: ${prescription.aria}, ${srSuffix}`}
      testId={`next-target-${exerciseName}`}
      action={action}
    />
  );
}

/**
 * Badge and screen-reader wording for the one thing that moved. `repeat` is not
 * an overload — last session's prescription was not completed — so it must not
 * be announced as an increase or carry the rising-trend icon (audit H5).
 */
function describeStep(
  step: NextTarget["step"],
  weightUnit: "kg" | "lb",
): { readonly badge: string; readonly srSuffix: string } {
  if (step.field === "repeat") {
    return { badge: "Repeat", srSuffix: "the same target as last time, which was not completed" };
  }
  if (step.field === "deload") {
    return {
      badge: `−${step.amount} ${weightUnit}`,
      srSuffix: `down ${step.amount} ${weightUnit}, after two sessions short of this target`,
    };
  }
  const unit = step.field === "reps" ? "rep" : weightUnit;
  return { badge: `+${step.amount} ${unit}`, srSuffix: `up ${step.amount} ${unit} on last time` };
}

/** Repeat and deload are not overloads, so neither may carry the rising-trend
 *  icon (audit H5 established that rule for repeat; a deload points down). */
function stepIcon(field: NextTarget["step"]["field"]) {
  if (field === "repeat") return <RotateCcw className="h-3 w-3 shrink-0" aria-hidden />;
  if (field === "deload") return <TrendingDown className="h-3 w-3 shrink-0" aria-hidden />;
  return <TrendingUp className="h-3 w-3 shrink-0" aria-hidden />;
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
