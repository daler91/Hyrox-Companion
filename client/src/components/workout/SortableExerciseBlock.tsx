import { ExerciseInput, type StructuredExercise } from "@/components/ExerciseInput";
import { GripVertical } from "lucide-react";
import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";

export interface SortableExerciseBlockProps {
  blockId: string;
  exData: StructuredExercise;
  blockLabel?: string;
  weightUnit: "kg" | "lbs";
  distanceUnit: "km" | "miles";
  onChange: (blockId: string, ex: StructuredExercise) => void;
  onRemove: (blockId: string) => void;
}

export function SortableExerciseBlock({ blockId, exData, blockLabel, weightUnit, distanceUnit, onChange, onRemove }: SortableExerciseBlockProps) {
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
