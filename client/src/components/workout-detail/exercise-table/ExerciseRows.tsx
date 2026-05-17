import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { EXERCISE_DEFINITIONS, type ExerciseName } from "@shared/schema";
import { ChevronDown, GripVertical, MoreVertical, Repeat, Trash2 } from "lucide-react";
import { type CSSProperties, memo, useCallback, useMemo, useState } from "react";

import {
  formatPrescription,
  type VisualSegment,
} from "@/components/exercise-row/formatPrescription";
import { InlineSetEditor } from "@/components/exercise-row/InlineSetEditor";
import { ExerciseSelector } from "@/components/ExerciseSelector";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import type { AddExerciseSetPayload, PatchExerciseSetPayload } from "@/lib/api";
import { categoryColor } from "@/lib/categoryColors";
import { getExerciseLabel, type GroupedExercise } from "@/lib/exerciseUtils";
import { cn } from "@/lib/utils";
import {
  assignmentPatchForValue,
  assignmentValueForGroup,
  type BlockAssignmentOption,
  UNASSIGNED_BLOCK_VALUE,
} from "@/lib/workoutStructureAssignments";

import {
  buildPlannedDiffSummary,
  buildPrimaryMetric,
  computeUniformity,
  shouldShowLoad,
} from "./metrics";

export function ExerciseRowRenderer({
  groups,
  rowKeys,
  expandedKeys,
  weightUnit,
  distanceUnit,
  onToggle,
  onUpdateSet,
  onAddSet,
  onDeleteSet,
  readableSummary,
  showPlannedDiffs,
  blockAssignmentOptions,
}: Readonly<{
  groups: readonly GroupedExercise[];
  rowKeys: readonly string[];
  expandedKeys: ReadonlySet<string>;
  weightUnit: "kg" | "lb";
  distanceUnit: "km" | "miles";
  onToggle: (rowKey: string) => void;
  onUpdateSet: (setId: string, data: PatchExerciseSetPayload) => void;
  onAddSet: (data: AddExerciseSetPayload) => void;
  onDeleteSet: (setId: string) => void;
  readableSummary: boolean;
  showPlannedDiffs: boolean;
  blockAssignmentOptions: readonly BlockAssignmentOption[];
}>) {
  return groups.map((group, idx) => {
    const rowKey = rowKeys[idx];
    const isExpanded = expandedKeys.has(rowKey);

    return (
      <SortableGroupRow
        key={rowKey}
        rowKey={rowKey}
        group={group}
        weightUnit={weightUnit}
        distanceUnit={distanceUnit}
        isExpanded={isExpanded}
        onToggle={onToggle}
        onUpdateSet={onUpdateSet}
        onAddSet={onAddSet}
        onDeleteSet={onDeleteSet}
        readableSummary={readableSummary}
        showPlannedDiffs={showPlannedDiffs}
        blockAssignmentOptions={blockAssignmentOptions}
      />
    );
  });
}

type SortableAttrs = ReturnType<typeof useSortable>;

interface DragHandleProps {
  readonly attributes: SortableAttrs["attributes"];
  readonly listeners: SortableAttrs["listeners"];
}

interface GroupRowProps {
  readonly rowKey: string;
  readonly group: GroupedExercise;
  readonly weightUnit: "kg" | "lb";
  readonly distanceUnit: "km" | "miles";
  readonly isExpanded: boolean;
  readonly onToggle: (rowKey: string) => void;
  readonly onUpdateSet: (setId: string, data: PatchExerciseSetPayload) => void;
  readonly onAddSet: (data: AddExerciseSetPayload) => void;
  readonly onDeleteSet: (setId: string) => void;
  readonly readableSummary: boolean;
  readonly showPlannedDiffs: boolean;
  readonly blockAssignmentOptions: readonly BlockAssignmentOption[];
  /**
   * Sortable attrs + listeners forwarded from `SortableGroupRow`. Applied
   * to the leading `GripVertical` button so the handle, and only the
   * handle, initiates drag. Optional so legacy tests can render
   * `GroupRow` without a `DndContext`; the handle renders inert there.
   */
  readonly dragHandleProps?: DragHandleProps;
}

function SortableGroupRow(props: GroupRowProps) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: props.rowKey });

  const style: CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.6 : 1,
    position: "relative",
    zIndex: isDragging ? 20 : undefined,
  };

  const dragHandleProps = useMemo(
    () => ({ attributes, listeners }),
    [attributes, listeners],
  );

  return (
    <div ref={setNodeRef} style={style}>
      <GroupRow {...props} dragHandleProps={dragHandleProps} />
    </div>
  );
}

