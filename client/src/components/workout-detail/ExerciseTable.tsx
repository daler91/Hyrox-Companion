import { EXERCISE_DEFINITIONS, type ExerciseName, type ExerciseSet } from "@shared/schema";
import { ChevronDown, MoreVertical, Plus, Repeat, Trash2 } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

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
import { Input } from "@/components/ui/input";
import { useDebouncedCallback } from "@/hooks/useDebouncedCallback";
import type { AddExerciseSetPayload, PatchExerciseSetPayload } from "@/lib/api";
import { categoryColor } from "@/lib/categoryColors";
import { getExerciseLabel, type GroupedExercise,groupExerciseSets } from "@/lib/exerciseUtils";
import { cn } from "@/lib/utils";

import { SaveFlashBadge, type SaveState, SaveStatePill } from "./SaveStatePill";

const AGG_DEBOUNCE_MS = 350;
// Debounce window for set-count changes. Longer than cell writes so a
// mid-typed "10" isn't interpreted as "1" first (which would fire
// one-set deletes before the intended value lands).
const SET_COUNT_DEBOUNCE_MS = 500;
const MIN_SETS = 1;
const MAX_SETS = 50;
// Grid columns: label | sets | primary metric (reps/dist/time) | load | chevron | menu.
// Mobile keeps the metric + load cells tight so the label column fits
// two-word exercise names at ~360px viewports; `sm:` breakpoint restores
// the 120px cells that comfortably fit 4-digit inputs + unit.
const GRID_TEMPLATE =
  "grid grid-cols-[1fr_52px_84px_84px_28px_28px] sm:grid-cols-[1fr_60px_120px_120px_32px_32px] items-center gap-2 px-2 sm:px-3 py-2";

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

  // Track the timestamp of the most recent successful mutation per row so
  // GroupRow can flash its own "Saved" badge — per-row feedback is the only
  // way a user knows *which* cell just persisted when several are edited in
  // quick succession. Keyed on the first set's id, matching `expandedKey`.
  const [savedAtByRow, setSavedAtByRow] = useState<Record<string, number>>({});
  const markRowSaved = useCallback((rowKey: string | undefined) => {
    if (!rowKey) return;
    setSavedAtByRow((prev) => ({ ...prev, [rowKey]: Date.now() }));
  }, []);

  const pickRowKeyForSet = useCallback(
    (setId: string): string | undefined => {
      for (const g of groups) {
        const first = g.sets[0];
        if (!first) continue;
        if (g.sets.some((s) => s.id === setId)) return first.id;
      }
      return undefined;
    },
    [groups],
  );

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
          <HeaderRow />
          {groups.map((group) => {
            const rowKey = group.sets[0]?.id ?? `${group.exerciseName}:${group.customLabel ?? ""}`;
            const isExpanded = expandedKeys.has(rowKey);

            return (
              <GroupRow
                key={rowKey}
                group={group}
                weightUnit={weightUnit}
                distanceUnit={distanceUnit}
                isExpanded={isExpanded}
                rowSavedAt={savedAtByRow[rowKey] ?? null}
                onToggle={() => toggleExpanded(rowKey)}
                onUpdateSet={(setId, data) => {
                  onUpdateSet(setId, data);
                  markRowSaved(pickRowKeyForSet(setId) ?? rowKey);
                }}
                onAddSet={(data) => {
                  onAddSet(data);
                  markRowSaved(rowKey);
                }}
                onDeleteSet={(setId) => {
                  onDeleteSet(setId);
                  markRowSaved(pickRowKeyForSet(setId) ?? rowKey);
                }}
              />
            );
          })}
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

