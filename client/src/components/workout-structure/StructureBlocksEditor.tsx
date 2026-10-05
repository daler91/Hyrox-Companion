import type { ExerciseSet, StructureBlockInput, StructureBlockScore } from "@shared/schema";
import { EXERCISE_DEFINITIONS, normalizeExerciseName } from "@shared/schema/exercises";
import { Plus, Trash2 } from "lucide-react";
import { type Ref, useCallback, useImperativeHandle, useMemo, useState } from "react";

import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import type { AddExerciseSetPayload, PatchExerciseSetPayload } from "@/lib/api";
import { type GroupedExercise, groupExerciseSets } from "@/lib/exerciseUtils";
import { assignmentPatchForStep, isUnassignedGroup } from "@/lib/workoutStructureAssignments";

import { UNASSIGNED_WORK_STEP_LABEL, type WorkoutStructureConfig } from "./types";
import {
  blockFromDraft,
  type DraftBlock,
  newDraft,
  type StructureChangeHandler,
  useStructureDrafts,
} from "./useStructureDrafts";
import { FORMAT_GUIDE, isGuidedFormat, type StepLinking, WorkoutStructureEditor } from "./WorkoutStructureEditor";

type StructureStep = StructureBlockInput["steps"][number];
type AssignGroupHandler = (
  group: GroupedExercise,
  block: StructureBlockInput,
  step: StructureStep,
) => void;
type AddLinkedRowHandler = (block: StructureBlockInput, step: StructureStep) => void;

/** What an owner can ask of the builder. */
export interface StructureBlocksEditorHandle {
  /**
   * Send a save still waiting out its pause and wait for every save to settle.
   * Resolves with whether the last save landed (a failed one is not reported
   * once a later one has gone out), or true at once when no save is waiting
   * or out; never rejects. CL15 (CODEBASE_ANALYSIS_2026-10-03)
   */
  readonly flush: () => Promise<boolean>;
}

