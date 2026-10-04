import type { ExerciseSet } from "@shared/schema";
import { EXERCISE_DEFINITIONS, type ExerciseName } from "@shared/schema/exercises";
import {
  displayDistanceToStored,
  getWorkoutDistanceDisplay,
  type WorkoutDistanceDisplayUnit,
} from "@shared/unitConversion";
import { MessageSquarePlus, Pencil, Plus, X } from "lucide-react";
import { memo, useCallback, useEffect, useId, useMemo, useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import type { AddExerciseSetPayload, PatchExerciseSetPayload } from "@/lib/api";
import { toPreferenceScaleAll } from "@/lib/setDisplay";
import { cn } from "@/lib/utils";

import { type FieldKey, getFieldLabel, getFields } from "./fieldMeta";

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
 * exercise definition (reps / weight / distance / time). A number cell
 * commits with `onUpdate(patch)` on blur or Enter; debouncing + merging
 * of those patches happens one level up in `usePlanDayExercises` /
 * `useWorkoutDetail`, which expose `flushPendingSetPatches` so LogSheet
 * can push queued edits before logging the day or closing.
 *
 * Compact and tabular rather than a large-card stepper. A per-set notes
 * toggle is tucked on the right so the row stays narrow by default.
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
  // The editor shows and writes numbers in the athlete's current unit; a row
  // stamped in another unit is converted first (finding D2). ExerciseTable
  // already does this, in which case the rows come back by reference.
  const scaledSets = useMemo(
    () => toPreferenceScaleAll(sets, { weightUnit, distanceUnit }),
    [sets, weightUnit, distanceUnit],
  );
  const orderedSets = useMemo(
    () => [...scaledSets].sort((a, b) => (a.setNumber ?? 0) - (b.setNumber ?? 0)),
    [scaledSets],
  );
  const lastSet = orderedSets.at(-1);

  // Grid: # | field-1 | field-2 ... | note-toggle | remove
  // Each field column shares width; note/remove are fixed-width icons.
  // Memoised so sibling `SetRow` components (wrapped in React.memo) skip
  // re-render when an unrelated field keystroke flushes through.
  const colTemplate = useMemo(
    // 3.25rem floor (was 80px): three metric columns plus the two icon
    // columns must fit a 360px phone inside the sheet's padding, or the note
    // and remove buttons get pushed past the edge and can't be tapped.
    () => `28px ${fields.map(() => "minmax(3.25rem, 1fr)").join(" ")} 28px 28px`,
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
      blockId: lastSet?.blockId ?? null,
      stepNumber: lastSet?.stepNumber ?? null,
      intervalMinute: lastSet?.intervalMinute ?? null,
      cycleNumber: lastSet?.cycleNumber ?? null,
      stepRole: lastSet?.stepRole ?? null,
      groupId: lastSet?.groupId ?? null,
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
        <HeaderRow
          fields={fields}
          weightUnit={weightUnit}
          distanceUnit={distanceUnit}
          colTemplate={colTemplate}
        />
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
        <span key={field}>{getHeaderLabel(field, weightUnit, distanceUnit)}</span>
      ))}
      <span className="sr-only">Note</span>
      <span className="sr-only">Remove</span>
    </div>
  );
}

function getHeaderLabel(field: FieldKey, weightUnit: string, distanceUnit: string): string {
  if (field === "distance") return "Distance";
  return getFieldLabel(field, {
    weightUnit: weightUnit as "kg" | "lbs",
    distanceUnit: distanceUnit as "km" | "miles",
  });
}

interface CustomLabelFieldProps {
  readonly initial: string;
  readonly placeholder?: string;
  readonly onChange: (next: string) => void;
}

