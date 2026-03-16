const fs = require('fs');
const path = require('path');

const filePath = path.join(__dirname, 'client/src/components/timeline/WorkoutDetailExercises.tsx');
let content = fs.readFileSync(filePath, 'utf8');

// Fix the syntax error around lines 529-533
content = content.replace(
  '  stopAllVoiceRef,\n,\n  editRpe,\n  setEditRpe,\n  source}: WorkoutDetailEditFormProps) {',
  '  stopAllVoiceRef,\n  editRpe,\n  setEditRpe,\n  source,\n}: WorkoutDetailEditFormProps) {'
);

fs.writeFileSync(filePath, content, 'utf8');
console.log("Syntax patched");
