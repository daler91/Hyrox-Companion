import type { ExerciseSet } from "@shared/schema";
import { ChevronDown, MoreVertical, Plus, Trash2 } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { type FieldKey, getFields } from "@/components/exercise-row/fieldMeta";
import { InlineSetEditor } from "@/components/exercise-row/InlineSetEditor";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { useDebouncedCallback } from "@/hooks/useDebouncedCallback";
import type { AddExerciseSetPayload, PatchExerciseSetPayload } from "@/lib/api";
import { categoryColor } from "@/lib/categoryColors";
import { getExerciseLabel, type GroupedExercise,groupExerciseSets } from "@/lib/exerciseUtils";
import { cn } from "@/lib/utils";

const AGG_DEBOUNCE_MS = 350;
// Debounce window for set-count changes. Longer than cell writes so a
// mid-typed "10" isn't interpreted as "1" first (which would fire
// one-set deletes before the intended value lands).
const SET_COUNT_DEBOUNCE_MS = 500;
const MIN_SETS = 1;
const MAX_SETS = 50;
// Grid columns: label | sets | primary metric (reps/dist/time) | load | chevron | menu.
const GRID_TEMPLATE =
  "grid grid-cols-[1fr_60px_90px_110px_32px_32px] items-center gap-2 px-3 py-2";

interface ExerciseTableProps {
  readonly workoutId: string;
  readonly exerciseSets: ExerciseSet[];
  readonly weightUnit: "kg" | "lb";
  readonly onUpdateSet: (setId: string, data: PatchExerciseSetPayload) => void;
  readonly onAddSet: (data: AddExerciseSetPayload) => void;
  readonly onDeleteSet: (setId: string) => void;
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
  onUpdateSet,
  onAddSet,
  onDeleteSet,
}: ExerciseTableProps) {
  const groups = useMemo(() => groupExerciseSets(exerciseSets), [exerciseSets]);
  const [expandedKey, setExpandedKey] = useState<string | null>(null);

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
        <div className="divide-y divide-border rounded-lg border border-border">
          <HeaderRow />
          {groups.map((group) => {
            const rowKey = group.sets[0]?.id ?? `${group.exerciseName}:${group.customLabel ?? ""}`;
            const isExpanded = expandedKey === rowKey;

            return (
              <GroupRow
                key={rowKey}
                group={group}
                weightUnit={weightUnit}
                isExpanded={isExpanded}
                onToggle={() => setExpandedKey((prev) => (prev === rowKey ? null : rowKey))}
                onUpdateSet={onUpdateSet}
                onAddSet={onAddSet}
                onDeleteSet={onDeleteSet}
              />
            );
          })}
        </div>
      )}
    </section>
  );
}

function HeaderRow() {
  return (
    <div
      className={cn(
        GRID_TEMPLATE,
        "border-b border-border bg-muted/40 text-xs font-medium uppercase tracking-wide text-muted-foreground",
      )}
    >
      <span>Exercise</span>
      <span className="text-right">Sets</span>
      <span className="text-right">Reps</span>
      <span className="text-right">Load</span>
      <span className="sr-only">Expand</span>
      <span className="sr-only">Actions</span>
    </div>
  );
}

function EmptyExerciseState() {
  return (
    <div className="rounded-lg border border-dashed border-border px-4 py-6 text-center text-sm text-muted-foreground">
      No exercises yet. Tap <span className="font-medium">+ Add</span> to log one.
    </div>
  );
}

interface GroupRowProps {
  readonly group: GroupedExercise;
  readonly weightUnit: "kg" | "lb";
  readonly isExpanded: boolean;
  readonly onToggle: () => void;
  readonly onUpdateSet: (setId: string, data: PatchExerciseSetPayload) => void;
  readonly onAddSet: (data: AddExerciseSetPayload) => void;
  readonly onDeleteSet: (setId: string) => void;
}

function GroupRow({
  group,
  weightUnit,
  isExpanded,
  onToggle,
  onUpdateSet,
  onAddSet,
  onDeleteSet,
}: GroupRowProps) {
  const label = getExerciseLabel(group.exerciseName, group.customLabel);
  const color = categoryColor(group.category);
  const lowConfidence = typeof group.confidence === "number" && group.confidence < 60;
  const uniformity = useMemo(() => computeUniformity(group.sets), [group.sets]);
  const setCount = group.sets.length;

  // Resolve the primary metric (reps / distance / time) from the
  // exercise definition — NOT from value presence. Time-only exercises
  // (e.g. battle_ropes) would otherwise fall back to "reps" and
  // silently misroute every edit through the wrong column.
  const metric = useMemo(
    () => resolvePrimaryMetric(group.exerciseName, uniformity),
    [group.exerciseName, uniformity],
  );
  const hasWeight = useMemo(() => shouldShowLoad(group), [group]);
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

  return (
    <div className="flex flex-col" data-testid="exercise-row" data-row-key={group.sets[0]?.id}>
      <div className={cn(GRID_TEMPLATE, "text-sm")}>
        <ExerciseLabel label={label} color={color} lowConfidence={lowConfidence} />

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
            <DropdownMenuItem onSelect={handleDeleteRow} className="text-destructive">
              <Trash2 className="mr-2 size-4" aria-hidden /> Delete
            </DropdownMenuItem>
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
            onUpdateSet={onUpdateSet}
            onAddSet={onAddSet}
            onDeleteSet={onDeleteSet}
          />
        </div>
      )}
    </div>
  );
}

function ExerciseLabel({
  label,
  color,
  lowConfidence,
}: Readonly<{ label: string; color: string; lowConfidence: boolean }>) {
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
        className="h-8 w-16 text-right tabular-nums"
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
  readonly suffix?: string;
  readonly valueKey: "reps" | "distance" | "time";
  readonly variesKey: "repsVaries" | "distanceVaries" | "timeVaries";
}

// Table-driven: avoids nested ternaries, centralises the per-field
// display metadata, and keeps `resolvePrimaryMetric` as a single
// lookup. Static property keys (rather than computed template
// literals) keep the indexing both type-safe and lint-clean.
const METRIC_META: Readonly<Record<PrimaryField, MetricMeta>> = {
  reps: { label: "Reps", valueKey: "reps", variesKey: "repsVaries" },
  distance: { label: "Distance", suffix: "m", valueKey: "distance", variesKey: "distanceVaries" },
  time: { label: "Time", suffix: "min", valueKey: "time", variesKey: "timeVaries" },
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
function resolvePrimaryMetric(exerciseName: string, u: UniformitySummary): PrimaryMetric {
  const field = pickPrimaryField(exerciseName, u);
  const meta = METRIC_META[field];
  return {
    field,
    value: u[meta.valueKey],
    varies: u[meta.variesKey],
    label: meta.label,
    suffix: meta.suffix,
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
 * Whether the aggregate Load cell should render. Non-custom
 * exercises key off the definition's field list. Custom exercises
 * declare every field, so additionally require that at least one
 * set has an actual weight — otherwise a custom running exercise
 * would surface a misleading empty Load input.
 */
function shouldShowLoad(group: GroupedExercise): boolean {
  const fields = getFields(group.exerciseName);
  if (!fields.includes("weight")) return false;
  if (group.exerciseName !== "custom") return true;
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
