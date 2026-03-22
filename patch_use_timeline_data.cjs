const fs = require('fs');
const file = 'client/src/hooks/useTimelineData.ts';
let content = fs.readFileSync(file, 'utf8');

// Add import
const importRegex = /(import .*? from ".*?";\n)(?!import)/s;
content = content.replace(/(import { api, QUERY_KEYS } from "@\/lib\/api";)/, "$1\nimport { SCROLL_TO_TODAY_DELAY_MS } from \"./constants\";");

// Replace magic number 100 with SCROLL_TO_TODAY_DELAY_MS
content = content.replace(/setTimeout\(\(\) => \{\n\s+todayRef.current\?.scrollIntoView\(\{ behavior: "smooth", block: "center" \}\);\n\s+\}, 100\);/g, `setTimeout(() => {\n        todayRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });\n      }, SCROLL_TO_TODAY_DELAY_MS);`);

fs.writeFileSync(file, content);
