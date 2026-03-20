const fs = require('fs');

const routesWorkoutsFile = 'server/routes/workouts.ts';
let workoutsContent = fs.readFileSync(routesWorkoutsFile, 'utf8');

// The original import might not include ParsedExercise
// import { ... } from "@shared/schema";
// We need to add it. Let's find the "@shared/schema" import line.
if (!workoutsContent.includes('ParsedExercise')) {
  // handled already by earlier script actually, it IS in the file but not imported.
}
workoutsContent = workoutsContent.replace(
  /import \{([^}]+)\} from "@shared\/schema";/g,
  (match, p1) => {
    if (!p1.includes('ParsedExercise')) {
      return `import {${p1}, type ParsedExercise} from "@shared/schema";`;
    }
    return match;
  }
);

fs.writeFileSync(routesWorkoutsFile, workoutsContent);
