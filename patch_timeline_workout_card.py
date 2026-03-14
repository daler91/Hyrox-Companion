import re

with open('client/src/components/timeline/TimelineWorkoutCard.tsx', 'r') as f:
    content = f.read()

# Add Tooltip imports
if 'Tooltip' not in content:
    content = content.replace(
        'import { groupExerciseSets, formatExerciseSummary } from "@/lib/exercise-utils";',
        'import { groupExerciseSets, formatExerciseSummary } from "@/lib/exercise-utils";\nimport {\n  Tooltip,\n  TooltipContent,\n  TooltipTrigger,\n} from "@/components/ui/tooltip";'
    )

# Replace the Button with Tooltip wrapped Button
button_target = """          {isPlanned && (
            <Button
              size="icon"
              variant="ghost"
              className="shrink-0 mt-0.5 text-muted-foreground hover:text-success"
              onClick={handleCompleteClick}
              data-testid={`button-complete-${entry.id}`}
              aria-label={`Mark ${entry.focus} as complete`}
            >
              <Circle className="h-5 w-5" />
            </Button>
          )}"""

button_replacement = """          {isPlanned && (
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  size="icon"
                  variant="ghost"
                  className="shrink-0 mt-0.5 text-muted-foreground hover:text-success"
                  onClick={handleCompleteClick}
                  data-testid={`button-complete-${entry.id}`}
                  aria-label={`Mark ${entry.focus} as complete`}
                >
                  <Circle className="h-5 w-5" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>
                <p>Mark {entry.focus} as complete</p>
              </TooltipContent>
            </Tooltip>
          )}"""

content = content.replace(button_target, button_replacement)

with open('client/src/components/timeline/TimelineWorkoutCard.tsx', 'w') as f:
    f.write(content)
