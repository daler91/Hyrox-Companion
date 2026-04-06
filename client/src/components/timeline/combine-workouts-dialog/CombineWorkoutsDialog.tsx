import { ArrowRight,Loader2 } from "lucide-react";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { ScrollArea } from "@/components/ui/scroll-area";

import { CombinedResultSummary } from "./CombinedResultSummary";
import { FieldSelector } from "./FieldSelector";
import type { CombineWorkoutsDialogProps,FieldSource } from "./types";
import { WorkoutCard } from "./WorkoutCard";

export function CombineWorkoutsDialog({
  open,
  onOpenChange,
  entry1,
  entry2,
  onConfirm,
  isPending,
}: Readonly<CombineWorkoutsDialogProps>) {
  const initialFieldState = { source: "both" as FieldSource, customValue: "" };
  const [fields, setFields] = useState({
    focus: { ...initialFieldState },
    mainWorkout: { ...initialFieldState },
    notes: { ...initialFieldState },
  });

  const updateField = (key: keyof typeof fields, changes: Partial<typeof initialFieldState>) => {
    setFields((prev) => ({ ...prev, [key]: { ...prev[key], ...changes } }));
  };

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
      focus: getFieldValue(fields.focus.source, entry1.focus, entry2.focus, fields.focus.customValue),
      mainWorkout: getFieldValue(fields.mainWorkout.source, entry1.mainWorkout, entry2.mainWorkout, fields.mainWorkout.customValue, "\n---\n"),
      duration: combinedDuration || undefined,
      calories: combinedCalories || undefined,
      notes: getFieldValue(fields.notes.source, entry1.notes, entry2.notes, fields.notes.customValue, "\n\n") || undefined,
    };

    onConfirm(combinedWorkout);
  };

  const resetState = () => {
    setFields({
      focus: { ...initialFieldState },
      mainWorkout: { ...initialFieldState },
      notes: { ...initialFieldState },
    });
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

            <CombinedResultSummary duration={combinedDuration} calories={combinedCalories} />

            {/* Field selection */}
            <div className="space-y-4">
              <Label className="text-base font-semibold">Choose what to keep for each field</Label>
              {[
                { key: "focus" as const, label: "Focus", val1: entry1.focus, val2: entry2.focus },
                { key: "mainWorkout" as const, label: "Main Workout", val1: entry1.mainWorkout, val2: entry2.mainWorkout, isTextArea: true },
                { key: "notes" as const, label: "Notes", val1: entry1.notes, val2: entry2.notes, isTextArea: true }
              ].map(f => (
                <FieldSelector
                  key={f.key}
                  label={f.label}
                  entry1Value={f.val1}
                  entry2Value={f.val2}
                  source={fields[f.key].source}
                  onSourceChange={(source) => updateField(f.key, { source })}
                  customValue={fields[f.key].customValue}
                  onCustomChange={(customValue) => updateField(f.key, { customValue })}
                  isTextArea={f.isTextArea}
                />
              ))}
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
