import { EXERCISE_DEFINITIONS, EXERCISE_NAME_ALIASES, type ExerciseCategory,type ExerciseName } from "@shared/schema";
import { Plus, Search } from "lucide-react";
import React from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { exerciseIcons } from "@/lib/exerciseIcons";
import { categoryLabels } from "@/lib/exerciseUtils";

interface ExerciseSelectorProps {
  readonly selectedExercises: ExerciseName[];
  readonly onToggle: (name: ExerciseName) => void;
  readonly onAdd?: (name: ExerciseName) => void;
  readonly allowDuplicates?: boolean;
}

const selectorCategoryLabels: Record<ExerciseCategory, string> = {
  ...categoryLabels,
  functional: "Functional",
} as Record<ExerciseCategory, string>;

const categoryOrder: ExerciseCategory[] = ["functional", "running", "strength", "conditioning"];

// ⚡ Bolt Performance Optimization:
// Move static array allocation and filtering outside of the component.
// This prevents O(N) object entries allocation and O(N) array filtering
// from running on every single render of the ExerciseSelector.
const exercisesByCategory = categoryOrder.map(cat => ({
  category: cat,
  label: selectorCategoryLabels[cat],
  exercises: (Object.entries(EXERCISE_DEFINITIONS) as [ExerciseName, typeof EXERCISE_DEFINITIONS[ExerciseName]][])
    .filter(([name, def]) => def.category === cat && name !== "emom"),
}));

function normalizeSearchText(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim().replace(/\s+/g, " ");
}

const exerciseAliasesByName = Object.entries(EXERCISE_NAME_ALIASES).reduce<Partial<Record<ExerciseName, string[]>>>(
  (aliasesByName, [alias, exerciseName]) => {
    aliasesByName[exerciseName] = [...(aliasesByName[exerciseName] ?? []), alias, alias.replaceAll("_", " ")];
    return aliasesByName;
  },
  {},
);

const exerciseSearchTokens = (Object.entries(EXERCISE_DEFINITIONS) as [ExerciseName, typeof EXERCISE_DEFINITIONS[ExerciseName]][])
  .reduce<Record<ExerciseName, string[]>>((tokensByName, [name, def]) => {
    const rawTokens = [name, name.replaceAll("_", " "), def.label, ...(exerciseAliasesByName[name] ?? [])];
    const tokens = new Set<string>();

    for (const rawToken of rawTokens) {
      const normalized = normalizeSearchText(rawToken);
      if (!normalized) continue;
      tokens.add(normalized);
      tokens.add(normalized.replace(/\s/g, ""));
    }

    tokensByName[name] = [...tokens];
    return tokensByName;
  }, {} as Record<ExerciseName, string[]>);

function exerciseMatchesSearch(name: ExerciseName, searchTerm: string, compactSearchTerm: string): boolean {
  if (!searchTerm) return true;
  return exerciseSearchTokens[name].some((token) => token.includes(searchTerm) || token.includes(compactSearchTerm));
}

export function ExerciseSelector({ selectedExercises, onToggle, onAdd, allowDuplicates = false }: Readonly<ExerciseSelectorProps>) {
  const [searchQuery, setSearchQuery] = React.useState("");
  const selectedCounts = React.useMemo(() => {
    const counts: Partial<Record<ExerciseName, number>> = {};
    for (const name of selectedExercises) {
      counts[name] = (counts[name] || 0) + 1;
    }
    return counts;
  }, [selectedExercises]);

  const filteredExercisesByCategory = React.useMemo(() => {
    const searchTerm = normalizeSearchText(searchQuery);
    const compactSearchTerm = searchTerm.replace(/\s/g, "");

    return exercisesByCategory
      .map(group => ({
        ...group,
        exercises: group.exercises.filter(([name]) => exerciseMatchesSearch(name, searchTerm, compactSearchTerm)),
      }))
      .filter(group => group.exercises.length > 0);
  }, [searchQuery]);

  const countOf = (name: ExerciseName) => selectedCounts[name] || 0;

  return (
    <div className="space-y-4" data-testid="exercise-selector">
      <div className="relative">
        <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
        <Input
          type="search"
          value={searchQuery}
          onChange={(event) => setSearchQuery(event.target.value)}
          placeholder="Search exercises"
          aria-label="Search exercises"
          autoComplete="off"
          className="pl-9"
          data-testid="exercise-selector-search"
        />
      </div>

      <div className="rounded-md border border-dashed bg-muted/30 px-3 py-2 text-xs text-muted-foreground" data-testid="exercise-selector-emom-help">
        EMOM is configured as a block, not a single exercise.
      </div>

      {filteredExercisesByCategory.length === 0 && (
        <div className="rounded-md border border-dashed border-border px-3 py-4 text-center text-sm text-muted-foreground" role="status" aria-live="polite" data-testid="exercise-selector-empty">
          No matching exercises
        </div>
      )}

      {filteredExercisesByCategory.map(({ category, label, exercises }) => (
        <div key={category}>
          <p className="text-xs font-medium text-muted-foreground mb-2">{label}</p>
          <div className="flex flex-wrap gap-2">
            {exercises.map(([name, def]) => {
              const count = countOf(name);
              const isSelected = count > 0;
              const Icon = exerciseIcons[name] || Plus;
              return (
                <Button
                  key={name}
                  variant={isSelected ? "default" : "outline"}
                  size="sm"
                  aria-pressed={allowDuplicates ? undefined : isSelected}
                  onClick={() => {
                    if (allowDuplicates && onAdd) {
                      onAdd(name);
                    } else {
                      onToggle(name);
                    }
                  }}
                  data-testid={`button-exercise-${name}`}
                >
                  <Icon className="h-3.5 w-3.5 mr-1.5" />
                  {def.label}
                  {allowDuplicates && count > 0 && (
                    <Badge variant="secondary" className="ml-1.5 h-4 min-w-[1rem] px-1 text-[10px]">
                      {count}
                    </Badge>
                  )}
                </Button>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
}
