import { useId } from "react";
import { ChevronDown, Plus, Trash2, X, Pencil, Copy } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { NumberStepper } from "@/components/ui/number-stepper";
import { Collapsible, CollapsibleContent } from "@/components/ui/collapsible";
import { EXERCISE_DEFINITIONS, type ExerciseName } from "@shared/schema";
import type { StructuredExercise, SetData } from "@/components/ExerciseInput";
import { createDefaultSet } from "@/components/ExerciseInput";
import { exerciseIcons } from "@/lib/exerciseIcons";
import { categoryBorderColors } from "@/lib/exerciseUtils";
import { cn } from "@/lib/utils";

type FieldKey = "reps" | "weight" | "distance" | "time";

const fieldMeta: Record<
  FieldKey,
  { label: (wu: string, du: string) => string; defaultStep: number; stepOptions: readonly number[] }
> = {
  reps: { label: () => "Reps", defaultStep: 1, stepOptions: [1, 5] },
  weight: { label: (wu) => `Weight (${wu})`, defaultStep: 2.5, stepOptions: [1, 2.5, 5, 10] },
  distance: { label: (_, du) => `Distance (${du === "km" ? "m" : "ft"})`, defaultStep: 50, stepOptions: [10, 50, 100, 500] },
  time: { label: () => "Time (min)", defaultStep: 1, stepOptions: [1, 5, 10] },
};

function getFields(exerciseName: ExerciseName): FieldKey[] {
  const def = EXERCISE_DEFINITIONS[exerciseName];
  if (!def) return ["reps", "weight"];
  return (def.fields as readonly string[]).filter((f): f is FieldKey =>
    f !== "sets" && f in fieldMeta,
  );
}

export interface ExerciseRowBlock {
  readonly blockId: string;
  readonly data: StructuredExercise;
}

export interface ExerciseRowProps {
  readonly exerciseName: ExerciseName;
  readonly displayLabel: string;
  readonly blocks: readonly ExerciseRowBlock[];
  readonly isExpanded: boolean;
  readonly onToggle: () => void;
  readonly onAdd: () => void;
  readonly onDuplicate: () => void;
  readonly onUpdateBlock: (blockId: string, data: StructuredExercise) => void;
  readonly onRemoveBlock: (blockId: string) => void;
  readonly weightUnit: "kg" | "lbs";
  readonly distanceUnit: "km" | "miles";
  readonly showCustomNameInput?: boolean;
}

export function ExerciseRow({
  exerciseName,
  displayLabel,
  blocks,
  isExpanded,
  onToggle,
  onAdd,
  onDuplicate,
  onUpdateBlock,
  onRemoveBlock,
  weightUnit,
  distanceUnit,
  showCustomNameInput,
}: ExerciseRowProps) {
  const def = EXERCISE_DEFINITIONS[exerciseName];
  const Icon = exerciseIcons[exerciseName] || Plus;
  const fields = getFields(exerciseName);
  const muscleGroups = (def?.muscleGroups ?? []) as readonly string[];
  const isAdded = blocks.length > 0;
  const borderColor = def ? categoryBorderColors[def.category] : undefined;

  const handleClick = () => {
    if (!isAdded) {
      onAdd();
    } else {
      onToggle();
    }
  };

  const totalSets = blocks.reduce((sum, b) => sum + (b.data.sets?.length ?? 0), 0);

  return (
    <Collapsible open={isAdded && isExpanded} className="w-full">
      <div
        className={cn(
          "rounded-2xl border border-border bg-card/60 overflow-hidden transition-colors",
          isAdded && "bg-card border-l-4",
          isAdded && borderColor,
        )}
        data-testid={`exercise-row-${exerciseName}`}
      >
        {/* Header */}
        <button
          type="button"
          onClick={handleClick}
          className="flex w-full items-center gap-3 px-4 py-3 text-left hover-elevate active-elevate-2"
          aria-expanded={isExpanded}
          data-testid={`exercise-row-header-${exerciseName}`}
        >
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-muted text-foreground">
            <Icon className="h-5 w-5" />
          </div>
          <div className="min-w-0 flex-1">
            <div className="truncate font-semibold text-foreground">{displayLabel}</div>
            {isAdded && (
              <div className="text-xs text-muted-foreground">
                {blocks.length > 1 ? `${blocks.length} blocks · ` : ""}
                {totalSets} {totalSets === 1 ? "set" : "sets"}
              </div>
            )}
          </div>
          <div className="flex items-center gap-1.5">
            {muscleGroups.slice(0, 2).map((mg) => (
              <Badge
                key={mg}
                variant="secondary"
                className="hidden sm:inline-flex bg-muted/80 text-muted-foreground font-medium"
              >
                {mg}
              </Badge>
            ))}
            {isAdded && (
              <ChevronDown
                className={cn(
                  "h-5 w-5 text-muted-foreground transition-transform",
                  isExpanded && "rotate-180",
                )}
              />
            )}
            {!isAdded && (
              <Plus className="h-5 w-5 text-muted-foreground" />
            )}
          </div>
        </button>

        {/* Expanded body */}
        <CollapsibleContent>
          <div className="border-t border-border px-4 py-4 space-y-4">
            {blocks.map((block, blockIdx) => (
              <ExerciseBlockEditor
                key={block.blockId}
                block={block}
                blockIndex={blockIdx}
                blockCount={blocks.length}
                fields={fields}
                weightUnit={weightUnit}
                distanceUnit={distanceUnit}
                showCustomNameInput={showCustomNameInput}
                onUpdate={(data) => onUpdateBlock(block.blockId, data)}
                onRemove={() => onRemoveBlock(block.blockId)}
              />
            ))}
            <div className="flex items-center justify-between gap-2">
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={onDuplicate}
                data-testid={`button-duplicate-${exerciseName}`}
              >
                <Copy className="h-3.5 w-3.5 mr-1.5" />
                Log as separate block
              </Button>
            </div>
          </div>
        </CollapsibleContent>
      </div>
    </Collapsible>
  );
}

