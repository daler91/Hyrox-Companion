import type { StructureBlockInput, StructureBlockScore } from "@shared/schema";
import { ArrowDown, ArrowUp, Link2, Plus, X } from "lucide-react";
import type { ReactNode } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { formatExerciseSummary, getExerciseLabel, type GroupedExercise } from "@/lib/exerciseUtils";
import { groupMatchesBlockStep } from "@/lib/workoutStructureAssignments";

import { buildEmomPreview } from "./emomPreview";
import {
  type BlockType,
  type StepType,
  UNASSIGNED_WORK_STEP_LABEL,
  type WorkoutSection,
  type WorkoutStep,
  type WorkoutStructureConfig,
} from "./types";

type StructureStep = StructureBlockInput["steps"][number];
type GuidedFormat = "emom" | "amrap" | "rounds";

const sections: WorkoutSection[] = ["warmup", "main", "accessory", "cooldown", "mobility"];
// Only the three formats with a dedicated configuration UI are offered.
// A block loaded with any other formatType still displays (see
// `blockTypeOptionsFor`) so legacy data isn't silently dropped.
const SUPPORTED_BLOCK_TYPES: BlockType[] = ["emom", "amrap", "rounds"];
const BLOCK_TYPE_LABELS: Record<BlockType, string> = {
  emom: "EMOM",
  amrap: "AMRAP",
  rounds: "Rounds",
  steady: "Steady",
  interval: "Interval",
  for_time: "For time",
};
// Plain-language names so the editor never relies on the user already
// knowing the gym acronyms.
const STEP_TYPE_LABELS: Record<StepType, string> = {
  work: "Movement",
  rest: "Rest",
  transition: "Transition",
};
const stepTypes: StepType[] = ["work", "rest", "transition"];
const MAX_EMOM_DURATION_MINUTES = 240;

interface FormatGuide {
  readonly name: string;
  readonly summary: string;
  readonly setupLabel: string;
  readonly setupHint: string;
  readonly movementsHint: string;
}

/**
 * Plain-English explanations shown next to each format so an average user
 * can pick and configure a block without knowing what the acronym means.
 */
export const FORMAT_GUIDE: Record<GuidedFormat, FormatGuide> = {
  emom: {
    name: "Every Minute On the Minute",
    summary:
      "A timer starts a fresh minute on repeat. At the top of each minute you begin the next movement, then rest with whatever time is left.",
    setupLabel: "Total length (minutes)",
    setupHint: "How many minutes the timer runs in total.",
    movementsHint:
      "Add one movement per minute, in order. If the block runs longer than your list, it loops back to the first movement.",
  },
  amrap: {
    name: "As Many Rounds As Possible",
    summary:
      "Work through the movements in order, over and over, until the time cap. Afterwards you count how many full rounds you finished.",
    setupLabel: "Time cap (minutes)",
    setupHint: "How long you keep going before stopping.",
    movementsHint: "Add the movements in the order you repeat them each round.",
  },
  rounds: {
    name: "Fixed rounds",
    summary:
      "Repeat the movements in order for a set number of rounds, then the block is done.",
    setupLabel: "Number of rounds",
    setupHint: "How many times you repeat the movements.",
    movementsHint: "Add the movements you repeat each round.",
  },
};

export function isGuidedFormat(type: string): type is GuidedFormat {
  return type === "emom" || type === "amrap" || type === "rounds";
}

/**
 * Everything the editor needs to let a work step link to a real exercise
 * row. Omitted entirely when the editor is used somewhere without
 * exercise rows (e.g. the log-workout confirm step), which keeps the
 * movement list clean instead of showing dead "link a row" affordances.
 */
export interface StepLinking {
  readonly block: StructureBlockInput;
  readonly groups: readonly GroupedExercise[];
  readonly unassignedGroups: readonly GroupedExercise[];
  readonly weightUnit: "kg" | "lb";
  readonly distanceUnit: "km" | "miles";
  readonly onAssignGroup?: (group: GroupedExercise, block: StructureBlockInput, step: StructureStep) => void;
  readonly onAddLinkedRow?: (block: StructureBlockInput, step: StructureStep) => void;
}

