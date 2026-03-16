const fs = require('fs');
const filepath = 'client/src/hooks/useWorkoutForm.ts';
let code = fs.readFileSync(filepath, 'utf8');

if (!code.includes('import type { InsertWorkoutLog, ParsedExercise }')) {
    code = 'import type { InsertWorkoutLog, ParsedExercise } from "@shared/schema";\n' + code;
}

code = code.replace(
    /mutationFn: async \(workoutData: Record<string, any>\) => {/,
    'mutationFn: async (workoutData: Omit<InsertWorkoutLog, "userId"> & { title?: string, exercises?: ParsedExercise[] }) => {'
);

fs.writeFileSync(filepath, code);
