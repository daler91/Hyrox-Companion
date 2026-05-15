import { EXERCISE_DEFINITIONS, type ExerciseSet, normalizeExerciseName, type StructureBlockInput, type StructureBlockScore } from "@shared/schema";
import { Link2, Plus, Trash2 } from "lucide-react";
import { useCallback, useMemo, useState } from "react";

import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import type { AddExerciseSetPayload, PatchExerciseSetPayload } from "@/lib/api";
import { formatExerciseSummary, getExerciseLabel, type GroupedExercise, groupExerciseSets } from "@/lib/exerciseUtils";
import {
  assignmentPatchForStep,
  groupMatchesBlockStep,
  isUnassignedGroup,
} from "@/lib/workoutStructureAssignments";

import { configToStructureBlock, structureBlockToConfig } from "./configToStructureBlocks";
import { buildEmomPreview } from "./emomPreview";
import { UNASSIGNED_WORK_STEP_LABEL, type WorkoutStep, type WorkoutStructureConfig } from "./types";
import { WorkoutStructureEditor } from "./WorkoutStructureEditor";

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
}

interface BlockContextProps {
  readonly block: StructureBlockInput;
  readonly groups: readonly GroupedExercise[];
  readonly unassignedGroups: readonly GroupedExercise[];
  readonly weightUnit: "kg" | "lb";
  readonly distanceUnit: "km" | "miles";
  readonly onAssignGroup?: AssignGroupHandler;
  readonly onAddLinkedRow?: AddLinkedRowHandler;
}

interface StructureBlockCardProps extends BlockContextProps {
  readonly config: WorkoutStructureConfig;
  readonly index: number;
  readonly showScoreControls: boolean;
  readonly onChange: (next: WorkoutStructureConfig) => void;
  readonly onRemove: () => void;
  readonly onScoreChange?: (blockId: string, score: StructureBlockScore | null) => void;
}

interface BlockStepContextProps extends BlockContextProps {
  readonly step: StructureStep;
}

type StepLinkActionsProps = Omit<BlockStepContextProps, "groups"> & {
  readonly hasLinkedRows: boolean;
};

const generateId = () => crypto.randomUUID();
const EMPTY_STRUCTURE_BLOCKS: readonly StructureBlockInput[] = [];
const EMPTY_EXERCISE_SETS: ExerciseSet[] = [];
const ASSIGN_SELECT_VALUE = "assign";

