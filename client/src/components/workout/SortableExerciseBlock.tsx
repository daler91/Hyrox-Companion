import React from "react";
import { ExerciseInput } from "@/components/ExerciseInput";
import { GripVertical } from "lucide-react";
import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";

export interface SortableExerciseBlockProps {
  readonly blockId: string;
  readonly exData: React.ComponentProps<typeof ExerciseInput>["exercise"];
  readonly blockLabel?: string;
  readonly weightUnit: "kg" | "lbs";
  readonly distanceUnit: "km" | "miles";
  readonly onChange: (blockId: string, ex: React.ComponentProps<typeof ExerciseInput>["exercise"]) => void;
  readonly onRemove: (blockId: string) => void;
}

export function SortableExerciseBlock({ blockId, exData, blockLabel, weightUnit, distanceUnit, onChange, onRemove }: Readonly<SortableExerciseBlockProps>) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: blockId });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
    position: "relative" as const,
  };

  return (
    <div ref={setNodeRef} style={style}>
      <div className="absolute left-0 top-3 z-10 cursor-grab active:cursor-grabbing touch-none p-1" {...attributes} {...listeners} data-testid={`drag-handle-${blockId}`}>
        <GripVertical className="h-4 w-4 text-muted-foreground" />
      </div>
      <div className="pl-6">
        <ExerciseInput
          exercise={exData}
          onChange={(ex) => onChange(blockId, ex)}
          onRemove={() => onRemove(blockId)}
          weightUnit={weightUnit}
          distanceUnit={distanceUnit}
          blockLabel={blockLabel}
        />
      </div>
    </div>
  );
}
