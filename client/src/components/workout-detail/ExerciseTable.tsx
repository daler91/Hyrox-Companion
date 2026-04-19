import type { ExerciseSet } from "@shared/schema";
import { MoreVertical, Plus, Trash2 } from "lucide-react";
import { useMemo, useState } from "react";

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
import { getExerciseLabel, groupExerciseSets } from "@/lib/exerciseUtils";
import { cn } from "@/lib/utils";

const CELL_SAVE_DEBOUNCE_MS = 350;

interface ExerciseTableProps {
  readonly workoutId: string;
  readonly exerciseSets: ExerciseSet[];
  readonly weightUnit: "kg" | "lb";
  readonly onUpdateSet: (setId: string, data: PatchExerciseSetPayload) => void;
  readonly onAddSet: (data: AddExerciseSetPayload) => void;
  readonly onDeleteSet: (setId: string) => void;
}

/**
 * Always-editable exercise table. One row per exercise (sets grouped by
 * exerciseName / customLabel); the Sets / Reps / Load cells accept inline
 * input and fire debounced PATCH requests through the parent's mutation
 * handlers. A per-row ⋮ menu deletes every set in the group; the +Add row
 * appends a blank "custom" exercise placeholder the user can then fill in.
 *
 * Intentionally simple: aggregate columns reflect the first set's values
 * (matches the mockup). When a workout has variable-per-set prescriptions
 * — pyramids, ramp-ups — the edit propagates to every set in the group.
 * Per-set expansion is deferred; "just make small edits" is the immediate
 * goal.
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

  return (
    <section
      className="flex flex-col gap-2"
      aria-label="Exercises"
      data-testid="exercise-table"
      data-workout-id={workoutId}
    >
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Exercises</span>
        <AddExerciseButton onAdd={onAddSet} />
      </div>

      {groups.length === 0 ? (
        <EmptyExerciseState />
      ) : (
        <div className="divide-y divide-border rounded-lg border border-border">
          <HeaderRow />
          {groups.map((group) => (
            <ExerciseRow
              key={`${group.exerciseName}:${group.customLabel ?? ""}:${group.sets[0]?.id ?? ""}`}
              group={group}
              weightUnit={weightUnit}
              onUpdateSet={onUpdateSet}
              onAddSet={onAddSet}
              onDeleteSet={onDeleteSet}
            />
          ))}
        </div>
      )}
    </section>
  );
}

function HeaderRow() {
  return (
    <div className="grid grid-cols-[1fr_70px_90px_120px_40px] items-center gap-2 border-b border-border bg-muted/40 px-3 py-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
      <span>Exercise</span>
      <span className="text-right">Sets</span>
      <span className="text-right">Reps</span>
      <span className="text-right">Load</span>
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

interface ExerciseRowProps {
  readonly group: ReturnType<typeof groupExerciseSets>[number];
  readonly weightUnit: "kg" | "lb";
  readonly onUpdateSet: (setId: string, data: PatchExerciseSetPayload) => void;
  readonly onAddSet: (data: AddExerciseSetPayload) => void;
  readonly onDeleteSet: (setId: string) => void;
}

function ExerciseRow({ group, weightUnit, onUpdateSet, onAddSet, onDeleteSet }: ExerciseRowProps) {
  const firstSet = group.sets[0];
  const setCount = group.sets.length;
  const sharedReps = firstSet?.reps ?? null;
  // Prefer weight if recorded; otherwise surface distance (meters) so the
  // column isn't blank for running/distance-based exercises.
  const sharedLoad = firstSet?.weight ?? null;
  const sharedDistance = firstSet?.distance ?? null;
  const label = getExerciseLabel(group.exerciseName, group.customLabel);
  const color = categoryColor(group.category);

  const debouncedUpdateAll = useDebouncedCallback((data: PatchExerciseSetPayload) => {
    for (const s of group.sets) onUpdateSet(s.id, data);
  }, CELL_SAVE_DEBOUNCE_MS);

  const lowConfidence = typeof group.confidence === "number" && group.confidence < 60;

  return (
    <div
      className="grid grid-cols-[1fr_70px_90px_120px_40px] items-center gap-2 px-3 py-2 text-sm"
      data-testid="exercise-row"
    >
      <div className="flex min-w-0 items-center gap-2">
        <span
          aria-hidden
          className="inline-block size-2 shrink-0 rounded-full"
          style={{ backgroundColor: color }}
        />
        <span
          className={cn("truncate font-medium", lowConfidence && "text-muted-foreground")}
          title={lowConfidence ? "Low-confidence parse — tap to review" : label}
        >
          {label}
        </span>
      </div>

      <NumberCell
        value={setCount}
        min={1}
        max={50}
        ariaLabel={`Sets for ${label}`}
        onChange={(next) => {
          if (next == null || next === setCount || next < 1) return;
          applySetCountChange(group, Math.round(next), firstSet, onAddSet, onDeleteSet);
        }}
      />

      <NumberCell
        value={sharedReps}
        ariaLabel={`Reps for ${label}`}
        suffix={sharedDistance != null && sharedReps == null ? "m" : undefined}
        overrideDisplay={sharedDistance != null && sharedReps == null ? sharedDistance : undefined}
        onChange={(next) => debouncedUpdateAll({ reps: next })}
      />

      <NumberCell
        value={sharedLoad}
        ariaLabel={`Load for ${label}`}
        suffix={weightUnit}
        onChange={(next) => debouncedUpdateAll({ weight: next })}
      />

      <RowActions
        onDelete={() => {
          for (const s of group.sets) onDeleteSet(s.id);
        }}
      />
    </div>
  );
}

interface NumberCellProps {
  readonly value: number | null;
  readonly ariaLabel: string;
  readonly min?: number;
  readonly max?: number;
  readonly suffix?: string;
  readonly overrideDisplay?: number;
  readonly onChange: (next: number | null) => void;
}

function NumberCell({ value, ariaLabel, min = 0, max, suffix, overrideDisplay, onChange }: NumberCellProps) {
  const [draft, setDraft] = useState<string>(() => formatInitial(overrideDisplay ?? value));

  // Keep in sync when the prop changes (e.g. optimistic rollback).
  const currentValue = overrideDisplay ?? value;
  const parsed = parseDraft(draft);
  const hasUnsavedEdit = parsed !== currentValue;
  const displayValue = hasUnsavedEdit ? draft : formatInitial(currentValue);

  return (
    <div className="flex items-center justify-end gap-1">
      <Input
        type="number"
        inputMode="decimal"
        value={displayValue}
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

function RowActions({ onDelete }: { onDelete: () => void }) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon" className="size-8 text-muted-foreground" aria-label="Row actions">
          <MoreVertical className="size-4" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem onSelect={onDelete} className="text-destructive">
          <Trash2 className="mr-2 size-4" aria-hidden /> Delete
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

interface AddExerciseButtonProps {
  readonly onAdd: (data: AddExerciseSetPayload) => void;
}

function AddExerciseButton({ onAdd }: AddExerciseButtonProps) {
  return (
    <Button
      variant="ghost"
      size="sm"
      className="h-7 gap-1 text-muted-foreground"
      onClick={() =>
        onAdd({
          exerciseName: "custom",
          customLabel: "New exercise",
          category: "conditioning",
          setNumber: 1,
        })
      }
      data-testid="exercise-table-add"
    >
      <Plus className="size-3.5" aria-hidden />
      Add
    </Button>
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

function applySetCountChange(
  group: ReturnType<typeof groupExerciseSets>[number],
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
