const fs = require('fs');
const path = 'client/src/pages/Timeline.tsx';
let content = fs.readFileSync(path, 'utf8');

const destructureRegex = /const \{\s*plans,\s*plansLoading,[\s\S]*?updatePlanGoalMutation,\s*\} = state;/m;
const match = content.match(destructureRegex);

if (match) {
  content = content.replace(match[0], '');
  content = content.replace(
    'const state = useTimelineState();\n  const scrollRef = useRef<HTMLDivElement>(null);',
    'const state = useTimelineState();\n  const scrollRef = useRef<HTMLDivElement>(null);\n  ' + match[0]
  );
  fs.writeFileSync(path, content);
  console.log("Timeline destructure fixed!");
} else {
  console.error("Could not find destructure block");
}
