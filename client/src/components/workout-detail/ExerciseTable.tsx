import {
  closestCenter,
  DndContext,
  type DragEndEvent,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { EXERCISE_DEFINITIONS, type ExerciseName, type ExerciseSet } from "@shared/schema";
import { ChevronDown, GripVertical, MoreVertical, Plus, Repeat, Trash2 } from "lucide-react";
import { type CSSProperties,memo, useCallback, useMemo, useState } from "react";

import { type FieldKey, getFields } from "@/components/exercise-row/fieldMeta";
import {
  formatPrescription,
  type VisualSegment,
} from "@/components/exercise-row/formatPrescription";
import { InlineSetEditor } from "@/components/exercise-row/InlineSetEditor";
import { ExerciseSelector } from "@/components/ExerciseSelector";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import type { AddExerciseSetPayload, PatchExerciseSetPayload } from "@/lib/api";
import { categoryColor } from "@/lib/categoryColors";
import { getExerciseLabel, type GroupedExercise,groupExerciseSets } from "@/lib/exerciseUtils";
import { cn } from "@/lib/utils";

import { type SaveState, SaveStatePill } from "./SaveStatePill";

interface ExerciseTableProps {
  readonly workoutId: string;
  readonly exerciseSets: ExerciseSet[];
  readonly weightUnit: "kg" | "lb";
  /**
   * User's distance preference. Drives the primary-metric suffix on
   * distance-based rows ("m" for km users, "ft" for miles users), mirroring
   * the convention in `fieldMeta.ts`. Optional so existing callers don't
   * break; defaults to "km".
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
   * by WorkoutDetailDialogV2 once the prescription has text but no rows
   * have been extracted yet.
   */
  readonly hasUnparsedText?: boolean;
}

/**
 * Compact one-row-per-exercise table for the detail dialog and the
 * planned-entry CTA. Aggregate cells (Sets / Reps-or-Distance / Load)
 * are inline-editable when the prescription is uniform; when it
 * varies between sets, the aggregate cell shows "Varies" and clicking
 * the row's chevron expands an inline per-set editor underneath so the
 * user can edit every set individually. Only one row expands at a
 * time — clicking another row collapses the first.
 *
 * External API (`onUpdateSet` / `onAddSet` / `onDeleteSet`) is
 * unchanged so both the logged-workout path and the plan-day "Mark
 * complete" path keep working.
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
}: ExerciseTableProps) {
  const groups = useMemo(() => groupExerciseSets(exerciseSets), [exerciseSets]);
  // Stable per-group identity for @dnd-kit — matches the React `key` used
  // below so `SortableContext` items align with the rendered rows. When a
  // row is brand-new and its first-set id hasn't landed yet we fall back
  // to a name/label composite; it's unique per render and the row
  // reconciles to the id once the add mutation returns.
  const rowKeys = useMemo(
    () =>
      groups.map(
        (g) => g.sets[0]?.id ?? `${g.exerciseName}:${g.customLabel ?? ""}`,
      ),
    [groups],
  );

  // 8 px activation distance matches useWorkoutSensors — taps on the
  // chevron / ⋮ menu / expand-summary button don't get hijacked as drags.
  // Keyboard sensor gives a11y (Tab → Space → ↑/↓ → Space) for free.
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const handleDragEnd = useCallback(
    (event: DragEndEvent) => {
      const { active, over } = event;
      if (!over || active.id === over.id) return;
      const oldIndex = rowKeys.indexOf(active.id as string);
      const newIndex = rowKeys.indexOf(over.id as string);
      if (oldIndex < 0 || newIndex < 0) return;
      // Move a whole group (all its sets) at once. Then walk the flat
      // set sequence and reassign contiguous `sortOrder` values; only
      // the sets whose position actually changed get a PATCH so a
      // two-row swap doesn't fan out across every set in the table.
      const nextGroups = arrayMove(groups, oldIndex, newIndex);
      let order = 0;
      for (const g of nextGroups) {
        for (const s of g.sets) {
          if (s.sortOrder !== order) {
            onUpdateSet(s.id, { sortOrder: order });
          }
          order += 1;
        }
      }
    },
    [groups, rowKeys, onUpdateSet],
  );
  // Multiple rows can be expanded at once — matches WorkoutExerciseMode's
  // Set<string> pattern so adding a new row (auto-expanded below) doesn't
  // collapse whatever the user was editing.
  const [expandedKeys, setExpandedKeys] = useState<Set<string>>(() => new Set());
  const [addPickerOpen, setAddPickerOpen] = useState(false);
  // Identity of the most-recently-added exercise. The row key we care about
  // (first set id) only exists once the mutation lands, so we reconcile
  // pending expansion during render: as soon as a group matching the identity
  // appears in `groups`, expand it and clear the pending marker. Render-time
  // reconciliation is the codebase convention to satisfy the
  // react-hooks/set-state-in-effect rule.
  const [pendingExpand, setPendingExpand] = useState<{
    exerciseName: string;
    customLabel: string | null;
  } | null>(null);

  if (pendingExpand) {
    // `groupExerciseSets` groups by *contiguous* sortOrder, so the same
    // exercise name can appear in multiple groups. Add always appends to
    // the end of the list, so match from the tail to pick the newly added
    // group — not an earlier occurrence of the same exercise.
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
    setExpandedKeys((prev) => {
      const next = new Set(prev);
      if (next.has(rowKey)) next.delete(rowKey);
      else next.add(rowKey);
      return next;
    });
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

      {groups.length === 0 ? (
        <EmptyExerciseState
          onAdd={() => setAddPickerOpen(true)}
          hasUnparsedText={hasUnparsedText ?? false}
        />
      ) : (
        <div className="divide-y divide-border rounded-lg border border-border">
          <DndContext
            sensors={sensors}
            collisionDetection={closestCenter}
            onDragEnd={handleDragEnd}
          >
            <SortableContext items={rowKeys} strategy={verticalListSortingStrategy}>
              {groups.map((group, idx) => {
                const rowKey = rowKeys[idx];
                const isExpanded = expandedKeys.has(rowKey);

                return (
                  <SortableGroupRow
                    key={rowKey}
                    rowKey={rowKey}
                    group={group}
                    weightUnit={weightUnit}
                    distanceUnit={distanceUnit}
                    isExpanded={isExpanded}
                    onToggle={toggleExpanded}
                    onUpdateSet={onUpdateSet}
                    onAddSet={onAddSet}
                    onDeleteSet={onDeleteSet}
                  />
                );
              })}
            </SortableContext>
          </DndContext>
        </div>
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

function AddExerciseDialog({
  open,
  onOpenChange,
  onPick,
  onAddCustom,
}: Readonly<{
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onPick: (name: ExerciseName) => void;
  onAddCustom: () => void;
}>) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg" data-testid="exercise-add-dialog">
        <DialogHeader>
          <DialogTitle>Add exercise</DialogTitle>
          <DialogDescription>
            Pick an exercise from the catalog, or add a custom one.
          </DialogDescription>
        </DialogHeader>
        <div className="max-h-[60vh] overflow-y-auto pr-1">
          <ExerciseSelector selectedExercises={[]} onToggle={onPick} />
        </div>
        <div className="flex items-center justify-between border-t border-border pt-3">
          <span className="text-xs text-muted-foreground">
            Can't find it? Add a custom one.
          </span>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={onAddCustom}
            data-testid="exercise-add-custom"
          >
            <Plus className="mr-1 size-3.5" aria-hidden />
            Add custom exercise
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function EmptyExerciseState({
  onAdd,
  hasUnparsedText,
}: Readonly<{ onAdd: () => void; hasUnparsedText: boolean }>) {
  if (hasUnparsedText) {
    return (
      <div
        className="flex flex-col items-center gap-2 rounded-lg border border-dashed border-border px-4 py-6 text-center text-sm text-muted-foreground"
        data-testid="exercise-table-empty-parse-hint"
      >
        <span><strong className="font-medium text-foreground">Description captured.</strong> No exercise rows yet.</span>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={onAdd}
          data-testid="exercise-table-empty-add"
        >
          <Plus className="mr-1 size-3.5" aria-hidden />
          Add manually
        </Button>
      </div>
    );
  }
  return (
    <div className="flex flex-col items-center gap-2 rounded-lg border border-dashed border-border px-4 py-6 text-center text-sm text-muted-foreground">
      <span>No exercises yet.</span>
      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={onAdd}
        data-testid="exercise-table-empty-add"
      >
        <Plus className="mr-1 size-3.5" aria-hidden />
        Add exercise
      </Button>
    </div>
  );
}

type SortableAttrs = ReturnType<typeof useSortable>;

interface DragHandleProps {
  readonly attributes: SortableAttrs["attributes"];
  readonly listeners: SortableAttrs["listeners"];
}

interface GroupRowProps {
  readonly rowKey: string;
  readonly group: GroupedExercise;
  readonly weightUnit: "kg" | "lb";
  readonly distanceUnit: "km" | "miles";
  readonly isExpanded: boolean;
  readonly onToggle: (rowKey: string) => void;
  readonly onUpdateSet: (setId: string, data: PatchExerciseSetPayload) => void;
  readonly onAddSet: (data: AddExerciseSetPayload) => void;
  readonly onDeleteSet: (setId: string) => void;
  /**
   * Sortable attrs + listeners forwarded from `SortableGroupRow`. Applied
   * to the leading `GripVertical` button so the handle — and only the
   * handle — initiates drag. Optional so legacy tests can render
   * `GroupRow` without a `DndContext`; the handle renders inert there.
   */
  readonly dragHandleProps?: DragHandleProps;
}

