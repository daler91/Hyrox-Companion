import type { ExerciseSet } from "@shared/schema";
import { MessageSquarePlus, Pencil, Plus, X } from "lucide-react";
import { useMemo, useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NumberStepper } from "@/components/ui/number-stepper";
import { Textarea } from "@/components/ui/textarea";
import { useDebouncedCallback } from "@/hooks/useDebouncedCallback";
import type { AddExerciseSetPayload, PatchExerciseSetPayload } from "@/lib/api";
import { cn } from "@/lib/utils";

import { type FieldKey, fieldMeta, getFields } from "./fieldMeta";

const CELL_SAVE_DEBOUNCE_MS = 350;

interface ExerciseSetListEditorProps {
  readonly sets: ExerciseSet[];
  readonly exerciseName: string;
  readonly customLabel: string | null | undefined;
  readonly category: string;
  readonly weightUnit: string;
  readonly distanceUnit?: string;
  readonly onUpdateSet: (setId: string, data: PatchExerciseSetPayload) => void;
  readonly onAddSet: (data: AddExerciseSetPayload) => void;
  readonly onDeleteSet: (setId: string) => void;
}

/**
 * Body component for an exercise group in the detail-dialog / plan-day
 * table. Renders one editable stepper row per DB set, with add / remove
 * buttons that fire the set-level mutations that `useWorkoutDetail` and
 * `usePlanDayExercises` already expose. Each cell debounces writes at
 * 350ms via `useDebouncedCallback`, which flushes pending edits on
 * unmount so closing the dialog mid-edit doesn't drop the user's last
 * change.
 *
 * Notes are surfaced behind a "+ Note" toggle so the row stays compact
 * for the common case but the field is one click away when needed.
 */
export function ExerciseSetListEditor({
  sets,
  exerciseName,
  customLabel,
  category,
  weightUnit,
  distanceUnit = "km",
  onUpdateSet,
  onAddSet,
  onDeleteSet,
}: ExerciseSetListEditorProps) {
  const fields = useMemo(() => getFields(exerciseName), [exerciseName]);
  const orderedSets = useMemo(
    () => [...sets].sort((a, b) => (a.setNumber ?? 0) - (b.setNumber ?? 0)),
    [sets],
  );
  const lastSet = orderedSets.at(-1);

  const handleAddSet = () => {
    const base = lastSet;
    onAddSet({
      exerciseName,
      customLabel: customLabel ?? null,
      category,
      setNumber: (base?.setNumber ?? orderedSets.length) + 1,
      reps: base?.reps ?? undefined,
      weight: base?.weight ?? undefined,
      distance: base?.distance ?? undefined,
      time: base?.time ?? undefined,
    });
  };

  // Custom-label fans out to every set in the group — `groupExerciseSets`
  // keys on exerciseName + customLabel, so updating one set would desync
  // the row.
  const debouncedLabelFanout = useDebouncedCallback((next: string | null) => {
    for (const s of orderedSets) onUpdateSet(s.id, { customLabel: next });
  }, CELL_SAVE_DEBOUNCE_MS);

  return (
    <div className="space-y-3">
      {exerciseName === "custom" && (
        <CustomLabelField
          initial={customLabel ?? ""}
          onChange={(next) => debouncedLabelFanout(next.trim() === "" ? null : next)}
        />
      )}

      <div className="space-y-3">
        {orderedSets.map((set) => (
          <SetRow
            key={set.id}
            set={set}
            fields={fields}
            weightUnit={weightUnit}
            distanceUnit={distanceUnit}
            canDelete={orderedSets.length > 1}
            onUpdate={(patch) => onUpdateSet(set.id, patch)}
            onDelete={() => onDeleteSet(set.id)}
          />
        ))}
      </div>

      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={handleAddSet}
        className="w-full"
        data-testid="button-add-set"
      >
        <Plus className="h-4 w-4 mr-1.5" aria-hidden />
        Add Set
      </Button>
    </div>
  );
}

interface CustomLabelFieldProps {
  readonly initial: string;
  readonly onChange: (next: string) => void;
}