interface Props {
  readonly value: WorkoutStructureConfig;
  readonly onChange: (next: WorkoutStructureConfig) => void;
  /** Hidden when the format is already fixed by the surrounding card. */
  readonly showFormatField?: boolean;
  readonly showScoreControls?: boolean;
  readonly onScoreChange?: (blockId: string, score: StructureBlockScore | null) => void;
  readonly linking?: StepLinking;
}

type EmomScore = Extract<StructureBlockScore, { type: "emom" }>;
type AmrapScore = Extract<StructureBlockScore, { type: "amrap" }>;
type RoundsScore = Extract<StructureBlockScore, { type: "rounds" }>;

function blockTypeOptionsFor(current: BlockType): BlockType[] {
  return SUPPORTED_BLOCK_TYPES.includes(current)
    ? SUPPORTED_BLOCK_TYPES
    : [current, ...SUPPORTED_BLOCK_TYPES];
}

function sectionLabel(section: WorkoutSection): string {
  return section.charAt(0).toUpperCase() + section.slice(1);
}

function stepPositionLabel(blockType: BlockType, index: number): string {
  return blockType === "emom" ? `Min ${index + 1}` : `Step ${index + 1}`;
}

function configStepLabel(step: WorkoutStep): string {
  if (step.type === "rest") return "Rest";
  if (step.type === "transition") return "Transition";
  return step.exercise && step.exercise !== UNASSIGNED_WORK_STEP_LABEL ? step.exercise : "Movement";
}

function configStepWithTarget(step: WorkoutStep): string {
  const label = configStepLabel(step);
  return step.target ? `${label} - ${step.target}` : label;
}

function groupOptionValue(group: GroupedExercise): string {
  return group.sets[0]?.id ?? `${group.exerciseName}:${group.customLabel ?? ""}`;
}

function mergeEmomScore(score: WorkoutStructureConfig["score"], patch: Partial<Omit<EmomScore, "type">>): EmomScore {
  const base: EmomScore = score?.type === "emom" ? score : { type: "emom", completed: false };
  return { ...base, ...patch, type: "emom" };
}

function mergeAmrapScore(score: WorkoutStructureConfig["score"], patch: Partial<Omit<AmrapScore, "type">>): AmrapScore {
  const base: AmrapScore = score?.type === "amrap" ? score : { type: "amrap", rounds: 0 };
  return { ...base, ...patch, type: "amrap" };
}

function mergeRoundsScore(score: WorkoutStructureConfig["score"], patch: Partial<Omit<RoundsScore, "type">>): RoundsScore {
  const base: RoundsScore = score?.type === "rounds" ? score : { type: "rounds", completedRounds: 0 };
  return { ...base, ...patch, type: "rounds" };
}

