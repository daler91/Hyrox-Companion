import { useMemo, useState } from "react";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Plus } from "lucide-react";
import { ExerciseRow, type ExerciseRowBlock } from "@/components/workout/ExerciseRow";
import type { StructuredExercise } from "@/components/ExerciseInput";
import {
  EXERCISE_DEFINITIONS,
  type ExerciseName,
  type ExerciseCategory,
} from "@shared/schema";
import { categoryLabels } from "@/lib/exerciseUtils";
import { cn } from "@/lib/utils";

interface WorkoutExerciseModeProps {
  exerciseBlocks: string[];
  exerciseData: Record<string, StructuredExercise>;
  addExercise: (exercise: ExerciseName) => void;
  updateBlock: (blockId: string, exData: StructuredExercise) => void;
  removeBlock: (blockId: string) => void;
  weightUnit: "kg" | "lbs";
  distanceUnit: "km" | "miles";
}

const categoryOrder: ExerciseCategory[] = [
  "functional",
  "running",
  "strength",
  "conditioning",
];

type TabValue = ExerciseCategory | "custom";

const tabLabels: Record<TabValue, string> = {
  ...(categoryLabels as Record<ExerciseCategory, string>),
  custom: "Custom",
};

// Static list of built-in exercises grouped by category (excluding "custom").
const exercisesByCategory = categoryOrder.map((cat) => ({
  category: cat,
  exercises: (
    Object.entries(EXERCISE_DEFINITIONS) as Array<
      [ExerciseName, (typeof EXERCISE_DEFINITIONS)[ExerciseName]]
    >
  ).filter(([name, def]) => def.category === cat && name !== "custom"),
}));

export const WorkoutExerciseMode = ({
  exerciseBlocks,
  exerciseData,
  addExercise,
  updateBlock,
  removeBlock,
  weightUnit,
  distanceUnit,
}: Readonly<WorkoutExerciseModeProps>) => {
  const [activeTab, setActiveTab] = useState<TabValue>("strength");
  const [expanded, setExpanded] = useState<Set<ExerciseName>>(new Set());

  // Group existing blocks by exerciseName for quick lookup.
  const blocksByName = useMemo(() => {
    const map = new Map<ExerciseName, ExerciseRowBlock[]>();
    for (const blockId of exerciseBlocks) {
      const data = exerciseData[blockId];
      if (!data) continue;
      const list = map.get(data.exerciseName) ?? [];
      list.push({ blockId, data });
      map.set(data.exerciseName, list);
    }
    return map;
  }, [exerciseBlocks, exerciseData]);

  const toggleExpanded = (name: ExerciseName) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });
  };

  const handleAdd = (name: ExerciseName) => {
    addExercise(name);
    setExpanded((prev) => new Set(prev).add(name));
  };

  const customBlocks: ExerciseRowBlock[] = blocksByName.get("custom") ?? [];

  return (
    <div className="space-y-4" data-testid="exercise-selector">
      <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as TabValue)}>
        <TabsList
          className={cn(
            "flex h-auto w-full justify-start gap-2 overflow-x-auto scrollbar-none",
            "bg-transparent p-0",
          )}
        >
          {categoryOrder.map((cat) => (
            <TabsTrigger
              key={cat}
              value={cat}
              className={cn(
                "shrink-0 rounded-full border border-border bg-card px-4 py-2 text-sm font-medium",
                "data-[state=active]:bg-primary data-[state=active]:text-primary-foreground data-[state=active]:border-primary data-[state=active]:shadow-none",
              )}
              data-testid={`tab-${cat}`}
            >
              {tabLabels[cat]}
            </TabsTrigger>
          ))}
          <TabsTrigger
            value="custom"
            className={cn(
              "shrink-0 rounded-full border border-border bg-card px-4 py-2 text-sm font-medium",
              "data-[state=active]:bg-primary data-[state=active]:text-primary-foreground data-[state=active]:border-primary data-[state=active]:shadow-none",
            )}
            data-testid="tab-custom"
          >
            Custom
          </TabsTrigger>
        </TabsList>

        {exercisesByCategory.map(({ category, exercises }) => (
          <TabsContent key={category} value={category} className="mt-4 space-y-2">
            {exercises.map(([name, def]) => {
              const blocks = blocksByName.get(name) ?? [];
              return (
                <ExerciseRow
                  key={name}
                  exerciseName={name}
                  displayLabel={def.label}
                  blocks={blocks}
                  isExpanded={expanded.has(name)}
                  onToggle={() => toggleExpanded(name)}
                  onAdd={() => handleAdd(name)}
                  onDuplicate={() => handleAdd(name)}
                  onUpdateBlock={updateBlock}
                  onRemoveBlock={removeBlock}
                  weightUnit={weightUnit}
                  distanceUnit={distanceUnit}
                />
              );
            })}
          </TabsContent>
        ))}

        <TabsContent value="custom" className="mt-4 space-y-3">
          <Button
            type="button"
            variant="outline"
            className="w-full"
            onClick={() => handleAdd("custom")}
            data-testid="button-add-custom-exercise"
          >
            <Plus className="h-4 w-4 mr-1.5" />
            Add custom exercise
          </Button>
          {customBlocks.length === 0 ? (
            <p className="text-center text-sm text-muted-foreground py-6">
              No custom exercises yet. Tap above to create one.
            </p>
          ) : (
            customBlocks.map((block) => (
              <ExerciseRow
                key={block.blockId}
                exerciseName="custom"
                displayLabel={block.data.customLabel || "Custom exercise"}
                blocks={[block]}
                isExpanded
                onToggle={() => {}}
                onAdd={() => handleAdd("custom")}
                onDuplicate={() => handleAdd("custom")}
                onUpdateBlock={updateBlock}
                onRemoveBlock={removeBlock}
                weightUnit={weightUnit}
                distanceUnit={distanceUnit}
                showCustomNameInput
              />
            ))
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
};