function HeaderRow() {
  return (
    <div
      className={cn(
        GRID_TEMPLATE,
        // Hidden on mobile: the new two-line row layout is self-describing
        // (name on its own line, labelled prescription summary below), so
        // a header labelled against the desktop 6-column grid would no
        // longer align with what renders beneath it.
        "hidden sm:grid",
        "border-b border-border bg-muted/40 text-xs font-medium uppercase tracking-wide text-muted-foreground",
      )}
    >
      <span>Exercise</span>
      <span className="text-right">Sets</span>
      {/*
       * Primary-metric column header intentionally blank — the
       * actual metric (Reps / Distance / Time) varies per row
       * depending on the exercise definition, so a static label
       * would be wrong for some rows. Each cell's unit suffix
       * ("m", "min", "reps") carries the meaning. `aria-hidden`
       * with a nbsp keeps the span in grid flow so the Load
       * header below stays in column 4; `sr-only` would pull
       * this element out of flow (position: absolute) and
       * auto-placement would shift Load into column 3.
       */}
      <span aria-hidden className="text-right">&nbsp;</span>
      <span className="text-right">Load</span>
      <span className="sr-only">Expand</span>
      <span className="sr-only">Actions</span>
    </div>
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
        <span>Tap <strong className="font-medium text-foreground">Parse</strong> above to extract exercises from the description.</span>
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

interface GroupRowProps {
  readonly group: GroupedExercise;
  readonly weightUnit: "kg" | "lb";
  readonly distanceUnit: "km" | "miles";
  readonly isExpanded: boolean;
  /** Epoch-ms of the latest successful mutation targeting this row, or null. */
  readonly rowSavedAt: number | null;
  readonly onToggle: () => void;
  readonly onUpdateSet: (setId: string, data: PatchExerciseSetPayload) => void;
  readonly onAddSet: (data: AddExerciseSetPayload) => void;
  readonly onDeleteSet: (setId: string) => void;
}

function GroupRow({
  group,
  weightUnit,
  distanceUnit,
  isExpanded,
  rowSavedAt,
  onToggle,
  onUpdateSet,
  onAddSet,
  onDeleteSet,
}: GroupRowProps) {
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

  // Refs mirroring the latest props so the debounced set-count timer
  // reads live state when it fires — see Codex P1. Without these, a
  // user who typed a new set count and then used the inline "Add
  // set" button before the 500ms timer landed would get a wrong diff
  // (stale snapshot's `sets.length` ≠ current length). React's
  // refs-during-render rule means we sync inside an effect.
  const groupRef = useRef(group);
  const onAddSetRef = useRef(onAddSet);
  const onDeleteSetRef = useRef(onDeleteSet);
  useEffect(() => {
    groupRef.current = group;
    onAddSetRef.current = onAddSet;
    onDeleteSetRef.current = onDeleteSet;
  }, [group, onAddSet, onDeleteSet]);

  // Fan-out writes: an aggregate edit only fires when the prescription
  // is uniform, so writing the same value to every set keeps them in
  // sync without flattening a variable prescription.
  const debouncedFanout = useDebouncedCallback((patch: PatchExerciseSetPayload) => {
    for (const s of group.sets) onUpdateSet(s.id, patch);
  }, AGG_DEBOUNCE_MS);

  // Set-count changes mutate the group structurally (add/delete set
  // rows). `useDebouncedCallback` flushes on unmount, which would race
  // a row-delete: if the user types a new count and then clicks ⋮ →
  // Delete within the debounce window, the unmount flush would
  // recreate sets after the delete mutation started. Use a raw
  // ref-based timer so we can cancel without flushing.
  const setCountTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const cancelPendingSetCount = useCallback(() => {
    if (setCountTimerRef.current !== null) {
      clearTimeout(setCountTimerRef.current);
      setCountTimerRef.current = null;
    }
  }, []);
  useEffect(() => cancelPendingSetCount, [cancelPendingSetCount]);

  const handleSetCountChange = (next: number | null) => {
    // Cancel any in-flight timer up front so a revert ("1" → "10" → "1")
    // or a cleared input discards the queued mutation that no longer
    // reflects the user's intent.
    cancelPendingSetCount();
    if (next == null) return;
    const clamped = Math.min(MAX_SETS, Math.max(MIN_SETS, Math.round(next)));
    if (clamped === setCount) return;
    setCountTimerRef.current = setTimeout(() => {
      setCountTimerRef.current = null;
      // Read latest group/handlers at fire time — an inline "Add set"
      // or per-set delete between typing and the 500ms flush would
      // otherwise produce a diff against a stale `sets.length`.
      const latestGroup = groupRef.current;
      if (latestGroup.sets.length === 0) return;
      applySetCountChange(
        latestGroup,
        clamped,
        onAddSetRef.current,
        onDeleteSetRef.current,
      );
    }, SET_COUNT_DEBOUNCE_MS);
  };

  const handleDeleteRow = () => {
    // Kill any queued set-count change before we tear the group down
    // so a pending add doesn't recreate sets after the delete.
    cancelPendingSetCount();
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
       * Mobile two-line layout: name gets the full row width on line 1;
       * a human-readable prescription ("2 × 6 reps · 150 lb") sits on
       * line 2 so the sets count can't be mistaken for part of the name.
       * Editing happens inside the expanded InlineSetEditor — cramming
       * three inline number inputs onto a 360 px viewport is what caused
       * the 2-letter name truncation in the first place.
       */}
      <div className="text-sm sm:hidden">
        <div className="flex items-center gap-2 px-3 py-2">
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
          {rowSavedAt != null && (
            <SaveFlashBadge key={rowSavedAt} testId="exercise-row-saved-mobile" />
          )}
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="size-8 text-muted-foreground"
            aria-label={isExpanded ? `Collapse ${label}` : `Expand ${label}`}
            aria-expanded={isExpanded}
            onClick={onToggle}
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
        <button
          type="button"
          onClick={onToggle}
          aria-label={`Edit ${label}: ${prescription.aria}`}
          className="flex w-full items-center gap-1.5 px-3 pb-2 pl-[22px] text-left text-xs text-muted-foreground"
        >
          {prescription.visual.map((seg) => (
            <PrescriptionSegment key={seg.separator ?? "sets"} segment={seg} />
          ))}
        </button>
      </div>

      <div className={cn(GRID_TEMPLATE, "hidden text-sm sm:grid")}>
        <ExerciseLabel
          label={label}
          color={color}
          lowConfidence={lowConfidence}
          rowSavedAt={rowSavedAt}
        />

        <AggregateCell
          value={setCount}
          min={MIN_SETS}
          max={MAX_SETS}
          ariaLabel={`Sets for ${label}`}
          onChange={handleSetCountChange}
        />

        <AggregateCell
          value={metric.value}
          ariaLabel={`${metric.label} for ${label}`}
          suffix={metric.suffix}
          varies={metric.varies}
          onExpandForVariable={onToggle}
          onChange={(next) => debouncedFanout({ [metric.field]: next } as PatchExerciseSetPayload)}
        />

        {hasWeight ? (
          <AggregateCell
            value={uniformity.weight}
            ariaLabel={`Load for ${label}`}
            suffix={weightUnit}
            varies={loadVaries}
            onExpandForVariable={onToggle}
            onChange={(next) => debouncedFanout({ weight: next })}
          />
        ) : (
          <span
            className="text-right text-xs text-muted-foreground"
            aria-label={`${label} has no load`}
          >
            —
          </span>
        )}

        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="size-7 text-muted-foreground"
          aria-label={isExpanded ? `Collapse ${label}` : `Expand ${label}`}
          aria-expanded={isExpanded}
          onClick={onToggle}
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
              className="size-7 text-muted-foreground"
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
}

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

function ExerciseLabel({
  label,
  color,
  lowConfidence,
  rowSavedAt,
}: Readonly<{ label: string; color: string; lowConfidence: boolean; rowSavedAt: number | null }>) {
  return (
    <div className="flex min-w-0 items-center gap-2">
      <span
        aria-hidden
        className="inline-block size-2 shrink-0 rounded-full"
        style={{ backgroundColor: color }}
      />
      <span
        className={cn("truncate font-medium", lowConfidence && "text-muted-foreground")}
        title={lowConfidence ? "Low-confidence parse — expand to review" : label}
      >
        {label}
      </span>
      {rowSavedAt != null && (
        <SaveFlashBadge key={rowSavedAt} testId="exercise-row-saved" />
      )}
    </div>
  );
}

interface AggregateCellProps {
  readonly value: number | null | undefined;
  readonly ariaLabel: string;
  readonly min?: number;
  readonly max?: number;
  readonly suffix?: string;
  /**
   * True when the sets in this group disagree on this field — we can't
   * safely show one editable value. The cell renders a "Varies" badge
   * that opens the inline per-set editor instead.
   */
  readonly varies?: boolean;
  readonly onExpandForVariable?: () => void;
  readonly onChange?: (next: number | null) => void;
}

function AggregateCell({
  value,
  ariaLabel,
  min = 0,
  max,
  suffix,
  varies,
  onExpandForVariable,
  onChange,
}: AggregateCellProps) {
  if (varies) {
    return (
      <button
        type="button"
        onClick={onExpandForVariable}
        className="flex items-center justify-end gap-1 text-xs text-muted-foreground hover:text-foreground"
        aria-label={`${ariaLabel} varies between sets — open per-set editor`}
        data-testid="exercise-cell-varies"
      >
        <span className="rounded bg-muted px-1.5 py-0.5 font-medium uppercase tracking-wide">
          Varies
        </span>
      </button>
    );
  }
  return (
    <NumberCell
      value={value ?? null}
      ariaLabel={ariaLabel}
      min={min}
      max={max}
      suffix={suffix}
      onChange={(next) => onChange?.(next)}
    />
  );
}

interface NumberCellProps {
  readonly value: number | null;
  readonly ariaLabel: string;
  readonly min?: number;
  readonly max?: number;
  readonly suffix?: string;
  readonly onChange: (next: number | null) => void;
}

function NumberCell({ value, ariaLabel, min = 0, max, suffix, onChange }: NumberCellProps) {
  // Local draft so keystrokes feel immediate; on each change we parse +
  // forward to the debounced save. React's "reset state when props
  // change" pattern syncs incoming server / optimistic updates without
  // fighting an in-progress edit.
  const [draft, setDraft] = useState<string>(() => formatInitial(value));
  const [lastExternal, setLastExternal] = useState<number | null>(value);
  if (value !== lastExternal) {
    setLastExternal(value);
    setDraft(formatInitial(value));
  }

  return (
    <div className="flex items-center justify-end gap-1">
      <Input
        type="number"
        inputMode="decimal"
        value={draft}
        min={min}
        max={max}
        onChange={(e) => {
          setDraft(e.target.value);
          const next = parseDraft(e.target.value);
          if (next == null || !Number.isNaN(next)) {
            onChange(next);
          }
        }}
        aria-label={ariaLabel}
        // Explicit border + hover ring so the cell reads as an input even
        // at idle — previously the flat default made athletes think the
        // numbers were static. Focus ring comes from the base Input.
        className="h-8 flex-1 min-w-0 text-right tabular-nums border border-input hover:border-ring/60 transition-colors"
      />
      {suffix && <span className="shrink-0 text-xs text-muted-foreground">{suffix}</span>}
    </div>
  );
}

function formatInitial(v: number | null | undefined): string {
  if (v == null) return "";
  return String(v);
}

function parseDraft(raw: string): number | null {
  if (raw.trim() === "") return null;
  const n = Number.parseFloat(raw);
  return Number.isNaN(n) ? null : n;
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

function applySetCountChange(
  group: GroupedExercise,
  next: number,
  onAddSet: (data: AddExerciseSetPayload) => void,
  onDeleteSet: (setId: string) => void,
) {
  const current = group.sets.length;
  if (next > current) {
    addCopiedSets(group, next - current, onAddSet);
    return;
  }
  if (next < current) {
    trimTrailingSets(group, next, onDeleteSet);
  }
}

function highestSetNumber(sets: readonly ExerciseSet[]): number {
  let max = 0;
  for (const s of sets) {
    const n = s.setNumber;
    if (typeof n === "number" && n > max) max = n;
  }
  return max;
}

/**
 * Seed new rows from the *trailing* set (highest setNumber) so pyramid
 * / ramp prescriptions keep progressing instead of cloning the first
 * warm-up set. Matches the inline per-set "Add set" button's
 * behaviour.
 *
 * setNumbers advance from `max(existing setNumber) + 1` rather than
 * array length. After a middle-set delete that left sets [1, 3],
 * `length + 1` would collide with an existing set and the inline
 * editor's sort-by-setNumber would render duplicates with ambiguous
 * ordering.
 */
function addCopiedSets(
  group: GroupedExercise,
  count: number,
  onAddSet: (data: AddExerciseSetPayload) => void,
) {
  const ordered = [...group.sets].sort(bySetNumber);
  const template = ordered.at(-1);
  if (!template) return;
  let nextSetNumber = highestSetNumber(group.sets);
  for (let i = 0; i < count; i++) {
    nextSetNumber += 1;
    onAddSet({
      exerciseName: template.exerciseName,
      customLabel: template.customLabel,
      category: template.category,
      setNumber: nextSetNumber,
      reps: template.reps,
      weight: template.weight,
      distance: template.distance,
      time: template.time,
    });
  }
}

/**
 * Trim from the highest-setNumber end so set identity is preserved for
 * rows the user didn't ask to remove.
 */
function trimTrailingSets(
  group: GroupedExercise,
  keep: number,
  onDeleteSet: (setId: string) => void,
) {
  const ordered = [...group.sets].sort(bySetNumber);
  const toRemove = ordered.slice(keep);
  for (const s of toRemove) onDeleteSet(s.id);
}

function bySetNumber(a: ExerciseSet, b: ExerciseSet): number {
  return (a.setNumber ?? 0) - (b.setNumber ?? 0);
}
