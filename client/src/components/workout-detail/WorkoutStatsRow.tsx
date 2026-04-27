import type { ExerciseSet, WorkoutLog } from "@shared/schema";
import { Pencil } from "lucide-react";
import { type ReactNode, useMemo, useState } from "react";

import { Button } from "@/components/ui/button";
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
  readonly reviewFirst?: boolean;
  /**
   * Bumped whenever the caller's updateRpe mutation fails so the
   * editable cell remounts and its local draft resets to the
   * server-authoritative value. workout.rpe alone isn't enough — the
   * mutation is non-optimistic, so a failure leaves workout.rpe
   * unchanged and the input would otherwise stay stuck on the
   * unsaved draft.
   */
  readonly rpeResetSignal?: number;
}

/**
 * Four-column strip below the dialog header showing duration / exercises /
 * RPE / volume. Derivations are client-side so the server never has to
 * denormalise these counts — cheap aggregates over the already-loaded
 * exerciseSets array.
 */
export function WorkoutStatsRow({ workout, exerciseSets, onChangeRpe, reviewFirst = false, rpeResetSignal = 0 }: WorkoutStatsRowProps) {
  const stats = useMemo(() => {
    const uniqueExercises = new Set<string>();
    let summedMinutes = 0;
    for (const s of exerciseSets) {
      const key = s.exerciseName === "custom" && s.customLabel
        ? `custom:${s.customLabel}`
        : s.exerciseName;
      uniqueExercises.add(key);
      if (s.time != null && s.time > 0) {
        summedMinutes += s.time;
      }
    }
    return {
      exerciseCount: uniqueExercises.size,
      setCount: exerciseSets.length,
      // Fallback when workout.duration is null (manual logs — Strava/Garmin
      // imports populate it directly). set.time is already in minutes.
      summedSetMinutes: summedMinutes > 0 ? Math.round(summedMinutes) : null,
    };
  }, [exerciseSets]);

  const displayDuration = workout.duration ?? stats.summedSetMinutes;

  return (
    <div
      className="grid grid-cols-2 gap-4 border-y border-border py-4 sm:grid-cols-4"
      data-testid="workout-stats-row"
    >
      <StatCell label="Duration" value={displayDuration} unit="min" />
      <StatCell label="Exercises" value={stats.exerciseCount} />
      {onChangeRpe ? (
        // Key intentionally excludes workout.rpe. Successful autosaves patch
        // the cached value while the input is still focused; remounting here
        // would re-apply reviewFirst's closed state and interrupt editing.
        // workout.id still isolates dialog navigation, and rpeResetSignal
        // forces a reset after a failed save.
        <RpeEditableCell
          key={`${workout.id}:${rpeResetSignal}`}
          value={workout.rpe}
          onChange={onChangeRpe}
          reviewFirst={reviewFirst}
        />
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
  readonly reviewFirst: boolean;
}

function formatRpeDraft(value: number | null | undefined): string {
  return value == null ? "" : String(value);
}

/**
 * Editable RPE stat cell. Keystrokes update local state immediately; the
 * persisted save fires 500ms after the last edit. Successful autosaves update
 * the value prop without remounting, so the review-first editor stays open
 * while focused. Opening from review mode refreshes the draft from the latest
 * prop; error resets still remount via rpeResetSignal.
 */
function RpeEditableCell({ value, onChange, reviewFirst }: Readonly<RpeEditableCellProps>) {
  const [draft, setDraft] = useState<string>(() => formatRpeDraft(value));
  const [isEditing, setIsEditing] = useState(!reviewFirst);

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

  if (!isEditing) {
    return (
      <StatCellShell label="RPE" testId="workout-stats-rpe-cell">
        <Button
          type="button"
          variant="ghost"
          className="h-auto w-fit justify-start gap-2 px-0 py-0 text-left hover:bg-transparent"
          onClick={() => {
            setDraft(formatRpeDraft(value));
            setIsEditing(true);
          }}
          data-testid="workout-stats-rpe-review"
        >
          <span className="text-2xl font-semibold tabular-nums">
            {value ?? "—"}
          </span>
          <Pencil className="size-3.5 text-muted-foreground" aria-hidden />
        </Button>
      </StatCellShell>
    );
  }

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
        onBlur={() => {
          if (reviewFirst) setIsEditing(false);
        }}
        aria-label="Rate of perceived exertion"
        placeholder="—"
        className="h-9 w-20 text-2xl font-semibold tabular-nums"
        data-testid="workout-stats-rpe-input"
      />
    </StatCellShell>
  );
}