const emptyEmomConfig = (): WorkoutStructureConfig => ({
  id: generateId(),
  section: "main",
  blockType: "emom",
  emomDurationMinutes: 10,
  emomAlternating: false,
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

function blockSummary(block: StructureBlockInput): string {
  if (block.formatType === "emom") return `${block.durationMinutes ?? block.steps.length} min`;
  if (block.formatType === "amrap") return `${block.timeCapMinutes ?? block.durationMinutes ?? "?"} min cap`;
  if (block.formatType === "rounds") return `${block.roundCount ?? block.rounds ?? "?"} rounds`;
  return `${block.steps.length} steps`;
}

function sectionLabel(section: StructureBlockInput["sectionType"]): string {
  return section.charAt(0).toUpperCase() + section.slice(1);
}

function configStepLabel(step: WorkoutStep): string {
  if (step.type === "rest") return "Rest";
  if (step.type === "transition") return "Transition";
  return step.exercise && step.exercise !== UNASSIGNED_WORK_STEP_LABEL ? step.exercise : "Unassigned work";
}

function configStepWithTarget(step: WorkoutStep): string {
  const label = configStepLabel(step);
  return step.target ? `${label} - ${step.target}` : label;
}

function stepTargetText(step: StructureStep): string | null {
  const targets = step.targets as Record<string, unknown> | null | undefined;
  if (!targets) return null;
  const instructions = targets.instructions;
  if (typeof instructions === "string" && instructions.trim()) return instructions.trim();
  const reps = targets.targetReps ?? targets.reps;
  if (typeof reps === "number") return `${reps} reps`;
  const distance = targets.targetDistance ?? targets.distance;
  if (typeof distance === "number") return `${distance}m`;
  const time = targets.targetTime ?? targets.time;
  if (typeof time === "number") return `${time}s`;
  return null;
}

function stepDisplayName(step: StructureStep): string {
  const type = step.stepType ?? "work";
  if (type === "rest") return "Rest";
  if (type === "transition") return "Transition";
  return step.exerciseName && step.exerciseName !== UNASSIGNED_WORK_STEP_LABEL
    ? step.exerciseName
    : "Unassigned work";
}

function stepPrefix(block: StructureBlockInput, step: StructureStep): string {
  if (block.formatType === "emom") return `Min ${step.minuteIndex ?? step.stepNumber}`;
  return `Step ${step.stepNumber}`;
}

function groupOptionValue(group: GroupedExercise): string {
  return group.sets[0]?.id ?? `${group.exerciseName}:${group.customLabel ?? ""}`;
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

  const handleAssignGroup = useCallback(
    (group: GroupedExercise, block: StructureBlockInput, step: StructureStep) => {
      if (!onUpdateSet) return;
      const patch = assignmentPatchForStep(block, step);
      for (const set of group.sets) onUpdateSet(set.id, patch);
    },
    [onUpdateSet],
  );

  const handleAddLinkedRow = useCallback(
    (block: StructureBlockInput, step: StructureStep) => {
      onAddSet?.(addPayloadForStep(block, step));
    },
    [onAddSet],
  );

  const hasBlocks = drafts.length > 0;

  return (
    <section className="space-y-3" data-testid="structure-blocks-editor" aria-label="Workout blocks">
      <div>
        <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
          Workout blocks
        </p>
        <p className="text-xs text-muted-foreground">
          Build EMOM, AMRAP, and fixed-round formats, then link each work step to an exercise row.
        </p>
      </div>

      {hasBlocks
        ? drafts.map((draft, idx) => {
            const block = blockFromDraft(draft, idx);
            return (
              <StructureBlockCard
                key={draft.id}
                block={block}
                config={draft.config}
                index={idx}
                groups={groups}
                unassignedGroups={unassignedGroups}
                weightUnit={weightUnit}
                distanceUnit={distanceUnit}
                showScoreControls={showScoreControls}
                onChange={(next) => handleUpdateBlock(draft.id, next)}
                onRemove={() => handleRemoveBlock(draft.id)}
                onAssignGroup={onUpdateSet ? handleAssignGroup : undefined}
                onAddLinkedRow={onAddSet ? handleAddLinkedRow : undefined}
                onScoreChange={onScoreChange ? (blockId, score) => handleUpdateScore(draft.id, blockId, score) : undefined}
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
          Add workout block
        </Button>
      )}
    </section>
  );
}

function StructureBlockCard({
  block,
  config,
  index,
  groups,
  unassignedGroups,
  weightUnit,
  distanceUnit,
  showScoreControls,
  onChange,
  onRemove,
  onAssignGroup,
  onAddLinkedRow,
  onScoreChange,
}: StructureBlockCardProps) {
  return (
    <div className="space-y-3 rounded-lg border border-border bg-background p-3" data-testid={`structure-block-${index}`}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 space-y-2">
          <div className="flex flex-wrap items-center gap-2">
            <span className="rounded-full bg-primary/10 px-2 py-1 text-[11px] font-semibold uppercase text-primary">
              {formatBlockType(block.formatType)}
            </span>
            <span className="text-sm font-medium">
              Block {index + 1}
            </span>
          </div>
          <div className="flex flex-wrap gap-1.5 text-[11px] text-muted-foreground">
            <span className="rounded-full bg-muted px-2 py-0.5">{sectionLabel(block.sectionType)}</span>
            <span className="rounded-full bg-muted px-2 py-0.5">{blockSummary(block)}</span>
            <span className="rounded-full bg-muted px-2 py-0.5">
              {block.steps.length} step{block.steps.length === 1 ? "" : "s"}
            </span>
          </div>
        </div>
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
      </div>

      <BlockPreview config={config} />
      <BlockStepLinks
        block={block}
        groups={groups}
        unassignedGroups={unassignedGroups}
        weightUnit={weightUnit}
        distanceUnit={distanceUnit}
        onAssignGroup={onAssignGroup}
        onAddLinkedRow={onAddLinkedRow}
      />

      <WorkoutStructureEditor
        value={config}
        onChange={onChange}
        showScoreControls={showScoreControls}
        onScoreChange={onScoreChange}
      />
    </div>
  );
}

function BlockPreview({ config }: { readonly config: WorkoutStructureConfig }) {
  if (config.blockType === "emom") {
    return <EmomBlockPreview config={config} />;
  }
  if (config.blockType === "amrap") {
    return (
      <StepSequencePreview
        summary={`Repeat ${config.steps.length} step${config.steps.length === 1 ? "" : "s"} until ${config.timeCapMinutes ?? "the"} min cap.`}
        steps={config.steps}
      />
    );
  }
  if (config.blockType === "rounds") {
    return (
      <StepSequencePreview
        summary={`Complete ${config.roundCount ?? "the prescribed"} round${config.roundCount === 1 ? "" : "s"} of ${config.steps.length} step${config.steps.length === 1 ? "" : "s"}.`}
        steps={config.steps}
      />
    );
  }
  return null;
}

function StepSequencePreview({
  summary,
  steps,
}: Readonly<{ summary: string; steps: readonly WorkoutStep[] }>) {
  return (
    <div className="rounded-md border border-primary/20 bg-primary/5 px-3 py-2 text-xs" data-testid="structure-block-preview">
      <p className="font-medium text-foreground">{summary}</p>
      <p className="mt-1 truncate text-muted-foreground">{steps.map(configStepWithTarget).join(" -> ")}</p>
    </div>
  );
}

function EmomBlockPreview({ config }: { readonly config: WorkoutStructureConfig }) {
  const preview = buildEmomPreview(config);
  if (preview.error) {
    return (
      <div className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive" data-testid="structure-block-preview">
        {preview.error}
      </div>
    );
  }
  if (preview.minutes.length === 0) return null;
  const visibleMinutes = preview.minutes.slice(0, 6);
  const hiddenCount = preview.minutes.length - visibleMinutes.length;
  return (
    <div className="rounded-md border border-primary/20 bg-primary/5 px-3 py-2 text-xs" data-testid="structure-block-preview">
      <p className="font-medium text-foreground">
        {config.emomDurationMinutes ?? preview.minutes.length} min EMOM with {preview.patternLength} step{preview.patternLength === 1 ? "" : "s"} across {preview.cycleCount} cycle{preview.cycleCount === 1 ? "" : "s"}.
      </p>
      <div className="mt-2 flex flex-wrap gap-1.5">
        {visibleMinutes.map(({ minute, step }) => (
          <span key={`block-emom-preview-${minute}`} className="rounded-full bg-background px-2 py-0.5 text-muted-foreground">
            Min {minute}: {configStepLabel(step)}
          </span>
        ))}
        {hiddenCount > 0 ? (
          <span className="rounded-full bg-background px-2 py-0.5 text-muted-foreground">
            +{hiddenCount} more
          </span>
        ) : null}
      </div>
    </div>
  );
}

function BlockStepLinks({
  block,
  groups,
  unassignedGroups,
  weightUnit,
  distanceUnit,
  onAssignGroup,
  onAddLinkedRow,
}: Readonly<BlockContextProps>) {
  return (
    <div className="space-y-2 rounded-md border border-border bg-muted/20 p-3" data-testid="structure-block-linked-rows">
      <div className="flex items-center gap-1.5 text-xs font-medium uppercase tracking-wide text-muted-foreground">
        <Link2 className="size-3.5" aria-hidden />
        Linked rows
      </div>
      <div className="space-y-2">
        {block.steps.map((step) => (
          <BlockStepLinkRow
            key={`${block.id ?? "draft"}-${step.stepNumber}`}
            block={block}
            step={step}
            groups={groups}
            unassignedGroups={unassignedGroups}
            weightUnit={weightUnit}
            distanceUnit={distanceUnit}
            onAssignGroup={onAssignGroup}
            onAddLinkedRow={onAddLinkedRow}
          />
        ))}
      </div>
    </div>
  );
}

function BlockStepLinkRow({
  block,
  step,
  groups,
  unassignedGroups,
  weightUnit,
  distanceUnit,
  onAssignGroup,
  onAddLinkedRow,
}: Readonly<BlockStepContextProps>) {
  const blockId = block.id;
  const linkedGroups = blockId
    ? groups.filter((group) => groupMatchesBlockStep(group, blockId, step.stepNumber))
    : [];
  const isWorkStep = (step.stepType ?? "work") === "work";
  const target = stepTargetText(step);

  return (
    <div className="rounded border border-border bg-background px-3 py-2" data-testid="structure-block-step">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="text-xs font-medium text-foreground">
            {stepPrefix(block, step)} - {stepDisplayName(step)}
          </p>
          {target ? <p className="text-xs text-muted-foreground">{target}</p> : null}
        </div>
        <span className="rounded-full bg-muted px-2 py-0.5 text-[11px] text-muted-foreground">
          {step.stepType ?? "work"}
        </span>
      </div>

      {linkedGroups.length > 0 ? (
        <div className="mt-2 space-y-1">
          {linkedGroups.map((group) => (
            <div
              key={groupOptionValue(group)}
              className="rounded bg-muted/60 px-2 py-1 text-xs text-muted-foreground"
              data-testid="structure-block-linked-row"
            >
              {formatExerciseSummary(group, weightUnit, distanceUnit)}
            </div>
          ))}
        </div>
      ) : null}

      {isWorkStep ? (
        <StepLinkActions
          block={block}
          step={step}
          hasLinkedRows={linkedGroups.length > 0}
          unassignedGroups={unassignedGroups}
          weightUnit={weightUnit}
          distanceUnit={distanceUnit}
          onAssignGroup={onAssignGroup}
          onAddLinkedRow={onAddLinkedRow}
        />
      ) : null}
    </div>
  );
}

function StepLinkActions({
  block,
  step,
  hasLinkedRows,
  unassignedGroups,
  weightUnit,
  distanceUnit,
  onAssignGroup,
  onAddLinkedRow,
}: Readonly<StepLinkActionsProps>) {
  const showMissingState = !hasLinkedRows;
  const hasAssignAction = Boolean(onAssignGroup && unassignedGroups.length > 0);
  const hasAddAction = Boolean(onAddLinkedRow);
  if (!showMissingState && !hasAssignAction && !hasAddAction) return null;

  return (
    <div className={`mt-2 flex flex-wrap items-center gap-2 rounded-md px-2 py-2 text-xs ${
      showMissingState
        ? "border border-dashed border-amber-300 bg-amber-500/10"
        : "border border-border bg-muted/30"
    }`}>
      {showMissingState ? (
        <span className="font-medium text-amber-800 dark:text-amber-200" data-testid="structure-block-missing-link">
          No exercise row linked.
        </span>
      ) : null}
      {onAssignGroup && unassignedGroups.length > 0 ? (
        <AssignGroupSelect
          groups={unassignedGroups}
          weightUnit={weightUnit}
          distanceUnit={distanceUnit}
          onAssign={(group) => onAssignGroup(group, block, step)}
          label={`Assign row to ${stepPrefix(block, step)}`}
        />
      ) : null}
      {onAddLinkedRow ? (
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="h-8"
          onClick={() => onAddLinkedRow(block, step)}
          data-testid="structure-block-add-linked-row"
        >
          <Plus className="mr-1 size-3.5" aria-hidden />
          Add linked row
        </Button>
      ) : null}
    </div>
  );
}

function AssignGroupSelect({
  groups,
  weightUnit,
  distanceUnit,
  onAssign,
  label,
}: Readonly<{
  groups: readonly GroupedExercise[];
  weightUnit: "kg" | "lb";
  distanceUnit: "km" | "miles";
  onAssign: (group: GroupedExercise) => void;
  label: string;
}>) {
  return (
    <Select
      value={ASSIGN_SELECT_VALUE}
      onValueChange={(value) => {
        const group = groups.find((candidate) => groupOptionValue(candidate) === value);
        if (group) onAssign(group);
      }}
    >
      <SelectTrigger className="h-8 w-full min-w-[9rem] sm:w-[12rem]" aria-label={label} data-testid="structure-block-assign-row">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value={ASSIGN_SELECT_VALUE} disabled>
          Assign row
        </SelectItem>
        {groups.map((group) => (
          <SelectItem key={groupOptionValue(group)} value={groupOptionValue(group)}>
            {getExerciseLabel(group.exerciseName, group.customLabel)} - {formatExerciseSummary(group, weightUnit, distanceUnit)}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
