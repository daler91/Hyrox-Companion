const fs = require('fs');
const file = 'client/src/hooks/useOnboarding.ts';
let content = fs.readFileSync(file, 'utf8');

// Add import
content = content.replace(/(import { queryClient } from "@\/lib\/queryClient";)/, "$1\nimport { COACH_AUTO_OPEN_DELAY_MS, IMPORT_INPUT_DELAY_MS, MOBILE_BREAKPOINT_PX } from \"./constants\";");

// Replace magic numbers
content = content.replace(/globalThis\.innerWidth < 768/, 'globalThis.innerWidth < MOBILE_BREAKPOINT_PX');
content = content.replace(/\}, 500\);/g, '}, COACH_AUTO_OPEN_DELAY_MS);');
content = content.replace(/\}, 100\);/g, '}, IMPORT_INPUT_DELAY_MS);');

fs.writeFileSync(file, content);
