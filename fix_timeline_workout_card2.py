with open('client/src/components/timeline/TimelineWorkoutCard.tsx', 'r') as f:
    content = f.read()

# Add missing Tooltip imports.
content = content.replace(
    'import { categoryChipColors, groupExerciseSets, formatExerciseSummary, type GroupedExercise } from "@/lib/exerciseUtils";',
    'import { categoryChipColors, groupExerciseSets, formatExerciseSummary, type GroupedExercise } from "@/lib/exerciseUtils";\nimport {\n  Tooltip,\n  TooltipContent,\n  TooltipTrigger,\n} from "@/components/ui/tooltip";'
)

with open('client/src/components/timeline/TimelineWorkoutCard.tsx', 'w') as f:
    f.write(content)
