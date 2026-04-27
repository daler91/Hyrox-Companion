import { EXERCISE_DEFINITIONS, type ExerciseName,type ExerciseSet } from "@shared/schema";
import { MessageSquarePlus, Pencil, Plus, X } from "lucide-react";
import { memo, useCallback, useMemo, useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import type { AddExerciseSetPayload, PatchExerciseSetPayload } from "@/lib/api";
import { cn } from "@/lib/utils";

import { type FieldKey, fieldMeta, getFields } from "./fieldMeta";

interface InlineSetEditorProps {
  readonly sets: ExerciseSet[];
  readonly exerciseName: string;
  readonly customLabel: string | null | undefined;
  readonly category: string;
  readonly weightUnit: string;
  readonly distanceUnit?: string;
  readonly onUpdateSet: (setId: string, data: PatchExerciseSetPayload) => void;
  readonly onAddSet: (data: AddExerciseSetPayload) => void;
  readonly onDeleteSet: (setId: string) => void;
  readonly showPlannedDiffs?: boolean;
}

/**
 * Tabular per-set editor that renders inline under a `GroupRow` when
 * the row is expanded. One row per set, columns derived from the
 * exercise definition (reps / weight / distance / time). Cells call
 * `onUpdate(patch)` synchronously on each keystroke; debouncing +
 * merging happens one level up in `usePlanDayExercises` /
 * `useWorkoutDetail` so the Save button can flush pending edits before
 * firing the coach-note regenerate.
 *
 * Keeps the compact tabular aesthetic of the log-workout MultiSetTable
 * rather than the large-card stepper pattern. A per-set notes toggle
 * is tucked on the right so the row stays narrow by default.
 */
export const InlineSetEditor = memo(function InlineSetEditor({
  sets,
  exerciseName,
  customLabel,
  category,
  weightUnit,
  distanceUnit = "km",
  onUpdateSet,
  onAddSet,
  onDeleteSet,
  showPlannedDiffs = false,
}: InlineSetEditorProps) {
  const fields = useMemo(() => getFields(exerciseName), [exerciseName]);
  const orderedSets = useMemo(
    () => [...sets].sort((a, b) => (a.setNumber ?? 0) - (b.setNumber ?? 0)),
    [sets],
  );
  const lastSet = orderedSets.at(-1);

  // Grid: # | field-1 | field-2 ... | note-toggle | remove
  // Each field column shares width; note/remove are fixed-width icons.
  // Memoised so sibling `SetRow` components (wrapped in React.memo) skip
  // re-render when an unrelated field keystroke flushes through.
  const colTemplate = useMemo(
    () => `28px ${fields.map(() => "minmax(80px, 1fr)").join(" ")} 28px 28px`,
    [fields],
  );
  const canDelete = orderedSets.length > 1;

  const handleAddSet = () => {
    onAddSet({
      exerciseName,
      customLabel: customLabel ?? null,
      category,
      setNumber: (lastSet?.setNumber ?? orderedSets.length) + 1,
      reps: lastSet?.reps ?? undefined,
      weight: lastSet?.weight ?? undefined,
      distance: lastSet?.distance ?? undefined,
      time: lastSet?.time ?? undefined,
      // Forward the originating row's id so client-side adapters that
      // manage multiple independent groups with the same
      // exerciseName+customLabel can append the new set to the right
      // block (the draft Log Workout flow needs this; server callers
      // ignore the field).
      sourceSetId: lastSet?.id ?? null,
    });
  };

  // Custom-label is fanned out across every set in the group — the
  // grouping key depends on `exerciseName + customLabel`, so editing
  // one set would split the row. Each fanout call hits the hook's
  // per-set debounce, so concurrent edits on separate set rows don't
  // race.
  const labelFanout = (next: string | null) => {
    for (const s of orderedSets) onUpdateSet(s.id, { customLabel: next });
  };

  const canonicalLabel =
    EXERCISE_DEFINITIONS[exerciseName as ExerciseName]?.label ?? "Exercise name";

  return (
    <div className="space-y-3">
      <CustomLabelField
        initial={customLabel ?? ""}
        placeholder={canonicalLabel}
        onChange={(next) => labelFanout(next.trim() === "" ? null : next)}
      />

      <div className="space-y-1">
        <HeaderRow fields={fields} weightUnit={weightUnit} distanceUnit={distanceUnit} colTemplate={colTemplate} />
        {orderedSets.map((set) => (
          <SetRow
            key={set.id}
            set={set}
            fields={fields}
            weightUnit={weightUnit}
            distanceUnit={distanceUnit}
            canDelete={canDelete}
            colTemplate={colTemplate}
            onUpdateSet={onUpdateSet}
            onDeleteSet={onDeleteSet}
            showPlannedDiffs={showPlannedDiffs}
          />
        ))}
      </div>

      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={handleAddSet}
        className="h-7 w-full text-xs"
        data-testid="button-add-set"
      >
        <Plus className="h-3.5 w-3.5 mr-1" aria-hidden />
        Add set
      </Button>
    </div>
  );
});

interface HeaderRowProps {
  readonly fields: readonly FieldKey[];
  readonly weightUnit: string;
  readonly distanceUnit: string;
  readonly colTemplate: string;
}

function HeaderRow({ fields, weightUnit, distanceUnit, colTemplate }: HeaderRowProps) {
  return (
    <div
      className="grid items-end gap-2 pb-1 text-[11px] font-medium uppercase tracking-wide text-muted-foreground"
      style={{ gridTemplateColumns: colTemplate }}
    >
      <span className="text-center">#</span>
      {fields.map((field) => (
        <span key={field}>{fieldMeta[field].label(weightUnit, distanceUnit)}</span>
      ))}
      <span className="sr-only">Note</span>
      <span className="sr-only">Remove</span>
    </div>
  );
}

interface CustomLabelFieldProps {
  readonly initial: string;
  readonly placeholder?: string;
  readonly onChange: (next: string) => void;
}

function CustomLabelField({ initial, placeholder, onChange }: CustomLabelFieldProps) {
  const [draft, setDraft] = useState(initial);
  const [lastExternal, setLastExternal] = useState(initial);
  if (initial !== lastExternal) {
    setLastExternal(initial);
    setDraft(initial);
  }

  return (
    <div className="space-y-1">
      <Label className="flex items-center gap-1 text-[11px] uppercase tracking-wide text-muted-foreground">
        <Pencil className="h-3 w-3" aria-hidden /> Exercise name
      </Label>
      <Input
        type="text"
        placeholder={placeholder ?? "Enter exercise name"}
        value={draft}
        onChange={(e) => {
          setDraft(e.target.value);
          onChange(e.target.value);
        }}
        className="h-8 text-sm"
        data-testid="input-custom-exercise-name"
      />
    </div>
  );
}

interface SetRowProps {
  readonly set: ExerciseSet;
  readonly fields: readonly FieldKey[];
  readonly weightUnit: string;
  readonly distanceUnit: string;
  readonly canDelete: boolean;
  readonly colTemplate: string;
  readonly onUpdateSet: (setId: string, data: PatchExerciseSetPayload) => void;
  readonly onDeleteSet: (setId: string) => void;
  readonly showPlannedDiffs: boolean;
}

const SetRow = memo(function SetRow({
  set,
  fields,
  weightUnit,
  distanceUnit,
  canDelete,
  colTemplate,
  onUpdateSet,
  onDeleteSet,
  showPlannedDiffs,
}: SetRowProps) {
  const [notesOpen, setNotesOpen] = useState(() => (set.notes ?? "").length > 0);
  const setId = set.id;
  const onUpdate = useCallback(
    (patch: PatchExerciseSetPayload) => onUpdateSet(setId, patch),
    [onUpdateSet, setId],
  );
  const onDelete = useCallback(() => onDeleteSet(setId), [onDeleteSet, setId]);

  return (
    <div className="space-y-1" data-testid={`set-row-${set.id}`}>
      <div className="grid items-center gap-2" style={{ gridTemplateColumns: colTemplate }}>
        <span className="text-center text-xs tabular-nums text-muted-foreground">
          {set.setNumber}
        </span>
        {fields.map((field) => (
          <FieldInput
            key={field}
            field={field}
            set={set}
            weightUnit={weightUnit}
            distanceUnit={distanceUnit}
            onUpdate={onUpdate}
            showPlannedDiffs={showPlannedDiffs}
          />
        ))}
        <Button
          type="button"
          variant="ghost"
          size="icon"
          onClick={() => setNotesOpen((v) => !v)}
          aria-label={notesOpen ? "Hide note" : "Add note"}
          aria-pressed={notesOpen}
          className={cn("size-7 text-muted-foreground", notesOpen && "text-foreground")}
          data-testid={`button-toggle-note-${set.id}`}
        >
          <MessageSquarePlus className="h-3.5 w-3.5" aria-hidden />
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          onClick={onDelete}
          disabled={!canDelete}
          aria-label={`Remove set ${set.setNumber}`}
          className="size-7 text-muted-foreground disabled:opacity-40"
          data-testid={`button-remove-set-${set.id}`}
        >
          <X className="h-3.5 w-3.5" aria-hidden />
        </Button>
      </div>

      {notesOpen && <NotesField set={set} onUpdate={onUpdate} />}
    </div>
  );
});

interface FieldInputProps {
  readonly field: FieldKey;
  readonly set: ExerciseSet;
  readonly weightUnit: string;
  readonly distanceUnit: string;
  readonly onUpdate: (patch: PatchExerciseSetPayload) => void;
  readonly showPlannedDiffs: boolean;
}

const FieldInput = memo(function FieldInput({ field, set, weightUnit, distanceUnit, onUpdate, showPlannedDiffs }: FieldInputProps) {
  const meta = fieldMeta[field];
  const label = meta.label(weightUnit, distanceUnit);
  const current = set[field] ?? undefined;
  const planned = getPlannedValue(set, field);
  const hasPlannedValue = showPlannedDiffs && typeof planned === "number";
  const showPlannedDiff = hasPlannedValue && planned !== current;

  // Local draft + "last saved" snapshot so incoming server / optimistic
  // updates at the same value don't overwrite an in-progress edit. A
  // genuine external change (rollback, server push) DOES propagate.
  const [draft, setDraft] = useState<string>(() => formatInitial(current));
  const [lastSaved, setLastSaved] = useState<number | undefined>(current);
  if (current !== lastSaved) {
    setLastSaved(current);
    setDraft(formatInitial(current));
  }

  return (
    <div className="flex min-w-0 flex-col gap-1">
      <Input
        type="number"
        inputMode="decimal"
        value={draft}
        onChange={(e) => {
          const raw = e.target.value;
          setDraft(raw);
          const parsed = parseDraft(raw);
          if (parsed == null || !Number.isNaN(parsed)) {
            const next = parsed ?? undefined;
            setLastSaved(next);
            onUpdate({ [field]: next ?? null } as PatchExerciseSetPayload);
          }
        }}
        placeholder={hasPlannedValue ? String(planned) : "--"}
        className="h-10 text-center text-sm tabular-nums"
        aria-label={`${label} for set ${set.setNumber}`}
        data-testid={`input-${field}-${set.id}`}
      />
      {showPlannedDiff && (
        <span
          className={cn(
            "text-center text-[10px] leading-none text-muted-foreground",
            "font-medium text-amber-700 dark:text-amber-300",
          )}
          data-testid={`planned-${field}-${set.id}`}
        >
          planned {formatPlannedValue(planned, field, weightUnit, distanceUnit)}
        </span>
      )}
    </div>
  );
});

interface NotesFieldProps {
  readonly set: ExerciseSet;
  readonly onUpdate: (patch: PatchExerciseSetPayload) => void;
}

function NotesField({ set, onUpdate }: NotesFieldProps) {
  const initial = set.notes ?? "";
  const [draft, setDraft] = useState(initial);
  const [lastSaved, setLastSaved] = useState(initial);
  if (initial !== lastSaved) {
    setLastSaved(initial);
    setDraft(initial);
  }

  return (
    <Textarea
      value={draft}
      onChange={(e) => {
        const next = e.target.value;
        setDraft(next);
        const stored = next.trim() === "" ? null : next;
        setLastSaved(stored ?? "");
        onUpdate({ notes: stored });
      }}
      placeholder="Note for this set"
      className="min-h-[48px] text-sm"
      aria-label={`Notes for set ${set.setNumber}`}
      data-testid={`input-notes-${set.id}`}
    />
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

function getPlannedValue(set: ExerciseSet, field: FieldKey): number | null | undefined {
  switch (field) {
    case "reps":
      return set.plannedReps;
    case "weight":
      return set.plannedWeight;
    case "distance":
      return set.plannedDistance;
    case "time":
      return set.plannedTime;
  }
}

function formatPlannedValue(
  value: number,
  field: FieldKey,
  weightUnit: string,
  distanceUnit: string,
): string {
  if (field === "weight") return `${value} ${weightUnit}`;
  if (field === "distance") return `${value} ${distanceUnit === "km" ? "m" : "ft"}`;
  if (field === "time") return `${value} min`;
  return `${value} reps`;
}
