with open('client/src/components/timeline/TimelineWorkoutCard.tsx', 'r') as f:
    content = f.read()

# Add missing Tooltip imports.
if 'import {\n  Tooltip,\n  TooltipContent,\n  TooltipTrigger,\n} from "@/components/ui/tooltip";' not in content:
    content = content.replace(
        'import { groupExerciseSets, formatExerciseSummary } from "@/lib/exercise-utils";',
        'import { groupExerciseSets, formatExerciseSummary } from "@/lib/exercise-utils";\nimport {\n  Tooltip,\n  TooltipContent,\n  TooltipTrigger,\n} from "@/components/ui/tooltip";'
    )

with open('client/src/components/timeline/TimelineWorkoutCard.tsx', 'w') as f:
    f.write(content)
