import {
  closestCenter,
  DndContext,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import {
  SortableContext,
  sortableKeyboardCoordinates,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import type { ExerciseSet, StructureBlockInput } from "@shared/schema";
import { EXERCISE_DEFINITIONS, type ExerciseName } from "@shared/schema/exercises";
import { Plus } from "lucide-react";
import { useCallback, useMemo, useState } from "react";

import { Button } from "@/components/ui/button";
import type { AddExerciseSetPayload, PatchExerciseSetPayload } from "@/lib/api";
import { groupExerciseSets } from "@/lib/exerciseUtils";
import { toPreferenceScaleAll } from "@/lib/setDisplay";
import { buildBlockAssignmentOptions } from "@/lib/workoutStructureAssignments";

import { useExerciseDndHandler } from "./exercise-table/dnd";
import { ExerciseRowRenderer } from "./exercise-table/ExerciseRows";
import { AddExerciseDialog, EmptyExerciseState } from "./exercise-table/ExerciseTableDialogs";
import {
  groupsContainLegacyEmom,
  toggleExerciseRow as toggleExerciseRowState,
} from "./exercise-table/state";
import { type SaveState, SaveStatePill } from "./SaveStatePill";

export { dispatchSortOrderMutations, toggleExerciseRow } from "./exercise-table/state";

interface ExerciseTableProps {
  readonly workoutId: string;
  readonly exerciseSets: ExerciseSet[];
  readonly weightUnit: "kg" | "lb";
  /**
   * User's distance preference. Stored row values stay in the user's table
   * storage unit, while display can promote larger feet values to miles or
   * clean kilometer targets. Optional so existing callers don't break;
   * defaults to "km".
   */
  readonly distanceUnit?: "km" | "miles";
  readonly onUpdateSet: (setId: string, data: PatchExerciseSetPayload) => void;
  readonly onAddSet: (data: AddExerciseSetPayload) => void;
  readonly onDeleteSet: (setId: string) => void;
  /**
   * Optional save-feedback signal shown next to the Exercises header.
   * Omit for surfaces that don't persist edits (nothing renders).
   */
  readonly saveState?: SaveState;
  /**
   * When true and the table is empty, the empty state nudges the user to
   * tap Parse on the prescription panel instead of the Add button. Used
   * when the prescription has text but no rows have been extracted yet.
   */
  readonly hasUnparsedText?: boolean;
  readonly defaultExpanded?: boolean;
  readonly readableSummary?: boolean;
  readonly showPlannedDiffs?: boolean;
  /**
   * Show each exercise's last logged session under its prescription, with a
   * "use last" fill. Opt-in because it costs one query per distinct exercise:
   * worth it on the surfaces where the athlete is deciding what to lift, noise
   * in the draft-entry flow where nothing is saved yet.
   */
  readonly showLastTime?: boolean;
  /**
   * The workout log being viewed, so its own sets are excluded from its
   * "last time". Distinct from `workoutId`, which is the *owner* id and is a
   * plan-day id on planned surfaces.
   */
  readonly currentWorkoutLogId?: string | null;
  readonly onOpenConversionHelper?: () => void;
  readonly structureBlocks?: StructureBlockInput[];
}

/**
 * Compact one-row-per-exercise table for the detail dialog and the
 * planned-entry CTA. Editing still flows through `onUpdateSet`,
 * `onAddSet`, and `onDeleteSet`; the extracted modules only split row
 * rendering and summary helpers out of this orchestration shell.
 */
export function ExerciseTable({
  workoutId,
  exerciseSets,
  weightUnit,
  distanceUnit = "km",
  onUpdateSet,
  onAddSet,
  onDeleteSet,
  saveState,
  hasUnparsedText,
  defaultExpanded = false,
  readableSummary = true,
  showPlannedDiffs = false,
  showLastTime = false,
  currentWorkoutLogId,
  onOpenConversionHelper,
  structureBlocks = [],
}: ExerciseTableProps) {
  // Every read below this line (prescription line, planned diffs, the inline
  // editor, last time and the next-target suggestion) sees values in the
  // athlete's current units: a row stamped in another unit is converted once
  // here instead of being relabelled at each site (finding D2).
  const scaledSets = useMemo(
    () => toPreferenceScaleAll(exerciseSets, { weightUnit, distanceUnit }),
    [exerciseSets, weightUnit, distanceUnit],
  );
  const groups = useMemo(() => groupExerciseSets(scaledSets), [scaledSets]);
  const blockAssignmentOptions = useMemo(
    () => buildBlockAssignmentOptions(structureBlocks),
    [structureBlocks],
  );
  const hasLegacyEmomRow = groupsContainLegacyEmom(groups);
  // Stable per-group identity for @dnd-kit. Matches the React `key`
  // used below so SortableContext items align with rendered rows.
  const rowKeys = useMemo(
    () => groups.map((g) => g.sets[0]?.id ?? `${g.exerciseName}:${g.customLabel ?? ""}`),
    [groups],
  );

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const handleDragEnd = useExerciseDndHandler(groups, rowKeys, onUpdateSet);
  const [expandedKeys, setExpandedKeys] = useState<Set<string>>(() =>
    defaultExpanded ? new Set(rowKeys) : new Set(),
  );
  // Rows this table has already offered to open. `defaultExpanded` applies to
  // every row once, including those that arrive after mount (the sets query
  // resolving behind an already-open sheet, a text parse landing) — but a row
  // the athlete has collapsed stays collapsed across re-renders.
  const [seenKeys, setSeenKeys] = useState<Set<string>>(() => new Set(rowKeys));
  if (defaultExpanded) {
    const unseen = rowKeys.filter((key) => !seenKeys.has(key));
    if (unseen.length > 0) {
      setSeenKeys((prev) => new Set([...prev, ...unseen]));
      setExpandedKeys((prev) => new Set([...prev, ...unseen]));
    }
  }
  const [addPickerOpen, setAddPickerOpen] = useState(false);
  const [pendingExpand, setPendingExpand] = useState<{
    exerciseName: string;
    customLabel: string | null;
  } | null>(null);

  if (pendingExpand) {
    const match = groups.findLast(
      (g) =>
        g.exerciseName === pendingExpand.exerciseName &&
        (g.customLabel ?? null) === pendingExpand.customLabel,
    );
    const firstSetId = match?.sets[0]?.id;
    if (firstSetId) {
      setPendingExpand(null);
      setExpandedKeys((prev) => {
        if (prev.has(firstSetId)) return prev;
        const next = new Set(prev);
        next.add(firstSetId);
        return next;
      });
    }
  }

  const toggleExpanded = useCallback((rowKey: string) => {
    setExpandedKeys((prev) => toggleExerciseRowState(prev, rowKey));
  }, []);

  const handlePickFromCatalog = (name: ExerciseName) => {
    const def = EXERCISE_DEFINITIONS[name];
    onAddSet({
      exerciseName: name,
      category: def.category,
      customLabel: null,
      setNumber: 1,
    });
    setPendingExpand({ exerciseName: name, customLabel: null });
    setAddPickerOpen(false);
  };

  const handleAddCustomPlaceholder = () => {
    onAddSet({
      exerciseName: "custom",
      customLabel: "New exercise",
      category: "conditioning",
      setNumber: 1,
    });
    setPendingExpand({ exerciseName: "custom", customLabel: "New exercise" });
    setAddPickerOpen(false);
  };

  return (
    <section
      className="flex flex-col gap-3"
      aria-label="Exercises"
      data-testid="exercise-table"
      data-workout-id={workoutId}
    >
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            Exercises
          </span>
          {saveState && <SaveStatePill state={saveState} />}
        </div>
        <Button
          variant="ghost"
          size="sm"
          className="h-7 gap-1 text-muted-foreground"
          onClick={() => setAddPickerOpen(true)}
          data-testid="exercise-table-add"
        >
          <Plus className="size-3.5" aria-hidden />
          Add
        </Button>
      </div>

      {hasLegacyEmomRow && (
        <div
          className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-destructive/50 bg-destructive/10 px-3 py-2 text-sm"
          data-testid="exercise-table-legacy-emom-warning"
        >
          <div>
            <p className="font-medium text-destructive">Legacy EMOM row detected</p>
            <span>
              EMOM is no longer supported as a row exercise. Convert this workout via Parse to
              exercises.
            </span>
          </div>
          {onOpenConversionHelper ? (
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={onOpenConversionHelper}
              data-testid="exercise-table-legacy-emom-cta"
            >
              Open conversion helper
            </Button>
          ) : null}
        </div>
      )}

      {groups.length === 0 ? (
        <EmptyExerciseState
          onAdd={() => setAddPickerOpen(true)}
          onParseText={onOpenConversionHelper}
          hasUnparsedText={hasUnparsedText ?? false}
        />
      ) : (
        <>
          <div className="divide-y divide-border rounded-lg border border-border">
            <DndContext
              sensors={sensors}
              collisionDetection={closestCenter}
              onDragEnd={handleDragEnd}
            >
              <SortableContext items={rowKeys} strategy={verticalListSortingStrategy}>
                <ExerciseRowRenderer
                  groups={groups}
                  rowKeys={rowKeys}
                  expandedKeys={expandedKeys}
                  weightUnit={weightUnit}
                  distanceUnit={distanceUnit}
                  onToggle={toggleExpanded}
                  onUpdateSet={onUpdateSet}
                  onAddSet={onAddSet}
                  onDeleteSet={onDeleteSet}
                  readableSummary={readableSummary}
                  showPlannedDiffs={showPlannedDiffs}
                  blockAssignmentOptions={blockAssignmentOptions}
                  showLastTime={showLastTime}
                  currentWorkoutLogId={currentWorkoutLogId}
                />
              </SortableContext>
            </DndContext>
          </div>
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="h-9 w-full text-muted-foreground"
            onClick={() => setAddPickerOpen(true)}
            data-testid="exercise-table-add-bottom"
          >
            <Plus className="mr-1 size-3.5" aria-hidden />
            Add exercise
          </Button>
        </>
      )}

      <AddExerciseDialog
        open={addPickerOpen}
        onOpenChange={setAddPickerOpen}
        onPick={handlePickFromCatalog}
        onAddCustom={handleAddCustomPlaceholder}
      />
    </section>
  );
}
