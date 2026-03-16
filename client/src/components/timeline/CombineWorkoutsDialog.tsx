import { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Loader2, ArrowRight, Clock, Flame } from "lucide-react";
import type { TimelineEntry } from "@shared/schema";

type FieldSource = "entry1" | "entry2" | "both" | "custom";

interface CombineWorkoutsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  entry1: TimelineEntry | null;
  entry2: TimelineEntry | null;
  onConfirm: (combinedWorkout: {
    date: string;
    focus: string;
    mainWorkout: string;
    duration?: number;
    calories?: number;
    notes?: string;
  }) => void;
  isPending: boolean;
}

export function CombineWorkoutsDialog({
  open,
  onOpenChange,
  entry1,
  entry2,
  onConfirm,
  isPending,
}: CombineWorkoutsDialogProps) {
  const [focusSource, setFocusSource] = useState<FieldSource>("both");
  const [workoutSource, setWorkoutSource] = useState<FieldSource>("both");
  const [notesSource, setNotesSource] = useState<FieldSource>("both");
  const [customFocus, setCustomFocus] = useState("");
  const [customWorkout, setCustomWorkout] = useState("");
  const [customNotes, setCustomNotes] = useState("");

  if (!entry1 || !entry2) return null;

  const getFieldValue = (
    source: FieldSource,
    val1: string | null | undefined,
    val2: string | null | undefined,
    customVal: string,
    separator: string = " + "
  ): string => {
    switch (source) {
      case "entry1":
        return val1 || "";
      case "entry2":
        return val2 || "";
      case "both":
        return [val1, val2].filter(Boolean).join(separator);
      case "custom":
        return customVal;
      default:
        return "";
    }
  };

  const handleConfirm = () => {
    const combinedDuration = (entry1.duration || 0) + (entry2.duration || 0);
    const combinedCalories = (entry1.calories || 0) + (entry2.calories || 0);

    const combinedWorkout = {
      date: entry1.date,
      focus: getFieldValue(focusSource, entry1.focus, entry2.focus, customFocus),
      mainWorkout: getFieldValue(workoutSource, entry1.mainWorkout, entry2.mainWorkout, customWorkout, "\n---\n"),
      duration: combinedDuration || undefined,
      calories: combinedCalories || undefined,
      notes: getFieldValue(notesSource, entry1.notes, entry2.notes, customNotes, "\n\n") || undefined,
    };

    onConfirm(combinedWorkout);
  };

  const resetState = () => {
    setFocusSource("both");
    setWorkoutSource("both");
    setNotesSource("both");
    setCustomFocus("");
    setCustomWorkout("");
    setCustomNotes("");
  };

  const handleOpenChange = (newOpen: boolean) => {
    if (!newOpen) {
      resetState();
    }
    onOpenChange(newOpen);
  };

  const combinedDuration = (entry1.duration || 0) + (entry2.duration || 0);
  const combinedCalories = (entry1.calories || 0) + (entry2.calories || 0);

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="max-w-4xl max-h-[90vh]">
        <DialogHeader>
          <DialogTitle>Combine Workouts</DialogTitle>
          <DialogDescription>
            Compare both workouts side by side and choose which fields to keep.
          </DialogDescription>
        </DialogHeader>

        <ScrollArea className="max-h-[65vh] pr-4">
          <div className="space-y-6">
            {/* Side-by-side workout comparison */}
            <div className="grid grid-cols-2 gap-4">
              <WorkoutCard
                label="Workout 1"
                entry={entry1}
                variant="primary"
              />
              <WorkoutCard
                label="Workout 2"
                entry={entry2}
                variant="secondary"
              />
            </div>

            {/* Combined result summary */}
            <div className="rounded-md border p-4 bg-muted/30">
              <Label className="text-sm font-medium">Combined Result (auto-summed)</Label>
              <div className="mt-2 flex flex-wrap gap-4 text-sm">
                {combinedDuration > 0 && (
                  <div className="flex items-center gap-1.5 text-muted-foreground">
                    <Clock className="h-4 w-4" />
                    <span>{combinedDuration} min total</span>
                  </div>
                )}
                {combinedCalories > 0 && (
                  <div className="flex items-center gap-1.5 text-muted-foreground">
                    <Flame className="h-4 w-4" />
                    <span>{combinedCalories} cal total</span>
                  </div>
                )}
              </div>
            </div>

            {/* Field selection */}
            <div className="space-y-4">
              <Label className="text-base font-semibold">Choose what to keep for each field</Label>
              
              <FieldSelector
                label="Focus"
                entry1Value={entry1.focus}
                entry2Value={entry2.focus}
                source={focusSource}
                onSourceChange={setFocusSource}
                customValue={customFocus}
                onCustomChange={setCustomFocus}
              />

              <FieldSelector
                label="Main Workout"
                entry1Value={entry1.mainWorkout}
                entry2Value={entry2.mainWorkout}
                source={workoutSource}
                onSourceChange={setWorkoutSource}
                customValue={customWorkout}
                onCustomChange={setCustomWorkout}
                isTextArea
              />

              <FieldSelector
                label="Notes"
                entry1Value={entry1.notes}
                entry2Value={entry2.notes}
                source={notesSource}
                onSourceChange={setNotesSource}
                customValue={customNotes}
                onCustomChange={setCustomNotes}
                isTextArea
              />
            </div>
          </div>
        </ScrollArea>

        <DialogFooter className="gap-2">
          <Button
            variant="outline"
            onClick={() => handleOpenChange(false)}
            disabled={isPending}
            data-testid="button-cancel-combine"
          >
            Cancel
          </Button>
          <Button
            onClick={handleConfirm}
            disabled={isPending}
            data-testid="button-confirm-combine"
          >
            {isPending ? (
              <>
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                Combining...
              </>
            ) : (
              <>
                Combine Workouts
                <ArrowRight className="h-4 w-4 ml-2" />
              </>
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

interface WorkoutCardProps {
  label: string;
  entry: TimelineEntry;
  variant: "primary" | "secondary";
}

function WorkoutCard({ label, entry, variant }: WorkoutCardProps) {
  const truncate = (text: string | null | undefined, maxLen: number = 150) => {
    if (!text) return null;
    if (text.length <= maxLen) return text;
    return text.substring(0, maxLen) + "...";
  };

  return (
    <Card className="p-4 space-y-3" data-testid={`card-workout-${variant}`}>
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <Badge variant={variant === "primary" ? "default" : "secondary"}>
          {label}
        </Badge>
        <div className="flex items-center gap-3 text-sm text-muted-foreground">
          {entry.duration && (
            <span className="flex items-center gap-1">
              <Clock className="h-3.5 w-3.5" />
              {entry.duration}m
            </span>
          )}
          {entry.calories && (
            <span className="flex items-center gap-1">
              <Flame className="h-3.5 w-3.5" />
              {entry.calories}
            </span>
          )}
        </div>
      </div>

      <div className="space-y-2">
        <div>
          <Label className="text-xs text-muted-foreground uppercase tracking-wide">Focus</Label>
          <p className="text-sm font-medium mt-0.5">{entry.focus || "(none)"}</p>
        </div>

        <div>
          <Label className="text-xs text-muted-foreground uppercase tracking-wide">Main Workout</Label>
          <p className="text-sm mt-0.5 whitespace-pre-wrap">{truncate(entry.mainWorkout) || "(none)"}</p>
        </div>

        {entry.notes && (
          <div>
            <Label className="text-xs text-muted-foreground uppercase tracking-wide">Notes</Label>
            <p className="text-sm mt-0.5 text-muted-foreground whitespace-pre-wrap">{truncate(entry.notes, 100)}</p>
          </div>
        )}
      </div>
    </Card>
  );
}

interface FieldSelectorProps {
  label: string;
  entry1Value: string | null | undefined;
  entry2Value: string | null | undefined;
  source: FieldSource;
  onSourceChange: (source: FieldSource) => void;
  customValue: string;
  onCustomChange: (value: string) => void;
  isTextArea?: boolean;
}

function FieldSelector({
  label,
  entry1Value,
  entry2Value,
  source,
  onSourceChange,
  customValue,
  onCustomChange,
  isTextArea = false,
}: FieldSelectorProps) {
  const labelId = label.toLowerCase().replaceAll(/\s+/g, "-");

  return (
    <div className="rounded-md border p-3 space-y-2">
      <Label className="text-sm font-medium">{label}</Label>
      
      <RadioGroup
        value={source}
        onValueChange={(val) => onSourceChange(val as FieldSource)}
        className="flex flex-wrap gap-4"
      >
        <div className="flex items-center gap-2">
          <RadioGroupItem value="entry1" id={`${labelId}-entry1`} />
          <Label htmlFor={`${labelId}-entry1`} className="font-normal cursor-pointer text-sm">
            Workout 1
          </Label>
        </div>
        
        <div className="flex items-center gap-2">
          <RadioGroupItem value="entry2" id={`${labelId}-entry2`} />
          <Label htmlFor={`${labelId}-entry2`} className="font-normal cursor-pointer text-sm">
            Workout 2
          </Label>
        </div>
        
        <div className="flex items-center gap-2">
          <RadioGroupItem value="both" id={`${labelId}-both`} />
          <Label htmlFor={`${labelId}-both`} className="font-normal cursor-pointer text-sm">
            Combine both
          </Label>
        </div>
        
        <div className="flex items-center gap-2">
          <RadioGroupItem value="custom" id={`${labelId}-custom`} />
          <Label htmlFor={`${labelId}-custom`} className="font-normal cursor-pointer text-sm">
            Custom
          </Label>
        </div>
      </RadioGroup>

      {source === "custom" && (
        <Textarea
          value={customValue}
          onChange={(e) => onCustomChange(e.target.value)}
          placeholder={`Enter custom ${label.toLowerCase()}...`}
          rows={isTextArea ? 3 : 2}
          className="mt-2"
          data-testid={`input-custom-${labelId}`}
        />
      )}
    </div>
  );
}