function SortableGroupRow(props: GroupRowProps) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: props.rowKey });

  // Relative positioning + a raised z-index while dragging so the
  // floating row renders above its neighbours' divide-y borders.
  const style: CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.6 : 1,
    position: "relative",
    zIndex: isDragging ? 20 : undefined,
  };

  // Stable object identity so GroupRow's React.memo isn't busted by a
  // fresh `{ attributes, listeners }` literal on every parent render —
  // otherwise typing into one row's InlineSetEditor re-renders every
  // row in the table via its memoized GroupRow wrapper.
  const dragHandleProps = useMemo(
    () => ({ attributes, listeners }),
    [attributes, listeners],
  );

  return (
    <div ref={setNodeRef} style={style}>
      <GroupRow {...props} dragHandleProps={dragHandleProps} />
    </div>
  );
}

function DragHandle({
  dragHandleProps,
  label,
}: Readonly<{ dragHandleProps?: DragHandleProps; label: string }>) {
  if (!dragHandleProps) {
    // Keep the slot occupied so the row layout doesn't shift when a
    // test renders `GroupRow` directly without a sortable wrapper.
    return <span aria-hidden className="block w-4" />;
  }
  return (
    <button
      type="button"
      aria-label={`Reorder ${label}`}
      data-testid="exercise-row-drag-handle"
      className="-ml-1 flex h-7 w-6 shrink-0 cursor-grab touch-none items-center justify-center rounded text-muted-foreground hover:text-foreground active:cursor-grabbing focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
      {...dragHandleProps.attributes}
      {...dragHandleProps.listeners}
    >
      <GripVertical className="size-4" aria-hidden />
    </button>
  );
}

