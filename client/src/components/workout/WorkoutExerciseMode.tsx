import {
  EXERCISE_DEFINITIONS,
  type ExerciseCategory,
  type ExerciseName,
} from "@shared/schema";
import { Plus } from "lucide-react";
import { useMemo, useState } from "react";

import type { StructuredExercise } from "@/components/ExerciseInput";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent,TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ExerciseRow, type ExerciseRowBlock } from "@/components/workout/ExerciseRow";
import { categoryLabels } from "@/lib/exerciseUtils";

const TAB_TRIGGER_CLASS =
  "shrink-0 rounded-full border border-border bg-card px-4 py-2 text-sm font-medium " +
  "data-[state=active]:bg-primary data-[state=active]:text-primary-foreground " +
  "data-[state=active]:border-primary data-[state=active]:shadow-none";

const TAB_LIST_CLASS =
  "flex h-auto w-full justify-start gap-2 overflow-x-auto scrollbar-none bg-transparent p-0";

const noop = () => {};

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

  const renderRow = (
    name: ExerciseName,
    displayLabel: string,
    blocks: ExerciseRowBlock[],
    overrides?: { key?: string; isExpanded?: boolean; onToggle?: () => void; showCustomNameInput?: boolean },
  ) => {
    const add = () => handleAdd(name);
    return (
      <ExerciseRow
        key={overrides?.key ?? name}
        exerciseName={name}
        displayLabel={displayLabel}
        blocks={blocks}
        isExpanded={overrides?.isExpanded ?? expanded.has(name)}
        onToggle={overrides?.onToggle ?? (() => toggleExpanded(name))}
        onAdd={add}
        onDuplicate={add}
        onUpdateBlock={updateBlock}
        onRemoveBlock={removeBlock}
        weightUnit={weightUnit}
        distanceUnit={distanceUnit}
        showCustomNameInput={overrides?.showCustomNameInput}
      />
    );
  };

  return (
    <div className="space-y-4" data-testid="exercise-selector">
      <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as TabValue)}>
        <TabsList className={TAB_LIST_CLASS}>
          {(categoryOrder as TabValue[]).concat("custom").map((cat) => (
            <TabsTrigger
              key={cat}
              value={cat}
              className={TAB_TRIGGER_CLASS}
              data-testid={`tab-${cat}`}
            >
              {tabLabels[cat]}
            </TabsTrigger>
          ))}
        </TabsList>

        {exercisesByCategory.map(({ category, exercises }) => (
          <TabsContent key={category} value={category} className="mt-4 space-y-2 min-h-[400px]">
            {exercises.map(([name, def]) =>
              renderRow(name, def.label, blocksByName.get(name) ?? []),
            )}
          </TabsContent>
        ))}

        <TabsContent value="custom" className="mt-4 space-y-3 min-h-[400px]">
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
            customBlocks.map((block) =>
              renderRow("custom", block.data.customLabel || "Custom exercise", [block], {
                key: block.blockId,
                isExpanded: true,
                onToggle: noop,
                showCustomNameInput: true,
              }),
            )
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
};
