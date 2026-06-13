import { EXERCISE_DEFINITIONS, type ExerciseSet, normalizeExerciseName, type StructureBlockInput, type StructureBlockScore } from "@shared/schema";
import { Plus, Trash2 } from "lucide-react";
import { useCallback, useMemo, useState } from "react";

import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import type { AddExerciseSetPayload, PatchExerciseSetPayload } from "@/lib/api";
import { type GroupedExercise, groupExerciseSets } from "@/lib/exerciseUtils";
import { assignmentPatchForStep, isUnassignedGroup } from "@/lib/workoutStructureAssignments";

import { configToStructureBlock, structureBlockToConfig } from "./configToStructureBlocks";
import { UNASSIGNED_WORK_STEP_LABEL, type WorkoutStructureConfig } from "./types";
import { FORMAT_GUIDE, isGuidedFormat, type StepLinking, WorkoutStructureEditor } from "./WorkoutStructureEditor";

interface DraftBlock {
  readonly id: string;
  readonly config: WorkoutStructureConfig;
}

type StructureStep = StructureBlockInput["steps"][number];
type AssignGroupHandler = (
  group: GroupedExercise,
  block: StructureBlockInput,
  step: StructureStep,
) => void;
type AddLinkedRowHandler = (block: StructureBlockInput, step: StructureStep) => void;

interface Props {
  readonly value?: StructureBlockInput[];
  readonly onChange: (next: StructureBlockInput[]) => void;
  readonly exerciseSets?: ExerciseSet[];
  readonly onUpdateSet?: (setId: string, data: PatchExerciseSetPayload) => void;
  readonly onAddSet?: (data: AddExerciseSetPayload) => void;
  readonly weightUnit?: "kg" | "lb";
  readonly distanceUnit?: "km" | "miles";
  readonly showScoreControls?: boolean;
  readonly onScoreChange?: (blockId: string, score: StructureBlockScore | null) => void;
  /**
   * Demote the block builder to an advanced affordance: hide the "Workout
   * blocks" title + helper text and relabel the empty-state button to
   * "Add structure (advanced)". Defaults to false so the /log builder keeps
   * its titled section.
   */
  readonly headerless?: boolean;
}

interface StructureBlockCardProps {
  readonly block: StructureBlockInput;
  readonly config: WorkoutStructureConfig;
  readonly index: number;
  readonly showScoreControls: boolean;
  readonly linking: StepLinking;
  readonly onChange: (next: WorkoutStructureConfig) => void;
  readonly onRemove: () => void;
  readonly onScoreChange?: (blockId: string, score: StructureBlockScore | null) => void;
}

const generateId = () => crypto.randomUUID();
const EMPTY_STRUCTURE_BLOCKS: readonly StructureBlockInput[] = [];
const EMPTY_EXERCISE_SETS: ExerciseSet[] = [];

const emptyEmomConfig = (): WorkoutStructureConfig => ({
  id: generateId(),
  section: "main",
  blockType: "emom",
  emomDurationMinutes: 10,
  steps: [{ id: generateId(), type: "work", exercise: UNASSIGNED_WORK_STEP_LABEL }],
});

const emptyAmrapConfig = (): WorkoutStructureConfig => ({
  id: generateId(),
  section: "main",
  blockType: "amrap",
  timeCapMinutes: 10,
  steps: [{ id: generateId(), type: "work", exercise: UNASSIGNED_WORK_STEP_LABEL }],
});

const emptyRoundsConfig = (): WorkoutStructureConfig => ({
  id: generateId(),
  section: "main",
  blockType: "rounds",
  roundCount: 3,
  steps: [{ id: generateId(), type: "work", exercise: UNASSIGNED_WORK_STEP_LABEL }],
});

function normalizeValue(value: StructureBlockInput[] | undefined): readonly StructureBlockInput[] {
  return Array.isArray(value) ? value : EMPTY_STRUCTURE_BLOCKS;
}

function draftsFromValue(value: readonly StructureBlockInput[]): DraftBlock[] {
  return value.map((block) => ({ id: block.id ?? generateId(), config: structureBlockToConfig(block) }));
}

function blockFromDraft(draft: DraftBlock, idx: number): StructureBlockInput {
  return configToStructureBlock(
    { ...draft.config, id: draft.config.id ?? draft.id },
    { sequenceOrder: idx, sortOrder: idx },
  );
}

