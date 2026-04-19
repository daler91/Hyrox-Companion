import type { ExerciseSet, WorkoutLog } from "@shared/schema";
import { type ReactNode, useEffect,useMemo, useState } from "react";

import { Input } from "@/components/ui/input";
import { useDebouncedCallback } from "@/hooks/useDebouncedCallback";

const RPE_SAVE_DEBOUNCE_MS = 500;

interface WorkoutStatsRowProps {
  readonly workout: WorkoutLog;
  readonly exerciseSets: ExerciseSet[];
  /**
   * When provided, the RPE cell renders as an editable input with a
   * debounced save. Omit to keep the cell read-only (planned entries or
   * anywhere we don't want the edit affordance).
   */
  readonly onChangeRpe?: (rpe: number | null) => void;
}

/**
 * Four-column strip below the dialog header showing duration / exercises /
 * RPE / volume. Derivations are client-side so the server never has to
 * denormalise these counts — cheap aggregates over the already-loaded
 * exerciseSets array.
 */
export function WorkoutStatsRow({ workout, exerciseSets, onChangeRpe }: WorkoutStatsRowProps) {
  const stats = useMemo(() => {
    const uniqueExercises = new Set<string>();
    for (const s of exerciseSets) {
      const key = s.exerciseName === "custom" && s.customLabel
        ? `custom:${s.customLabel}`
        : s.exerciseName;
      uniqueExercises.add(key);
    }
    return {
      exerciseCount: uniqueExercises.size,
      setCount: exerciseSets.length,
    };
  }, [exerciseSets]);

  return (
    <div
      className="grid grid-cols-2 gap-4 border-y border-border py-4 sm:grid-cols-4"
      data-testid="workout-stats-row"
    >
      <StatCell label="Duration" value={workout.duration} unit="min" />
      <StatCell label="Exercises" value={stats.exerciseCount} />
      {onChangeRpe ? (
        <RpeEditableCell value={workout.rpe} onChange={onChangeRpe} />
      ) : (
        <StatCell label="RPE" value={workout.rpe} />
      )}
      <StatCell label="Volume" value={stats.setCount} unit={stats.setCount === 1 ? "set" : "sets"} />
    </div>
  );
}

function StatCellShell({
  label,
  testId,
  children,
}: Readonly<{ label: string; testId?: string; children: ReactNode }>) {
  return (
    <div className="flex flex-col gap-1" data-testid={testId}>
      <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{label}</span>
      {children}
    </div>
  );
}

function StatCell({ label, value, unit }: Readonly<{ label: string; value: number | null | undefined; unit?: string }>) {
  const displayValue = value == null ? "—" : String(value);
  return (
    <StatCellShell label={label}>
      <div className="flex items-baseline gap-1">
        <span className="text-2xl font-semibold tabular-nums">{displayValue}</span>
        {unit && value != null && <span className="text-xs text-muted-foreground">{unit}</span>}
      </div>
    </StatCellShell>
  );
}

interface RpeEditableCellProps {
  readonly value: number | null | undefined;
  readonly onChange: (rpe: number | null) => void;
}

/**
 * Editable RPE stat cell. Keystrokes update local state immediately; the
 * persisted save fires 500ms after the last edit. Sync-on-prop-change
 * keeps the input in step with optimistic rollback if the server
 * rejects the update.
 */
function formatRpeDraft(value: number | null | undefined): string {
  return value == null ? "" : String(value);
}

function RpeEditableCell({ value, onChange }: Readonly<RpeEditableCellProps>) {
  const [draft, setDraft] = useState<string>(() => formatRpeDraft(value));

  useEffect(() => {
    setDraft(formatRpeDraft(value));
  }, [value]);

  const debouncedSave = useDebouncedCallback((next: string) => {
    if (next.trim() === "") {
      onChange(null);
      return;
    }
    const parsed = Number.parseInt(next, 10);
    if (Number.isNaN(parsed)) return;
    const clamped = Math.min(10, Math.max(1, parsed));
    onChange(clamped);
  }, RPE_SAVE_DEBOUNCE_MS);

  return (
    <StatCellShell label="RPE" testId="workout-stats-rpe-cell">
      <Input
        type="number"
        inputMode="numeric"
        min={1}
        max={10}
        step={1}
        value={draft}
        onChange={(e) => {
          setDraft(e.target.value);
          debouncedSave(e.target.value);
        }}
        aria-label="Rate of perceived exertion"
        placeholder="—"
        className="h-9 w-20 text-2xl font-semibold tabular-nums"
        data-testid="workout-stats-rpe-input"
      />
    </StatCellShell>
  );
}
