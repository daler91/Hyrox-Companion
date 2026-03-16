const fs = require('fs');
const path = require('path');

const filePath = path.join(__dirname, 'client/src/components/timeline/WorkoutDetailDialog.tsx');
let content = fs.readFileSync(filePath, 'utf8');

// Replace WorkoutDetailEditForm props
content = content.replace(
  'stopAllVoiceRef={stopAllVoiceRef}',
  'stopAllVoiceRef={stopAllVoiceRef}\n              editRpe={editRpe}\n              setEditRpe={setEditRpe}\n              source={entry.source}'
);

// Remove the inline RpeSelector below WorkoutDetailEditForm
const rpeSelectorToRemove = `
            {entry.source !== "strava" && (
              <RpeSelector value={editRpe} onChange={setEditRpe} compact />
            )}
`;
if (content.includes(rpeSelectorToRemove)) {
    content = content.replace(rpeSelectorToRemove, '\n');
} else {
    // try slightly different whitespace
    const rpeRegex = /\{entry\.source !== "strava" && \(\s*<RpeSelector value=\{editRpe\} onChange=\{setEditRpe\} compact \/>\s*\)\}/;
    content = content.replace(rpeRegex, '');
}

fs.writeFileSync(filePath, content, 'utf8');
console.log("Patch applied to WorkoutDetailDialog props and removed inline RpeSelector");