function draftsToValue(drafts: readonly DraftBlock[]): StructureBlockInput[] {
  return drafts.map((draft, idx) => blockFromDraft(draft, idx));
}

function formatBlockType(type: StructureBlockInput["formatType"]): string {
  return type === "amrap" || type === "emom" ? type.toUpperCase() : "Rounds";
}

function addPayloadForStep(
  block: StructureBlockInput,
  step: StructureStep,
): AddExerciseSetPayload {
  const rawName = typeof step.exerciseName === "string" ? step.exerciseName.trim() : "";
  const hasNamedExercise = rawName.length > 0 && rawName !== UNASSIGNED_WORK_STEP_LABEL;
  const normalizedName = hasNamedExercise ? normalizeExerciseName(rawName) : null;
  const knownDefinition = normalizedName ? EXERCISE_DEFINITIONS[normalizedName] : undefined;
  const fallbackLabel = hasNamedExercise ? rawName : `${formatBlockType(block.formatType)} step ${step.stepNumber}`;
  return {
    exerciseName: normalizedName ?? "custom",
    customLabel: knownDefinition ? null : fallbackLabel,
    category: step.category ?? knownDefinition?.category ?? "conditioning",
    setNumber: 1,
    ...(block.id
      ? {
          blockId: block.id,
          stepNumber: step.stepNumber,
          intervalMinute: step.minuteIndex ?? null,
          cycleNumber: null,
          stepRole: step.stepRole ?? step.stepType ?? "work",
          groupId: step.groupId ?? null,
        }
      : {}),
  };
}