const GroupRow = memo(function GroupRow({
  rowKey,
  group,
  weightUnit,
  distanceUnit,
  isExpanded,
  onToggle,
  onUpdateSet,
  onAddSet,
  onDeleteSet,
  dragHandleProps,
}: GroupRowProps) {
  const handleToggle = useCallback(() => onToggle(rowKey), [onToggle, rowKey]);
  const label = getExerciseLabel(group.exerciseName, group.customLabel);
  const color = categoryColor(group.category);
  const lowConfidence = typeof group.confidence === "number" && group.confidence < 60;
  const [changeExerciseOpen, setChangeExerciseOpen] = useState(false);
  const uniformity = useMemo(() => computeUniformity(group.sets), [group.sets]);
  const setCount = group.sets.length;

  // Resolve the primary metric (reps / distance / time) from the
  // exercise definition — NOT from value presence. Time-only exercises
  // (e.g. battle_ropes) would otherwise fall back to "reps" and
  // silently misroute every edit through the wrong column.
  const metric = useMemo(
    () => resolvePrimaryMetric(group.exerciseName, uniformity, distanceUnit),
    [group.exerciseName, uniformity, distanceUnit],
  );
  const hasWeight = useMemo(
    () => shouldShowLoad(group, metric.field),
    [group, metric.field],
  );
  const loadVaries = uniformity.weightVaries;

  const handleDeleteRow = () => {
    for (const s of group.sets) onDeleteSet(s.id);
  };

  const handlePickExercise = (name: ExerciseName) => {
    const def = EXERCISE_DEFINITIONS[name];
    // Fan-out the swap across every set in the group so they stay grouped.
    // `customLabel: null` clears any override from a prior rename so the new
    // exercise's canonical label shows.
    for (const s of group.sets) {
      onUpdateSet(s.id, {
        exerciseName: name,
        category: def.category,
        customLabel: null,
      });
    }
    setChangeExerciseOpen(false);
  };

  const prescription = formatPrescription({
    setCount,
    metricValue: metric.value,
    metricSuffix: metric.suffix ?? "",
    metricVaries: metric.varies,
    weightValue: uniformity.weight,
    weightUnit,
    weightVaries: loadVaries,
    hasWeight,
  });
  const prescriptionSegments = prescription.visual.map((seg) => (
    <PrescriptionSegment key={seg.separator ?? "sets"} segment={seg} />
  ));

  const changeExerciseItem = (
    <DropdownMenuItem
      onSelect={() => setChangeExerciseOpen(true)}
      data-testid="exercise-row-change"
    >
      <Repeat className="mr-2 size-4" aria-hidden /> Change exercise
    </DropdownMenuItem>
  );
  const deleteItem = (
    <DropdownMenuItem onSelect={handleDeleteRow} className="text-destructive">
      <Trash2 className="mr-2 size-4" aria-hidden /> Delete
    </DropdownMenuItem>
  );

  return (
    <div className="flex flex-col" data-testid="exercise-row" data-row-key={group.sets[0]?.id}>
      {/*
       * Two-line summary used at every width: name + colored dot on line
       * 1, human-readable prescription ("2 × 6 reps · 150 lb") on line
       * 2. Editing happens inside the expanded InlineSetEditor so the
       * same interaction works on phone and desktop.
       */}
      <div className="text-sm">
        <div className="flex items-center gap-2 px-3 py-2 sm:px-4 sm:py-3">
          <DragHandle dragHandleProps={dragHandleProps} label={label} />
          <span
            aria-hidden
            className="inline-block size-2 shrink-0 rounded-full"
            style={{ backgroundColor: color }}
          />
          <span
            className={cn(
              "min-w-0 flex-1 truncate font-medium",
              lowConfidence && "text-muted-foreground",
            )}
            title={lowConfidence ? "Low-confidence parse — expand to review" : label}
          >
            {label}
          </span>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="size-8 text-muted-foreground"
            aria-label={isExpanded ? `Collapse ${label}` : `Expand ${label}`}
            aria-expanded={isExpanded}
            onClick={handleToggle}
            data-testid="exercise-row-toggle"
          >
            <ChevronDown
              className={cn("size-4 transition-transform", isExpanded && "rotate-180")}
              aria-hidden
            />
          </Button>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className="size-8 text-muted-foreground"
                aria-label={`Row actions for ${label}`}
                data-testid="exercise-row-actions"
              >
                <MoreVertical className="size-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              {changeExerciseItem}
              <DropdownMenuSeparator />
              {deleteItem}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
        {/*
         * Summary is only shown when the row is collapsed. When expanded,
         * the InlineSetEditor below surfaces the same values in editable
         * form, so the summary would be redundant — and an "Edit …"
         * button wired to onToggle would misleadingly collapse the
         * editor when tapped.
         */}
        {!isExpanded && (
          <button
            type="button"
            onClick={handleToggle}
            aria-label={`Edit ${label}: ${prescription.aria}`}
            className="flex w-full items-center gap-1.5 px-3 pb-2 pl-[50px] text-left text-xs text-muted-foreground sm:px-4 sm:pb-3 sm:pl-[54px] sm:text-sm"
          >
            {prescriptionSegments}
          </button>
        )}
      </div>

      {isExpanded && (
        <div className="border-t border-border bg-muted/20 px-4 py-3">
          <InlineSetEditor
            sets={group.sets}
            exerciseName={group.exerciseName}
            customLabel={group.customLabel}
            category={group.category}
            weightUnit={weightUnit}
            distanceUnit={distanceUnit}
            onUpdateSet={onUpdateSet}
            onAddSet={onAddSet}
            onDeleteSet={onDeleteSet}
          />
        </div>
      )}

      <Dialog open={changeExerciseOpen} onOpenChange={setChangeExerciseOpen}>
        <DialogContent className="max-w-lg" data-testid="exercise-change-dialog">
          <DialogHeader>
            <DialogTitle>Change exercise</DialogTitle>
            <DialogDescription>
              Replace {label} with another exercise. Your reps, weight, and other set
              values stay the same.
            </DialogDescription>
          </DialogHeader>
          <div className="max-h-[60vh] overflow-y-auto pr-1">
            <ExerciseSelector selectedExercises={[]} onToggle={handlePickExercise} />
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
});

function PrescriptionSegment({ segment }: Readonly<{ segment: VisualSegment }>) {
  return (
    <>
      {segment.separator && (
        <span aria-hidden className="text-muted-foreground/60">
          {segment.separator === "times" ? "×" : "·"}
        </span>
      )}
      <span>{segment.text}</span>
    </>
  );
}

interface UniformitySummary {
  readonly reps: number | null;
  readonly repsVaries: boolean;
  readonly weight: number | null;
  readonly weightVaries: boolean;
  readonly distance: number | null;
  readonly distanceVaries: boolean;
  readonly time: number | null;
  readonly timeVaries: boolean;
}

function computeUniformity(sets: readonly ExerciseSet[]): UniformitySummary {
  const first: ExerciseSet | undefined = sets[0];
  return {
    reps: first?.reps ?? null,
    repsVaries: hasVariance(sets, "reps"),
    weight: first?.weight ?? null,
    weightVaries: hasVariance(sets, "weight"),
    distance: first?.distance ?? null,
    distanceVaries: hasVariance(sets, "distance"),
    time: first?.time ?? null,
    timeVaries: hasVariance(sets, "time"),
  };
}

/**
 * True when any set in the group disagrees with the first on this
 * field. Extracted so `computeUniformity` stays under Sonar's
 * cognitive-complexity ceiling — the old in-lined version with four
 * ifs in the loop plus the combined break guard scored 17.
 */
function hasVariance(
  sets: readonly ExerciseSet[],
  field: "reps" | "weight" | "distance" | "time",
): boolean {
  if (sets.length <= 1) return false;
  const baseline = sets[0][field];
  for (let i = 1; i < sets.length; i++) {
    if (sets[i][field] !== baseline) return true;
  }
  return false;
}

type PrimaryField = "reps" | "distance" | "time";

interface PrimaryMetric {
  readonly field: PrimaryField;
  readonly value: number | null;
  readonly varies: boolean;
  readonly label: string;
  readonly suffix?: string;
}

interface MetricMeta {
  readonly label: string;
  readonly suffix?: (distanceUnit: "km" | "miles") => string;
  readonly valueKey: "reps" | "distance" | "time";
  readonly variesKey: "repsVaries" | "distanceVaries" | "timeVaries";
}

// Table-driven: avoids nested ternaries, centralises the per-field
// display metadata, and keeps `resolvePrimaryMetric` as a single
// lookup. Static property keys (rather than computed template
// literals) keep the indexing both type-safe and lint-clean.
// Distance suffix is a function of the user's distanceUnit preference —
// mirrors `fieldMeta.ts` so miles users see "ft" instead of "m".
const METRIC_META: Readonly<Record<PrimaryField, MetricMeta>> = {
  reps: { label: "Reps", suffix: () => "reps", valueKey: "reps", variesKey: "repsVaries" },
  distance: {
    label: "Distance",
    suffix: (du) => (du === "km" ? "m" : "ft"),
    valueKey: "distance",
    variesKey: "distanceVaries",
  },
  time: { label: "Time", suffix: () => "min", valueKey: "time", variesKey: "timeVaries" },
};

const METRIC_PRIORITY: readonly PrimaryField[] = ["reps", "distance", "time"];

/**
 * The exercise's definition is the source of truth for which metric
 * shows in the middle column. Priority: reps > distance > time >
 * reps (fallback if none of the three are in the definition).
 * Deriving from value-presence would silently miswire time-only
 * exercises (battle_ropes, etc.) into reps edits.
 *
 * EXCEPT for custom exercises — those declare every field, so the
 * definition can't tell us which metric is actually meaningful.
 * Fall back to value-presence there (distance > time > reps) so a
 * custom "Interval Run" with reps=1 + distance=5000 rolls up the
 * distance instead of the reps placeholder.
 */
function resolvePrimaryMetric(
  exerciseName: string,
  u: UniformitySummary,
  distanceUnit: "km" | "miles",
): PrimaryMetric {
  const field = pickPrimaryField(exerciseName, u);
  const meta = METRIC_META[field];
  return {
    field,
    value: u[meta.valueKey],
    varies: u[meta.variesKey],
    label: meta.label,
    suffix: meta.suffix?.(distanceUnit),
  };
}

function pickPrimaryField(exerciseName: string, u: UniformitySummary): PrimaryField {
  if (exerciseName === "custom") {
    if (u.distance != null) return "distance";
    if (u.time != null) return "time";
    return "reps";
  }
  const fields: readonly FieldKey[] = getFields(exerciseName);
  return METRIC_PRIORITY.find((m) => fields.includes(m)) ?? "reps";
}

/**
 * Whether the aggregate Load cell should render as an editable input
 * vs. the "—" dash. Three-state decision:
 *   1. Exercise definition doesn't list `weight` → always dash.
 *   2. Weight is the primary logging axis (reps-primary strength
 *      movements like `back_squat`, `kettlebell_swings`) → always
 *      editable, even before the first weight is entered, so users
 *      can type the prescribed load inline.
 *   3. Weight is a secondary annotation (distance- or time-primary
 *      exercises like `sled_push`, `farmers_carry`, and custom rows
 *      primary-resolved to distance/time) → editable only once at
 *      least one set has a weight value. Otherwise render the dash
 *      so a distance-only prescription doesn't show a phantom `lb`
 *      input that implies "you must fill this in".
 */
function shouldShowLoad(group: GroupedExercise, primaryField: PrimaryField): boolean {
  const fields = getFields(group.exerciseName);
  if (!fields.includes("weight")) return false;
  if (primaryField === "reps") return true;
  return group.sets.some((s) => s.weight != null);
}

