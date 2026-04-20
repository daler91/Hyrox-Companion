import type { ExerciseSet } from "@shared/schema";
import { Plus } from "lucide-react";
import { useMemo, useState } from "react";

import { ExerciseRowShell } from "@/components/exercise-row/ExerciseRowShell";
import { ExerciseSetListEditor } from "@/components/exercise-row/ExerciseSetListEditor";
import { Button } from "@/components/ui/button";
import type { AddExerciseSetPayload, PatchExerciseSetPayload } from "@/lib/api";
import { getExerciseLabel, groupExerciseSets } from "@/lib/exerciseUtils";

interface ExerciseTableProps {
  readonly workoutId: string;
  readonly exerciseSets: ExerciseSet[];
  readonly weightUnit: "kg" | "lb";
  readonly onUpdateSet: (setId: string, data: PatchExerciseSetPayload) => void;
  readonly onAddSet: (data: AddExerciseSetPayload) => void;
  readonly onDeleteSet: (setId: string) => void;
}

/**
 * Expandable exercise list for the detail dialog and planned-entry CTA.
 * Each row is an `ExerciseRowShell` (icon, muscle badges, category border,
 * chevron) wrapping an `ExerciseSetListEditor` body with per-set stepper
 * rows. Groups are derived from `groupExerciseSets` and rows stay
 * expanded by default so the dialog's edit surface is visible without an
 * extra tap — the chevron collapses a row when the user wants a summary
 * view.
 *
 * External API is unchanged: the workout detail dialog and the plan-day
 * picker both hand in their own `onUpdateSet` / `onAddSet` / `onDeleteSet`
 * — the editor body fires set-level PATCHes through whichever mutation
 * bundle was wired up.
 */
export function ExerciseTable({
  workoutId,
  exerciseSets,
  weightUnit,
  onUpdateSet,
  onAddSet,
  onDeleteSet,
}: ExerciseTableProps) {
  const groups = useMemo(() => groupExerciseSets(exerciseSets), [exerciseSets]);
  // Track explicitly-collapsed rows; anything not in the set is expanded.
  // Keying by the first set id keeps a row's state stable across adds
  // (new sets don't change the head id) and survives a rename since the
  // group's id is carried by the head set regardless of label edits.
  const [collapsed, setCollapsed] = useState<Set<string>>(() => new Set());

  const toggle = (rowKey: string) => {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(rowKey)) next.delete(rowKey);
      else next.add(rowKey);
      return next;
    });
  };

  const handleAddPlaceholder = () => {
    onAddSet({
      exerciseName: "custom",
      customLabel: "New exercise",
      category: "conditioning",
      setNumber: 1,
    });
  };

  return (
    <section
      className="flex flex-col gap-3"
      aria-label="Exercises"
      data-testid="exercise-table"
      data-workout-id={workoutId}
    >
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
          Exercises
        </span>
        <Button
          variant="ghost"
          size="sm"
          className="h-7 gap-1 text-muted-foreground"
          onClick={handleAddPlaceholder}
          data-testid="exercise-table-add"
        >
          <Plus className="size-3.5" aria-hidden />
          Add
        </Button>
      </div>

      {groups.length === 0 ? (
        <EmptyExerciseState />
      ) : (
        <div className="flex flex-col gap-2">
          {groups.map((group) => {
            const rowKey = group.sets[0]?.id ?? `${group.exerciseName}:${group.customLabel ?? ""}`;
            const label = getExerciseLabel(group.exerciseName, group.customLabel);
            const lowConfidence =
              typeof group.confidence === "number" && group.confidence < 60;
            const setCount = group.sets.length;
            const subtitle = `${setCount} ${setCount === 1 ? "set" : "sets"}`;
            const isExpanded = !collapsed.has(rowKey);

            // Guards against deleting every set via the row-level Delete.
            // `ExerciseSetListEditor` also prevents the last-set remove
            // from the per-set X; this path keeps row-level delete as a
            // "clear the whole group" action.
            const handleDeleteRow = () => {
              for (const s of group.sets) onDeleteSet(s.id);
            };

            return (
              <ExerciseRowShell
                key={rowKey}
                exerciseName={group.exerciseName}
                displayLabel={label}
                category={group.category}
                subtitle={subtitle}
                isExpanded={isExpanded}
                onToggle={() => toggle(rowKey)}
                onDelete={handleDeleteRow}
                lowConfidence={lowConfidence}
              >
                <ExerciseSetListEditor
                  sets={group.sets}
                  exerciseName={group.exerciseName}
                  customLabel={group.customLabel}
                  category={group.category}
                  weightUnit={weightUnit}
                  onUpdateSet={onUpdateSet}
                  onAddSet={onAddSet}
                  onDeleteSet={onDeleteSet}
                />
              </ExerciseRowShell>
            );
          })}
        </div>
      )}
    </section>
  );
}

function EmptyExerciseState() {
  return (
    <div className="rounded-lg border border-dashed border-border px-4 py-6 text-center text-sm text-muted-foreground">
      No exercises yet. Tap <span className="font-medium">+ Add</span> to log one.
    </div>
  );
}
