import type { ExerciseSet } from "@shared/schema";
import { ChevronDown, MoreVertical, Plus, Trash2 } from "lucide-react";
import { useMemo, useState } from "react";

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
// Grid columns: label | sets | reps/dist | load | chevron | menu.
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
  const firstSet = group.sets[0];
  const setCount = group.sets.length;

  const repsField: "reps" | "distance" =
    uniformity.reps == null && uniformity.distance != null ? "distance" : "reps";
  const repsValue =
    repsField === "distance" ? uniformity.distance : uniformity.reps;
  const repsVaries =
    repsField === "distance" ? uniformity.distanceVaries : uniformity.repsVaries;
  const loadVaries = uniformity.weightVaries;

  // Fan-out writes: an aggregate edit only fires when the prescription
  // is uniform, so writing the same value to every set keeps them in
  // sync without flattening a variable prescription.
  const debouncedFanout = useDebouncedCallback((patch: PatchExerciseSetPayload) => {
    for (const s of group.sets) onUpdateSet(s.id, patch);
  }, AGG_DEBOUNCE_MS);

  const handleSetCountChange = (next: number | null) => {
    if (next == null || next === setCount || next < 1) return;
    applySetCountChange(group, Math.round(next), firstSet, onAddSet, onDeleteSet);
  };

  const handleDeleteRow = () => {
    for (const s of group.sets) onDeleteSet(s.id);
  };

  // Suffix shown next to the reps/distance cell. Weight column gets
  // the unit via its own suffix.
  const repsSuffix = repsField === "distance" ? "m" : undefined;

  return (
    <div className="flex flex-col" data-testid="exercise-row" data-row-key={group.sets[0]?.id}>
      <div className={cn(GRID_TEMPLATE, "text-sm")}>
        <ExerciseLabel label={label} color={color} lowConfidence={lowConfidence} />

        <AggregateCell
          value={setCount}
          min={1}
          max={50}
          ariaLabel={`Sets for ${label}`}
          onChange={handleSetCountChange}
        />

        <AggregateCell
          value={repsValue}
          ariaLabel={`${repsField === "distance" ? "Distance" : "Reps"} for ${label}`}
          suffix={repsSuffix}
          varies={repsVaries}
          onExpandForVariable={onToggle}
          onChange={(next) => debouncedFanout({ [repsField]: next } as PatchExerciseSetPayload)}
        />

        <AggregateCell
          value={uniformity.weight}
          ariaLabel={`Load for ${label}`}
          suffix={weightUnit}
          varies={loadVaries}
          onExpandForVariable={onToggle}
          onChange={(next) => debouncedFanout({ weight: next })}
        />

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
}

function computeUniformity(sets: readonly ExerciseSet[]): UniformitySummary {
  if (sets.length === 0) {
    return {
      reps: null,
      repsVaries: false,
      weight: null,
      weightVaries: false,
      distance: null,
      distanceVaries: false,
    };
  }
  const first = sets[0];
  let repsVaries = false;
  let weightVaries = false;
  let distanceVaries = false;
  for (let i = 1; i < sets.length; i++) {
    if (!repsVaries && sets[i].reps !== first.reps) repsVaries = true;
    if (!weightVaries && sets[i].weight !== first.weight) weightVaries = true;
    if (!distanceVaries && sets[i].distance !== first.distance) distanceVaries = true;
    if (repsVaries && weightVaries && distanceVaries) break;
  }
  return {
    reps: first.reps ?? null,
    repsVaries,
    weight: first.weight ?? null,
    weightVaries,
    distance: first.distance ?? null,
    distanceVaries,
  };
}

function applySetCountChange(
  group: GroupedExercise,
  next: number,
  firstSet: ExerciseSet | undefined,
  onAddSet: (data: AddExerciseSetPayload) => void,
  onDeleteSet: (setId: string) => void,
) {
  const current = group.sets.length;
  if (next > current && firstSet) {
    for (let i = 0; i < next - current; i++) {
      onAddSet({
        exerciseName: firstSet.exerciseName,
        customLabel: firstSet.customLabel,
        category: firstSet.category,
        setNumber: current + i + 1,
        reps: firstSet.reps,
        weight: firstSet.weight,
        distance: firstSet.distance,
        time: firstSet.time,
      });
    }
  } else if (next < current) {
    const toRemove = group.sets.slice(next);
    for (const s of toRemove) onDeleteSet(s.id);
  }
}
