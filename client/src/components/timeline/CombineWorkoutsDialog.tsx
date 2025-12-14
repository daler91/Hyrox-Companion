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
import { Loader2, ArrowRight } from "lucide-react";
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

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="max-w-2xl max-h-[90vh]">
        <DialogHeader>
          <DialogTitle>Combine Workouts</DialogTitle>
          <DialogDescription>
            Choose which fields to keep from each workout, or combine them together.
          </DialogDescription>
        </DialogHeader>

        <ScrollArea className="max-h-[60vh] pr-4">
          <div className="space-y-6">
            <FieldSelector
              label="Focus"
              entry1Value={entry1.focus}
              entry2Value={entry2.focus}
              source={focusSource}
              onSourceChange={setFocusSource}
              customValue={customFocus}
              onCustomChange={setCustomFocus}
              preview={getFieldValue(focusSource, entry1.focus, entry2.focus, customFocus)}
            />

            <FieldSelector
              label="Main Workout"
              entry1Value={entry1.mainWorkout}
              entry2Value={entry2.mainWorkout}
              source={workoutSource}
              onSourceChange={setWorkoutSource}
              customValue={customWorkout}
              onCustomChange={setCustomWorkout}
              preview={getFieldValue(workoutSource, entry1.mainWorkout, entry2.mainWorkout, customWorkout, "\n---\n")}
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
              preview={getFieldValue(notesSource, entry1.notes, entry2.notes, customNotes, "\n\n")}
              isTextArea
            />

            <div className="rounded-md border p-4 bg-muted/50">
              <Label className="text-sm font-medium">Auto-combined values</Label>
              <div className="mt-2 text-sm text-muted-foreground space-y-1">
                {(entry1.duration || entry2.duration) && (
                  <p>Duration: {(entry1.duration || 0) + (entry2.duration || 0)} min</p>
                )}
                {(entry1.calories || entry2.calories) && (
                  <p>Calories: {(entry1.calories || 0) + (entry2.calories || 0)}</p>
                )}
              </div>
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

interface FieldSelectorProps {
  label: string;
  entry1Value: string | null | undefined;
  entry2Value: string | null | undefined;
  source: FieldSource;
  onSourceChange: (source: FieldSource) => void;
  customValue: string;
  onCustomChange: (value: string) => void;
  preview: string;
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
  preview,
  isTextArea = false,
}: FieldSelectorProps) {
  const truncate = (text: string | null | undefined, maxLen: number = 60) => {
    if (!text) return "(empty)";
    if (text.length <= maxLen) return text;
    return text.substring(0, maxLen) + "...";
  };

  return (
    <div className="space-y-3">
      <Label className="text-base font-semibold">{label}</Label>
      
      <RadioGroup
        value={source}
        onValueChange={(val) => onSourceChange(val as FieldSource)}
        className="space-y-2"
      >
        <div className="flex items-start gap-3">
          <RadioGroupItem value="entry1" id={`${label}-entry1`} className="mt-1" />
          <Label htmlFor={`${label}-entry1`} className="font-normal cursor-pointer flex-1">
            <span className="text-sm font-medium text-muted-foreground">Workout 1:</span>
            <span className="block text-sm mt-0.5">{truncate(entry1Value)}</span>
          </Label>
        </div>
        
        <div className="flex items-start gap-3">
          <RadioGroupItem value="entry2" id={`${label}-entry2`} className="mt-1" />
          <Label htmlFor={`${label}-entry2`} className="font-normal cursor-pointer flex-1">
            <span className="text-sm font-medium text-muted-foreground">Workout 2:</span>
            <span className="block text-sm mt-0.5">{truncate(entry2Value)}</span>
          </Label>
        </div>
        
        <div className="flex items-start gap-3">
          <RadioGroupItem value="both" id={`${label}-both`} className="mt-1" />
          <Label htmlFor={`${label}-both`} className="font-normal cursor-pointer">
            Combine both
          </Label>
        </div>
        
        <div className="flex items-start gap-3">
          <RadioGroupItem value="custom" id={`${label}-custom`} className="mt-1" />
          <Label htmlFor={`${label}-custom`} className="font-normal cursor-pointer">
            Custom value
          </Label>
        </div>
      </RadioGroup>

      {source === "custom" && (
        <Textarea
          value={customValue}
          onChange={(e) => onCustomChange(e.target.value)}
          placeholder={`Enter custom ${label.toLowerCase()}...`}
          rows={isTextArea ? 4 : 2}
          className="mt-2"
          data-testid={`input-custom-${label.toLowerCase().replace(/\s+/g, "-")}`}
        />
      )}

      {source !== "custom" && preview && (
        <div className="rounded-md border p-3 bg-background">
          <Label className="text-xs text-muted-foreground uppercase tracking-wide">Preview</Label>
          <p className={`text-sm mt-1 ${isTextArea ? 'whitespace-pre-wrap' : ''}`}>
            {truncate(preview, 200)}
          </p>
        </div>
      )}
    </div>
  );
}
