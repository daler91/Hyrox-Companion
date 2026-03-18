const fs = require('fs');
const path = require('path');

const filePath = path.join('client', 'src', 'components', 'timeline', 'WorkoutDetailExercises.tsx');
let content = fs.readFileSync(filePath, 'utf8');

// The issue might be that useCallback and useToast are imported but not used anymore.
// Let's check if they are used.
const isUseCallbackUsed = content.match(/useCallback\(/g) !== null;
const isUseToastUsed = content.match(/useToast\(\)/g) !== null;

console.log('useCallback used:', isUseCallbackUsed);
console.log('useToast used:', isUseToastUsed);

if (!isUseCallbackUsed) {
  content = content.replace(/,\s*useCallback\s*/, '');
}

if (!isUseToastUsed) {
  content = content.replace(/import \{ useToast \} from "@\/hooks\/use-toast";\n/, '');
}

fs.writeFileSync(filePath, content, 'utf8');