function CustomLabelField({ initial, placeholder, onChange }: CustomLabelFieldProps) {
  const id = useId();
  const [draft, setDraft] = useState(initial);
  const [lastExternal, setLastExternal] = useState(initial);
  if (initial !== lastExternal) {
    setLastExternal(initial);
    setDraft(initial);
  }

  return (
    <div className="space-y-1">
      <Label
        htmlFor={id}
        className="flex items-center gap-1 text-[11px] uppercase tracking-wide text-muted-foreground"
      >
        <Pencil className="h-3 w-3" aria-hidden /> Exercise name
      </Label>
      <Input
        id={id}
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
        <TooltipProvider>
          <Tooltip>
            <TooltipTrigger asChild>
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
            </TooltipTrigger>
            <TooltipContent>
              <p>{notesOpen ? "Hide note" : "Add note"}</p>
            </TooltipContent>
          </Tooltip>
        </TooltipProvider>
        <TooltipProvider>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                onClick={(e) => {
                  if (!canDelete) e.preventDefault();
                  else onDelete();
                }}
                aria-disabled={!canDelete}
                aria-label={`Remove set ${set.setNumber}`}
                className="size-7 text-muted-foreground aria-disabled:opacity-40 aria-disabled:cursor-not-allowed"
                data-testid={`button-remove-set-${set.id}`}
              >
                <X className="h-3.5 w-3.5" aria-hidden />
              </Button>
            </TooltipTrigger>
            <TooltipContent>
              <p>Remove set</p>
            </TooltipContent>
          </Tooltip>
        </TooltipProvider>
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

const FieldInput = memo(function FieldInput({
  field,
  set,
  weightUnit,
  distanceUnit,
  onUpdate,
  showPlannedDiffs,
}: FieldInputProps) {
  const label =
    field === "distance"
      ? "Distance"
      : getFieldLabel(field, {
          weightUnit: weightUnit as "kg" | "lbs",
          distanceUnit: distanceUnit as "km" | "miles",
        });
  const current = set[field] ?? undefined;
  const planned = getPlannedValue(set, field);
  const displayUnit = getFieldDisplayUnit(field, current, planned, distanceUnit);
  const currentDisplay = getFieldDisplayValue(current, field, distanceUnit);
  const plannedDisplay = getFieldDisplayValue(planned ?? undefined, field, distanceUnit);
  const hasPlannedValue = showPlannedDiffs && planned != null;
  const showPlannedDiff = hasPlannedValue && planned !== current;
  const plannedText =
    planned == null ? "" : formatPlannedValue(planned, field, weightUnit, distanceUnit);

  const [draft, setDraft] = useState<string>(() => formatInitial(currentDisplay));
  const [lastCommitted, setLastCommitted] = useState<number | undefined>(currentDisplay);
  const [committedDraft, setCommittedDraft] = useState<string>(() => formatInitial(currentDisplay));
  const [pendingCommit, setPendingCommit] = useState<number | undefined>(undefined);
  const [isDirty, setIsDirty] = useState(false);
  const [suppressTransientEmpty, setSuppressTransientEmpty] = useState(false);
  const [commitBaseValue, setCommitBaseValue] = useState<number | undefined>(currentDisplay);
  // Whether the optimistic cache write for the pending commit has been seen
  // yet. See the note on `externalNewerWhilePending` below.
  const [commitObserved, setCommitObserved] = useState(false);

  const hasPending = pendingCommit !== undefined;

  useEffect(() => {
    if (!suppressTransientEmpty) return;
    const timeoutId = globalThis.setTimeout(() => {
      setSuppressTransientEmpty(false);
    }, EXTERNAL_RECONCILIATION_GRACE_MS);
    return () => globalThis.clearTimeout(timeoutId);
  }, [suppressTransientEmpty]);

  const shouldIgnoreTransientEmpty =
    hasPending &&
    suppressTransientEmpty &&
    (currentDisplay == null || formatInitial(currentDisplay) === "");
  const commitMatched = hasPending && currentDisplay === pendingCommit;
  if (commitMatched && !commitObserved) setCommitObserved(true);
  // A stored value that still equals `commitBaseValue` is ambiguous: either the
  // debounced PATCH hasn't fired yet (keep showing what the athlete typed), or
  // the save failed and the optimistic write was rolled back (show the stored
  // value — the typed one was never accepted). Once the optimistic write has
  // been observed, only the second reading is possible, so the base-value
  // guard is dropped and the rollback surfaces. Without that, the field kept
  // displaying a number the server had rejected until the row was remounted.
  const externalNewerWhilePending =
    hasPending &&
    currentDisplay !== pendingCommit &&
    (commitObserved || currentDisplay !== commitBaseValue);
  const externalNewerAndNotPending = !hasPending && currentDisplay !== lastCommitted;
  const shouldUseExternal =
    !isDirty &&
    !shouldIgnoreTransientEmpty &&
    (commitMatched || externalNewerWhilePending || externalNewerAndNotPending);
  let inputValue = committedDraft;
  if (isDirty) inputValue = draft;
  if (shouldUseExternal) inputValue = formatInitial(currentDisplay);

  const commitDraft = () => {
    if (!isDirty) return;
    const parsed = parseDraft(draft, field);
    if (parsed === INVALID_DRAFT) {
      // An entry that isn't a valid value for this field is dropped, never
      // committed as a clear: the cell returns to the last committed value
      // and nothing is sent (CL7, CODEBASE_ANALYSIS_2026-10-03).
      setDraft(committedDraft);
      setIsDirty(false);
      return;
    }
    // Only an emptied cell clears the stored value.
    const next = parsed ?? undefined;
    const nextDraft = formatInitial(next);
    const storedNext = getStoredFieldValue(next, field, displayUnit, distanceUnit);
    setLastCommitted(next);
    setCommittedDraft(nextDraft);
    setDraft(nextDraft);
    setPendingCommit(next);
    setCommitObserved(false);
    setCommitBaseValue(lastCommitted);
    setSuppressTransientEmpty(nextDraft.trim() !== "");
    if (storedNext !== current) {
      onUpdate({ [field]: storedNext ?? null });
    }
    setIsDirty(false);
  };

  return (
    <div className="flex min-w-0 flex-col gap-1">
      <div className="relative">
        {/*
          type="text", not "number": a number input reports a decimal comma
          ("62,5") as "", so the typed value could never be read (CL7).
          inputMode keeps the decimal keypad on phones.
        */}
        <Input
          type="text"
          inputMode="decimal"
          value={inputValue}
          onChange={(e) => {
            setDraft(e.target.value);
            setIsDirty(true);
          }}
          onBlur={commitDraft}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              commitDraft();
              e.currentTarget.blur();
            }
          }}
          placeholder={hasPlannedValue ? formatInitial(plannedDisplay) : "--"}
          className={cn("h-10 text-center text-sm tabular-nums", displayUnit && "pr-9")}
          aria-label={`${label} for set ${set.setNumber}`}
          data-testid={`input-${field}-${set.id}`}
        />
        {displayUnit && (
          <span
            className="pointer-events-none absolute inset-y-0 right-2 flex items-center text-[10px] font-medium text-muted-foreground"
            data-testid={`unit-${field}-${set.id}`}
          >
            {displayUnit}
          </span>
        )}
      </div>
      {showPlannedDiff && (
        <span
          className={cn("text-center text-[10px] leading-none", "font-medium text-warning")}
          data-testid={`planned-${field}-${set.id}`}
        >
          planned {plannedText}
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
  // `lastExternal` mirrors only the prop. It used to be set from onChange
  // too, so under a debounced owner (LogSheet, ReviewSurface) — where
  // `set.notes` doesn't move until the save fires — every keystroke read as a
  // prop change and reset the box (CL8, CODEBASE_ANALYSIS_2026-10-03). A new
  // prop is adopted only while the draft still matches the last one seen, so
  // a save landing mid-sentence can't clobber the rest of the note either.
  const [lastExternal, setLastExternal] = useState(initial);
  if (initial !== lastExternal) {
    setLastExternal(initial);
    if (draft === lastExternal) setDraft(initial);
  }

  return (
    <Textarea
      value={draft}
      onChange={(e) => {
        const next = e.target.value;
        setDraft(next);
        onUpdate({ notes: next.trim() === "" ? null : next });
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

function getDefaultDistanceDisplayUnit(distanceUnit: string): WorkoutDistanceDisplayUnit {
  return distanceUnit === "miles" || distanceUnit === "mi" ? "ft" : "m";
}

function getFieldDisplayUnit(
  field: FieldKey,
  current: number | undefined,
  planned: number | null | undefined,
  distanceUnit: string,
): WorkoutDistanceDisplayUnit | undefined {
  if (field !== "distance") return undefined;
  const value = current ?? planned ?? undefined;
  return value == null
    ? getDefaultDistanceDisplayUnit(distanceUnit)
    : getWorkoutDistanceDisplay(value, distanceUnit).unit;
}

function getFieldDisplayValue(
  value: number | undefined,
  field: FieldKey,
  distanceUnit: string,
): number | undefined {
  if (value == null) return undefined;
  return field === "distance" ? getWorkoutDistanceDisplay(value, distanceUnit).value : value;
}

function getStoredFieldValue(
  value: number | undefined,
  field: FieldKey,
  displayUnit: WorkoutDistanceDisplayUnit | undefined,
  distanceUnit: string,
): number | undefined {
  if (value == null) return undefined;
  if (field !== "distance") return value;
  return displayDistanceToStored(
    value,
    displayUnit ?? getDefaultDistanceDisplayUnit(distanceUnit),
    distanceUnit,
  );
}

const EXTERNAL_RECONCILIATION_GRACE_MS = 800;

/** A non-empty entry that isn't a valid value for its field. */
const INVALID_DRAFT = Symbol("invalid-draft");

// Digits with at most one decimal separator, which may be "." or "," — the
// iOS decimal keypad types "," in comma-decimal regions (CL7).
const DECIMAL_DRAFT = /^\d*[.,]?\d*$/;
// "1,000" is 1 to a comma-decimal athlete and 1000 to everyone else, so a
// comma followed by exactly one 3-digit group is refused rather than guessed.
const AMBIGUOUS_THOUSANDS = /^[1-9]\d{0,2},\d{3}$/;

function parseDraft(raw: string, field: FieldKey): number | null | typeof INVALID_DRAFT {
  const trimmed = raw.trim();
  if (trimmed === "") return null;
  if (!DECIMAL_DRAFT.test(trimmed) || AMBIGUOUS_THOUSANDS.test(trimmed)) return INVALID_DRAFT;
  const n = Number(trimmed.replace(",", "."));
  if (!Number.isFinite(n)) return INVALID_DRAFT;
  // Same bound as the server's set schema: reps is a whole number >= 1.
  if (field === "reps" && (!Number.isInteger(n) || n < 1)) return INVALID_DRAFT;
  return n;
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
  if (field === "distance") return getWorkoutDistanceDisplay(value, distanceUnit).text;
  if (field === "time") return `${value} min`;
  return `${value} reps`;
}