export function WorkoutStructureEditor({
  value,
  onChange,
  showFormatField = true,
  showScoreControls = false,
  onScoreChange,
  linking,
}: Props) {
  const update = <K extends keyof WorkoutStructureConfig>(key: K, next: WorkoutStructureConfig[K]) =>
    onChange({ ...value, [key]: next });

  const parsePositiveInt = (raw: string): number | undefined => {
    if (!raw.trim()) return undefined;
    const parsed = Number(raw);
    if (!Number.isFinite(parsed)) return undefined;
    const normalized = Math.trunc(parsed);
    return normalized > 0 ? normalized : undefined;
  };
  const parseEmomDurationMinutes = (raw: string): number | undefined => {
    const parsed = parsePositiveInt(raw);
    return parsed === undefined ? undefined : Math.min(parsed, MAX_EMOM_DURATION_MINUTES);
  };
  const reorderStep = (index: number, direction: -1 | 1) => {
    const destination = index + direction;
    if (destination < 0 || destination >= value.steps.length) return;
    const steps = [...value.steps];
    const [item] = steps.splice(index, 1);
    steps.splice(destination, 0, item);
    update("steps", steps);
  };
  const addWorkStep = () =>
    update("steps", [
      ...value.steps,
      { id: crypto.randomUUID(), type: "work", exercise: UNASSIGNED_WORK_STEP_LABEL },
    ]);
  const changeStepType = (index: number, nextType: StepType) => {
    const steps = [...value.steps];
    const base = { ...steps[index], type: nextType };
    steps[index] = nextType === "work" ? base : { ...base, exercise: undefined };
    update("steps", steps);
  };
  const changeStepDuration = (index: number, raw: string) => {
    const steps = [...value.steps];
    steps[index] = { ...steps[index], durationSeconds: raw ? Number(raw) : undefined };
    update("steps", steps);
  };
  const removeStep = (index: number) =>
    update("steps", value.steps.filter((_, i) => i !== index));

  const updateScore = (score: StructureBlockScore | null) => {
    if (value.id && onScoreChange) {
      onScoreChange(value.id, score);
      return;
    }
    onChange({ ...value, score });
  };

  const blockTypeOptions = blockTypeOptionsFor(value.blockType);
  const guide = isGuidedFormat(value.blockType) ? FORMAT_GUIDE[value.blockType] : null;
  const movementsHint = guide?.movementsHint ?? "Add the steps that make up this block.";

  return (
    <div className="space-y-4">
      <section className="space-y-3" aria-label="Block setup">
        <Label className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
          Set up
        </Label>
        <div className="grid gap-3 sm:grid-cols-2">
          {showFormatField && (
            <div>
              <Label className="text-xs">Format</Label>
              <Select value={value.blockType} onValueChange={(v) => update("blockType", v as BlockType)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {blockTypeOptions.map((s) => <SelectItem key={s} value={s}>{BLOCK_TYPE_LABELS[s]}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          )}
          <div>
            <Label className="text-xs">Workout section</Label>
            <Select value={value.section} onValueChange={(v) => update("section", v as WorkoutSection)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {sections.map((s) => <SelectItem key={s} value={s}>{sectionLabel(s)}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          {value.blockType === "emom" && (
            <SetupNumberField
              label={FORMAT_GUIDE.emom.setupLabel}
              hint={FORMAT_GUIDE.emom.setupHint}
              value={value.emomDurationMinutes}
              min={1}
              max={MAX_EMOM_DURATION_MINUTES}
              placeholder="e.g. 10"
              onChange={(raw) => update("emomDurationMinutes", parseEmomDurationMinutes(raw))}
            />
          )}
          {value.blockType === "amrap" && (
            <SetupNumberField
              label={FORMAT_GUIDE.amrap.setupLabel}
              hint={FORMAT_GUIDE.amrap.setupHint}
              value={value.timeCapMinutes}
              min={1}
              placeholder="e.g. 12"
              onChange={(raw) => update("timeCapMinutes", parsePositiveInt(raw))}
            />
          )}
          {value.blockType === "rounds" && (
            <SetupNumberField
              label={FORMAT_GUIDE.rounds.setupLabel}
              hint={FORMAT_GUIDE.rounds.setupHint}
              value={value.roundCount}
              min={1}
              placeholder="e.g. 3"
              onChange={(raw) => update("roundCount", parsePositiveInt(raw))}
            />
          )}
        </div>
      </section>

      <section className="space-y-2" aria-label="Movements">
        <div>
          <Label className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
            Movements
          </Label>
          <p className="text-xs text-muted-foreground">{movementsHint}</p>
        </div>
        {value.steps.map((step, idx) => (
          <MovementRow
            key={step.id}
            step={step}
            index={idx}
            blockType={value.blockType}
            isFirst={idx === 0}
            isLast={idx === value.steps.length - 1}
            linking={linking}
            onChangeType={(next) => changeStepType(idx, next)}
            onChangeDuration={(raw) => changeStepDuration(idx, raw)}
            onMoveUp={() => reorderStep(idx, -1)}
            onMoveDown={() => reorderStep(idx, 1)}
            onRemove={() => removeStep(idx)}
          />
        ))}
        <Button type="button" variant="outline" size="sm" onClick={addWorkStep}>
          <Plus className="mr-1 size-3.5" aria-hidden />
          Add movement
        </Button>
      </section>

      <BlockPreview config={value} />

      {showScoreControls && isGuidedFormat(value.blockType) && (
        <ResultControls value={value} onUpdateScore={updateScore} />
      )}
    </div>
  );
}

function SetupNumberField({
  label,
  hint,
  value,
  min,
  max,
  placeholder,
  onChange,
}: Readonly<{
  label: string;
  hint: string;
  value: number | undefined;
  min: number;
  max?: number;
  placeholder: string;
  onChange: (raw: string) => void;
}>) {
  return (
    <div>
      <Label className="text-xs">{label}</Label>
      <Input
        type="number"
        min={min}
        max={max}
        value={value ?? ""}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
      />
      <p className="mt-1 text-xs text-muted-foreground">{hint}</p>
    </div>
  );
}

interface MovementRowProps {
  readonly step: WorkoutStep;
  readonly index: number;
  readonly blockType: BlockType;
  readonly isFirst: boolean;
  readonly isLast: boolean;
  readonly linking?: StepLinking;
  readonly onChangeType: (next: StepType) => void;
  readonly onChangeDuration: (raw: string) => void;
  readonly onMoveUp: () => void;
  readonly onMoveDown: () => void;
  readonly onRemove: () => void;
}

function MovementRow({
  step,
  index,
  blockType,
  isFirst,
  isLast,
  linking,
  onChangeType,
  onChangeDuration,
  onMoveUp,
  onMoveDown,
  onRemove,
}: MovementRowProps) {
  const positionLabel = stepPositionLabel(blockType, index);
  const blockStep = linking?.block.steps[index];

  return (
    <div className="space-y-2 rounded-md border border-border bg-background p-2.5" data-testid="structure-block-step">
      <div className="flex items-center gap-2">
        <span className="shrink-0 rounded bg-muted px-1.5 py-0.5 text-[11px] font-medium text-muted-foreground">
          {positionLabel}
        </span>
        <Select value={step.type} onValueChange={(v) => onChangeType(v as StepType)}>
          <SelectTrigger className="h-8 w-[8.5rem]" aria-label={`${positionLabel} type`}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {stepTypes.map((t) => <SelectItem key={t} value={t}>{STEP_TYPE_LABELS[t]}</SelectItem>)}
          </SelectContent>
        </Select>
        <div className="ml-auto flex items-center gap-0.5">
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="size-7"
            onClick={onMoveUp}
            disabled={isFirst}
            aria-label={`Move ${positionLabel} earlier`}
          >
            <ArrowUp className="size-3.5" aria-hidden />
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="size-7"
            onClick={onMoveDown}
            disabled={isLast}
            aria-label={`Move ${positionLabel} later`}
          >
            <ArrowDown className="size-3.5" aria-hidden />
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="size-7"
            onClick={onRemove}
            aria-label={`Remove ${positionLabel}`}
          >
            <X className="size-3.5" aria-hidden />
          </Button>
        </div>
      </div>

      {step.type === "work" ? (
        <WorkStepBody step={step} blockStep={blockStep} linking={linking} />
      ) : (
        <p className="text-xs text-muted-foreground">
          {step.type === "rest" ? "Rest" : "Transition"}
          {step.target ? ` — ${step.target}` : ""}
        </p>
      )}

      <div className="flex items-center gap-2">
        <Label className="text-[11px] text-muted-foreground">Time</Label>
        <Input
          className="h-8 w-24"
          type="number"
          min={0}
          placeholder="Sec"
          value={step.durationSeconds ?? ""}
          onChange={(e) => onChangeDuration(e.target.value)}
          aria-label={`${positionLabel} duration in seconds`}
        />
        <span className="text-[11px] text-muted-foreground">optional</span>
      </div>
    </div>
  );
}

function WorkStepBody({
  step,
  blockStep,
  linking,
}: Readonly<{
  step: WorkoutStep;
  blockStep?: StructureStep;
  linking?: StepLinking;
}>) {
  const namedExercise =
    step.exercise && step.exercise !== UNASSIGNED_WORK_STEP_LABEL ? step.exercise : null;

  if (!linking || !blockStep) {
    return (
      <div className="text-xs text-muted-foreground">
        <p>{namedExercise ?? "Movement"}</p>
        {step.target ? <p>{step.target}</p> : null}
      </div>
    );
  }

  const blockId = linking.block.id;
  const linkedGroups = blockId
    ? linking.groups.filter((group) => groupMatchesBlockStep(group, blockId, blockStep.stepNumber))
    : [];
  const showPlaceholder = !namedExercise && linkedGroups.length === 0;

  return (
    <div className="space-y-1.5">
      {namedExercise ? <p className="text-xs font-medium text-foreground">{namedExercise}</p> : null}
      {showPlaceholder ? <p className="text-xs text-muted-foreground">Movement</p> : null}
      {step.target ? <p className="text-xs text-muted-foreground">{step.target}</p> : null}
      {linkedGroups.map((group) => (
        <div
          key={groupOptionValue(group)}
          className="rounded bg-muted/60 px-2 py-1 text-xs text-muted-foreground"
          data-testid="structure-block-linked-row"
        >
          {formatExerciseSummary(group, linking.weightUnit, linking.distanceUnit)}
        </div>
      ))}
      <StepLinkActions
        block={linking.block}
        step={blockStep}
        hasLinkedRows={linkedGroups.length > 0}
        linking={linking}
      />
    </div>
  );
}

function StepLinkActions({
  block,
  step,
  hasLinkedRows,
  linking,
}: Readonly<{
  block: StructureBlockInput;
  step: StructureStep;
  hasLinkedRows: boolean;
  linking: StepLinking;
}>) {
  const hasAssignAction = Boolean(linking.onAssignGroup && linking.unassignedGroups.length > 0);
  const hasAddAction = Boolean(linking.onAddLinkedRow);
  // Only flag a missing link when there is actually a way to fix it —
  // otherwise (e.g. the confirm step, which has no exercise rows) the
  // movement row would show a dead-end warning.
  const showMissingState = !hasLinkedRows && (hasAssignAction || hasAddAction);
  if (!showMissingState && !hasAssignAction && !hasAddAction) return null;

  const positionLabel =
    block.formatType === "emom"
      ? `Min ${step.minuteIndex ?? step.stepNumber}`
      : `Step ${step.stepNumber}`;

  return (
    <div
      className={`flex flex-wrap items-center gap-2 rounded-md px-2 py-2 text-xs ${
        showMissingState
          ? "border border-dashed border-amber-300 bg-amber-500/10"
          : "border border-border bg-muted/30"
      }`}
    >
      {showMissingState ? (
        <span
          className="flex items-center gap-1 font-medium text-amber-800 dark:text-amber-200"
          data-testid="structure-block-missing-link"
        >
          <Link2 className="size-3.5" aria-hidden />
          No exercise row linked.
        </span>
      ) : null}
      {linking.onAssignGroup && linking.unassignedGroups.length > 0 ? (
        <AssignGroupSelect
          groups={linking.unassignedGroups}
          weightUnit={linking.weightUnit}
          distanceUnit={linking.distanceUnit}
          onAssign={(group) => linking.onAssignGroup?.(group, block, step)}
          label={`Assign row to ${positionLabel}`}
        />
      ) : null}
      {linking.onAddLinkedRow ? (
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="h-8"
          onClick={() => linking.onAddLinkedRow?.(block, step)}
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
  const ASSIGN_SELECT_VALUE = "assign";
  return (
    <Select
      value={ASSIGN_SELECT_VALUE}
      onValueChange={(value) => {
        const group = groups.find((candidate) => groupOptionValue(candidate) === value);
        if (group) onAssign(group);
      }}
    >
      <SelectTrigger
        className="h-8 w-full min-w-[9rem] sm:w-[12rem]"
        aria-label={label}
        data-testid="structure-block-assign-row"
      >
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

function PreviewShell({ children }: { readonly children: ReactNode }) {
  return (
    <div
      className="rounded-md border border-primary/20 bg-primary/5 px-3 py-2 text-xs"
      data-testid="structure-block-preview"
    >
      <p className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-primary">At a glance</p>
      {children}
    </div>
  );
}

function BlockPreview({ config }: { readonly config: WorkoutStructureConfig }) {
  if (config.blockType === "emom") return <EmomBlockPreview config={config} />;
  if (config.blockType === "amrap") {
    const stepCount = config.steps.length;
    return (
      <StepSequencePreview
        summary={`Repeat ${stepCount} step${stepCount === 1 ? "" : "s"} until ${config.timeCapMinutes ?? "the"} min cap.`}
        steps={config.steps}
      />
    );
  }
  if (config.blockType === "rounds") {
    const stepCount = config.steps.length;
    return (
      <StepSequencePreview
        summary={`Complete ${config.roundCount ?? "the prescribed"} round${config.roundCount === 1 ? "" : "s"} of ${stepCount} step${stepCount === 1 ? "" : "s"}.`}
        steps={config.steps}
      />
    );
  }
  return null;
}

function StepSequencePreview({ summary, steps }: Readonly<{ summary: string; steps: readonly WorkoutStep[] }>) {
  return (
    <PreviewShell>
      <p className="font-medium text-foreground">{summary}</p>
      <p className="mt-1 truncate text-muted-foreground">{steps.map(configStepWithTarget).join(" -> ")}</p>
    </PreviewShell>
  );
}

function EmomBlockPreview({ config }: { readonly config: WorkoutStructureConfig }) {
  const preview = buildEmomPreview(config);
  if (preview.minutes.length === 0) {
    return (
      <PreviewShell>
        <p className="text-muted-foreground">Set a length and add at least one movement to see the minute-by-minute plan.</p>
      </PreviewShell>
    );
  }
  const visibleMinutes = preview.minutes.slice(0, 8);
  const hiddenCount = preview.minutes.length - visibleMinutes.length;
  return (
    <PreviewShell>
      <p className="font-medium text-foreground">
        {config.emomDurationMinutes ?? preview.minutes.length}-minute EMOM ·{" "}
        {preview.patternLength} movement{preview.patternLength === 1 ? "" : "s"} on repeat
      </p>
      <div className="mt-2 flex flex-wrap gap-1.5">
        {visibleMinutes.map(({ minute, step }) => (
          <span key={`emom-preview-${minute}`} className="rounded-full bg-background px-2 py-0.5 text-muted-foreground">
            Min {minute}: {configStepLabel(step)}
          </span>
        ))}
        {hiddenCount > 0 ? (
          <span className="rounded-full bg-background px-2 py-0.5 text-muted-foreground">
            +{hiddenCount} more
          </span>
        ) : null}
      </div>
    </PreviewShell>
  );
}

function ResultControls({
  value,
  onUpdateScore,
}: Readonly<{
  value: WorkoutStructureConfig;
  onUpdateScore: (score: StructureBlockScore | null) => void;
}>) {
  const emomScore = value.score?.type === "emom" ? value.score : null;
  const amrapScore = value.score?.type === "amrap" ? value.score : null;
  const roundsScore = value.score?.type === "rounds" ? value.score : null;

  const handleNotesChange = (raw = "") => {
    const notes = raw.length > 0 ? raw : null;
    if (value.blockType === "emom") onUpdateScore(mergeEmomScore(value.score, { notes }));
    if (value.blockType === "amrap") onUpdateScore(mergeAmrapScore(value.score, { notes }));
    if (value.blockType === "rounds") onUpdateScore(mergeRoundsScore(value.score, { notes }));
  };

  return (
    <section
      className="space-y-3 rounded-md border border-primary/25 bg-primary/5 p-3"
      data-testid="structure-block-result"
      aria-label="Block result"
    >
      <div>
        <p className="text-[11px] font-semibold uppercase tracking-wide text-primary">How did it go?</p>
        <p className="text-xs text-muted-foreground">Fill this in after the workout to record your result.</p>
      </div>

      {value.blockType === "emom" && (
        <div className="grid gap-3 sm:grid-cols-3">
          <div>
            <Label className="text-xs">Finished it</Label>
            <Button
              type="button"
              className="mt-1 w-full"
              variant={emomScore?.completed ? "default" : "outline"}
              aria-pressed={emomScore?.completed ?? false}
              onClick={() => onUpdateScore(mergeEmomScore(value.score, { completed: !emomScore?.completed }))}
            >
              {emomScore?.completed ? "Completed" : "Mark completed"}
            </Button>
          </div>
          <ResultNumberField
            label="Minutes completed"
            ariaLabel="Completed minutes"
            placeholder="e.g. 10"
            value={emomScore?.completedMinutes}
            onChange={(num) => onUpdateScore(mergeEmomScore(value.score, { completedMinutes: num }))}
          />
          <ResultNumberField
            label="Reps missed"
            ariaLabel="Missed reps"
            placeholder="e.g. 0"
            value={emomScore?.missedReps}
            onChange={(num) => onUpdateScore(mergeEmomScore(value.score, { missedReps: num }))}
          />
        </div>
      )}

      {value.blockType === "amrap" && (
        <div className="grid gap-3 sm:grid-cols-2">
          <ResultNumberField
            label="Full rounds done"
            ariaLabel="AMRAP rounds"
            placeholder="e.g. 5"
            value={amrapScore?.rounds}
            onChange={(num) => onUpdateScore(mergeAmrapScore(value.score, { rounds: num ?? 0 }))}
          />
          <ResultNumberField
            label="Extra reps in last round"
            ariaLabel="AMRAP extra reps"
            placeholder="e.g. 12"
            value={amrapScore?.reps}
            onChange={(num) => onUpdateScore(mergeAmrapScore(value.score, { reps: num }))}
          />
        </div>
      )}

      {value.blockType === "rounds" && (
        <div className="grid gap-3 sm:grid-cols-2">
          <ResultNumberField
            label="Rounds completed"
            ariaLabel="Completed rounds"
            placeholder="e.g. 3"
            value={roundsScore?.completedRounds}
            onChange={(num) => onUpdateScore(mergeRoundsScore(value.score, { completedRounds: num ?? 0 }))}
          />
          <ResultNumberField
            label="Total time (seconds)"
            ariaLabel="Elapsed time in seconds"
            placeholder="e.g. 480"
            value={roundsScore?.elapsedSeconds}
            onChange={(num) => onUpdateScore(mergeRoundsScore(value.score, { elapsedSeconds: num }))}
          />
        </div>
      )}

      <div>
        <Label className="text-xs">Notes</Label>
        <Input
          aria-label="Result notes"
          placeholder="Result notes"
          value={value.score?.notes ?? ""}
          onChange={(e) => handleNotesChange(e.target.value)}
        />
      </div>
    </section>
  );
}

function ResultNumberField({
  label,
  ariaLabel,
  placeholder,
  value,
  onChange,
}: Readonly<{
  label: string;
  ariaLabel: string;
  placeholder: string;
  value: number | null | undefined;
  onChange: (next: number | null) => void;
}>) {
  return (
    <div>
      <Label className="text-xs">{label}</Label>
      <Input
        type="number"
        min={0}
        aria-label={ariaLabel}
        placeholder={placeholder}
        value={value ?? ""}
        onChange={(e) => onChange(e.target.value ? Number(e.target.value) : null)}
      />
    </div>
  );
}
