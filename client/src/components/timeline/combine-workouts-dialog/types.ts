import type { TimelineEntry } from "@shared/schema";

export type FieldSource = "entry1" | "entry2" | "both" | "custom";

export interface CombineWorkoutsDialogProps {
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  readonly entry1: TimelineEntry | null;
  readonly entry2: TimelineEntry | null;
  readonly onConfirm: (combinedWorkout: {
    readonly date: string;
    readonly focus: string;
    readonly mainWorkout: string;
    readonly duration?: number;
    readonly calories?: number;
    readonly notes?: string;
  }) => void;
  isPending: boolean;
}

export interface WorkoutCardProps {
  readonly label: string;
  readonly entry: TimelineEntry;
  readonly variant: "primary" | "secondary";
}

export interface FieldSelectorProps {
  readonly label: string;
  readonly entry1Value: string | null | undefined;
  readonly entry2Value: string | null | undefined;
  readonly source: FieldSource;
  readonly onSourceChange: (source: FieldSource) => void;
  readonly customValue: string;
  readonly onCustomChange: (value: string) => void;
  readonly isTextArea?: boolean;
}