function DragHandle({
  dragHandleProps,
  label,
}: Readonly<{ dragHandleProps?: DragHandleProps; label: string }>) {
  if (!dragHandleProps) {
    return <span aria-hidden className="block w-4" />;
  }
  return (
    <button
      type="button"
      aria-label={`Reorder ${label}`}
      data-testid="exercise-row-drag-handle"
      className="-ml-1 flex h-7 w-6 shrink-0 cursor-grab touch-none items-center justify-center rounded text-muted-foreground hover:text-foreground active:cursor-grabbing focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
      {...dragHandleProps.attributes}
      {...dragHandleProps.listeners}
    >
      <GripVertical className="size-4" aria-hidden />
    </button>
  );
}

interface BlockAssignmentPickerProps {
  readonly value: string;
  readonly options: readonly BlockAssignmentOption[];
  readonly onAssign: (value: string) => void;
}

function BlockAssignmentPickerItems({
  value,
  options,
  onAssign,
}: Readonly<BlockAssignmentPickerProps>) {
  return (
    <DropdownMenuRadioGroup value={value} onValueChange={onAssign}>
      <DropdownMenuRadioItem value={UNASSIGNED_BLOCK_VALUE}>
        No block assignment
      </DropdownMenuRadioItem>
      <DropdownMenuSeparator />
      {options.map((option) => (
        <DropdownMenuRadioItem key={option.value} value={option.value}>
          {option.label}
        </DropdownMenuRadioItem>
      ))}
    </DropdownMenuRadioGroup>
  );
}