export function StructureBlocksEditor({
  value,
  onChange,
  exerciseSets = EMPTY_EXERCISE_SETS,
  onUpdateSet,
  onAddSet,
  weightUnit = "kg",
  distanceUnit = "km",
  showScoreControls = false,
  onScoreChange,
  headerless = false,
}: Props) {
  const normalizedValue = normalizeValue(value);
  const [drafts, setDrafts] = useState<DraftBlock[]>(() => draftsFromValue(normalizedValue));
  const [trackedValue, setTrackedValue] = useState(normalizedValue);
  const [addOpen, setAddOpen] = useState(false);
  const groups = useMemo(() => groupExerciseSets(exerciseSets), [exerciseSets]);
  const unassignedGroups = useMemo(() => groups.filter(isUnassignedGroup), [groups]);

  if (normalizedValue !== trackedValue) {
    setTrackedValue(normalizedValue);
    const externalSnapshot = JSON.stringify(normalizedValue);
    const localSnapshot = JSON.stringify(draftsToValue(drafts));
    if (externalSnapshot !== localSnapshot) {
      setDrafts(draftsFromValue(normalizedValue));
    }
  }

  const commit = useCallback(
    (next: DraftBlock[]) => {
      setDrafts(next);
      onChange(draftsToValue(next));
    },
    [onChange],
  );

  const handleAddEmom = useCallback(() => {
    commit([...drafts, { id: generateId(), config: emptyEmomConfig() }]);
  }, [commit, drafts]);

  const handleAddAmrap = useCallback(() => {
    commit([...drafts, { id: generateId(), config: emptyAmrapConfig() }]);
  }, [commit, drafts]);

  const handleAddRounds = useCallback(() => {
    commit([...drafts, { id: generateId(), config: emptyRoundsConfig() }]);
  }, [commit, drafts]);

  const handleUpdateBlock = useCallback(
    (id: string, next: WorkoutStructureConfig) => {
      commit(drafts.map((draft) => (draft.id === id ? { ...draft, config: next } : draft)));
    },
    [commit, drafts],
  );

  const handleUpdateScore = useCallback(
    (draftId: string, blockId: string, score: StructureBlockScore | null) => {
      setDrafts((prev) =>
        prev.map((draft) =>
          draft.id === draftId ? { ...draft, config: { ...draft.config, score } } : draft,
        ),
      );
      onScoreChange?.(blockId, score);
    },
    [onScoreChange],
  );

  const handleRemoveBlock = useCallback(
    (id: string) => {
      commit(drafts.filter((draft) => draft.id !== id));
    },
    [commit, drafts],
  );

  const handleAssignGroup = useCallback<AssignGroupHandler>(
    (group, block, step) => {
      if (!onUpdateSet) return;
      const patch = assignmentPatchForStep(block, step);
      for (const set of group.sets) onUpdateSet(set.id, patch);
    },
    [onUpdateSet],
  );

  const handleAddLinkedRow = useCallback<AddLinkedRowHandler>(
    (block, step) => {
      onAddSet?.(addPayloadForStep(block, step));
    },
    [onAddSet],
  );

  const hasBlocks = drafts.length > 0;

  return (
    <section className="space-y-3" data-testid="structure-blocks-editor" aria-label="Workout blocks">
      {!headerless ? (
        <div>
          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            Workout blocks
          </p>
          <p className="text-xs text-muted-foreground">
            Add an EMOM, AMRAP, or fixed-round block. Each one explains itself, and you build it
            top to bottom.
          </p>
        </div>
      ) : null}

      {hasBlocks
        ? drafts.map((draft, idx) => {
            const block = blockFromDraft(draft, idx);
            const linking: StepLinking = {
              block,
              groups,
              unassignedGroups,
              weightUnit,
              distanceUnit,
              onAssignGroup: onUpdateSet ? handleAssignGroup : undefined,
              onAddLinkedRow: onAddSet ? handleAddLinkedRow : undefined,
            };
            return (
              <StructureBlockCard
                key={draft.id}
                block={block}
                config={draft.config}
                index={idx}
                showScoreControls={showScoreControls}
                linking={linking}
                onChange={(next) => handleUpdateBlock(draft.id, next)}
                onRemove={() => handleRemoveBlock(draft.id)}
                onScoreChange={
                  onScoreChange
                    ? (blockId, score) => handleUpdateScore(draft.id, blockId, score)
                    : undefined
                }
              />
            );
          })
        : null}

      {hasBlocks || addOpen ? (
        <div className="flex flex-wrap gap-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={handleAddEmom}
            data-testid="structure-blocks-add-emom"
          >
            <Plus className="mr-1 size-3.5" aria-hidden />
            EMOM
          </Button>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={handleAddAmrap}
            data-testid="structure-blocks-add-amrap"
          >
            <Plus className="mr-1 size-3.5" aria-hidden />
            AMRAP
          </Button>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={handleAddRounds}
            data-testid="structure-blocks-add-rounds"
          >
            <Plus className="mr-1 size-3.5" aria-hidden />
            Rounds
          </Button>
        </div>
      ) : (
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => setAddOpen(true)}
          data-testid="structure-blocks-add-toggle"
        >
          <Plus className="mr-1 size-3.5" aria-hidden />
          {headerless ? "Add structure (advanced)" : "Add workout block"}
        </Button>
      )}
    </section>
  );
}

function StructureBlockCard({
  block,
  config,
  index,
  showScoreControls,
  linking,
  onChange,
  onRemove,
  onScoreChange,
}: StructureBlockCardProps) {
  const guide = isGuidedFormat(block.formatType) ? FORMAT_GUIDE[block.formatType] : null;

  return (
    <div className="space-y-3 rounded-lg border border-border bg-background p-3" data-testid={`structure-block-${index}`}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 space-y-1">
          <div className="flex items-center gap-2">
            <span className="rounded-full bg-primary/10 px-2 py-0.5 text-[11px] font-semibold uppercase text-primary">
              {formatBlockType(block.formatType)}
            </span>
            <span className="text-sm font-medium">Block {index + 1}</span>
          </div>
          {guide ? (
            <p className="text-xs text-muted-foreground">
              <span className="font-medium text-foreground">{guide.name}.</span> {guide.summary}
            </p>
          ) : null}
        </div>
        <TooltipProvider>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                onClick={onRemove}
                aria-label={`Remove block ${index + 1}`}
                data-testid={`structure-block-remove-${index}`}
              >
                <Trash2 className="size-4" aria-hidden />
              </Button>
            </TooltipTrigger>
            <TooltipContent>
              <p>Remove block</p>
            </TooltipContent>
          </Tooltip>
        </TooltipProvider>
      </div>

      <WorkoutStructureEditor
        value={config}
        onChange={onChange}
        showFormatField={false}
        showScoreControls={showScoreControls}
        onScoreChange={onScoreChange}
        linking={linking}
      />
    </div>
  );
}
