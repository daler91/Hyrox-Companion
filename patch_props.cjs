const fs = require('fs');
const path = require('path');

const filePath = path.join(__dirname, 'client/src/components/timeline/WorkoutDetailExercises.tsx');
let content = fs.readFileSync(filePath, 'utf8');

// Update WorkoutDetailEditFormProps interface
const oldPropsStr = `
  onParseText: () => void;
  stopAllVoiceRef?: React.MutableRefObject<(() => void) | null>;
}
`;

const newPropsStr = `
  onParseText: () => void;
  stopAllVoiceRef?: React.MutableRefObject<(() => void) | null>;
  editRpe: number | null;
  setEditRpe: (rpe: number | null) => void;
  source?: string;
}
`;

content = content.replace(oldPropsStr, newPropsStr);

// Also need to add RpeSelector import if it's not there
if (!content.includes('import { RpeSelector }')) {
  content = content.replace(
    'import { VoiceFieldButton } from "@/components/VoiceFieldButton";',
    'import { VoiceFieldButton } from "@/components/VoiceFieldButton";\nimport { RpeSelector } from "@/components/RpeSelector";'
  );
}

fs.writeFileSync(filePath, content, 'utf8');
console.log("WorkoutDetailEditFormProps patched.");