interface ExerciseBlockEditorProps {
  readonly block: ExerciseRowBlock;
  readonly blockIndex: number;
  readonly blockCount: number;
  readonly fields: readonly FieldKey[];
  readonly weightUnit: "kg" | "lbs";
  readonly distanceUnit: "km" | "miles";
  readonly showCustomNameInput?: boolean;
  readonly onUpdate: (data: StructuredExercise) => void;
  readonly onRemove: () => void;
}

function ExerciseBlockEditor({
  block,
  blockIndex,
  blockCount,
  fields,
  weightUnit,
  distanceUnit,
  showCustomNameInput,
  onUpdate,
  onRemove,
}: ExerciseBlockEditorProps) {
  const idPrefix = useId();
  const exercise = block.data;
  const sets: SetData[] = exercise.sets.length > 0 ? exercise.sets : [createDefaultSet(1)];

  const setFieldStep = (setIdx: number, field: FieldKey, value: number | undefined) => {
    const updated = [...sets];
    updated[setIdx] = { ...updated[setIdx], [field]: value };
    onUpdate({ ...exercise, sets: updated });
  };

  const addSet = () => {
    const last = sets.at(-1);
    const next: SetData = {
      setNumber: sets.length + 1,
      reps: last?.reps,
      weight: last?.weight,
      distance: last?.distance,
      time: last?.time,
    };
    onUpdate({ ...exercise, sets: [...sets, next] });
  };

  const removeSet = (idx: number) => {
    if (sets.length <= 1) return;
    const next = sets
      .filter((_, i) => i !== idx)
      .map((s, i) => ({ ...s, setNumber: i + 1 }));
    onUpdate({ ...exercise, sets: next });
  };

  return (
    <div className="space-y-3" data-testid={`block-editor-${block.blockId}`}>
      {blockCount > 1 && (
        <div className="flex items-center justify-between">
          <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
            Block #{blockIndex + 1}
          </span>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            onClick={onRemove}
            aria-label={`Remove block ${blockIndex + 1}`}
            className="h-8 w-8"
            data-testid={`button-remove-block-${block.blockId}`}
          >
            <Trash2 className="h-4 w-4" />
          </Button>
        </div>
      )}

      {showCustomNameInput && (
        <div className="space-y-1.5">
          <Label
            htmlFor={`${idPrefix}-custom-name`}
            className="flex items-center gap-1 text-xs text-muted-foreground"
          >
            <Pencil className="h-3 w-3" />
            Exercise Name
          </Label>
          <Input
            id={`${idPrefix}-custom-name`}
            type="text"
            placeholder="Enter exercise name"
            value={exercise.customLabel ?? ""}
            onChange={(e) =>
              onUpdate({ ...exercise, customLabel: e.target.value || undefined })
            }
            data-testid={`input-custom-name-${block.blockId}`}
          />
        </div>
      )}

      <div className="space-y-3">
        {sets.map((set, idx) => (
          <div
            key={set.setNumber}
            className="rounded-xl bg-muted/30 p-3"
            data-testid={`set-row-${block.blockId}-${idx}`}
          >
            <div className="mb-2 flex items-center justify-between">
              <span className="text-sm font-semibold text-foreground">
                Set {set.setNumber}
              </span>
              {sets.length > 1 && (
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  onClick={() => removeSet(idx)}
                  aria-label={`Remove set ${set.setNumber}`}
                  className="h-7 w-7"
                  data-testid={`button-remove-set-${block.blockId}-${idx}`}
                >
                  <X className="h-3.5 w-3.5" />
                </Button>
              )}
            </div>
            <div
              className={cn(
                "grid gap-3",
                fields.length === 1 ? "grid-cols-1" : "grid-cols-2",
              )}
            >
              {fields.map((field) => {
                const meta = fieldMeta[field];
                return (
                  <div key={field} className="space-y-1">
                    <Label className="text-[11px] uppercase tracking-wide text-muted-foreground">
                      {meta.label(weightUnit, distanceUnit)}
                    </Label>
                    <NumberStepper
                      value={set[field]}
                      defaultStep={meta.defaultStep}
                      stepOptions={meta.stepOptions}
                      onChange={(v) => setFieldStep(idx, field, v)}
                      ariaLabel={`${meta.label(weightUnit, distanceUnit)} for set ${set.setNumber}`}
                      testId={`input-${field}-${block.blockId}-${idx}`}
                    />
                  </div>
                );
              })}
            </div>
          </div>
        ))}
      </div>

      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={addSet}
        className="w-full"
        data-testid={`button-add-set-${block.blockId}`}
      >
        <Plus className="h-4 w-4 mr-1.5" />
        Add Set
      </Button>
    </div>
  );
}