function BlockAssignmentBadge({
  label,
  value,
  options,
  onAssign,
}: Readonly<BlockAssignmentPickerProps & { readonly label: string }>) {
  if (options.length === 0 || value === UNASSIGNED_BLOCK_VALUE) return null;
  const option = options.find((candidate) => candidate.value === value);
  if (!option) return null;
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          className="hidden max-w-[9rem] shrink-0 truncate rounded-full bg-primary/10 px-2 py-1 text-[11px] font-medium text-primary hover:bg-primary/15 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring sm:inline-block"
          title={option.label}
          aria-label={`Block assignment for ${label}: ${option.label}`}
          data-testid="exercise-row-block-assignment"
        >
          {option.label}
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="max-h-72 min-w-56 overflow-y-auto">
        <BlockAssignmentPickerItems value={value} options={options} onAssign={onAssign} />
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function BlockAssignmentAction({
  value,
  options,
  onAssign,
}: Readonly<BlockAssignmentPickerProps>) {
  if (options.length === 0) return null;
  return (
    <DropdownMenuSub>
      <DropdownMenuSubTrigger>Block assignment</DropdownMenuSubTrigger>
      <DropdownMenuSubContent className="max-h-72 min-w-56 overflow-y-auto">
        <BlockAssignmentPickerItems value={value} options={options} onAssign={onAssign} />
      </DropdownMenuSubContent>
    </DropdownMenuSub>
  );
}

const GroupRow = memo(function GroupRow({
  rowKey,
  group,
  weightUnit,
  distanceUnit,
  isExpanded,
  onToggle,
  onUpdateSet,
  onAddSet,
  onDeleteSet,
  readableSummary,
  showPlannedDiffs,
  blockAssignmentOptions,
  dragHandleProps,
}: GroupRowProps) {
  const handleToggle = useCallback(() => onToggle(rowKey), [onToggle, rowKey]);
  const label = getExerciseLabel(group.exerciseName, group.customLabel);
  const color = categoryColor(group.category);
  const lowConfidence = typeof group.confidence === "number" && group.confidence < 60;
  const [changeExerciseOpen, setChangeExerciseOpen] = useState(false);
  const uniformity = useMemo(() => computeUniformity(group.sets), [group.sets]);
  const setCount = group.sets.length;

  const metric = useMemo(
    () => buildPrimaryMetric(group.exerciseName, uniformity, distanceUnit),
    [group.exerciseName, uniformity, distanceUnit],
  );
  const hasWeight = useMemo(
    () => shouldShowLoad(group, metric.field),
    [group, metric.field],
  );
  const loadVaries = uniformity.weightVaries;

  const handleDeleteRow = () => {
    for (const s of group.sets) onDeleteSet(s.id);
  };

  const handlePickExercise = (name: ExerciseName) => {
    const def = EXERCISE_DEFINITIONS[name];
    for (const s of group.sets) {
      onUpdateSet(s.id, {
        exerciseName: name,
        category: def.category,
        customLabel: null,
      });
    }
    setChangeExerciseOpen(false);
  };
  const blockAssignmentValue = assignmentValueForGroup(group, blockAssignmentOptions);
  const handleAssignBlock = useCallback((value: string) => {
    const patch = assignmentPatchForValue(value, blockAssignmentOptions);
    for (const set of group.sets) onUpdateSet(set.id, patch);
  }, [blockAssignmentOptions, group.sets, onUpdateSet]);
  const prescription = formatPrescription({
    setCount,
    metricValue: metric.value,
    metricSuffix: metric.suffix ?? "",
    metricVaries: metric.varies,
    weightValue: uniformity.weight,
    weightUnit,
    weightVaries: loadVaries,
    hasWeight,
  });
  const prescriptionSegments = prescription.visual.map((seg) => (
    <PrescriptionSegment key={seg.separator ?? "sets"} segment={seg} />
  ));
  const plannedDiffSummary = showPlannedDiffs
    ? buildPlannedDiffSummary(group.sets, weightUnit, distanceUnit)
    : null;

  const changeExerciseItem = (
    <DropdownMenuItem
      onSelect={() => setChangeExerciseOpen(true)}
      data-testid="exercise-row-change"
    >
      <Repeat className="mr-2 size-4" aria-hidden /> Change exercise
    </DropdownMenuItem>
  );
  const deleteItem = (
    <DropdownMenuItem onSelect={handleDeleteRow} className="text-destructive">
      <Trash2 className="mr-2 size-4" aria-hidden /> Delete
    </DropdownMenuItem>
  );

  return (
    <div className="flex flex-col" data-testid="exercise-row" data-row-key={group.sets[0]?.id}>
      <div className="text-sm">
        <div className="flex items-center gap-2 px-3 py-2 sm:px-4 sm:py-3">
          <DragHandle dragHandleProps={dragHandleProps} label={label} />
          <span
            aria-hidden
            className="inline-block size-2 shrink-0 rounded-full"
            style={{ backgroundColor: color }}
          />
          <span
            className={cn(
              "min-w-0 flex-1 truncate font-medium",
              lowConfidence && "text-muted-foreground",
            )}
            title={lowConfidence ? "Low-confidence parse - expand to review" : label}
          >
            {label}
          </span>
          <BlockAssignmentBadge
            label={label}
            value={blockAssignmentValue}
            options={blockAssignmentOptions}
            onAssign={handleAssignBlock}
          />
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="size-8 text-muted-foreground"
            aria-label={isExpanded ? `Collapse ${label}` : `Expand ${label}`}
            aria-expanded={isExpanded}
            onClick={handleToggle}
            data-testid="exercise-row-toggle"
          >
            <ChevronDown
              className={cn("size-4 transition-transform", isExpanded && "rotate-180")}
              aria-hidden
            />
          </Button>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className="size-8 text-muted-foreground"
                aria-label={`Row actions for ${label}`}
                data-testid="exercise-row-actions"
              >
                <MoreVertical className="size-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              {changeExerciseItem}
              <BlockAssignmentAction
                value={blockAssignmentValue}
                options={blockAssignmentOptions}
                onAssign={handleAssignBlock}
              />
              <DropdownMenuSeparator />
              {deleteItem}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
        {!isExpanded && readableSummary && (
          <button
            type="button"
            onClick={handleToggle}
            aria-label={`Edit ${label}: ${prescription.aria}`}
            className="flex w-full flex-wrap items-center gap-1.5 px-3 pb-2 pl-[50px] text-left text-xs text-muted-foreground sm:px-4 sm:pb-3 sm:pl-[54px] sm:text-sm"
          >
            {prescriptionSegments}
            {plannedDiffSummary && (
              <span
                className="rounded-full bg-amber-500/10 px-2 py-0.5 text-[10px] font-medium text-amber-700 dark:text-amber-300"
                data-testid="exercise-row-planned-diff"
              >
                {plannedDiffSummary}
              </span>
            )}
          </button>
        )}
      </div>

      {isExpanded && (
        <div className="border-t border-border bg-muted/20 px-4 py-3">
          <InlineSetEditor
            sets={group.sets}
            exerciseName={group.exerciseName}
            customLabel={group.customLabel}
            category={group.category}
            weightUnit={weightUnit}
            distanceUnit={distanceUnit}
            onUpdateSet={onUpdateSet}
            onAddSet={onAddSet}
            onDeleteSet={onDeleteSet}
            showPlannedDiffs={showPlannedDiffs}
          />
        </div>
      )}

      <Dialog open={changeExerciseOpen} onOpenChange={setChangeExerciseOpen}>
        <DialogContent className="max-w-lg" data-testid="exercise-change-dialog">
          <DialogHeader>
            <DialogTitle>Change exercise</DialogTitle>
            <DialogDescription>
              Replace {label} with another exercise. Your reps, weight, and other set
              values stay the same.
            </DialogDescription>
          </DialogHeader>
          <div className="max-h-[60vh] overflow-y-auto pr-1">
            <ExerciseSelector selectedExercises={[]} onToggle={handlePickExercise} />
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
});

function PrescriptionSegment({ segment }: Readonly<{ segment: VisualSegment }>) {
  return (
    <>
      {segment.separator && (
        <span aria-hidden className="text-muted-foreground/60">
          {segment.separator === "times" ? "×" : "·"}
        </span>
      )}
      <span>{segment.text}</span>
    </>
  );
}