function CustomLabelField({ initial, onChange }: CustomLabelFieldProps) {
  // React's "adjust state when props change" pattern: pair the draft
  // with a snapshot of the last prop value we synced from, then
  // reconcile during render when the incoming prop diverges. Lets the
  // field stay responsive to external rewrites (draft restore, server
  // echo) without clobbering in-progress user edits — and avoids the
  // `react-hooks/set-state-in-effect` rule's setState-in-effect trap.
  const [draft, setDraft] = useState(initial);
  const [lastExternal, setLastExternal] = useState(initial);
  if (initial !== lastExternal) {
    setLastExternal(initial);
    setDraft(initial);
  }

  return (
    <div className="space-y-1.5">
      <Label className="flex items-center gap-1 text-xs text-muted-foreground">
        <Pencil className="h-3 w-3" aria-hidden /> Exercise Name
      </Label>
      <Input
        type="text"
        placeholder="Enter exercise name"
        value={draft}
        onChange={(e) => {
          setDraft(e.target.value);
          onChange(e.target.value);
        }}
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
  readonly onUpdate: (patch: PatchExerciseSetPayload) => void;
  readonly onDelete: () => void;
}

function SetRow({
  set,
  fields,
  weightUnit,
  distanceUnit,
  canDelete,
  onUpdate,
  onDelete,
}: SetRowProps) {
  const [notesOpen, setNotesOpen] = useState(() => (set.notes ?? "").length > 0);

  return (
    <div className="rounded-xl bg-muted/30 p-3" data-testid={`set-row-${set.id}`}>
      <div className="mb-2 flex items-center justify-between">
        <span className="text-sm font-semibold text-foreground">Set {set.setNumber}</span>
        <div className="flex items-center gap-1">
          <Button
            type="button"
            variant="ghost"
            size="icon"
            onClick={() => setNotesOpen((v) => !v)}
            aria-label={notesOpen ? "Hide note" : "Add note"}
            aria-pressed={notesOpen}
            className="h-7 w-7 text-muted-foreground"
            data-testid={`button-toggle-note-${set.id}`}
          >
            <MessageSquarePlus className="h-3.5 w-3.5" aria-hidden />
          </Button>
          {canDelete && (
            <Button
              type="button"
              variant="ghost"
              size="icon"
              onClick={onDelete}
              aria-label={`Remove set ${set.setNumber}`}
              className="h-7 w-7 text-muted-foreground"
              data-testid={`button-remove-set-${set.id}`}
            >
              <X className="h-3.5 w-3.5" aria-hidden />
            </Button>
          )}
        </div>
      </div>

      <div className={cn("grid gap-3", fields.length === 1 ? "grid-cols-1" : "grid-cols-2")}>
        {fields.map((field) => (
          <FieldStepper
            key={field}
            field={field}
            set={set}
            weightUnit={weightUnit}
            distanceUnit={distanceUnit}
            onUpdate={onUpdate}
          />
        ))}
      </div>

      {notesOpen && (
        <div className="mt-3">
          <NotesField set={set} onUpdate={onUpdate} />
        </div>
      )}
    </div>
  );
}

interface FieldStepperProps {
  readonly field: FieldKey;
  readonly set: ExerciseSet;
  readonly weightUnit: string;
  readonly distanceUnit: string;
  readonly onUpdate: (patch: PatchExerciseSetPayload) => void;
}

function FieldStepper({ field, set, weightUnit, distanceUnit, onUpdate }: FieldStepperProps) {
  const meta = fieldMeta[field];
  const label = meta.label(weightUnit, distanceUnit);
  const current = (set[field] as number | null | undefined) ?? undefined;

  // Local draft so the stepper feels immediate; debounced callback
  // fires the PATCH. `lastSaved` tracks what we asked the server to
  // store so incoming optimistic/server updates with the same value
  // don't clobber an in-progress edit. External changes (error
  // rollback, a server push with a different value) DO resync the
  // draft — reconciled in render (React's "adjust state when props
  // change" pattern).
  const [draft, setDraft] = useState<number | undefined>(current);
  const [lastSaved, setLastSaved] = useState<number | undefined>(current);
  if (current !== lastSaved) {
    setLastSaved(current);
    setDraft(current);
  }

  const debouncedPatch = useDebouncedCallback((next: number | undefined) => {
    setLastSaved(next);
    onUpdate({ [field]: next ?? null } as PatchExerciseSetPayload);
  }, CELL_SAVE_DEBOUNCE_MS);

  return (
    <div className="space-y-1">
      <Label className="text-[11px] uppercase tracking-wide text-muted-foreground">{label}</Label>
      <NumberStepper
        value={draft}
        defaultStep={meta.defaultStep}
        stepOptions={meta.stepOptions}
        onChange={(v) => {
          setDraft(v);
          debouncedPatch(v);
        }}
        ariaLabel={`${label} for set ${set.setNumber}`}
        testId={`input-${field}-${set.id}`}
      />
    </div>
  );
}

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

  const debouncedPatch = useDebouncedCallback((next: string) => {
    const stored = next.trim() === "" ? null : next;
    setLastSaved(stored ?? "");
    onUpdate({ notes: stored });
  }, CELL_SAVE_DEBOUNCE_MS);

  return (
    <div className="space-y-1">
      <Label className="text-[11px] uppercase tracking-wide text-muted-foreground">Notes</Label>
      <Textarea
        value={draft}
        onChange={(e) => {
          setDraft(e.target.value);
          debouncedPatch(e.target.value);
        }}
        placeholder="How did this set feel?"
        className="min-h-[60px]"
        aria-label={`Notes for set ${set.setNumber}`}
        data-testid={`input-notes-${set.id}`}
      />
    </div>
  );
}
