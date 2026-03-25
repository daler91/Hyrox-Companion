const fs = require('fs');
const file = 'client/src/pages/Timeline.tsx';
let content = fs.readFileSync(file, 'utf8');

content = content.replace(
  '<FloatingActionButton coachPanelOpen={coachOpen} onCoachToggle={() => setCoachOpen(!coachOpen)} />',
  '{!detailEntry && <FloatingActionButton coachPanelOpen={coachOpen} onCoachToggle={() => setCoachOpen(!coachOpen)} />}'
);

fs.writeFileSync(file, content);
console.log('Patched Timeline.tsx');
