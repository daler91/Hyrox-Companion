const fs = require('fs');
const path = 'client/src/pages/Timeline.tsx';
let content = fs.readFileSync(path, 'utf8');
content = content.replace('getDateLabel = (d)', 'getDateLabel = (d: Date)');
fs.writeFileSync(path, content);
