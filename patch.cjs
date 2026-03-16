const fs = require('fs');

let content = fs.readFileSync('client/src/components/timeline/TimelineWorkoutCard.tsx', 'utf8');

// Replace imports
content = content.replace(
  'import { type TimelineEntry, type ExerciseSet, EXERCISE_DEFINITIONS, type ExerciseName } from "@shared/schema";',
  'import { type TimelineEntry, type ExerciseSet, EXERCISE_DEFINITIONS, type ExerciseName, type PersonalRecord } from "@shared/schema";'
);

// Remove interface definitions
content = content.replace(
  /interface PRValue \{[\s\S]*?\}\n\ninterface PREntry \{[\s\S]*?\}\n\n/,
  ''
);

// Replace PREntry with PersonalRecord
content = content.replace(
  /readonly personalRecords\?: Record<string, PREntry>;/g,
  'readonly personalRecords?: Record<string, PersonalRecord>;'
);

content = content.replace(
  /function hasPRInWorkout\(group: GroupedExercise, workoutLogId: string \| undefined, prs\?: Record<string, PREntry>\): boolean \{/g,
  'function hasPRInWorkout(group: GroupedExercise, workoutLogId: string | undefined, prs?: Record<string, PersonalRecord>): boolean {'
);

content = content.replace(
  /readonly personalRecords\?: Record<string, PREntry>;/g,
  'readonly personalRecords?: Record<string, PersonalRecord>;'
);

fs.writeFileSync('client/src/components/timeline/TimelineWorkoutCard.tsx', content);
