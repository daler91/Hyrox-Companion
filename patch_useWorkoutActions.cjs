const fs = require('fs');
const filepath = 'client/src/hooks/useWorkoutActions.ts';
let code = fs.readFileSync(filepath, 'utf8');

if (!code.includes('import type { UpdateWorkoutLog }')) {
    code = code.replace(
        /import \{ type ParsedExercise, type TimelineEntry, type PlanDay, type WorkoutStatus \} from "@shared\/schema";/,
        'import { type ParsedExercise, type TimelineEntry, type PlanDay, type WorkoutStatus, type UpdateWorkoutLog } from "@shared/schema";'
    );
}

code = code.replace(
    /mutationFn: async \(\{ workoutId, updates \}: \{ workoutId: string; updates: Record<string, any> \}\) => \{/,
    'mutationFn: async ({ workoutId, updates }: { workoutId: string; updates: UpdateWorkoutLog & { exercises?: ParsedExercise[] } }) => {'
);

fs.writeFileSync(filepath, code);
