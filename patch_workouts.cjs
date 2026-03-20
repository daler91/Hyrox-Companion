const fs = require('fs');

const routesWorkoutsFile = 'server/routes/workouts.ts';
let workoutsContent = fs.readFileSync(routesWorkoutsFile, 'utf8');

// The original line 204: const validatedExercises = exerciseValidation.data as any;
// And the createWorkout call: const result = await createWorkout(parseResult.data, validatedExercises as any, userId);

workoutsContent = workoutsContent.replace(/const validatedExercises = exerciseValidation\.data as any;/g, 'const validatedExercises = exerciseValidation.data as ParsedExercise[] | undefined;');
workoutsContent = workoutsContent.replace(/const result = await createWorkout\(parseResult\.data, validatedExercises as any, userId\);/g, 'const result = await createWorkout(parseResult.data, validatedExercises, userId);');
workoutsContent = workoutsContent.replace(/const result = await updateWorkout\(req\.params\.id, parseResult\.data, validatedExercises as any, userId\);/g, 'const result = await updateWorkout(req.params.id, parseResult.data, validatedExercises, userId);');

fs.writeFileSync(routesWorkoutsFile, workoutsContent);