interface Props {
  readonly ref?: Ref<StructureBlocksEditorHandle>;
  readonly value?: StructureBlockInput[];
  /**
   * Receives every block after an edit, and the steps it renumbered so the
   * owner can keep exercise rows on the step they belong to (CL15). A
   * returned promise is the save: the next one waits for it, and a rejection
   * reloads `value` because the save didn't land.
   */
  readonly onChange: StructureChangeHandler;
  /** Delay before onChange after the last edit. 0, the default, calls it on every edit. */
  readonly saveDebounceMs?: number;
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
  readonly draft: DraftBlock;
  readonly index: number;
  readonly showScoreControls: boolean;
  readonly groups: GroupedExercise[];
  readonly unassignedGroups: GroupedExercise[];
  readonly weightUnit: "kg" | "lb";
  readonly distanceUnit: "km" | "miles";
  readonly onAssignGroup?: AssignGroupHandler;
  readonly onAddLinkedRow?: AddLinkedRowHandler;
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
  ref,
  value,
  onChange,
  saveDebounceMs = 0,
  exerciseSets = EMPTY_EXERCISE_SETS,
  onUpdateSet,
  onAddSet,
  weightUnit = "kg",
  distanceUnit = "km",
  showScoreControls = false,
  onScoreChange,
  headerless = false,
}: Props) {
  const { drafts, commit, updateScore, flush, isIdle } = useStructureDrafts(
    normalizeValue(value),
    onChange,
    saveDebounceMs,
  );
  useImperativeHandle(ref, () => ({ flush }), [flush]);
  const [addOpen, setAddOpen] = useState(false);
  const groups = useMemo(() => groupExerciseSets(exerciseSets), [exerciseSets]);
  const unassignedGroups = useMemo(() => groups.filter(isUnassignedGroup), [groups]);

  const handleAddEmom = useCallback(() => {
    commit((current) => [...current, newDraft(emptyEmomConfig())]);
  }, [commit]);

  const handleAddAmrap = useCallback(() => {
    commit((current) => [...current, newDraft(emptyAmrapConfig())]);
  }, [commit]);

  const handleAddRounds = useCallback(() => {
    commit((current) => [...current, newDraft(emptyRoundsConfig())]);
  }, [commit]);

  const handleUpdateBlock = useCallback(
    (id: string, next: WorkoutStructureConfig) => {
      commit((current) => current.map((draft) => (draft.id === id ? { ...draft, config: next, edited: true } : draft)));
    },
    [commit],
  );

  const handleUpdateScore = useCallback(
    (draftId: string, blockId: string, score: StructureBlockScore | null) => {
      updateScore(draftId, score);
      onScoreChange?.(blockId, score);
    },
    [onScoreChange, updateScore],
  );

  const handleRemoveBlock = useCallback(
    (id: string) => {
      commit((current) => current.filter((draft) => draft.id !== id));
    },
    [commit],
  );

  // A row assigned here takes the step number the athlete sees. With a block
  // save still waiting or out, that numbering isn't stored yet, and the save
  // would then move the row a second time as if it had the old one. So the
  // save goes first, and the row is linked once it has landed. CL15
  // (CODEBASE_ANALYSIS_2026-10-03)
  const afterSave = useCallback(
    (link: () => void) => {
      if (isIdle()) {
        link();
        return;
      }
      void flush().then((saved) => {
        if (saved) link();
      });
    },
    [flush, isIdle],
  );

  const handleAssignGroup = useCallback<AssignGroupHandler>(
    (group, block, step) => {
      if (!onUpdateSet) return;
      const patch = assignmentPatchForStep(block, step);
      afterSave(() => {
        for (const set of group.sets) onUpdateSet(set.id, patch);
      });
    },
    [afterSave, onUpdateSet],
  );

  const handleAddLinkedRow = useCallback<AddLinkedRowHandler>(
    (block, step) => {
      if (!onAddSet) return;
      const payload = addPayloadForStep(block, step);
      afterSave(() => {
        onAddSet(payload);
      });
    },
    [afterSave, onAddSet],
  );

  const hasBlocks = drafts.length > 0;

  return (
    <section className="space-y-3" data-testid="structure-blocks-editor" aria-label="Workout blocks">
      {!headerless && (
        <div>
          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            Workout blocks
          </p>
          <p className="text-xs text-muted-foreground">
            Add an EMOM, AMRAP, or fixed-round block. Each one explains itself, and you build it
            top to bottom.
          </p>
        </div>
      )}

      {hasBlocks
        ? drafts.map((draft, idx) => (
            <StructureBlockCard
              key={draft.id}
              draft={draft}
              index={idx}
              showScoreControls={showScoreControls}
              groups={groups}
              unassignedGroups={unassignedGroups}
              weightUnit={weightUnit}
              distanceUnit={distanceUnit}
              onAssignGroup={onUpdateSet ? handleAssignGroup : undefined}
              onAddLinkedRow={onAddSet ? handleAddLinkedRow : undefined}
              onChange={(next) => handleUpdateBlock(draft.id, next)}
              onRemove={() => handleRemoveBlock(draft.id)}
              onScoreChange={
                onScoreChange
                  ? (blockId, score) => handleUpdateScore(draft.id, blockId, score)
                  : undefined
              }
            />
          ))
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
  draft,
  index,
  showScoreControls,
  groups,
  unassignedGroups,
  weightUnit,
  distanceUnit,
  onAssignGroup,
  onAddLinkedRow,
  onChange,
  onRemove,
  onScoreChange,
}: StructureBlockCardProps) {
  // ⚡ Bolt Performance Optimization: `block`/`linking` are memoized here (keyed
  // on `draft`, which keeps a stable reference for every block *except* the one
  // just edited — see StructureBlocksEditor's handleUpdateBlock) instead of
  // being rebuilt as fresh object literals on every StructureBlocksEditor
  // render. WorkoutStructureEditor passes `linking` straight down to the
  // memo()'d MovementRow for every movement in every block; a fresh `linking`
  // object each render defeated that memo entirely, so a single keystroke in
  // one block re-rendered every MovementRow across every block. Now unrelated
  // blocks keep the same `linking` reference and their MovementRows correctly
  // bail out.
  const block = useMemo(() => blockFromDraft(draft, index), [draft, index]);
  const linking: StepLinking = useMemo(
    () => ({
      block,
      groups,
      unassignedGroups,
      weightUnit,
      distanceUnit,
      onAssignGroup,
      onAddLinkedRow,
    }),
    [block, groups, unassignedGroups, weightUnit, distanceUnit, onAssignGroup, onAddLinkedRow],
  );
  const config = draft.config;
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
